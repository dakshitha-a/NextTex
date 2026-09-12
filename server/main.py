"""The NextTex server.

A single uvicorn process serves the built frontend, the API and the event
stream. There is no nginx and no container: this runs on one person's
machine, for that person, and every extra moving part is one more thing
between someone cloning the repository and having an editor open.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import json
import os
import mimetypes
import secrets
import shutil
import subprocess
import tempfile
import time
import zipfile
from functools import partial
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from starlette.background import BackgroundTask
from fastapi import (
    Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import (
    FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

from nexttex import attachments, auth, claude_auth, gitrepo, synctex
from server.collab import transport as collab_transport
from server.collab.peers import PeerNetwork
from server.collab.store import CollabStore
from server.transcript import TranscriptError
from nexttex.atomic import (
    NotAFile, read_bytes, read_text, unique_name, write_atomically,
)
from nexttex.compile import CompileScheduler, ProjectPaths
from nexttex.config import Settings, ensure_tex_on_path, missing_tools
from nexttex import references
from nexttex.library import (
    MAX_PDFS as LIBRARY_MAX, Library, Scan, have_pdftotext,
    title_is_on_the_page, walk as library_walk,
)
from nexttex.openai_agent import DEFAULT_MODEL as OPENAI_DEFAULT_MODEL
from nexttex.providers import PROVIDERS
from nexttex.context import KINDS, MEMORY_MAX_CHARS
from nexttex.project import (
    Project, ProjectConfig, Registry, id_for, instance_name, is_control_path,
    is_ours,
)
from nexttex.symbols import walk_project
from nexttex import deps, updates
from nexttex.install.ui import child_env
from server.session import CLOSED, ProjectSession, spawn

log = logging.getLogger("nexttex.server")

SESSIONS: dict[str, ProjectSession] = {}
# One folder-read per project at a time.  A second would race the first
# over the same .bib file for no benefit -- the network is the bottleneck.
LIBRARY_JOBS: dict[str, Scan] = {}
# Stop events for the running file watch.  Setting one makes the watcher
# restart against the current set of open projects.
WATCH_RESTART: list[asyncio.Event] = []
SETTINGS = Settings.load()
REGISTRY = Registry()

# Where this install lives, which is the thing an update updates.  The
# override exists for the browser tests, which need a repository whose
# remote they control rather than the real one.
INSTALL_ROOT = Path(
    os.environ.get("NEXTTEX_INSTALL_ROOT") or Path(__file__).resolve().parent.parent
)
UPDATES = updates.Cache(INSTALL_ROOT)
# Regenerated every time the process starts.  A page waiting for a restart
# asks "is this a different process", not "is the code different": an update
# that pulls nothing still restarts, and the commit would not have moved.
BOOT = secrets.token_hex(8)


def _head_now() -> str:
    """The commit the working tree is on, right now."""
    try:
        return gitrepo._run(INSTALL_ROOT, "rev-parse", "--short", "HEAD").strip()
    except gitrepo.GitError:
        return ""


#: The commit this process loaded, read once, here, before anything can move
#: it. Reading it at request time reads the working tree, which is a
#: different fact and was being reported as this one: an install whose files
#: have moved forward without a restart answered with the new commit while
#: running the old code, and the update footer, comparing that same disk
#: commit against the remote, said it was up to date. A Windows laptop was
#: found serving day-old code and being told three times over that it was
#: current.
HEAD_AT_BOOT = _head_now()
# One update at a time, and the log is kept so a tab that arrives late -- or
# reloads mid-update -- can be shown what has happened so far.
UPDATE_JOB: dict[str, object] = {}

COOKIE = "nexttex_token"
FRONTEND = Path(__file__).resolve().parent.parent / "frontend" / "dist"


# ---------------------------------------------------------------------------
# Lifecycle


@asynccontextmanager
async def lifespan(app: FastAPI):
    tex = ensure_tex_on_path()
    print(f"  LaTeX      {tex or 'NOT FOUND, so compiling will fail'}")
    for item in missing_tools():
        print(f"  missing    {item}")
    watcher = asyncio.create_task(_watch_projects())
    reaper = asyncio.create_task(_reap_idle())
    rejoin = asyncio.create_task(_rejoin_shared_projects())
    warm = asyncio.create_task(_warm_the_agent())
    try:
        yield
    finally:
        watcher.cancel()
        reaper.cancel()
        rejoin.cancel()
        warm.cancel()
        for pending in list(PENDING_JOINS.values()):
            PENDING_JOINS.pop(pending.token, None)
            await pending.release(keep=False)
        for session in list(SESSIONS.values()):
            await session.close()


async def _warm_the_agent() -> None:
    """Import the agent SDK now, while nobody is waiting for it.

    `providers.agent_for` imports it the first time a project is opened, and
    deliberately: an install that chose OpenAI, or no agent at all, should
    never load it. The cost of that is six hundred milliseconds -- the SDK
    pulls in `mcp`, which builds several hundred pydantic models -- and it
    was being paid by the first person to open a project after a restart,
    which is to say by every update.

    So it is done here instead, on a thread because it is a synchronous
    import that would otherwise stall the event loop, and only for an
    install actually configured for Claude. Nothing depends on it finishing:
    if it has not by the time a project opens, the import happens there as
    it always did, and if it fails the same failure is reported the same way.
    """
    if SETTINGS.provider not in ("claude", ""):
        return

    def load() -> None:
        try:
            import nexttex.agent  # noqa: F401
        except Exception:
            # An install without the SDK says so when somebody asks a
            # question. It is not something to report at startup.
            pass

    try:
        await asyncio.get_running_loop().run_in_executor(None, load)
    except Exception:
        pass


async def _rejoin_shared_projects() -> None:
    """Open every shared project, so its peers can reach it again.

    A project is otherwise opened on demand, by somebody looking at it -- and
    that is right for a project nobody else has. It is wrong for a shared
    one: the peer is this server rather than the browser, which is what lets
    a collaborator's work arrive while the tab is shut, and after a restart
    there was no session to arrive at until somebody clicked the project.
    So the promise held all day and quietly stopped holding across a restart,
    which is exactly when nobody is watching.

    Only projects that have been shared, and only their peer network -- a
    private project still costs nothing and contacts nothing.
    """
    await asyncio.sleep(0.5)          # let the sockets bind first
    for entry in REGISTRY.list():
        if entry.get("missing"):
            continue
        root = Path(entry["path"])
        if not (root / ".nexttex" / "collab" / "share.json").is_file():
            continue
        try:
            session_for(Project.open(root).id)
        except Exception:
            # A project that has been moved or deleted since. The projects
            # screen already says so; this is not the place to complain.
            continue


async def _watch_projects() -> None:
    """Tell the browser when files change underneath it.

    An external edit -- a git pull, a checkout, the user's own editor -- has
    to reach the open tab, or it will save over changes it never saw.  Our
    *own* writes must not: the browser would then be told to reload the
    buffer it just sent us, discarding whatever was typed in the meantime.
    """
    from watchfiles import awatch

    while True:
        roots = [Path(s.project.root) for s in SESSIONS.values()]
        if not roots:
            await asyncio.sleep(1.0)
            continue
        stop = asyncio.Event()
        WATCH_RESTART.append(stop)
        try:
            # `step` is the poll interval; `debounce` is the window over which
            # changes are coalesced, and its default of 1600 ms would make an
            # external edit take nearly two seconds to appear.
            async for changes in awatch(
                *roots, step=120, debounce=300, recursive=True, stop_event=stop
            ):
                touched: dict[str, set[str]] = {}
                for _change, raw in changes:
                    path = Path(raw)
                    for session in SESSIONS.values():
                        root = session.project.root
                        if root not in path.parents:
                            continue
                        # Build output and our own state churn constantly and
                        # are not the user's files.
                        rel = path.relative_to(root)
                        if rel.parts and rel.parts[0] in {
                            session.project.config.build_dir, ".nexttex", ".git"
                        }:
                            continue
                        if is_ours(path.name) or path.suffix in {
                            ".nexttex-tmp", ".part", ".swp"
                        }:
                            continue
                        # The agent SDK writes through its own temp files,
                        # named like main.tex.tmp.31337.abcdef.  Announcing
                        # those as changes tells the browser to reload a
                        # file that has never existed.
                        if ".tmp." in path.name or path.name.endswith("~"):
                            continue
                        if session.is_own_write(path):
                            continue
                        touched.setdefault(session.project.id, set()).add(str(rel))
                for project_id, paths in touched.items():
                    session = SESSIONS.get(project_id)
                    if not session:
                        continue
                    # Into the shared document first.  This is the only way
                    # an outside write -- a git pull, vim in another
                    # terminal -- reaches the people editing the file, and
                    # `ingest` diffs, so handing it text the document
                    # already holds costs nothing and changes nothing.
                    for relative in paths:
                        try:
                            path = session.project.resolve(relative)
                            here = path.exists()
                            # `gone` and "could not read it" are different
                            # things, and `read_text` returns None for both.
                            # Conflating them marked every figure in the
                            # project as deleted the moment it was rewritten.
                            session.collab.ingest(
                                relative,
                                read_text(path) if here else None,
                                gone=not here,
                            )
                        except (OSError, ValueError):
                            continue
                    await session.events.publish(
                        {"type": "files_changed", "paths": sorted(paths)}
                    )
        except (asyncio.CancelledError, GeneratorExit):
            raise
        except Exception:
            # Said once, not once a second. The watcher is what makes a
            # `git pull`, an agent's write and an editor in another
            # terminal appear in the tree, and it retried in complete
            # silence: a project whose watch could not start looked like a
            # project where nothing outside the app ever changes, and
            # nothing anywhere said otherwise.
            global _WATCHER_COMPLAINED
            if not _WATCHER_COMPLAINED:
                _WATCHER_COMPLAINED = True
                log.warning(
                    "the file watcher stopped and is retrying every second; "
                    "changes made outside NextTex may not appear",
                    exc_info=True,
                )
            await asyncio.sleep(1.0)
        finally:
            if stop in WATCH_RESTART:
                WATCH_RESTART.remove(stop)


def _restart_watch() -> None:
    """Wake the file watcher so it picks up a newly opened or closed project."""
    while WATCH_RESTART:
        WATCH_RESTART.pop().set()


# How long a project stays open after the last request that wanted it.
#
# Nothing evicted a session at all: the reaper disconnected the idle agent
# and left everything else resident, so opening a project was a one way
# door.  Fifty projects touched over a week is fifty CRDT stores, symbol
# caches, dependency graphs and libraries held until the server restarts,
# on a machine somebody is also trying to write on.  The same half hour the
# agent gets, because the two are the same judgement: a person who has not
# touched this project in half an hour has moved on.
SESSION_IDLE_TIMEOUT = 30 * 60

# How often an *open* project has the contents nothing refers to swept out
# of its history.  Collection used to happen only when a session was
# evicted, and a shared project is deliberately never evicted -- somebody
# may be typing into it from another machine this second -- so unless the
# writer emptied the trash or cleared a file by hand, a shared project kept
# every thinned version's contents for ever.  That is the exact failure
# eviction-time collection was added to fix, reintroduced by the rule that
# keeps shared projects alive.
COLLECT_EVERY = 60 * 60


async def _reap_once() -> None:
    """One pass of the reaper.

    Separated from the loop so a test can run it without waiting a minute
    for the sleep or half an hour for the timeout.
    """
    # A join nobody answered holds a peer connection and a set of documents
    # open, so it is bounded here like everything else in this file.
    for token, pending in list(PENDING_JOINS.items()):
        if time.monotonic() - pending.at <= JOIN_DECISION_TIMEOUT:
            continue
        if PENDING_JOINS.pop(token, None) is not None:
            log.info("a join of %s was never answered, and was discarded",
                     pending.target)
            await pending.release(keep=False)

    for project_id, session in list(SESSIONS.items()):
        try:
            if (
                not session.in_use()
                and time.monotonic() - session.touched > SESSION_IDLE_TIMEOUT
            ):
                # `session_for` builds it again on the next request that asks,
                # so this is giving memory back rather than closing anything
                # the writer would notice.
                if SESSIONS.get(project_id) is session:
                    # Closed *before* collecting.  Closing flushes whatever
                    # documents are still pending out to disk, and each of
                    # those writes a version; collecting first took its
                    # picture of what is referenced before those lines
                    # existed.  In a thread because the walk is unbounded
                    # and this is still the event loop.
                    await _close_session(project_id, session)
                    await asyncio.to_thread(session.history.collect)
                    _restart_watch()
                continue
            await session.reap_idle_agent()
            if time.monotonic() - session.collected_at > COLLECT_EVERY:
                # Open, and swept anyway. See COLLECT_EVERY.
                session.collected_at = time.monotonic()
                await asyncio.to_thread(session.history.collect)
        except Exception:
            # One session's reaping must not stop the others being reaped, so
            # this is caught per session rather than around the loop.  But a
            # reaper that has silently stopped reaping leaves an agent
            # subprocess per project alive for as long as the server runs, and
            # nothing anywhere would say so.
            log.warning("could not reap the idle session for %s",
                        session.project.id, exc_info=True)


async def _reap_idle() -> None:
    while True:
        await asyncio.sleep(60)
        await _reap_once()


app = FastAPI(title="NextTex", lifespan=lifespan, docs_url=None, redoc_url=None)


# ---------------------------------------------------------------------------
# Authentication.
#
# Two credentials, doing two jobs.  The instance token is what the installer
# prints: it is the recovery path, and it is how a script gets in.  A session
# is what a browser holds, minted when it proves it knows the password or
# arrives carrying the token.  nexttex/auth.py explains why they are separate;
# the short version is that the cookie used to *be* the token, so every
# browser held the master credential and none of them could be signed out.
#
# EventSource cannot send an Authorization header, so the session has to live
# in a cookie for the event stream to be authenticated at all.
#
# Nothing here runs for WebSockets: Starlette's HTTP middleware is not called
# for the websocket scope.  `authorise_socket` below is what the sync route
# must use, and forgetting it would publish every document to anyone who can
# reach the port.

# Reachable without credentials, because they are how you get credentials, or
# because they are needed to draw the page that asks for them.
OPEN_PATHS = ("/assets/", "/favicon", "/api/login")


def _client_address(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _supplied_token(request: Request) -> str:
    """Whatever this request offers as a credential, in preference order."""
    header = request.headers.get("authorization", "")
    return (
        request.query_params.get("token")
        or request.cookies.get(COOKIE)
        or request.headers.get("x-nexttex-token")
        or (header[7:] if header.lower().startswith("bearer ") else "")
    )


def _authorise(supplied: str) -> str:
    """"instance", "session" or "" -- what this credential is, if anything."""
    if not supplied:
        return ""
    if auth.same_secret(supplied, SETTINGS.token):
        return "instance"
    record = auth.find_session(SETTINGS.sessions, supplied)
    if record is None:
        return ""
    if auth.touch(record):
        _save_settings()
    return "session"


def _has_live_session(request: Request) -> bool:
    """Whether this browser is already carrying a session of its own.

    Asked before minting one.  A bookmarked `?token=` link is loaded again
    and again -- it is the URL the installer printed, so it is the one people
    keep -- and without this check every one of those loads filed another row
    in the settings card for the same browser.
    """
    cookie = request.cookies.get(COOKIE, "")
    if not cookie or auth.same_secret(cookie, SETTINGS.token):
        return False
    return auth.find_session(SETTINGS.sessions, cookie) is not None


def _save_settings() -> None:
    """Persist settings, ignoring an unwritable state directory.

    Settings.load() already runs in memory when the directory cannot be
    written, and a session that survives only until restart is much better
    than a 500 on sign-in.
    """
    try:
        SETTINGS.save()
    except OSError:
        pass


def _issue_session(response, request: Request) -> None:
    """Mint a session for this browser and put it in the cookie."""
    token, record = auth.new_session(auth.label_for(request.headers.get("user-agent", "")))
    SETTINGS.sessions = auth.prune([*SETTINGS.sessions, record])
    _save_settings()
    response.set_cookie(
        COOKIE, token,
        httponly=True, samesite="lax",
        secure=request.url.scheme == "https",
        max_age=auth.SESSION_TTL_SECONDS,
    )


def authorise_socket(websocket) -> bool:
    """Whether a WebSocket may proceed.

    Its own function because HTTP middleware does not run for the websocket
    scope -- a route that forgets to call this is open to the world, and that
    is not the kind of mistake that shows up in a screenshot.

    The `Origin` check is here rather than left to `samesite=lax`.  A
    WebSocket handshake is a cross-site request that carries cookies in some
    browsers regardless of `SameSite`, and the cost of being wrong is every
    document in every open project readable and writable by any page the
    writer happens to visit.  Same-origin, or no origin at all -- which is
    what a script or a test client sends, and which cannot be forged by a
    page.
    """
    origin = websocket.headers.get("origin")
    if origin:
        host = websocket.headers.get("host", "")
        try:
            if urlsplit(origin).netloc != host:
                return False
        except ValueError:
            return False

    supplied = (
        websocket.cookies.get(COOKIE)
        or websocket.query_params.get("token")
        or ""
    )
    return bool(_authorise(supplied))


# Requests that change something and were made by a page rather than by a
# person or a script.  `SameSite=lax` is the cookie's own defence and it is
# not enough here, because "site" is scheme and host and *not port*: a page
# on http://127.0.0.1:5173 -- a Vite dev server, a notebook, whatever a
# `npm start` in another project put there -- is same-site with NextTex on
# 127.0.0.1:8450, and its cookies ride along.
#
# What that reached was not theoretical.  `POST /api/projects/{id}/upload`
# takes a multipart body, so it needs no preflight, and it writes a named
# file into the project: `latexmkrc` is arbitrary Perl at the next full
# build.  `POST /api/update` runs the update script.  Neither takes a JSON
# body, which is what had been quietly doing the work of a CSRF defence for
# every other route.
#
# The rule is the one `authorise_socket` already argues for, applied to the
# other half of the app: same-origin, or no origin at all.  A browser always
# sends `Origin` on a request that changes something and `Sec-Fetch-Site` on
# everything; curl, the installer and the test client send neither, and a
# page cannot forge their absence.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _same_origin_request(request: Request) -> bool:
    # Asked of every method, before the safe-method exemption. A GET is
    # supposed to be safe, and a page on `http://127.0.0.1:5173` is
    # same-site with this one, so `SameSite=Lax` lets its cookie travel:
    # that page could read a project's file list, its transcript, its
    # papers and its settings, one GET at a time, and the exemption said
    # yes before anything looked. A browser sends this header on every
    # request; curl, the installer and the printed link send none, and a
    # page cannot forge an absence.
    fetch_site = request.headers.get("sec-fetch-site", "")
    if fetch_site:
        # "none" is the address bar or a bookmark, which is a person.
        # "same-site" is the different-port case above, and is refused.
        return fetch_site in ("same-origin", "none")

    if request.method in SAFE_METHODS:
        return True

    origin = request.headers.get("origin", "")
    if not origin:
        return True
    try:
        return urlsplit(origin).netloc == request.headers.get("host", "")
    except ValueError:
        return False


# Headers this app had none of.  Each one is here for something specific
# that was found rather than for a checklist.
#
# `X-Content-Type-Options: nosniff` and `frame-ancestors 'none'` are the
# cheap ones: nothing here should ever be re-typed by a browser's guess, and
# nothing here should ever be in somebody else's frame.
#
# The content policy is the interesting one, and it is built from hashes
# rather than from `'unsafe-inline'` because this app really does serve two
# inline scripts: the theme stamp in `index.html`, which has to be blocking
# and classic so the first frame is already the right colour, and the small
# script on the sign-in page.  Hashing them keeps `script-src` strict, which
# is the half of a policy actually worth having.  Styles are not hashed:
# React writes `style` attributes all over this interface, and no policy that
# forbids those survives contact with the code.
#
# `blob:` is here for pdf.js, which runs its renderer in a worker built
# from a blob.  It was also in `img-src`, on the grounds that the history
# panel made an object URL for every figure thumbnail.  It does not and
# never did: `blobUrl(sha)` in that panel returns this app's own history
# route, an ordinary URL that happens to be named after what it fetches,
# and it goes straight into an `img` src.  There is no `createObjectURL`
# anywhere in this interface except the one in `saveBlob`, which hands a
# download to an anchor and is not an image at all.  So `img-src` no longer
# says `blob:`, because a policy is only worth having as tight as it can
# actually be.
SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
}


def _inline_hashes() -> str:
    """`'sha256-...'` for every inline script this app serves.

    Computed once, from the files themselves, so a rebuild that changes the
    theme stamp cannot leave a policy behind that blocks it.  A missing
    `dist/` is not an error: the dev server serves the unbuilt page and this
    process is then only serving the API.
    """
    import base64
    import re as _re

    sources: list[str] = [_sign_in_page()]
    index = FRONTEND / "index.html"
    if index.is_file():
        try:
            sources.append(index.read_text(encoding="utf-8"))
        except OSError:
            pass

    hashes: list[str] = []
    for text in sources:
        for body in _re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>",
                                text, _re.S):
            digest = hashlib.sha256(body.encode("utf-8")).digest()
            hashes.append(f"'sha256-{base64.b64encode(digest).decode()}'")
    return " ".join(dict.fromkeys(hashes))


def _content_policy() -> str:
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' {_inline_hashes()}".strip(),
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        # The event stream and the collaboration sockets are same-origin, but
        # a websocket scheme is not covered by `'self'` in every browser.
        "connect-src 'self' ws: wss:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


CONTENT_POLICY = ""


def _secure(response: Response) -> Response:
    """Stamp the security headers onto one response.

    A function and not only a middleware, because two kinds of response never
    reach that middleware.  `authenticate` refuses some requests before it,
    and an unhandled exception becomes a response above it, in Starlette's own
    error middleware.  The sign-in page was one of those: the one page an
    unauthenticated visitor actually sees, and the one most worth framing,
    came back with no content policy, no nosniff and no framing rule at all.
    """
    global CONTENT_POLICY
    if not CONTENT_POLICY:
        # Built on the first response rather than at import, because the
        # sign-in page and the built index are both read from disk and this
        # module is imported by tests that redirect the state directory.
        CONTENT_POLICY = _content_policy()
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    response.headers.setdefault("content-security-policy", CONTENT_POLICY)
    return response


# The most this install will take in one request.  Starlette spools a
# multipart body to a temporary file before any route sees it, so without a
# gate here the per-file limits below bound what lands in the project and
# nothing bounds what the machine absorbs on the way.  A chunked request
# sends no `Content-Length` and slips past this, which is why the per-file
# limits exist as well rather than instead.
MAX_BODY_BYTES = 512 * 1024 * 1024


@app.middleware("http")
async def authenticate(request: Request, call_next):
    if not _same_origin_request(request):
        return JSONResponse(
            {"error": "This request came from another page, so it was refused."},
            status_code=403,
        )

    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(
            {"error": "That request is larger than this install accepts at once."},
            status_code=413,
        )

    if request.url.path.startswith(OPEN_PATHS):
        return await call_next(request)

    supplied = _supplied_token(request)
    kind = _authorise(supplied)
    if not kind:
        # The same limiter the password route has. A token is 32 bytes of
        # `secrets` and is not guessable in any useful sense, so this is
        # not the wall that stops an attack; it is what stops the port
        # being a free unlimited oracle, and it costs a legitimate writer
        # nothing, because a cookie that has gone stale is not counted.
        #
        # Only a *supplied* credential that matched nothing. An ordinary
        # first visit sends none, and every password set clears the session
        # list, so counting a stale cookie would lock out the writer who
        # had just changed their own password.
        if supplied and not request.cookies.get(COOKIE):
            address = _client_address(request)
            auth.note_failure(address)
            delay = auth.failure_delay(address)
            if delay:
                await asyncio.sleep(delay)
        if request.url.path.startswith("/api/"):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return HTMLResponse(_sign_in_page(), status_code=401)

    response = await call_next(request)

    # A browser arriving with the instance token -- from the printed URL, or
    # holding the pre-session cookie an older install gave it -- is upgraded
    # to a session in place, so it never has to be told to sign in again.
    # Only once: a browser that already has a session keeps it.
    if kind == "instance" and not _has_live_session(request):
        wants_page = "text/html" in request.headers.get("accept", "")
        if wants_page or request.query_params.get("token"):
            _issue_session(response, request)
    return response


# Declared after `authenticate`, which is what puts it outside it: Starlette
# builds the stack with the last middleware added on the outside.  So this now
# sees the refusals `authenticate` returns without ever calling a route.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    return _secure(await call_next(request))


@app.exception_handler(RequestValidationError)
async def malformed(request: Request, exc: RequestValidationError) -> Response:
    """A body FastAPI would not accept, in the shape the browser reads.

    The default answer is a list of objects under `detail`, each with a
    `loc`, a `msg` and a `type`. `api.ts` has one error path and it reads
    `error`, so what reached the writer was the string "[object Object]"
    or the bare status line, for what is nearly always a missing field.

    The first error is the useful one, said as a sentence.
    """
    first = (exc.errors() or [{}])[0]
    where = [part for part in (first.get("loc") or []) if isinstance(part, str)]
    field = where[-1] if where else "the request"
    said = first.get("msg") or "is not acceptable"
    return _secure(JSONResponse({"error": f"{field}: {said}"}, status_code=422))


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> Response:
    """What the writer is told when something breaks that nothing anticipated.

    Starlette answers an unhandled exception with the plain text "Internal
    Server Error", which is not JSON, so the browser's single error path could
    not read it and fell back to the status line.  The writer was told
    "Internal Server Error" and given no way to connect that to anything.
    This answers in the shape `api.ts` already reads, and puts a short
    reference in both halves so the message on screen and the line in the
    terminal name each other.

    The traceback is deliberately not repeated here.  Starlette re-raises once
    this returns and uvicorn logs the stack immediately after this line, so
    logging it again would put two copies of it in front of somebody trying to
    read one.
    """
    reference = secrets.token_hex(4)
    log.error("unhandled %s during %s %s [%s]", type(exc).__name__,
              request.method, request.url.path, reference)
    return _secure(JSONResponse(
        {"error": "Something went wrong inside NextTex. The server's log has "
                  f"the details, under {reference}."},
        status_code=500,
    ))


def _sign_in_page() -> str:
    """The page a browser without credentials is given.

    Server-rendered, because it has to draw before the bundle is authorised.
    That is the reason it exists and not a reason for it to look like a
    different program: it is the front door, and the first version of it was
    at one and a half times the app's type scale, in a bold sans with no
    logo, on 8 and 12 pixel radii, under a drop shadow the design forbids
    anywhere but the typeset page, with a slab button brighter than anything
    else on screen.

    So the palette, the scale and the radii here are the app's, written out
    rather than imported -- the built stylesheet's name is content-hashed and
    this page has no way to look it up. It is a copy, kept small on purpose.
    """
    has_password = bool(SETTINGS.password_hash)
    recovery = """
        <p class=aside>Lost it? Run this on the machine running NextTex:</p>
        <pre class=aside><code>.venv/bin/python server/run.py --print-url</code></pre>
    """
    if has_password:
        body = f"""
        <form id=f autocomplete=on>
          <label for=p>Password</label>
          <input id=p name=password type=password autocomplete=current-password
                 autofocus required>
          <p id=e role=alert hidden></p>
          <button type=submit>Sign in</button>
        </form>
        {recovery}
        <p class=aside>Or <code>run.py --set-password</code> to choose a new
        one, then restart NextTex.</p>
        """
    else:
        body = f"""
        <p><b>You need the full link.</b> This install has no password yet, so
        the only way in is the address the server printed: the one
        ending <code>?token=&hellip;</code></p>
        {recovery}
        <p class=aside>You can set a password once you are in.</p>
        """
    return f"""<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>NextTex</title>
<style>
  /* --ink-2 is here for the recovery command, which sits on --surround
     rather than on --surface: --ink-3 measures 4.16:1 there at 12px,
     under the 4.5 small text needs, and the app's own answer to that
     pairing is `.nx-on-surround`, which steps the dimmest ink up to
     --ink-2. That rule cannot reach a page whose stylesheet is a copy, so
     the copy carries the ink it needs. Both values are the app's own,
     from styles.css. */
  :root {{ --surround:#0A0C0B; --surface:#121614; --surface-3:#2A302C;
           --ink:#E3E8E2; --ink-2:#B0B5B0; --ink-3:#909892; --hint:#3FC6D2;
           --pen:#C988E7; --error:#F47365; color-scheme: dark; }}
  @media (prefers-color-scheme: light) {{
    :root {{ --surround:#B9BEB8; --surface:#E3E7E2; --surface-3:#C6CBC5;
             --ink:#141715; --ink-2:#373B36; --ink-3:#4E534D; --hint:#00626D;
             --pen:#6F2998; --error:#9F1912; color-scheme: light; }}
  }}
  * {{ box-sizing: border-box; }}
  ::selection {{ background: color-mix(in oklab, var(--hint) 30%, transparent); }}
  body {{ margin:0; min-height:100dvh; display:grid; place-items:center;
          background:var(--surround); color:var(--ink);
          font:13.5px/1.55 ui-sans-serif,system-ui,sans-serif; padding:1.5rem; }}
  main {{ background:var(--surface); border:1px solid var(--surface-3);
          border-radius:5px; padding:16px; width:min(23rem,100%); }}
  .top {{ display:flex; align-items:center; gap:8px; }}
  h1 {{ font:600 15px/1.3 ui-serif,Georgia,serif; margin:0; }}
  .lead {{ color:var(--ink-3); margin:6px 0 14px; font-size:12.5px; }}
  label {{ display:block; font-size:12.5px; color:var(--ink-3);
           margin-bottom:4px; }}
  input {{ width:100%; padding:5px 8px; font:inherit; color:var(--ink);
           background:var(--surround); border:1px solid var(--surface-3);
           border-radius:3px; }}
  input:focus-visible, button:focus-visible {{
    outline:1px solid var(--hint); outline-offset:1px; }}
  button {{ margin-top:10px; width:100%; height:28px; font:inherit;
            font-weight:500; color:var(--ink); background:transparent;
            border:1px solid var(--surface-3); border-radius:3px;
            cursor:pointer; }}
  button:hover:not([disabled]) {{ border-color:var(--hint); color:var(--hint); }}
  button[disabled] {{ opacity:.5; cursor:default; }}
  code {{ font:12px ui-monospace,SFMono-Regular,monospace; }}
  /* On --surround, not --surface: see the note beside --ink-2 above. */
  pre {{ margin:4px 0 0; padding:5px 8px; background:var(--surround);
         border:1px solid var(--surface-3); border-radius:3px;
         overflow-x:auto; color:var(--ink-2); }}
  pre code {{ color:var(--ink-2); }}
  pre.aside {{ color:var(--ink-2); }}
  p {{ margin:10px 0 0; }}
  .aside {{ color:var(--ink-3); font-size:12.5px; }}
  #e {{ color:var(--error); font-size:12.5px; margin:6px 0 0; }}
</style>
<main>
  <div class=top>
    <!-- The app's own mark, path for path, rather than an approximation of
         it: this page cannot import the component, and two drawings that
         are nearly the same read worse than one that is. -->
    <svg width="18" height="18" viewBox="0 0 32 32" role="img"
         aria-label="NextTex">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="none"
            stroke="var(--pen)" stroke-width="2" />
      <path d="M11 7.5h7.5L23 12v12.5H11V19.5l3.5-3.5L11 12.5z" fill="none"
            stroke="var(--pen)" stroke-width="2" stroke-linejoin="round"
            stroke-linecap="round" />
      <path d="M18.5 7.5V12H23" fill="none" stroke="var(--pen)"
            stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
    <h1>NextTex</h1>
  </div>
  <p class=lead>Sign in to reach your projects.</p>
  {body}
</main>
<script>
  var f = document.getElementById('f');
  if (f) f.addEventListener('submit', async function (ev) {{
    ev.preventDefault();
    var e = document.getElementById('e'), b = f.querySelector('button');
    e.hidden = true; b.disabled = true; b.textContent = 'Signing in\u2026';
    try {{
      var r = await fetch('/api/login', {{
        method: 'POST', headers: {{ 'content-type': 'application/json' }},
        body: JSON.stringify({{ password: document.getElementById('p').value }})
      }});
      if (r.ok) {{ location.replace(location.pathname + location.search); return; }}
      var d = await r.json().catch(function () {{ return {{}}; }});
      e.textContent = d.error || 'That is not the password.';
    }} catch (err) {{
      e.textContent = 'Could not reach the server.';
    }}
    e.hidden = false; b.disabled = false; b.textContent = 'Sign in';
    document.getElementById('p').select();
  }});
</script>
</html>
"""


# ---------------------------------------------------------------------------
# Sharing a project with other installs


@app.get("/api/projects/{project_id}/collab")
async def collab_state(project_id: str):
    """Whether this project is shared, with whom, and whether they are here."""
    session = session_for(project_id)
    return session.peers.state()


@app.post("/api/projects/{project_id}/collab/share")
async def start_sharing(project_id: str, name: str = Body("", embed=True)):
    """Make a private project a shared one.

    "First" carries no privileges and is not recorded as anything: there is
    no owner, which is the point. Every member can invite, and every member
    can remove.
    """
    if not collab_transport.available():
        raise HTTPException(
            501,
            "Peer-to-peer collaboration is not available on this platform. "
            "iroh publishes no wheel for it yet.",
        )
    session = session_for(project_id)
    session.peers.begin_sharing(name or SETTINGS.display_name or "Unnamed")
    await session.peers.start()
    return session.peers.state()


@app.post("/api/projects/{project_id}/collab/invite")
async def make_invite(project_id: str):
    """A single-use string for one other install.

    Only its hash is kept. Somebody who reads the config file cannot use an
    invite out of it, and it can be spent exactly once.
    """
    if not collab_transport.available():
        raise HTTPException(501, "Not available on this platform.")
    session = session_for(project_id)
    # Sharing first, then listening, then the invite. Starting the transport
    # before the project was shared did nothing -- `start` returns
    # immediately for an unshared project -- so `address()` was empty and the
    # invite carried nothing to dial.
    name = SETTINGS.display_name or "Unnamed"
    session.peers.begin_sharing(name)
    await session.peers.start()
    invite = session.peers.invite(name)
    if not _unwrap_invite(invite).get("address"):
        raise HTTPException(
            503, "This install is not reachable yet. Try again in a moment.",
        )
    return {"invite": invite}


def _unwrap_invite(invite: str) -> dict:
    from server.collab.peers import _unwrap

    try:
        return _unwrap(invite)
    except Exception:
        return {}


@app.post("/api/collab/join")
async def join_share(
    invite: str = Body(..., embed=True),
    path: str = Body(..., embed=True),
):
    """Accept an invite into a folder of our own.

    The folder must be empty or new.  Two documents built independently from
    identical text merge into *both* copies -- every line twice -- and
    nothing raises, so a joiner has to start from nothing and be sent the
    whole state.
    """
    if not collab_transport.available():
        raise HTTPException(501, "Not available on this platform.")

    target = Path(path).expanduser()
    if target.exists() and any(target.iterdir()):
        raise HTTPException(
            400,
            "That folder already has something in it. Joining needs an empty "
            "one, so the project can arrive as it is rather than being merged "
            "with whatever is there.",
        )
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise HTTPException(400, f"Could not make that folder: {error}")

    # Joined *before* the project is opened, because an empty folder is not
    # yet a project: `ProjectSession` needs a main document, and the joiner
    # has no files at all until the first sync brings them.  So this is a
    # bootstrap -- documents, then disk, then a project -- and the session
    # that opens afterwards finds an ordinary LaTeX folder.
    project = Project.open(target)
    store = CollabStore(project)
    network = PeerNetwork(store)
    try:
        reason = await network.join(invite, SETTINGS.display_name or "Unnamed")
        if not reason:
            reason = await _wait_for_the_project(store)
    except Exception:
        await network.close()
        store.close()
        shutil.rmtree(target, ignore_errors=True)
        raise

    if reason:
        await network.close()
        store.close()
        shutil.rmtree(target, ignore_errors=True)
        raise HTTPException(400, reason)

    # Nothing is written here, which is what the card below says. It used
    # to flush every document to disk and then close the store, which
    # flushes again, so by the time the offer was built the folder held the
    # whole project: the Windows laptop found `main.tex` complete and
    # readable while the card saying "Nothing has been written yet" was
    # still on screen, and two other files carrying an mtime a minute
    # older. Discard then had to delete real files rather than decline to
    # create them, which is the opposite of what the writer was promised.
    #
    # The store and its connection stay open until the answer, and
    # `PendingJoin.release` closes them either way.

    # Held open rather than written and registered. Accepting an invite is
    # downloading somebody else's files, and until now the first moment a
    # person could look at what they had accepted was after all of it was on
    # their disk. The documents are in memory here and the manifest names
    # every one of them, so the answer is offered before anything is written.
    token = secrets.token_urlsafe(16)
    PENDING_JOINS[token] = PendingJoin(
        token=token, target=target, project=project, store=store,
        network=network, at=time.monotonic(),
    )
    return {
        "ok": True,
        "token": token,
        "path": str(target),
        "files": _offered_files(store, project),
    }


@dataclass
class PendingJoin:
    """A join that has arrived and has not been accepted."""

    token: str
    target: Path
    project: Project
    store: object
    network: object
    at: float

    async def release(self, keep: bool) -> None:
        """Close the connection, and remove the folder unless it is kept."""
        with contextlib.suppress(Exception):
            await self.network.close()
        with contextlib.suppress(Exception):
            self.store.close()
        if not keep:
            shutil.rmtree(self.target, ignore_errors=True)


#: Whether the watcher's failure has already been logged. It retries every
#: second, and a fault that persists would otherwise write a stack trace a
#: second for as long as the server runs.
_WATCHER_COMPLAINED = False

#: Projects whose session is being closed right now. `session_for` refuses
#: while an id is in here rather than building a second session beside the
#: one going away: `close()` awaits, so between popping a session and
#: finishing with it there was a window in which any request built a fresh
#: one over the same project, and the two then flushed the same documents
#: to the same files from two sets of state.
CLOSING: set[str] = set()


async def _close_session(project_id: str, session) -> None:
    """Take a session down with nothing able to replace it halfway."""
    CLOSING.add(project_id)
    try:
        await session.close()
    finally:
        SESSIONS.pop(project_id, None)
        CLOSING.discard(project_id)

#: Joins waiting for somebody to look at them. Bounded by the reaper below,
#: because each one holds a peer connection and a set of documents open.
PENDING_JOINS: dict[str, PendingJoin] = {}

#: How long a join may sit unanswered. Long enough to read a list of files
#: and short enough that a tab closed on the question does not hold a peer
#: connection open for the life of the server.
JOIN_DECISION_TIMEOUT = 10 * 60


async def _ingest_on_loop(session, relative: str, text: str) -> None:
    """Fold text into a shared document, from the loop it belongs to."""
    session.collab.ingest(relative, text)


def _offered_files(store, project: Project) -> list[dict]:
    """What the other end has sent, as a person would want to see it.

    `refused` rather than silently absent: a joiner is better served by
    being told that a `latexmkrc` was offered and will not be written than
    by a list that quietly omits it. What was offered is the more
    interesting fact of the two.
    """
    offered = []
    for file_id, record in store.files.items():
        if record.get("trashed"):
            continue
        relative = str(record.get("path") or "")
        if not relative:
            continue
        # Measured here, from what actually arrived, rather than taken from
        # the record. That number is written once, when the sharer first
        # adopts a file, and is never refreshed as the document is edited,
        # so the card was quoting a size from whenever the project was
        # first shared: the laptop was shown 3 kB for a file that landed at
        # 957 bytes.
        #
        # It is still the sender's line endings. A joiner on Windows writes
        # CRLF and gets a file a byte or two longer per line, which is why
        # the card says these are the sizes as sent.
        kind = str(record.get("kind") or "binary")
        body = store.body(file_id) if kind == "text" else None
        size = (
            len(str(body).encode("utf-8")) if body is not None
            else int(record.get("size") or 0)
        )
        offered.append({
            "path": relative,
            "kind": kind,
            "size": size,
            "refused": is_control_path(Path(relative)),
        })
    offered.sort(key=lambda item: item["path"])
    return offered


@app.post("/api/collab/join/accept")
async def accept_join(token: str = Body(..., embed=True)):
    """Write what arrived, and make it a project."""
    pending = PENDING_JOINS.pop(token, None)
    if pending is None:
        raise HTTPException(404, "That invite is no longer waiting to be answered.")
    try:
        # Every record, not only the ones an observer happened to mark
        # dirty. `_dirty` is filled by the watcher on a document that
        # changed, and a document that arrived empty produces no change to
        # observe, so a zero-length file was named in the manifest, listed
        # on the offer card, accepted, and never written: the writer got a
        # project with a file missing and nothing saying which.
        pending.store.project_everything()
        pending.store.flush()
    finally:
        await pending.release(keep=True)
    # Registered only now: a join that was never accepted leaves nothing
    # behind for somebody to find later and wonder about.
    REGISTRY.add(str(pending.target))
    _restart_watch()
    return {
        "ok": True,
        "project": {"id": pending.project.id, "path": str(pending.target)},
    }


@app.post("/api/collab/join/discard")
async def discard_join(token: str = Body(..., embed=True)):
    """Say no, and leave nothing behind."""
    pending = PENDING_JOINS.pop(token, None)
    if pending is None:
        raise HTTPException(404, "That invite is no longer waiting to be answered.")
    await pending.release(keep=False)
    return {"ok": True}


async def _wait_for_the_project(store, seconds: float = 30.0) -> str:
    """Wait until the other peer has sent us a project, or say why not.

    A join is the one moment a person is watching a progress indicator, so
    it waits rather than returning an empty folder and leaving them to
    wonder. Thirty seconds is generous for a paper and mean for a thesis
    full of figures; the files that have arrived are kept either way.

    The manifest is not the project. It named every file and arrived first,
    and `send_documents` pipelines the bodies behind it without waiting for
    a reply, so "any text record exists" was true well before the text did:
    the wait ended, half a second was slept for luck, and whatever had not
    landed by then was written to disk as an empty file. This waits for the
    bodies, and only stops early when every text document has one.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds

    def wanted() -> list[str]:
        return [
            file_id for file_id, record in store.files.items()
            if record.get("kind") == "text" and not record.get("trashed")
        ]

    while loop.time() < deadline:
        listed = wanted()
        if listed:
            # A record with a size of zero really is empty, and waiting for
            # it to have contents would wait for ever.
            waiting = [
                file_id for file_id in listed
                if int(store.files[file_id].get("size") or 0) > 0
                and not str(store.body(file_id) or "")
            ]
            if not waiting:
                return ""
        await asyncio.sleep(0.1)

    if wanted():
        # Something arrived and not all of it. Better to say so than to
        # write the half that came as though it were the project.
        return ("Only part of that project arrived before the connection "
                "went quiet. Nothing has been written; try joining again.")
    return ("Nothing arrived from that peer. They may be offline, or the "
            "invite may already have been used.")


@app.delete("/api/projects/{project_id}/collab/member/{peer}")
async def remove_member(project_id: str, peer: str):
    """Disconnect a peer. Not revocation -- they keep what they have."""
    session = session_for(project_id)
    session.peers.remove(peer)
    return session.peers.state()


# ---------------------------------------------------------------------------
# The shared documents


@app.websocket("/api/projects/{project_id}/sync/{doc_id:path}")
async def sync_socket(websocket: WebSocket, project_id: str, doc_id: str):
    """One browser, one shared document.

    **The authentication here is not decoration.**  Starlette's HTTP
    middleware is not called for the websocket scope, so the check that
    guards the other ninety routes does not guard this one.  Without the
    line below, anyone who can reach the port can read and write every
    document in every open project, and nothing on screen would say so.

    A cookie is what a browser has -- the same one the event stream uses,
    and for the same reason: neither a WebSocket nor an EventSource can send
    an Authorization header from the page.
    """
    if not authorise_socket(websocket):
        await websocket.close(code=1008)
        return

    session = SESSIONS.get(project_id)
    if session is None:
        try:
            session = session_for(project_id)
        except HTTPException:
            await websocket.close(code=1003)
            return

    await session.sync.serve(websocket, doc_id)


# ---------------------------------------------------------------------------
# Signing in, and the sessions that result


@app.post("/api/login")
async def login(request: Request, password: str = Body("", embed=True)):
    """Exchange a password for a session.

    Open to unauthenticated callers, because it is how a browser stops being
    one.  A wrong answer costs a delay that doubles, which makes a remote
    guess uneconomic without ever locking the person at the keyboard out of
    their own documents.
    """
    address = _client_address(request)

    if not SETTINGS.password_hash:
        return JSONResponse(
            {"error": "No password is set on this install. Open the link the "
                      "server printed when it started."}, status_code=403)

    # Written down before it is spent, not after.  The delay bounds how long
    # one attempt takes; counting the attempt only once it had failed meant
    # a hundred arriving together all read the same count, all waited the
    # same nothing, and the doubling never described the guessing rate.
    auth.note_failure(address)
    delay = auth.failure_delay(address)
    if delay:
        await asyncio.sleep(delay)

    # scrypt is 15 ms of CPU with the GIL held, on the one route that needs
    # no credentials at all, in a process that is also serving every open
    # document.  On the loop it is a way for anyone who can reach the port
    # to stop the editor without ever guessing anything.
    if not await asyncio.to_thread(
            auth.verify_password, password,
            SETTINGS.password_hash, SETTINGS.password_salt):
        return JSONResponse({"error": "That is not the password."}, status_code=401)

    auth.note_success(address)
    response = JSONResponse({"ok": True})
    _issue_session(response, request)
    return response


@app.post("/api/logout")
async def logout(request: Request):
    """Sign this browser out, and forget the session it was holding."""
    supplied = _supplied_token(request)
    record = auth.find_session(SETTINGS.sessions, supplied)
    if record is not None:
        SETTINGS.sessions = [s for s in SETTINGS.sessions if s is not record]
        _save_settings()
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE)
    return response


@app.get("/api/auth")
async def auth_state(request: Request):
    """What the settings card and the first-run screen need to know."""
    supplied = _supplied_token(request)
    return {
        "hasPassword": bool(SETTINGS.password_hash),
        "displayName": SETTINGS.display_name,
        "sessions": auth.describe(SETTINGS.sessions, supplied),
    }


@app.post("/api/auth/password")
async def set_password(
    request: Request,
    password: str = Body(..., embed=True),
    current: str = Body("", embed=True),
    display_name: str | None = Body(None, embed=True),
):
    """Set or change the password.

    Changing one revokes every session, including this browser's -- and then
    immediately issues this browser a new one.  Someone changing a password is
    either being careful or has just stopped being careful, and both of those
    want the other browsers signed out.
    """
    if len(password) < 8:
        return JSONResponse(
            {"error": "Use at least eight characters."}, status_code=400)

    # Changing an existing password needs the old one.  Arriving with the
    # instance token counts, because that is the documented way back in for
    # someone who has forgotten it and has access to the machine.
    if SETTINGS.password_hash:
        by_token = auth.same_secret(
            request.query_params.get("token", "")
            or request.headers.get("x-nexttex-token", ""),
            SETTINGS.token,
        )
        if not by_token and not await asyncio.to_thread(
                auth.verify_password, current,
                SETTINGS.password_hash, SETTINGS.password_salt):
            auth.note_failure(_client_address(request))
            return JSONResponse(
                {"error": "That is not the current password."}, status_code=403)

    # Off the loop. The verification a few lines above is already threaded,
    # for exactly this reason, and the hashing that sets a new password is
    # the same deliberately expensive work with nobody's keystrokes waiting
    # behind it any less.
    SETTINGS.password_hash, SETTINGS.password_salt = await asyncio.to_thread(
        auth.hash_password, password
    )
    SETTINGS.sessions = []
    if display_name is not None:
        SETTINGS.display_name = display_name.strip()[:60]
    _save_settings()

    response = JSONResponse({"ok": True, "displayName": SETTINGS.display_name})
    _issue_session(response, request)
    return response


@app.delete("/api/auth/sessions")
async def sign_out_others(request: Request):
    """Sign every other browser out, keeping this one."""
    supplied = _supplied_token(request)
    record = auth.find_session(SETTINGS.sessions, supplied)
    SETTINGS.sessions = [record] if record is not None else []
    _save_settings()
    return {"ok": True, "sessions": auth.describe(SETTINGS.sessions, supplied)}


@app.post("/api/auth/name")
async def set_display_name(display_name: str = Body("", embed=True)):
    """The name collaborators see beside this peer's cursor and versions."""
    SETTINGS.display_name = display_name.strip()[:60]
    _save_settings()
    return {"ok": True, "displayName": SETTINGS.display_name}


# ---------------------------------------------------------------------------
# Helpers


async def _fetch_missing_blob(session, sha: str, seconds: float = 6.0) -> None:
    """Ask this project's peers for a version's contents, and wait a little.

    A collaborator's version arrives as a line in the log; its contents come
    on demand.  Almost nobody opens almost any old version, so pulling a
    peer's whole history down before the first keystroke would be the wrong
    trade -- but the moment somebody does open one, the bytes have to come
    from somewhere.

    Silent when there is nobody to ask, or when nobody has it: the caller's
    own 404 already says something a person can act on, and saying it again
    in protocol terms would not help.
    """
    if not sha or session.history.blobs.get(sha) is not None:
        return
    peers = getattr(session, "peers", None)
    if peers is None or not peers.links:
        return
    await peers.fetch_blob(sha)
    deadline = asyncio.get_running_loop().time() + seconds
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.1)
        if session.history.blobs.get(sha) is not None:
            return


def _open_session(project: Project) -> ProjectSession:
    """Build a session for a project and put it in service."""
    session = ProjectSession(
        project,
        model=SETTINGS.model,
        provider=SETTINGS.provider,
        api_key=SETTINGS.openai_key,
    )
    SESSIONS[project.id] = session
    session.start_agent_pump()
    # A project that has been shared picks its peers back up when it opens.
    # Nothing is contacted for a project that has not been.
    if session.peers.share.shared:
        spawn(session.peers.start(), "reconnecting to this project's peers")
    _restart_watch()
    return session


def session_for(project_id: str) -> ProjectSession:
    """The session for a project, opening it if it is not open yet.

    "Open" is a thing the user does to a window, not a precondition the
    server keeps.  While it was one, restarting the server 404'd every route
    a tab was using -- including its event stream, which then retried a 404
    every two seconds forever with nothing on screen to say so.  A tab that
    was open before the restart now simply carries on.

    Construction is synchronous, so two requests arriving together cannot
    build two sessions for one project.
    """
    if project_id in CLOSING:
        # Asked before the lookup, because the session is still in the
        # dictionary while it is closing: handing it out would give work to
        # a session whose documents are being flushed and whose watcher is
        # going away, and popping it first instead would let the next
        # request build a second one beside it, so that one project had two
        # sets of documents flushing to the same files. A moment is all
        # this ever is.
        raise HTTPException(503, "That project is closing; try again in a moment.")
    session = SESSIONS.get(project_id)
    if session is not None:
        session.touched = time.monotonic()
        return session
    project = REGISTRY.find(project_id)
    if project is None:
        raise HTTPException(404, "unknown project")
    return _open_session(project)


def _tag(text: str | None) -> str:
    """What a file said, for a browser to hand back on its next save.

    A hash of the contents, not a timestamp.  Modification time was tried
    twice: a float second was far too coarse, and even `st_mtime_ns` is only
    as fine as the filesystem chooses to record -- two saves a millisecond
    apart share one on plenty of them, which is exactly the interval this
    has to tell apart.  Content answers the real question anyway: does this
    file still say what the browser last agreed it said.
    """
    if text is None:
        return ""
    return hashlib.blake2b(text.encode("utf-8"), digest_size=8).hexdigest()


def _ingest(session: ProjectSession, target: Path, text: str) -> None:
    """Fold a write that has already landed on disk into the shared document.

    Two things this fixes, both of which showed as "my save did nothing".

    **The path is normalised first.**  `CollabStore.ingest` finds a file by
    matching its manifest on the exact string, so a path that is safe but not
    canonical -- `./main.tex`, `chapters//03.tex` -- missed, triggered a full
    `adopt()` walk of the project on every save looking for it, and then
    returned False.  The file was on disk and the shared document never heard.
    Three of the eight callers were already normalising and three were not.

    **A failure here no longer eats the write.**  This used to be called bare,
    after the file had been written and its version recorded, and before the
    `files_changed` that tells every other tab to reload.  So a raise meant a
    500 whose body said nothing, no announcement, no rebuild, and every other
    window still showing the old text over a file that had already changed.
    In `upload` it was inside the loop, which made it a silently partial
    upload: files one to k on disk, nothing announced, no rebuild.

    The write is the thing the writer asked for and it has already succeeded.
    A collaboration layer that cannot keep up is worth a line in the log, not
    worth throwing their save away.
    """
    try:
        session.collab.ingest(session.project.relative(target), text)
    except Exception:
        log.warning("could not fold %s into the shared document",
                    target.name, exc_info=True)


def _safe(session: ProjectSession, relative: str) -> Path:
    try:
        return session.project.resolve(relative)
    except PermissionError:
        raise HTTPException(403, "path is outside the project")
    except (OSError, ValueError):
        # ValueError is what a NUL byte in the path raises out of resolve();
        # a mistyped URL is a bad request, not a server error.
        raise HTTPException(400, "bad path")


def _safe_rel(session: ProjectSession, relative: str) -> tuple[Path, str]:
    """The resolved path, and the canonical name the history files it under.

    `slug_for` hashes the exact string it is handed, so `./main.tex` and
    `main.tex` are two different files as far as a version log is concerned
    and only one of them is ever real.  Everything that *writes* history goes
    through `Project.relative` first.  The routes that read it, name it,
    clear it and rename it did not: they called `_safe` for the fence, threw
    away the path it resolved, and passed the raw query string on.

    So asking for the history of `./main.tex` returned an empty list with a
    200, clearing it reported that nothing had been cleared, and -- the one
    that cost something -- renaming through a dotted path moved the file on
    disk, left its entire past filed under a name nothing would ever look up
    again, and answered `{"ok": true}`.
    """
    target = _safe(session, relative)
    try:
        return target, session.project.relative(target)
    except (OSError, ValueError):
        raise HTTPException(400, "bad path")


# ---------------------------------------------------------------------------
# Projects


@app.get("/api/projects")
async def list_projects():
    return {"projects": REGISTRY.list(), "open": list(SESSIONS)}


@app.post("/api/projects")
async def add_project(path: str = Body(..., embed=True)):
    try:
        project = REGISTRY.add(path)
    except FileNotFoundError:
        raise HTTPException(400, f"no such directory: {path}")
    return project.as_dict()


# A new project is empty on purpose.  Templates are not guesses NextTex
# should make: a journal class, a university handbook and a lab report have
# nothing in common, and the way to get one is to upload the real document
# and let the agent read it.
BLANK_DOCUMENT = """\\documentclass[12pt]{article}

\\begin{document}

\\end{document}
"""


@app.post("/api/projects/create")
async def create_project(
    path: str = Body(...),
    name: str = Body(""),
):
    root = Path(path).expanduser()
    if not root.is_absolute():
        root = Path.home() / root
    if root.exists() and any(root.iterdir()):
        raise HTTPException(400, f"{root} already has files in it")
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise HTTPException(400, f"could not make that folder: {error}")

    (root / "main.tex").write_text(BLANK_DOCUMENT, encoding="utf-8")
    (root / "references.bib").write_text("", encoding="utf-8")
    (root / "figures").mkdir(exist_ok=True)
    title = name.strip() or root.name
    ProjectConfig(name=title, main="main.tex", build_dir="build").save(root)
    project = REGISTRY.add(root)
    _restart_watch()
    return project.as_dict()


@app.delete("/api/projects/{project_id}")
async def forget_project(project_id: str):
    """Take a project out of the list. The files are not touched."""
    session = SESSIONS.get(project_id)
    project = session.project if session else REGISTRY.find(project_id)
    if session:
        await _close_session(project_id, session)
        _restart_watch()
    # A project whose folder has been moved or deleted cannot be opened, so
    # there is no `Project` to ask for its root -- and that is precisely the
    # entry a user most wants to be rid of.  The registry still knows where
    # it pointed.
    root = project.root if project else REGISTRY.path_for(project_id)
    if root is None:
        raise HTTPException(404, "unknown project")
    # Registry removal does not depend on the project being open: the
    # projects most likely to be removed are the ones nobody has opened.
    REGISTRY.remove(root)
    return {"ok": True}


@app.post("/api/projects/{project_id}/relocate")
async def relocate_project(project_id: str, path: str = Body(..., embed=True)):
    """Say where a project's folder went.

    Moving a folder outside NextTex leaves an entry pointing at nothing, and
    the only alternative to this was to remove the entry and add the new
    path -- which works, but loses the place in the list and reads like
    throwing the project away to get it back.

    A project is identified by where it is, so repointing one gives it a new
    id: this is a removal and an addition, done together and keeping the
    entry's position. Any session on the old id is closed, because the root
    it was built around is gone.
    """
    old_root = REGISTRY.path_for(project_id)
    if old_root is None:
        raise HTTPException(404, "unknown project")

    root = Path(path).expanduser()
    if not root.is_absolute():
        root = Path.home() / root
    root = root.resolve()
    if not root.is_dir():
        raise HTTPException(400, f"no such directory: {root}")

    # Pointing one project at another's folder would leave two entries
    # sharing an id, and the second would shadow the first everywhere.
    other = REGISTRY.path_for(id_for(root))
    if other is not None and other.resolve() != old_root.resolve():
        raise HTTPException(409, f"another project is already at {root}")

    session = SESSIONS.get(project_id)
    if session:
        await _close_session(project_id, session)

    try:
        project = REGISTRY.relocate(old_root, root)
    except (FileNotFoundError, OSError) as error:
        raise HTTPException(400, f"could not open {root}: {error}")
    _restart_watch()
    return project.as_dict()


@app.post("/api/projects/{project_id}/open")
async def open_project(project_id: str):
    """Open a project in a window, and hand back everything it needs.

    Other routes open a session on demand; this one is what the *user*
    means by opening a project, so it is the only place that marks the
    project as recently opened.
    """
    fresh = project_id not in SESSIONS
    # Construction stays synchronous, and the docstring on `session_for` says
    # why: two requests arriving together must not build two sessions for one
    # project.  What was never necessary is doing the *filesystem* work on the
    # loop as well.  The bench measured it at 125 ms on a thesis, every open,
    # during which no other request could be served and no autosave, event
    # stream or collaborator socket could make progress.
    session = session_for(project_id)
    if fresh:
        REGISTRY.touch(session.project.root)

    def gather() -> dict:
        # None of this touches a CRDT object, which is what makes it safe to
        # move: the constraint recorded in `docs/architecture.md` is about
        # pycrdt documents and the thread that built them, and these are a
        # directory walk, a transcript read and a dependency scan.
        return {
            "tree": session.project.tree(),
            "context": [d.as_dict() for d in session.context.documents()],
            "transcript": session.transcript.items(),
            # Which documents are previewed, which others could be, and who
            # reads what -- in the same payload rather than a second round
            # trip, because the preview strip is drawn on the first frame.
            **session.documents_payload(),
        }

    return {**session.project.as_dict(), **await asyncio.to_thread(gather)}


@app.get("/api/projects/{project_id}/tree")
async def project_tree(project_id: str):
    return session_for(project_id).project.tree()


# ---------------------------------------------------------------------------
# Files
#
# What one request may put into a project, and what the editor will open.
# There was no limit of any kind on either.
#
# The numbers are meant to sit well past anything a document needs and well
# short of anything that hurts.  A high resolution figure is a few megabytes
# and a scanned hundred page appendix is tens of them, so a quarter of a
# gigabyte for one file is generous.  A `.tex` file is kilobytes, and the
# editor is unusable long before ten megabytes of it: refusing to open one
# that large is kinder than freezing the browser that asked.

MAX_UPLOAD_BYTES = 256 * 1024 * 1024
# The same number the length gate uses, deliberately: one drop of files is
# the largest thing anybody sends this server, so the two limits are the one
# limit seen from either end of the request.
MAX_UPLOAD_TOTAL = MAX_BODY_BYTES
MAX_UPLOAD_FILES = 200
MAX_TEXT_BYTES = 10 * 1024 * 1024
#: The tail of a latexmk log, for the drawer. A run with a package looping
#: writes tens of megabytes and the interesting part is always the end.
MAX_LOG_BYTES = 2 * 1024 * 1024


def _size(count: int) -> str:
    """A size a person reads, for a message a person is shown."""
    if count >= 1 << 20:
        return f"{count / (1 << 20):.0f} MB"
    if count >= 1 << 10:
        return f"{count / (1 << 10):.0f} kB"
    return f"{count} bytes"


@app.get("/api/projects/{project_id}/file")
async def read_file(project_id: str, path: str):
    session = session_for(project_id)
    target = _safe(session, path)
    if not target.is_file():
        raise HTTPException(404, "no such file")
    stat = target.stat()
    if stat.st_size > MAX_TEXT_BYTES:
        # Read and encoded on the event loop, so a big enough file does not
        # merely fail slowly: it stalls every other browser on the install
        # while it is read, and then again while it is turned into JSON.
        raise HTTPException(
            413,
            f"That file is {_size(stat.st_size)}, and the editor opens files "
            f"up to {_size(MAX_TEXT_BYTES)}.",
        )
    try:
        text = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(415, "not a text file")
    return {
        "path": path, "text": text,
        "mtime": stat.st_mtime, "size": stat.st_size,
        "tag": _tag(text),
    }


@app.put("/api/projects/{project_id}/file")
async def write_file(
    project_id: str,
    path: str = Body(...),
    text: str = Body(...),
    compile: bool = Body(True),
    base: str = Body(""),
    origin: str = Body(""),
    create: bool = Body(False),
):
    """Save one file.

    Not the editor's path any more -- the editor writes into the shared
    document and the server projects that onto disk.  This is what everything
    *else* uses: an upload, a template, a script, a test.

    `base` used to carry the tag the browser last agreed with, and a save
    whose tag had moved on was refused.  That machinery existed because this
    route was whole-file last-writer-wins with nothing watching, and it is
    gone: the text is folded into the shared document instead, so a
    concurrent edit merges rather than being turned away.  The parameter is
    still accepted and ignored, so an older caller does not fail.

    `origin` names the tab that saved, so the broadcast below can tell every
    *other* tab without the saving tab hearing its own echo.
    """
    session = session_for(project_id)
    target = _safe(session, path)
    # The same ceiling the read has, at the same place in the request.
    # There was none at all: `text: str` with no length, written, hashed,
    # compressed into a version and scanned three times, all on the loop.
    # A 40 MB body measured at 1.61 seconds during which nothing else on
    # this install was answered, against a 9 to 11 millisecond baseline,
    # and the file it wrote could not then be opened by the editor.
    size = len(text.encode("utf-8"))
    if size > MAX_TEXT_BYTES:
        raise HTTPException(
            413,
            f"That is {_size(size)}, and the editor opens files up to "
            f"{_size(MAX_TEXT_BYTES)}, so it was not written.",
        )
    if not target.exists() and not create:
        # A save must not bring a file back.  Renaming or deleting one that
        # was open left the tab pointing at the old name, and this route's
        # mkdir-and-write then recreated it -- so the writer went on editing
        # an orphan nothing includes.
        raise HTTPException(404, "no such file")
    previous = await asyncio.to_thread(read_text, target)
    created = previous is None
    try:
        # Off the loop: two fsyncs, a sha256 and a zlib compression, none
        # of which is anybody's keystroke. The constraint recorded in
        # `docs/architecture.md` is about pycrdt documents and the thread
        # that built them, and none of these three touches one; `_ingest`
        # does, and stays where it is.
        await asyncio.to_thread(write_atomically, target, text)
    except NotAFile as error:
        raise HTTPException(400, str(error))
    except OSError as error:
        raise HTTPException(500, f"could not save: {error}")
    session.mark_written(target)
    await asyncio.to_thread(
        session.record_version, target, text,
        by="you", previous=previous, source=origin,
    )
    # And into the shared document, so anybody with this file open sees it
    # arrive rather than finding out at their next reload.
    _ingest(session, target, text)

    await asyncio.to_thread(session.note_edit, target, text, previous)
    if compile:
        session.schedule_compile()
    tag = _tag(text)
    if previous != text:
        await session.events.publish({
            "type": "files_changed", "paths": [path], "origin": origin,
            # An ordinary save changes no names, so the other tabs need to
            # reload this file and nothing else.  Without this every
            # keystroke burst in one window cost every other one a full
            # tree request.  Creating a file is the exception: the name is
            # new, and a tree that does not show it leaves the writer with
            # a file they cannot reach until they reload the page.
            "structural": created,
        })
    return {"ok": True, "tag": tag, "mtime": target.stat().st_mtime}


@app.post("/api/projects/{project_id}/flush")
async def flush_documents(project_id: str):
    """Write every shared document out now, rather than on its debounce.

    This replaces the beacon a closing tab used to send.  That existed
    because the browser held the only copy of the last quarter second of
    typing; it does not any more -- the server has every keystroke as it is
    made -- so the last-gasp save has nothing left to rescue.

    What is still worth having is a way to say "now": the projection waits
    a moment to coalesce a burst, and a manual build clicked inside that
    window would otherwise typeset the previous text and look like the
    button had not worked.
    """
    session = session_for(project_id)
    session.collab.flush()
    return {"ok": True}


@app.post("/api/projects/{project_id}/file/new")
async def create_entry(
    project_id: str, path: str = Body(...), directory: bool = Body(False)
):
    session = session_for(project_id)
    target = _safe(session, path)
    if target.exists():
        raise HTTPException(409, "already exists")
    if directory:
        target.mkdir(parents=True)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.touch()
    return {"ok": True}


@app.post("/api/projects/{project_id}/file/rename")
async def rename_entry(project_id: str, path: str = Body(...), to: str = Body(...)):
    session = session_for(project_id)
    source, path = _safe_rel(session, path)
    target, to = _safe_rel(session, to)
    if not source.exists():
        raise HTTPException(404, "no such file")
    if target.exists():
        raise HTTPException(409, "a file of that name already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        source.rename(target)
    except OSError as error:
        raise HTTPException(400, f"could not rename: {error}")
    session.history.note_move(path, to)
    # And the shared document, or the manifest goes on naming the old path:
    # the watcher then sees one file vanish and another appear, trashes the
    # first and adopts the second, and every browser editing it carries on
    # looking normal while nothing it types reaches disk again.
    session.collab.rename(path, to)
    # A second tab has the file open under its old name, and the watcher
    # only tells it the tree changed -- not that this path became that one.
    # Every tab gets this, the originating one included, which is safe
    # because the remap is idempotent: after the first pass nothing matches
    # the old path any more.
    await session.events.publish({"type": "renamed", "from": path, "to": to})
    await session.events.publish(
        {"type": "files_changed", "paths": [to], "structural": True}
    )
    return {"ok": True}


@app.post("/api/projects/{project_id}/file/duplicate")
async def duplicate_entry(project_id: str, path: str = Body(..., embed=True)):
    """Copy a file beside itself.

    The name is chosen here rather than by the caller, for the reason
    `unique_name` exists at all: it is one rule in one place, and the
    interface quotes the answer back rather than guessing at it.
    """
    session = session_for(project_id)
    source, path = _safe_rel(session, path)
    if not source.exists():
        raise HTTPException(404, "no such file")
    if source.is_dir():
        raise HTTPException(400, "a folder cannot be duplicated")
    # Every keystroke goes into the shared document and the file on disk
    # trails it by the debounce, so a copy taken without this would be a copy
    # of the chapter as it was a moment ago rather than as it is -- and the
    # writer would have no way of telling which they had got.
    session.collab.flush()
    target = unique_name(source, "copy")
    try:
        # The bytes, not the text.  A figure that has been through a UTF-8
        # decode is not that figure any more.
        shutil.copy2(source, target)
    except OSError as error:
        raise HTTPException(400, f"could not duplicate: {error}")
    to = session.project.relative(target)
    # The watcher would find this on its own, eventually and in a batch.
    # Saying so here is what makes the copy appear in the same beat the menu
    # item was clicked in, for this tab and for everybody else's.
    await session.events.publish(
        {"type": "files_changed", "paths": [to], "structural": True}
    )
    return {"ok": True, "path": to}


@app.delete("/api/projects/{project_id}/file")
async def delete_file(project_id: str, path: str):
    """Move a file or folder to the trash. Nothing is destroyed here."""
    session = session_for(project_id)
    target = _safe(session, path)
    if target == session.project.root:
        raise HTTPException(400, "refusing to delete the project root")
    if not target.exists():
        raise HTTPException(404, "no such file")
    entry = session.trash.delete(target)
    await session.events.publish({"type": "trash_changed"})
    return {"ok": True, "entry": entry.as_dict()}


# ---------------------------------------------------------------------------
# The trash


@app.get("/api/projects/{project_id}/trash")
async def list_trash(project_id: str):
    session = session_for(project_id)
    return {"entries": [entry.as_dict() for entry in session.trash.entries()]}


@app.post("/api/projects/{project_id}/trash/{entry_id}/restore")
async def restore_trash(project_id: str, entry_id: str):
    session = session_for(project_id)
    try:
        result = session.trash.restore(entry_id)
    except FileNotFoundError as error:
        raise HTTPException(404, str(error))
    await session.events.publish({"type": "trash_changed"})
    await session.events.publish({"type": "files_changed", "paths": result["restored"]})
    # Which build path a restore needs depends on what came back.  Without
    # this the scheduler reused whatever the last edit left set, so
    # restoring a .bib skipped the biber pass its citations needed.
    for was, relative in zip(result["was"], result["restored"]):
        restored = session.project.root / relative
        # A file coming back out of the trash is a file coming back into the
        # project: it has to reach the shared document, and its record has to
        # stop being marked trashed or nothing will ever write it again.
        #
        # Told what it *was* called as well as what it is called now.  Those
        # differ when the old name had been taken, and matching on the new
        # one alone found no trashed record at all.
        session.collab.untrash(was, relative, read_text(restored))
        session.note_edit(restored, read_text(restored), None)
    session.schedule_compile()
    return {"ok": True, **result}


@app.delete("/api/projects/{project_id}/trash/{entry_id}")
async def purge_trash(project_id: str, entry_id: str):
    """Delete one entry for good, along with the history of what it held."""
    session = session_for(project_id)
    if session.trash.find(entry_id) is None:
        raise HTTPException(404, "no such trash entry")
    # Off the loop: an `rmtree` over a deleted chapter's figures, then a
    # walk of the version ledger. Neither is anybody's keystroke.
    if not await asyncio.to_thread(session.trash.purge, entry_id):
        # The payload would not come off the disk. The entry stays where it
        # is, because it is the only way back to those files, and saying so
        # is the difference between "delete for good" being a promise and
        # being a claim.
        raise HTTPException(
            500,
            "That could not be deleted for good, so it has been left in the "
            "trash. Something else may have the file open.",
        )
    await asyncio.to_thread(session.history.collect)
    await session.events.publish({"type": "trash_changed"})
    return {"ok": True}


@app.delete("/api/projects/{project_id}/trash")
async def empty_trash(project_id: str):
    session = session_for(project_id)
    removed, kept = await asyncio.to_thread(session.trash.empty)
    await asyncio.to_thread(session.history.collect)
    await session.events.publish({"type": "trash_changed"})
    return {"ok": True, "removed": removed, "kept": kept}


# ---------------------------------------------------------------------------
# Version history


@app.get("/api/projects/{project_id}/history")
async def file_history(project_id: str, path: str):
    session = session_for(project_id)
    # The fence, and the name the history files this under.
    _, path = _safe_rel(session, path)
    # And which of them can actually be opened.  A collaborator's version
    # arrives as a line, and its contents come when somebody asks for them,
    # so the panel has to be able to tell "here" from "not here yet" -- and,
    # when nobody is connected, from "nobody left to ask".
    here = session.history.have(path)
    versions = []
    for version in session.history.versions(path):
        entry = version.as_dict()
        entry["here"] = version.sha in here
        versions.append(entry)
    versions.reverse()     # newest first, as the panel reads it
    return {"path": path, "versions": versions}


@app.get("/api/projects/{project_id}/history/blob")
async def history_blob(
    project_id: str, path: str, sha: str, raw: bool = False, download: bool = False
):
    """One version, as text for the editor or as bytes for everything else.

    A figure's history is unreachable through the text form: `content`
    decodes with errors="replace", so an old PNG comes back as a string of
    replacement characters.  `raw=1` serves the stored bytes with the
    file's own media type, which is what the History panel's thumbnails
    and its Download both ask for.
    """
    session = session_for(project_id)
    _, path = _safe_rel(session, path)
    await _fetch_missing_blob(session, sha)
    if raw or download:
        data = session.history.bytes_of(path, sha)
        if data is None:
            raise HTTPException(404, "that version is no longer stored")
        name = Path(path).name
        # Always an attachment, and never a guessed type.
        #
        # `inline` plus `mimetypes.guess_type` meant a project file called
        # `x.html` came back as `text/html`, rendered on this app's own
        # origin, carrying the HttpOnly session cookie: stored cross-site
        # scripting, from a file that a template, a clone or a collaborator
        # can put in a project.  The two sibling routes never had this
        # because they hand `filename=` to `FileResponse`, which forces an
        # attachment; this one built its own headers and lost that.
        #
        # The `raw` parameter still means what it meant, which is "the bytes
        # rather than the JSON".
        #
        # It used to say the panel fetched this and made its own object URL.
        # It does not, and never did: there is no createObjectURL anywhere in
        # the frontend.  The URL goes straight into an `img` src, and now
        # also into pdf.js for an old version of a figure.  That is the
        # better arrangement rather than an oversight -- the response is
        # immutable and keyed by sha, so the browser caches it and there is
        # nothing to revoke -- but the comment had been describing a
        # mechanism nobody built.
        return Response(
            content=data,
            media_type="application/octet-stream",
            headers={
                "content-disposition": f'attachment; filename="{name}"',
                # The URL names a sha, so these bytes can never be different
                # bytes.  Twenty thumbnails in the panel cost one fetch each,
                # once, however often the panel is reopened.
                "cache-control": "private, max-age=31536000, immutable",
            },
        )
    text = session.history.content(path, sha)
    if text is None:
        raise HTTPException(404, "that version is no longer stored")
    return {"path": path, "sha": sha, "text": text}


@app.post("/api/projects/{project_id}/history/restore")
async def restore_version(
    project_id: str, path: str = Body(...), sha: str = Body(...)
):
    """Put an old version back, as a new version. Nothing is overwritten."""
    session = session_for(project_id)
    target, path = _safe_rel(session, path)
    # Bytes rather than text, so restoring a figure gives back the figure.
    text = session.history.bytes_of(path, sha)
    if text is None:
        raise HTTPException(404, "that version is no longer stored")
    previous = read_bytes(target)
    try:
        write_atomically(target, text)
    except (NotAFile, OSError) as error:
        raise HTTPException(400, str(error))
    session.mark_written(target)
    session.record_version(
        target, text, by="you", why="restored an earlier version",
        op="restore", previous=previous,
    )
    # Into the document too. Without this the restore was silently undone:
    # the file held the old text, the shared document still held the new
    # text, and the next keystroke anywhere projected the document back over
    # the restored file.
    _ingest(session, target, text)
    session.note_edit(target, text, previous)
    session.schedule_compile()
    await session.events.publish({"type": "files_changed", "paths": [path]})
    return {"ok": True}


@app.post("/api/projects/{project_id}/history/label")
async def label_version(
    project_id: str,
    path: str = Body(...),
    sha: str = Body(...),
    label: str = Body(""),
):
    session = session_for(project_id)
    _, path = _safe_rel(session, path)
    if not session.history.set_label(path, sha, label.strip() or None):
        raise HTTPException(404, "no such version")
    return {"ok": True}


@app.get("/api/projects/{project_id}/history/timeline")
async def history_timeline(project_id: str, limit: int = 80):
    session = session_for(project_id)
    return {"versions": session.history.timeline(max(1, min(limit, 500)))}


@app.get("/api/projects/{project_id}/history/size")
async def history_size(project_id: str):
    """What the stored history costs on disk.

    So the writer deciding whether to clear a file's history is told what
    they would get back rather than asked to guess.  `History.size` has
    existed since the store was written and had no caller.
    """
    session = session_for(project_id)
    return {"bytes": await asyncio.to_thread(session.history.size)}


@app.delete("/api/projects/{project_id}/history")
async def purge_history(project_id: str, path: str):
    """Delete every stored version of one file.  The file is not touched.

    Nothing here unlinks a blob by name, and that is the whole safety of it.
    Blobs are content-addressed and therefore shared -- with this file's own
    past, with any other file that happens to hold identical bytes, and with
    the final version recorded for a file now sitting in the trash -- so the
    only correct way to free them is to drop this file's log and then let
    `collect` sweep whatever no *remaining* log still points at.  Its one
    hour grace is what stops it racing a `record` that has written a blob
    and not yet its line -- and it is keyed on the blob's own mtime, which
    is why `put` touches a blob it finds already there rather than leaving
    it alone.  A version made in the last hour survives this call and goes
    on the next one.  The copy in the interface says "within the hour" for
    that reason and must not promise sooner.

    **On a shared project this clears one disk.**  A collaborator's copy of
    this file's past is on their machine and stays there, which §22 already
    treats as correct rather than as a fault, and nothing is sent to say
    otherwise: one person's decision about their own disk space must not
    reach into somebody else's copy.  What stops it coming straight back is
    the floor `History.forget` leaves behind, which refuses those records on
    the way in.  The confirmation says so, on a shared project only.

    The order matters.  Forget, then re-seed, then collect: collecting first
    would unlink the blob holding the file's current contents and the
    re-seed would immediately write it back, which is harmless but makes the
    freed figure a lie.

    The re-seed is a floor, and not optional.  Without it the file has no
    past at all, the panel is empty, and the next edit has nothing to diff
    against; `create` is in PERMANENT_OPS so the marker is never thinned
    away.  It used to be switchable through a `reseed` query parameter that
    no document mentioned, no test exercised, and nothing in the interface
    could reach -- an undocumented way to turn off the one safety property
    this route claims.
    """
    session = session_for(project_id)
    target, path = _safe_rel(session, path)
    before = await asyncio.to_thread(session.history.size)
    removed = len(session.history.versions(path))
    session.history.forget(path)
    seeded = False
    if target.is_file():
        session.record_version(
            target, read_bytes(target), by="you",
            why="history was cleared", op="create",
        )
        seeded = True
    # Off the event loop: both of these walk the whole store, and the store
    # is as big as the project's editing history.  The trash routes above
    # call `collect` inline, which is a wart rather than a precedent.
    await asyncio.to_thread(session.history.collect)
    after = await asyncio.to_thread(session.history.size)
    await session.events.publish({"type": "files_changed", "paths": [path]})
    # A peer's copy of this file's history is on their disk and stays there.
    # That is consistent with two collaborators being allowed to keep
    # different depths of the same file, which this project already treats
    # as correct rather than as a fault.
    return {
        "ok": True,
        "path": path,
        "removed": removed,
        "seeded": seeded,
        "freed": max(0, before - after),
    }


@app.post("/api/projects/{project_id}/upload")
async def upload(
    project_id: str,
    directory: str = Form(""),
    policy: str = Form(""),
    files: list[UploadFile] = File(...),
):
    """Put files into the project, saying what happened to each.

    `policy` is a JSON object naming what to do about a file that is
    already there: {"plot.png": "replace" | "keep-both" | "skip"}.  The
    browser decides from the tree it already has, so the common upload
    costs no round trip to find out there is nothing to ask about -- but
    the tree can be stale, so the decision travels with the request and
    this is where it is enforced.  Anything unlisted replaces, which is
    what dropping a file on a folder has always done.
    """
    session = session_for(project_id)
    destination = _safe(session, directory) if directory else session.project.root
    if destination.exists() and not destination.is_dir():
        raise HTTPException(400, "that is a file, not a folder")
    destination.mkdir(parents=True, exist_ok=True)

    try:
        wanted = json.loads(policy) if policy else {}
    except json.JSONDecodeError:
        wanted = {}
    if not isinstance(wanted, dict):
        wanted = {}

    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(
            413,
            f"That is {len(files)} files, and one upload carries up to "
            f"{MAX_UPLOAD_FILES}.",
        )

    written: list[str] = []
    results: list[dict] = []
    accepted = 0
    for item in files:
        # The name is taken apart, never trusted: an upload called
        # "../../.bashrc" lands in this directory like anything else.
        name = Path(item.filename or "upload").name
        target = destination / name
        choice = str(wanted.get(name, "replace"))

        # Landing in the project was never the whole question.  `latexmkrc`
        # in the project root is arbitrary Perl on the next full build, and
        # an upload is a form post, which needs no preflight, which is how a
        # page on a neighbouring port could reach this route at all.  The
        # same-origin check now refuses that page; this refuses the file, so
        # neither is the only thing standing there.
        if is_control_path(target.relative_to(session.project.root)):
            results.append({"name": name, "path": "", "outcome": "refused"})
            continue

        # Starlette has already spooled the whole body before this route is
        # called, so `size` is known and reliable here.  That also means this
        # check is about what lands in the project rather than about what the
        # server absorbed; what bounds *that* is the length gate in
        # `authenticate`.  Refused per file, like a control file, so the rest
        # of a drop still lands.
        size = item.size or 0
        if size > MAX_UPLOAD_BYTES or accepted + size > MAX_UPLOAD_TOTAL:
            results.append({"name": name, "path": "", "outcome": "too-big"})
            continue

        if target.exists() and choice == "skip":
            results.append({"name": name, "path": "", "outcome": "skipped"})
            continue

        outcome = "written"
        renamed_to = ""
        if target.is_file():
            if choice == "keep-both":
                target = unique_name(target)
                renamed_to = target.name
                outcome = "renamed"
            else:
                # An upload of the same name is a replacement; the old one
                # is still worth being able to get back.  Bytes, not text:
                # this read the file as UTF-8 and swallowed the
                # UnicodeDecodeError, so replacing a figure -- which is
                # most of what gets uploaded -- destroyed the previous one
                # with no version, no trash entry and nothing said.  The
                # blob store never had trouble with arbitrary bytes; only
                # this line did.  `op="replace"` keeps two exports a minute
                # apart from collapsing into one version and losing the
                # original, which is the version this is all for.
                try:
                    session.record_version(
                        target, target.read_bytes(),
                        by="you", why="replaced by an upload", op="replace",
                    )
                except OSError:
                    pass
                outcome = "replaced"
        elif target.exists():
            raise HTTPException(409, f"{name} is a folder")

        temp = target.with_name(target.name + ".part")
        with temp.open("wb") as handle:
            while chunk := await item.read(1 << 20):
                handle.write(chunk)
        temp.replace(target)
        accepted += size
        session.mark_written(target)
        relative = session.project.relative(target)
        # Uploads suppress the watcher, so this is the only way an uploaded
        # file reaches anybody else's copy -- or this browser's own editor.
        _ingest(session, target, read_text(target))
        written.append(relative)
        results.append({
            "name": name, "path": relative, "outcome": outcome,
            **({"renamedTo": renamed_to} if renamed_to else {}),
        })

    if written:
        session.schedule_compile()
        await session.events.publish({
            "type": "files_changed", "paths": written, "structural": True,
        })
    return {"written": written, "results": results}


# ---------------------------------------------------------------------------
# The writer's own library: a folder of papers, turned into a bibliography
#
# The one feature here that reaches outside a project, deliberately and
# with its own rules.  A Zotero folder is not in the project and never
# will be, so `Project.resolve` -- which answers one question, can this
# client-supplied relative path escape the project it names -- is not
# involved.  What guards this instead: it is read-only, it returns folder
# names and PDF counts and never file contents, it does not follow
# symlinks, and no tool the agent can call reaches it at all.


@app.get("/api/browse")
async def browse(path: str = "", count: bool = False):
    """Folders on the machine running NextTex, for picking one.

    Not scoped to a project, because it is not about one: a project is
    already a server-side absolute path typed into a box on the projects
    screen, so this is the app's existing model finally given a control.
    """
    home = Path.home()
    where = Path(path).expanduser() if path else home
    try:
        where = where.resolve()
    except (OSError, ValueError):
        raise HTTPException(400, "There is no folder at that path.")
    if not where.exists():
        raise HTTPException(400, "There is no folder at that path.")
    if not where.is_dir():
        raise HTTPException(400, "That is a file, not a folder.")

    def listing() -> dict:
        folders = []
        here = 0
        try:
            for item in sorted(os.scandir(where), key=lambda e: e.name.lower()):
                if item.name.startswith("."):
                    continue
                if item.is_dir(follow_symlinks=False):
                    try:
                        pdfs = sum(
                            1 for child in os.scandir(item.path)
                            if child.is_file() and child.name.lower().endswith(".pdf")
                        )
                    except OSError:
                        pdfs = 0
                    folders.append({"name": item.name, "path": item.path, "pdfs": pdfs})
                elif item.is_file() and item.name.lower().endswith(".pdf"):
                    here += 1
        except PermissionError:
            raise HTTPException(403, "NextTex cannot read that folder.")
        except OSError as error:
            raise HTTPException(400, str(error))
        return {"folders": folders, "pdfsHere": here}

    body = await asyncio.to_thread(listing)
    deep = None
    if count:
        found, unreadable = await asyncio.to_thread(library_walk, where)
        deep = {"pdfs": len(found), "unreadable": unreadable,
                "capped": len(found) > LIBRARY_MAX}
    return {
        "path": str(where),
        "parent": str(where.parent) if where.parent != where else None,
        "home": str(home),
        **body,
        "deep": deep,
    }


def _library(session: ProjectSession) -> Library:
    return Library(session.project.state_dir / "library")


def _bib_for(session: ProjectSession) -> Path | None:
    """The project's bibliography, or None when it has none."""
    found = sorted(
        path for path in session.project.root.rglob("*.bib")
        if ".nexttex" not in path.parts and "build" not in path.parts
    )
    return found[0] if found else None


@app.get("/api/projects/{project_id}/library")
async def library_state(project_id: str):
    session = session_for(project_id)
    shelf = _library(session)
    papers = shelf.papers()
    running = LIBRARY_JOBS.get(project_id)
    return {
        "count": sum(1 for paper in papers if paper.state == "added"),
        "sources": shelf.sources(),
        "lastRun": shelf.last_run(),
        "running": running.progress.as_dict() if running else None,
        "unidentified": [
            paper.as_dict() for paper in papers if paper.state == "unidentified"
        ],
        "haveReader": have_pdftotext(),
    }


@app.post("/api/projects/{project_id}/library/scan")
async def library_scan(project_id: str, path: str = Body(..., embed=True)):
    """Read a folder of papers into the bibliography.

    Answers as soon as it knows there is work to do, and does the work in
    the background: a hundred papers is a hundred network lookups, and the
    writer goes on writing throughout.
    """
    session = session_for(project_id)
    if project_id in LIBRARY_JOBS:
        raise HTTPException(409, "A folder is already being read.")
    if not have_pdftotext():
        raise HTTPException(
            503,
            "NextTex needs pdftotext to read a PDF. It comes with poppler-utils.",
        )
    bib = _bib_for(session)
    if bib is None:
        raise HTTPException(
            400,
            "There is no .bib file in this project. Make one first, "
            "New file, references.bib.",
        )

    folder = Path(path).expanduser()
    try:
        folder = folder.resolve()
    except (OSError, ValueError):
        raise HTTPException(400, "There is no folder at that path.")
    if not folder.is_dir():
        raise HTTPException(400, "There is no folder at that path.")

    fetch = references._load("bib_from_doi")
    fold = references._load("verify_bib").fold
    loop = asyncio.get_running_loop()

    def announce(progress) -> None:
        asyncio.run_coroutine_threadsafe(
            session.events.publish({"type": "library_scan", **progress.as_dict()}),
            loop,
        )

    def read_bib() -> str:
        return read_text(bib) or ""

    def write_bib(text: str) -> None:
        write_atomically(bib, text)
        session.mark_written(bib)
        # Back onto the loop for the fold, the way `announce` above already
        # goes. This whole function runs inside `to_thread(scan.run)`, and
        # `ingest` applies a transaction to a pycrdt document: the
        # constraint recorded in `docs/architecture.md` is that a document
        # belongs to the thread that built it, and this one was built on
        # the loop. Every reference the importer added was folded in from
        # a worker thread.
        asyncio.run_coroutine_threadsafe(
            _ingest_on_loop(session, session.project.relative(bib), text), loop,
        ).result()

    scan = Scan(
        _library(session), bib,
        read_bib=read_bib, write_bib=write_bib,
        entry_for=lambda doi, existing: references.entry_for(doi, existing),
        appended=references.appended,
        fetch_metadata=fetch.fetch_metadata,
        fold=fold,
        on_progress=announce,
    )
    LIBRARY_JOBS[project_id] = scan

    # A version on each side of the run, so both the bibliography as it was
    # and as it ended up stay reachable.  `op="import"` rather than "edit"
    # for the reason a replacement is not one either: the coalescer merges
    # same-author edits inside ninety seconds, and a two-hundred-entry
    # append is the largest change this file will ever take.
    session.record_version(bib, read_bib(), by="you", op="import",
                           why="before papers were imported")

    async def work() -> None:
        try:
            await asyncio.to_thread(scan.run, folder)
            session.record_version(
                bib, read_bib(), by="you", op="import",
                why=f"papers imported from {folder.name}",
            )
            session.note_edit(bib)
            session.schedule_compile()
        except Exception as error:                      # network, disk, anything
            scan.progress.phase = "failed"
            scan.progress.message = str(error)
            await session.events.publish(
                {"type": "library_scan", **scan.progress.as_dict()}
            )
        finally:
            LIBRARY_JOBS.pop(project_id, None)

    spawn(work(), "the library scan")
    return JSONResponse({"started": True}, status_code=202)


@app.post("/api/projects/{project_id}/library/stop")
async def library_stop(project_id: str):
    scan = LIBRARY_JOBS.get(project_id)
    if scan is None:
        return {"stopped": False}
    scan.stop()
    return {"stopped": True}


@app.post("/api/projects/{project_id}/library/resolve")
async def library_resolve(
    project_id: str, sha: str = Body(...), doi: str = Body(...)
):
    """A DOI the writer supplied for a paper that could not be identified.

    The title check still runs, but a human pasting a DOI is a human making
    the claim, so a mismatch is reported rather than refused.
    """
    session = session_for(project_id)
    shelf = _library(session)
    bib = _bib_for(session)
    if bib is None:
        raise HTTPException(400, "There is no .bib file in this project.")

    papers = shelf.papers()
    paper = next((p for p in papers if p.sha == sha), None)
    if paper is None:
        raise HTTPException(404, "no such paper")

    existing = read_text(bib) or ""
    try:
        found = await asyncio.to_thread(references.entry_for, doi.strip(), existing)
    except Exception as error:
        return {"added": False, "reason": str(error)}
    if not found.get("added"):
        return {"added": False, "reason": str(found.get("reason") or "not added")}

    write_atomically(bib, references.appended(read_text(bib) or "", found["entry"]))
    session.mark_written(bib)
    session.collab.ingest(session.project.relative(bib), read_text(bib))
    session.record_version(bib, read_text(bib), by="you", op="import",
                           why=f"added {found['key']} by hand")

    fold = references._load("verify_bib").fold
    body = shelf.text_for(sha)
    warning = ""
    if body and not title_is_on_the_page(found.get("title", ""), body, fold):
        warning = ("Added, though that paper's title is not on the first page "
                   "of this PDF.")

    paper.state = "added"
    paper.doi = doi.strip()
    paper.key = found["key"]
    paper.reason = ""
    shelf.save(papers, shelf.sources(), shelf.last_run())
    await session.events.publish({"type": "files_changed",
                                  "paths": [session.project.relative(bib)]})
    return {"added": True, "key": found["key"], "warning": warning}


@app.get("/api/projects/{project_id}/log")
async def build_log(project_id: str, document: str = ""):
    """The engine's own log, for the row in the drawer that came from it.

    `build/` is excluded from the file tree, deliberately, so this file was
    unreachable from the app: no route, and no way to open it even though
    `.log` is a text kind the editor would draw. Section 7 of the design
    document rejects a bottom console with Problems, Output and Terminal
    tabs, and this is what keeping the log reachable looks like without
    one: it opens inside the diagnostic it belongs to.

    A missing log is an empty answer rather than a 404: a project that has
    never built has no log, and that is an ordinary state of affairs the
    drawer should not have to translate from an error.
    """
    session = session_for(project_id)
    # Named explicitly rather than through `document_for`, which falls back
    # to the main document for a name it does not know. That fallback is
    # right for callers written before several documents existed and wrong
    # here: a client asking for one document's log and being handed
    # another's would be told nothing about the substitution.
    if document and document not in session.documents:
        raise HTTPException(404, "no such document")
    state = session.document_for(document or None)

    def read() -> str:
        path = state.paths.log
        if not path.is_file():
            return ""
        # Capped, because a run with a package looping can write tens of
        # megabytes and the interesting part is the end.
        raw = path.read_bytes()[-MAX_LOG_BYTES:]
        return raw.decode("utf-8", errors="replace")

    return {"document": state.path, "text": await asyncio.to_thread(read)}


@app.post("/api/projects/{project_id}/library/add")
async def library_add(project_id: str, doi: str = Body(..., embed=True)):
    """One reference, from a DOI the writer has in front of them.

    The resolve route above does this too, and cannot be used for it: it
    needs an unidentified PDF from a folder scan to hang the DOI on, so a
    writer who simply has a DOI has to acquire a paper first. This is that
    route with the paper taken out, which is what the README already
    promises when it calls working without an agent a real option.
    """
    session = session_for(project_id)
    bib = _bib_for(session)
    if bib is None:
        raise HTTPException(400, "There is no .bib file in this project.")

    existing = read_text(bib) or ""
    try:
        found = await asyncio.to_thread(references.entry_for, doi.strip(), existing)
    except Exception as error:      # noqa: BLE001 -- any failure is a reason
        # A DOI nobody has is an ordinary answer rather than a fault, and
        # the one thing that must never happen here is an invented entry.
        return {"added": False, "reason": str(error)}
    if not found.get("added"):
        return {"added": False, "reason": str(found.get("reason") or "not added")}

    await asyncio.to_thread(
        write_atomically, bib, references.appended(existing, found["entry"])
    )
    session.mark_written(bib)
    text = read_text(bib)
    session.collab.ingest(session.project.relative(bib), text)
    session.record_version(bib, text, by="you", op="import",
                           why=f"added {found['key']} by DOI")
    await session.events.publish({"type": "files_changed",
                                  "paths": [session.project.relative(bib)]})
    return {
        "added": True,
        "key": found["key"],
        "title": found.get("title", ""),
        "author": found.get("author", ""),
        "year": found.get("year", ""),
    }


@app.post("/api/projects/{project_id}/library/verify")
async def library_verify(project_id: str):
    """Check every entry against the record it claims to come from.

    Written, tested, called from the agent's tool, and reachable from the
    interface nowhere at all. Nothing is written: this reports.
    """
    session = session_for(project_id)
    bib = _bib_for(session)
    if bib is None:
        raise HTTPException(400, "There is no .bib file in this project.")
    return await asyncio.to_thread(references.verify, bib)


@app.delete("/api/projects/{project_id}/library/unidentified")
async def library_forget(project_id: str):
    """Dismiss the list of papers that could not be identified.

    Nothing is destroyed -- the papers are where they always were -- so
    this is not a delete and does not ask."""
    session = session_for(project_id)
    shelf = _library(session)
    papers = [p for p in shelf.papers() if p.state != "unidentified"]
    shelf.save(papers, shelf.sources(), shelf.last_run())
    return {"cleared": True}


# ---------------------------------------------------------------------------
# Project context: the template, the voice samples, the background reading
#
# These documents are not part of the manuscript and must not land in the
# project directory: they are what the agent reads *about* the writing, and
# they live under .nexttex/context/ instead.


@app.get("/api/projects/{project_id}/context")
async def list_context(project_id: str):
    session = session_for(project_id)
    return {
        "documents": [d.as_dict() for d in session.context.documents()],
        "stale": session.context.needs_distillation(),
    }


@app.post("/api/projects/{project_id}/context")
async def add_context(
    project_id: str,
    kind: str = Form(...),
    note: str = Form(""),
    files: list[UploadFile] = File(...),
):
    session = session_for(project_id)
    if kind not in KINDS:
        raise HTTPException(400, f"kind must be one of {', '.join(KINDS)}")
    added = []
    for item in files:
        if (item.size or 0) > MAX_UPLOAD_BYTES:
            # This one reads the whole file into memory in a single call,
            # with nothing in front of it, which is why it is capped even
            # though the upload route streams.
            raise HTTPException(
                413,
                f"{Path(item.filename or 'that file').name} is "
                f"{_size(item.size or 0)}, and one file may be up to "
                f"{_size(MAX_UPLOAD_BYTES)}.",
            )
        data = await item.read()
        # `context.add` runs pdftotext and then pdfinfo, as subprocesses,
        # inline. Measured at 1.00 second of blocked loop for one ordinary
        # paper, against a 9 to 11 millisecond baseline, and it is on the
        # path of something nobody can see, which is why it was never
        # reported. It is the outlier in a file where everything
        # comparable is already threaded.
        document = await asyncio.to_thread(
            session.context.add,
            kind, Path(item.filename or "upload").name, data, note,
        )
        added.append(document.as_dict())
    await session.events.publish({"type": "context_changed"})
    return {"added": added, "stale": session.context.needs_distillation()}


@app.get("/api/projects/{project_id}/context/memory")
async def read_memory(project_id: str):
    session = session_for(project_id)
    return {
        # The text is what a hand edit works on; the notes are what the
        # panel shows, because the file's own heading is scaffolding rather
        # than something the writer asked to be remembered.
        "text": session.context.memory_text(),
        "notes": session.context.memory_notes(),
        "limit": MEMORY_MAX_CHARS,
    }


@app.put("/api/projects/{project_id}/context/memory")
async def write_memory(project_id: str, text: str = Body(..., embed=True)):
    """Edit by hand what the agent was asked to remember.

    The distilled summaries beside it are meant to be corrected rather than
    regenerated, and memory is more so: it is the one thing here the writer
    dictated in the first place.
    """
    session = session_for(project_id)
    # Refused rather than cut. `set_memory` truncates at the cap and
    # answers with what it kept, so a writer who pasted more than fits got
    # a success, a panel that redrew with the end of their paragraph gone,
    # and nothing saying which. The agent's own path already refuses and
    # says the memory is full; this is the hand-edited one.
    body = text.strip()
    if len(body) > MEMORY_MAX_CHARS:
        raise HTTPException(
            400,
            f"Memory is limited to {MEMORY_MAX_CHARS} characters and that is "
            f"{len(body)}. Shorten it and it will be kept exactly.",
        )
    saved = session.context.set_memory(text)
    notes = session.context.memory_notes()
    # The system prompt is fixed for a Claude client's lifetime, so the
    # agent has to be told the ground moved under it.
    changed = getattr(session.agent, "memory_changed", None)
    if callable(changed):
        changed()
    await session.events.publish({"type": "context_changed"})
    return {"text": saved, "notes": notes, "limit": MEMORY_MAX_CHARS}


@app.get("/api/projects/{project_id}/dictionary")
async def read_dictionary(project_id: str):
    """The words this writer has said are spelled correctly.

    Per project rather than per machine: the vocabulary of a dissertation on
    excited-state dynamics has nothing to say about the next document, and a
    shared list would slowly stop flagging anything.
    """
    return {"words": session_for(project_id).dictionary.words()}


@app.post("/api/projects/{project_id}/dictionary")
async def add_to_dictionary(project_id: str, word: str = Body(..., embed=True)):
    return {"words": session_for(project_id).dictionary.add(word)}


@app.delete("/api/projects/{project_id}/dictionary")
async def remove_from_dictionary(project_id: str, word: str):
    """Undo an addition.

    Here because the alternative to a mistaken click is editing
    `.nexttex/dictionary.txt` by hand, and a writer should not have to know
    that file exists to take back one word.
    """
    return {"words": session_for(project_id).dictionary.remove(word)}


@app.delete("/api/projects/{project_id}/context/{document_id}")
async def remove_context(project_id: str, document_id: str):
    session = session_for(project_id)
    removed = session.context.remove(document_id)
    if not removed:
        raise HTTPException(404, "no such document")
    await session.events.publish({"type": "context_changed"})
    return {"ok": True}


@app.get("/api/projects/{project_id}/context/{document_id}/file")
async def context_file(project_id: str, document_id: str, text: bool = False):
    session = session_for(project_id)
    documents = {d.id: d for d in session.context.documents()}
    document = documents.get(document_id)
    if document is None:
        raise HTTPException(404, "no such document")
    if text:
        return {"text": session.context.extracted_text(document)}
    path = session.context.stored_path(document)
    if path is None or not path.is_file():
        raise HTTPException(404, "the stored file is missing")
    return FileResponse(
        path, filename=document.filename,
        media_type=mimetypes.guess_type(document.filename)[0]
        or "application/octet-stream",
    )


@app.post("/api/projects/{project_id}/context/distill")
async def distill_context(project_id: str, kind: str = Body(..., embed=True)):
    """Turn uploaded documents into the short summary the agent actually reads.

    The documents themselves are far too long to sit in every prompt: a
    handbook is ninety pages. The agent reads them once, here, and writes a
    page of rules that goes into the system prompt from then on.
    """
    session = session_for(project_id)
    if kind not in {"style", "voice"}:
        raise HTTPException(400, "kind must be style or voice")
    request = session.context.distillation_request(kind)
    if request is None:
        raise HTTPException(400, f"no {kind} documents to read")
    prompt, output = request
    session.start_agent_pump()
    try:
        await session.agent.ask(prompt)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"started": True, "writes": str(output)}


@app.get("/api/projects/{project_id}/download")
async def download(project_id: str, path: str = "", format: str = "auto"):
    """Take a copy away: one file, a folder, the whole project, or its PDF.

    This works whether or not the project is open, because the moment a user
    most wants a copy is often from the project list -- about to archive
    something, or to send the PDF to a supervisor -- and having to open a
    project first would be a step for nothing.
    """
    session = SESSIONS.get(project_id)
    project = session.project if session else REGISTRY.find(project_id)
    if project is None:
        raise HTTPException(404, "unknown project")

    if format == "pdf":
        pdf = await _project_pdf(project, session)
        return FileResponse(
            pdf, media_type="application/pdf",
            filename=f"{project.config.name}.pdf",
        )

    try:
        target = project.resolve(path) if path else project.root
    except PermissionError:
        raise HTTPException(403, "path is outside the project")
    except (OSError, ValueError):
        # ValueError is what a NUL byte in the path raises out of resolve();
        # a mistyped URL is a bad request, not a server error.
        raise HTTPException(400, "bad path")

    if target.is_file() and format != "zip":
        return FileResponse(
            target, filename=target.name,
            media_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream",
        )
    if not target.exists():
        raise HTTPException(404, "no such path")

    build_dir = project.build_dir.resolve()

    def build_archive() -> Path:
        """Write the archive to a file, and hand back where it is.

        Not into memory: a project with figures is tens of megabytes, and a
        BytesIO holds all of it while the response is served.  Streaming one
        was worse than it looked -- Starlette iterates a file object by
        *line*, and compressed bytes carry a newline every few hundred, so a
        40 MB archive left as a hundred and fifty thousand chunks.
        """
        handle = tempfile.NamedTemporaryFile(
            prefix="nexttex-download-", suffix=".zip", delete=False,
        )
        archive_path = Path(handle.name)
        base = target.parent if target.is_file() else target
        items = [target] if target.is_file() else target.rglob("*")
        try:
            with zipfile.ZipFile(handle, "w", zipfile.ZIP_DEFLATED) as archive:
                for item in items:
                    if not item.is_file():
                        continue
                    # Build output is regenerated from the source and would
                    # multiply the archive size for nothing.
                    if build_dir == item or build_dir in item.parents:
                        continue
                    if any(p in {".git", ".nexttex", "__pycache__"}
                           for p in item.parts):
                        continue
                    if is_ours(item.name):
                        continue
                    archive.write(item, item.relative_to(base))
        finally:
            handle.close()
        return archive_path

    # On a thread: compressing a thesis takes seconds, and on the loop that
    # is seconds in which nothing else in the app answers at all.
    archive_path = await asyncio.to_thread(build_archive)

    def remove_archive() -> None:
        archive_path.unlink(missing_ok=True)

    stem = target.stem if target.is_file() else (target.name or project.config.name)
    return FileResponse(
        archive_path, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{stem}.zip"'},
        background=BackgroundTask(remove_archive),
    )


SOURCE_SUFFIXES = {".tex", ".bib", ".cls", ".sty"}


def _source_newer_than(project: Project, stamp: float) -> bool:
    """Whether any source file has changed since that PDF was made.

    This walked the project with `rglob("*")` and a `stat` per entry, which
    means it walked `.git` and the whole build directory before discarding
    almost everything it had found, on the path a download takes.
    `walk_project` prunes those two rather than filtering their contents
    afterwards, which is the difference between reading a thesis and reading
    its entire history.
    """
    for path in walk_project(project.root, build_dir=project.build_dir):
        if path.suffix.lower() not in SOURCE_SUFFIXES or is_ours(path.name):
            continue
        try:
            if path.stat().st_mtime > stamp:
                return True
        except OSError:
            # It went away between the walk and the question, which is not
            # a reason to rebuild.
            continue
    return False


async def _project_pdf(project: Project, session: ProjectSession | None) -> Path:
    """The project's rendered PDF, built first if it is missing or stale.

    A download has to be the current document.  The preview PDF on disk may
    have been produced by a scoped fast build covering one chapter, so any
    build done here is a full one.
    """
    paths = ProjectPaths(
        root=project.root, main=project.main, build_dir=project.build_dir
    )
    if not project.main.is_file():
        raise HTTPException(400, f"no main file at {project.config.main}")

    scheduler = session.compiler if session else CompileScheduler(paths)
    # Only a full build produces a PDF worth handing over; the preview on
    # disk is often one chapter.
    fresh = paths.pdf.is_file() and scheduler.pdf_is_complete()
    if fresh:
        stamp = paths.pdf.stat().st_mtime
        fresh = not await asyncio.to_thread(_source_newer_than, project, stamp)
    if fresh:
        return paths.pdf

    result = await scheduler.build(force_full=True)
    if not paths.pdf.is_file():
        message = "compilation produced no PDF"
        # `result.diagnostics` does not exist.  `CompileResult` carries the
        # parsed log, and the diagnostics hang off that -- so this branch,
        # which exists to tell the writer *which error* stopped their
        # download, raised AttributeError instead and the route answered 500.
        # The one path in this app where somebody is told nothing at the
        # exact moment they asked for their thesis as a PDF.
        # `.errors` rather than `.diagnostics`: the writer is being told why
        # their download failed, and a font substitution warning is not why.
        # These are `Diagnostic` dataclasses, not dicts, which is the second
        # half of what the old line got wrong.
        errors = (result.log.errors if result.log else None) or []
        if errors:
            message = f"{message}: {errors[0].message}"
        raise HTTPException(422, message)
    return paths.pdf


# ---------------------------------------------------------------------------
# Git: backing the writing up somewhere that is not this machine


@app.get("/api/projects/{project_id}/git")
async def git_status(project_id: str):
    session = SESSIONS.get(project_id)
    project = session.project if session else REGISTRY.find(project_id)
    if project is None:
        raise HTTPException(404, "unknown project")
    # `git status` on a thesis with a large working tree is not instant, and
    # this route is called after every build.
    ready, reason = await asyncio.to_thread(gitrepo.gh_available)
    state = await asyncio.to_thread(gitrepo.status, project.root)
    return {**state.as_dict(), "gh": ready, "ghReason": reason}


@app.post("/api/projects/{project_id}/git/{action}")
async def git_action(
    project_id: str,
    action: str,
    message: str = Body("", embed=True),
):
    session = session_for(project_id)
    root = session.project.root
    # Every one of these is a synchronous `subprocess.run` with a two minute
    # timeout, and `push` and `pull` reach the network.  Called inline they
    # stopped the whole server for as long as they took: every autosave,
    # every event stream, every collaborator's socket, on a push to a remote
    # that was not answering.  `git_status` two functions above already knew
    # this and said so in its own comment.
    try:
        if action == "commit":
            output = await asyncio.to_thread(gitrepo.commit, root, message)
            return {"ok": True, "output": output}
        if action == "push":
            return {"ok": True, "output": await asyncio.to_thread(gitrepo.push, root)}
        if action == "pull":
            output = await asyncio.to_thread(gitrepo.pull, root)
            await session.events.publish({"type": "files_changed", "paths": []})
            return {"ok": True, "output": output}
        if action == "init":
            await asyncio.to_thread(gitrepo.initialise, root)
            return {"ok": True}
    except gitrepo.GitError as error:
        raise HTTPException(400, str(error))
    raise HTTPException(404, "no such action")


@app.post("/api/projects/{project_id}/git/backup/github")
async def git_backup(
    project_id: str,
    name: str = Body(""),
    url: str = Body(""),
    token: str = Body(""),
    private: bool = Body(True),
):
    """Point a project at GitHub, either by making the repository or joining one."""
    session = session_for(project_id)
    root = session.project.root
    # The same reason as the route above, and this one was not in the
    # finding: `create_github` shells out to `gh`, which makes its own
    # network calls, so it is the slowest thing here.
    try:
        if url:
            remote = await asyncio.to_thread(gitrepo.attach_remote, root, url, token)
        else:
            remote = await asyncio.to_thread(
                gitrepo.create_github, root,
                name or session.project.config.name, private,
            )
        return {"ok": True, "remote": remote}
    except gitrepo.GitError as error:
        raise HTTPException(400, str(error))


# ---------------------------------------------------------------------------
# What the project can complete to, and what it can start from


@app.get("/api/projects/{project_id}/symbols")
async def project_symbols(project_id: str):
    """Labels, citation keys, figures and macros -- for autocomplete."""
    session = session_for(project_id)
    found = session.symbols.get(
        excluded=session.project._excluded, build_dir=session.project.build_dir
    )
    return found.as_dict()


TEMPLATES = Path(__file__).resolve().parent.parent / "nexttex" / "templates"


@app.get("/api/templates")
async def list_templates():
    if not TEMPLATES.is_dir():
        return {"templates": []}
    return {"templates": sorted(p.name for p in TEMPLATES.iterdir() if p.is_dir())}


@app.post("/api/projects/{project_id}/template")
async def load_template(project_id: str, name: str = Body("basic", embed=True)):
    """Fill a blank project with something to start writing in.

    Refuses to touch a document that has anything in it: this is for the
    first minute of a project, not a way to lose an afternoon's work.
    """
    session = session_for(project_id)
    source = TEMPLATES / name
    if not source.is_dir() or ".." in name or "/" in name:
        raise HTTPException(404, "no such template")

    main = session.paths.main
    if main.exists():
        body = main.read_text(encoding="utf-8", errors="replace")
        body = body.split("\\begin{document}", 1)[-1]
        body = body.rsplit("\\end{document}", 1)[0]
        if body.strip():
            raise HTTPException(
                400,
                "this document already has something in it; "
                "the template would overwrite it",
            )

    written: list[str] = []
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.name == ".gitkeep":
            continue
        relative = path.relative_to(source)
        # The template's main.tex becomes *this* project's main file,
        # whatever it is called.
        target = main if relative.name == "main.tex" else session.project.root / relative
        if target.exists() and target.stat().st_size > 0 and target != main:
            continue          # never overwrite a file the writer already has
        target.parent.mkdir(parents=True, exist_ok=True)
        text = path.read_text(encoding="utf-8")
        if target.exists():
            session.record_version(
                target, target.read_text(encoding="utf-8", errors="replace"),
                by="you", why="before the template was loaded",
            )
        write_atomically(target, text)
        session.mark_written(target)
        session.record_version(target, text, by="you", why=f"loaded the {name} template")
        session.collab.ingest(session.project.relative(target), text)
        written.append(session.project.relative(target))

    (session.project.root / "figures").mkdir(exist_ok=True)
    session.note_edit(main, read_text(main), None)
    session.schedule_compile()
    await session.events.publish({"type": "files_changed", "paths": written})
    return {"ok": True, "written": written, "main": session.project.config.main}


@app.post("/api/projects/{project_id}/main")
async def set_main_document(project_id: str, path: str = Body(..., embed=True)):
    """Typeset a different file as the document.

    A thesis is not always rooted at main.tex, and a writer working on one
    chapter may want that chapter to be the document for a while.
    """
    session = session_for(project_id)
    target = _safe(session, path)
    if not target.is_file() or target.suffix.lower() not in {".tex", ".ltx"}:
        raise HTTPException(400, "the main document has to be a .tex file")
    await session.set_main(path)
    await session.events.publish(
        {"type": "project_changed", **_project_settings(session)}
    )
    session.schedule_compile()
    return {"ok": True, "main": path}


def _project_settings(session) -> dict:
    """Everything `project_changed` carries.

    Carried in the event rather than looked up afterwards.  The browser
    used to answer this event by re-fetching `open` -- the whole file tree
    and the whole transcript -- to learn one string, which on a forty-file
    project with a long conversation is a real cost for a switch being
    flipped.
    """
    config = session.project.config
    return {
        "main": config.main,
        "previews": list(session.documents),
        "autocompile": config.autocompile,
        "markErrors": config.mark_errors,
        "markWarnings": config.mark_warnings,
    }


@app.post("/api/projects/{project_id}/settings")
async def set_project_settings(
    project_id: str,
    autocompile: bool | None = Body(None),
    markErrors: bool | None = Body(None),
    markWarnings: bool | None = Body(None),
):
    """The three switches on the settings card.

    Any subset: the card sends the one that changed.
    """
    session = session_for(project_id)
    config = session.project.config
    if autocompile is not None:
        config.autocompile = bool(autocompile)
    if markErrors is not None:
        config.mark_errors = bool(markErrors)
    if markWarnings is not None:
        config.mark_warnings = bool(markWarnings)
    try:
        config.save(session.project.root)
    except OSError as error:
        raise HTTPException(500, f"could not save the project settings: {error}")
    settings = _project_settings(session)
    await session.events.publish({"type": "project_changed", **settings})
    return settings


# ---------------------------------------------------------------------------
# Compiling and the PDF


@app.post("/api/projects/{project_id}/compile")
async def compile_now(
    project_id: str,
    full: bool = Body(False, embed=True),
    document: str = Body("", embed=True),
):
    """Build one document now.

    An empty `document` means the main one, which is what every caller
    written before a project could have several sends.
    """
    session = session_for(project_id)
    result = await session.compile(force_full=full, document=document or None)
    return session.as_client_dict(result, session.document_for(document).path)


@app.get("/api/projects/{project_id}/documents")
async def list_documents(project_id: str):
    """What is previewed, what could be, and which document reads what.

    The `owners` map goes to the browser so the editor can mark the right
    preview stale on a keystroke rather than waiting for the server to say
    so a debounce later.
    """
    return session_for(project_id).documents_payload()


@app.post("/api/projects/{project_id}/previews")
async def add_preview(project_id: str, path: str = Body(..., embed=True)):
    """Start previewing another document in this project."""
    session = session_for(project_id)
    target = _safe(session, path)
    if target.suffix.lower() not in (".tex", ".ltx"):
        raise HTTPException(400, "only a .tex file can be previewed")
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError as error:
        raise HTTPException(400, f"could not read {path}: {error}")
    if not deps.is_standalone(text):
        raise HTTPException(
            400,
            f"{path} has no \\documentclass and \\begin{{document}} of its own, "
            "so it cannot be built by itself",
        )
    try:
        await session.register_preview(path)
    except ValueError as error:
        # A jobname already spoken for: two documents cannot both build to
        # one PDF, and renaming is the writer's call rather than ours.
        raise HTTPException(409, str(error))
    spawn(session.compile(document=path), "the first build of a new preview")
    return session.documents_payload()


@app.delete("/api/projects/{project_id}/previews")
async def remove_preview(project_id: str, path: str):
    session = session_for(project_id)
    try:
        await session.unregister_preview(path)
    except ValueError as error:
        raise HTTPException(400, str(error))
    return session.documents_payload()


@app.post("/api/projects/{project_id}/editor")
async def editor_state(project_id: str, state: dict = Body(...)):
    session_for(project_id).set_editor_state(state)
    return {"ok": True}


@app.get("/api/projects/{project_id}/pdf")
async def get_pdf(project_id: str, request: Request, document: str = ""):
    session = session_for(project_id)
    state = session.document_for(document)
    pdf = state.paths.pdf
    if not pdf.exists():
        raise HTTPException(404, "nothing has been built yet")
    # An ETag from the file's own mtime and size means PDF.js re-fetches
    # only when the document actually changed, which matters when a build
    # runs every time typing pauses.
    #
    # The jobname is in it because two documents' PDFs now sit behind one
    # route, and a client that dropped the query string -- or a proxy that
    # normalised it away -- could otherwise be handed a 304 for the wrong
    # document.  The jobname rather than the path: jobnames are unique by
    # construction, and a path may legally contain a quote.
    stat = pdf.stat()
    etag = f'W/"{state.paths.jobname}-{int(stat.st_mtime_ns)}-{stat.st_size}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return FileResponse(
        pdf, media_type="application/pdf",
        headers={"ETag": etag, "Cache-Control": "no-cache"},
    )


@app.get("/api/projects/{project_id}/synctex/inverse")
async def synctex_inverse(
    project_id: str, page: int, x: float, y: float, document: str = ""
):
    """PDF click to source position."""
    session = session_for(project_id)
    state = session.document_for(document)
    # A synctex query on a thesis-sized .synctex.gz is not free, and this
    # runs on every double-click in the preview.
    position = await asyncio.to_thread(
        synctex.pdf_to_source,
        state.paths.pdf, page, x, y, session.project.root,
        shadow_main=state.paths.shadow, main_file=state.paths.main,
    )
    if position is None:
        return {"found": False}
    try:
        relative = session.project.relative(position.file)
    except ValueError:
        return {"found": False}
    return {"found": True, "file": relative, "line": position.line,
            "column": position.column}


@app.get("/api/projects/{project_id}/synctex/forward")
async def synctex_forward(
    project_id: str, path: str, line: int, column: int = 0, document: str = ""
):
    """Source position to places on the page."""
    session = session_for(project_id)
    state = session.document_for(document)
    target = _safe(session, path)
    positions = await asyncio.to_thread(
        synctex.source_to_pdf,
        state.paths.pdf, target, line, session.project.root, column,
    )
    return {"positions": [
        {"page": p.page, "x": p.x, "y": p.y, "width": p.width, "height": p.height}
        for p in positions
    ]}


@app.get("/api/projects/{project_id}/words")
async def words(project_id: str, path: str = "", scope: str = "file"):
    """A word count that ignores markup, from texcount.

    Counting words in a .tex file with a regular expression counts control
    sequences and maths as prose, which is wrong by thousands on a thesis.
    texcount complains about a preamble it cannot parse and still counts
    correctly, so its warnings go to stderr and are ignored.
    """
    session = session_for(project_id)
    if not shutil.which("texcount"):
        return {"words": None, "scope": scope}
    argv = ["texcount", "-q", "-total", "-1", "-sum"]
    if scope == "document":
        argv += ["-inc", str(session.paths.main)]
    else:
        if not path:
            return {"words": None, "scope": scope}
        argv.append(str(_safe(session, path)))
    def count() -> str:
        return subprocess.run(
            argv, capture_output=True, text=True, timeout=45,
            cwd=session.project.root,
        ).stdout

    try:
        # In a thread: texcount over a whole thesis takes seconds, and on
        # the loop it holds up every autosave and every streamed token.
        out = await asyncio.to_thread(count)
    except (OSError, subprocess.SubprocessError):
        return {"words": None, "scope": scope}
    total = None
    for line in out.splitlines():
        digits = line.strip()
        if digits.isdigit():
            total = int(digits)
            break
    return {"words": total, "scope": scope}


@app.get("/api/projects/{project_id}/lint")
async def lint(project_id: str, path: str):
    """chktex findings for one file: syntax problems without a compile."""
    session = session_for(project_id)
    target = _safe(session, path)
    if not shutil.which("chktex"):
        return {"diagnostics": []}
    rcfile = Path(__file__).resolve().parent.parent / ".chktexrc"
    # `-I0` is the fix and `%f` is the guard.
    #
    # chktex follows \input and \include by default, so asking it about
    # main.tex asked it about the whole dissertation -- and this route then
    # stamped the requested path onto every finding, because the format
    # captured no filename.  A warning at line 34 of a chapter was reported
    # as line 34 of main.tex, which on a real document is a comment banner.
    # That is where the underlined comments came from: chktex does not lint
    # inside comments, so a decorated comment was always misattribution.
    #
    # This route is per-file -- it runs on whichever tab is open -- so `-I0`
    # is the answer that matches it: a chapter's warnings appear when that
    # chapter is open.  `%f` is then read only to discard anything chktex
    # attributes elsewhere, so a future change to these flags cannot quietly
    # bring the bug back.
    argv = ["chktex", "-q", "-I0", "-f", "%f:%l:%c:%k:%n:%m\n"]
    if rcfile.exists():
        argv += ["-l", str(rcfile)]
    argv.append(str(target))
    try:
        out = await asyncio.to_thread(
            lambda: subprocess.run(
                argv, capture_output=True, text=True, timeout=15,
                cwd=session.project.root,
            ).stdout
        )
    except (subprocess.SubprocessError, OSError):
        return {"diagnostics": []}
    diagnostics = []
    for row in out.splitlines():
        # Six fields, and the message is whatever is left -- it contains
        # colons routinely.  A filename with a colon in it would split
        # wrongly and then fail the containment check below, which drops the
        # row: the safe direction for a guard to fail in.
        parts = row.split(":", 5)
        if len(parts) != 6:
            continue
        found_in, line, column, kind, _number, message = parts
        if not line.isdigit():
            continue
        try:
            where = (session.project.root / found_in).resolve()
            where.relative_to(session.project.root.resolve())
        except (OSError, ValueError):
            continue
        if where != target.resolve():
            continue
        diagnostics.append({
            "severity": "warning" if kind.strip().lower() == "warning" else "info",
            "message": message.strip(),
            "file": path,
            "line": int(line),
            "column": int(column) if column.isdigit() else None,
            "source": "chktex",
        })
    return {"diagnostics": diagnostics}


# ---------------------------------------------------------------------------
# The agent


#: How much of a selection is worth sending. A writer who selects a whole
#: chapter and asks "tighten this" means it, but the model does not need
#: every line to know what was meant, and the turn should not fail because
#: the passage did not fit.
SELECTION_LINES = 200
SELECTION_CHARS = 24_000


def _selected_context(selection: dict | None) -> str:
    """What the writer had highlighted, as a preamble for the model.

    Sent with the question rather than left for the `editor_state` tool to
    fetch. The tool is still there and still right for "put this here", but
    a tool is only read if the model decides to call one, and somebody who
    selects a paragraph and types "make this shorter" has already said what
    they mean. Waiting to be asked lost that.

    The file and the line numbers go in with the text, because an edit needs
    somewhere to land.
    """
    if not selection:
        return ""
    text = str(selection.get("text") or "")
    if not text.strip():
        return ""
    name = str(selection.get("file") or "the open file")
    first = selection.get("fromLine")
    last = selection.get("toLine")

    lines = text.split("\n")
    dropped = 0
    if len(lines) > SELECTION_LINES:
        dropped = len(lines) - SELECTION_LINES
        lines = lines[:SELECTION_LINES]
        text = "\n".join(lines)
    if len(text) > SELECTION_CHARS:
        text = text[:SELECTION_CHARS]
        dropped = max(dropped, 1)

    where = (
        f"{name}, lines {first}\u2013{last}"
        if isinstance(first, int) and isinstance(last, int) and last != first
        else f"{name}, line {first}" if isinstance(first, int) else name
    )
    tail = f"\n[\u2026and {dropped} more lines, not shown]" if dropped else ""
    return (
        "The writer has this passage selected in the editor "
        f"({where}). Their question is most likely about it.\n"
        f"<selection>\n{text}{tail}\n</selection>"
    )


@app.post("/api/projects/{project_id}/agent/attachment")
async def agent_attachment(project_id: str, file: UploadFile = File(...)):
    """Take one image the writer pasted, dropped or picked.

    The bytes go on disk and the question carries the path, for the reason
    written at the top of `nexttex/attachments.py`: the agent already reads
    images from disk, that path is the one section 27 hardened, and the
    transcript ends up recording a filename rather than a megabyte of
    base64.
    """
    session = session_for(project_id)
    kind = (file.content_type or "").split(";")[0].strip().lower()
    if kind not in attachments.KINDS:
        raise HTTPException(
            400,
            "That is not an image the agent can look at. PNG, JPEG, WebP "
            "and GIF are the ones it can.",
        )
    # Asked before the read where the header offers an answer. Reading a
    # file into memory and then measuring it is the wrong order for the one
    # case the limit exists for.
    declared = getattr(file, "size", None)
    if declared is not None and declared > attachments.LIMIT:
        raise HTTPException(
            413,
            f"That image is {declared // (1024 * 1024)} MB, and the agent "
            f"takes up to {attachments.LIMIT // (1024 * 1024)}.",
        )
    data = await file.read()
    if not data:
        raise HTTPException(400, "That file is empty.")
    if len(data) > attachments.LIMIT:
        raise HTTPException(
            413,
            f"That image is {len(data) // (1024 * 1024)} MB, and the agent "
            f"takes up to {attachments.LIMIT // (1024 * 1024)}. A "
            "screenshot at screen resolution is well under it.",
        )
    path, name = await asyncio.to_thread(
        attachments.keep, session.project.state_dir, data, kind
    )
    return {"path": path, "name": name, "bytes": len(data)}


@app.post("/api/projects/{project_id}/agent/ask")
async def agent_ask(
    project_id: str,
    prompt: str = Body(..., embed=True),
    selection: dict | None = Body(None, embed=True),
    attached: list[str] | None = Body(None, embed=True),
):
    session = session_for(project_id)
    session.start_agent_pump()
    # Recorded as well as sent, so `editor_state` answers with what was true
    # when the question was asked rather than with whatever the 400 ms
    # cursor debounce had last managed to deliver.
    if selection and str(selection.get("text") or "").strip():
        session.note_selection(selection)
    # The images the writer attached, named above the question in the same
    # preamble the selection uses. `turn_start` does not carry it, so the
    # conversation on screen shows what was typed rather than the question
    # with a list of paths stapled to it; the chips under the composer are
    # what says an image went with it.
    #
    # Checked against the directory rather than trusted: this is a list of
    # strings out of an HTTP body, and the one thing it must not become is a
    # way to make the agent read an arbitrary path.
    held = attachments.directory(session.project.state_dir)
    paths = [
        name for name in (attached or [])
        if isinstance(name, str) and (held / Path(name).name).is_file()
    ][: attachments.MOST]
    preamble = _selected_context(selection)
    note = attachments.sentence(paths)
    if note:
        preamble = f"{note}\n\n{preamble}" if preamble else note
    try:
        await session.agent.ask(prompt, context=preamble)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True, "attached": paths}


@app.post("/api/projects/{project_id}/agent/reset")
async def agent_reset(project_id: str):
    """Put this conversation away and start an empty one.

    Refused while a turn is running rather than interrupting it first: the
    interrupt is asynchronous, and tearing the client down while an answer
    is still arriving is the failure the model switch already defers around.
    The button is disabled in the meantime, so this is the second line.
    """
    session = session_for(project_id)
    try:
        await session.agent.reset()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    try:
        archived = session.transcript.archive()
    except TranscriptError as failure:
        # The conversation is still there, so saying it was cleared would
        # be a lie the panel then acts on: it empties itself and the next
        # thing said is appended to the end of the old record.
        raise HTTPException(
            409, f"The conversation could not be filed away: {failure}"
        )
    # Every tab, so a second one is not left holding a conversation the
    # server has filed away and can no longer answer for.
    await session.events.publish({"type": "conversation_reset"})
    return {"ok": True, "archived": archived}


@app.post("/api/projects/{project_id}/agent/mode")
async def agent_mode(project_id: str, mode: str = Body(..., embed=True)):
    """Move the permission control, which has three positions now.

    Was `/agent/auto` with a boolean, which could not express both of the
    quiet positions the writer asked for. The agent validates the name
    itself, because this is a string out of an HTTP body and the quietest
    position is not somewhere to arrive by typo.
    """
    session = session_for(project_id)
    setter = getattr(session.agent, "set_mode", None)
    if not callable(setter):
        raise HTTPException(400, "this agent does not ask permission")
    try:
        setter(mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    # `auto` travels alongside for one version, so a tab that has not been
    # reloaded does not read a control it does not understand as no fence.
    await session.events.publish({
        "type": "agent_settings", "mode": mode, "auto": mode != "ask",
    })
    return {"mode": mode, "auto": mode != "ask"}


@app.post("/api/projects/{project_id}/agent/permission")
async def agent_permission(
    project_id: str, id: str = Body(...), decision: str = Body(...)
):
    if decision not in {"allow", "always", "conversation", "deny"}:
        raise HTTPException(
            400, "decision must be allow, always, conversation or deny"
        )
    session = session_for(project_id)
    resolved = session.agent.resolve_permission(id, decision)
    if resolved:
        session.transcript.note_decision(id, decision)
    return {"resolved": resolved}


# The models a writer can choose between.  Names, not identifiers, because
# the person picking is choosing how careful and how quick they want the
# help to be -- not which build is deployed.
# One list per provider.  A single shared list meant an OpenAI writer was
# offered a menu of Claude models, and picking one sent `claude-opus-5` to
# OpenAI -- which fails at the far end with a message about an unknown
# model rather than anything the writer could act on.
CLAUDE_MODELS = [
    {"id": "", "name": "Default", "note": "Whatever your Claude plan gives"},
    {"id": "claude-opus-5", "name": "Opus 5", "note": "The most careful"},
    {"id": "claude-sonnet-5", "name": "Sonnet 5", "note": "Quick, and good at prose"},
    {"id": "claude-haiku-4-5", "name": "Haiku 4.5", "note": "Fastest, for small edits"},
]

OPENAI_MODELS = [
    {"id": "", "name": "Default", "note": f"{OPENAI_DEFAULT_MODEL}"},
    {"id": "gpt-4o", "name": "GPT-4o", "note": "The general one"},
    {"id": "gpt-4o-mini", "name": "GPT-4o mini", "note": "Cheaper, for small edits"},
]


def _models_for(provider: str) -> list[dict]:
    return OPENAI_MODELS if provider == "openai" else CLAUDE_MODELS


def _model_is_wrong_provider(provider: str, model: str) -> bool:
    """Would this model be sent to a service that has never heard of it?

    Checked by prefix rather than by membership, because OpenAI ships
    models faster than this app is updated: an id NextTex has never seen
    is allowed through to OpenAI, but a `claude-` one is not.
    """
    if not model:
        return False
    if provider == "openai":
        return model.startswith("claude-")
    return not model.startswith("claude-")


@app.get("/api/projects/{project_id}/agent/usage")
async def agent_usage(project_id: str):
    session = session_for(project_id)
    return {
        "usage": session.agent.usage,
        "model": session.agent.model or "",
        "models": _models_for(SETTINGS.provider),
        # Whether a turn is actually running, so a browser that thinks one
        # is can find out that it is wrong.  A turn that ends without
        # saying so is the one failure this cannot detect from the event
        # stream alone -- there is nothing to detect, which is the bug.
        "busy": session.agent.busy,
        # Whether this agent approves without asking, and whether it is the
        # kind of agent that ever asks at all -- the OpenAI and no-agent
        # paths never put a card up, so offering the switch there would
        # promise a change that does not happen.
        "mode": str(getattr(session.agent, "mode", "ask")),
        "auto": bool(getattr(session.agent, "auto", False)),
        "asks": callable(getattr(session.agent, "set_mode", None)),
        # The cards waiting on an answer, so a browser that reloaded gets
        # them back rather than showing a card it cannot answer.  A reload
        # loses the card and not the turn, and the turn then waited out its
        # full ten minutes for an answer nobody could give.
        # No `getattr` default: every agent answers this now, and a
        # default here is what let three of the four not answer it.
        "pending": list(session.agent.pending_cards),
    }


@app.post("/api/projects/{project_id}/agent/model")
async def agent_model(project_id: str, model: str = Body("", embed=True)):
    session = session_for(project_id)
    if _model_is_wrong_provider(SETTINGS.provider, model):
        raise HTTPException(400, "that model belongs to a different provider")
    if (
        model
        and SETTINGS.provider != "openai"
        and not any(entry["id"] == model for entry in CLAUDE_MODELS)
    ):
        raise HTTPException(400, "unknown model")
    await session.agent.set_model(model)
    SETTINGS.model = model
    SETTINGS.save()
    # Changing the model closes the client the running turn is reading
    # from, so a change made mid-answer is remembered and taken up when
    # that answer finishes.  Say which happened; a dropdown that appears
    # to do nothing is worse than one that explains itself.
    return {"ok": True, "model": model, "deferred": session.agent.model != (model or None)}


@app.post("/api/projects/{project_id}/agent/interrupt")
async def agent_interrupt(project_id: str):
    await session_for(project_id).agent.interrupt()
    return {"ok": True}


@app.post("/api/projects/{project_id}/agent/undo")
async def agent_undo(
    project_id: str,
    path: str = Body(...),
    before: str = Body(...),
    after: str = Body(...),
    edit_id: str = Body(""),
    state: str = Body("reverted"),
):
    """Reverse one edit the agent made.

    Refuses when the file no longer matches what the agent left behind: the
    user has typed there since, and restoring the old text would throw their
    work away. The UI turns the undo affordance off in that case, but the
    check belongs here too, because the file can change between the render
    and the click.
    """
    session = session_for(project_id)
    target = _safe(session, path)
    try:
        current = target.read_text(encoding="utf-8")
    except OSError:
        raise HTTPException(404, "no such file")
    if current != after:
        return {"ok": False, "reason": "changed since"}
    try:
        write_atomically(target, before)
    except (NotAFile, OSError) as error:
        raise HTTPException(400, str(error))
    session.mark_written(target)
    # And the document, or the undo is put straight back by the next
    # projection -- the same way a restored version was.
    session.collab.ingest(session.project.relative(target), before)
    # Redo is this same route with the arguments swapped, so `state` is the
    # only thing that says which way round the writer meant it.
    undoing = state != "live"
    session.record_version(
        target, before, by="you",
        why="undid one of Claude's edits" if undoing else "put Claude's edit back",
        op="undo" if undoing else "redo",
    )
    if edit_id:
        session.transcript.note_revert(edit_id, state)
    session.note_edit(target, before, current)
    session.schedule_compile()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Signing in to Claude


# ---------------------------------------------------------------------------
# This install: which one it is, and whether it is behind


@app.get("/api/instance")
async def instance():
    """Who this server is.  Cheap, no network, answered while restarting.

    `boot` is the interesting field: a page that has just asked for an
    update polls this until the nonce changes, which is how it knows the
    process it is talking to is a new one.

    `head` and `diskHead` are two different facts and were one. `head` is
    the commit this process loaded and cannot change while it runs.
    `diskHead` is what the files say now, which an update moves without
    asking this process anything. When they differ, the install has been
    updated and not restarted, and the footer says so instead of claiming
    to be up to date.
    """
    return {
        "instance": instance_name(),
        "head": HEAD_AT_BOOT,
        "diskHead": await asyncio.to_thread(_head_now),
        "boot": BOOT,
        "supervised": updates.supervised(),
        "root": str(INSTALL_ROOT),
    }


@app.get("/api/update")
async def update_check(force: bool = False):
    """What updating would do.  Cached, because the screen that asks is the
    one the writer opens every session."""
    report = await asyncio.to_thread(UPDATES.get, force)
    body = report.as_dict()
    job = UPDATE_JOB.get("state")
    body["updating"] = job in ("running", "restarting")
    body["phase"] = job or ""
    return body


@app.post("/api/update")
async def update_start():
    """Pull, reinstall, rebuild, and then get out of the way so the
    supervisor can start a new process."""
    if UPDATE_JOB.get("state") in ("running", "restarting"):
        raise HTTPException(409, "An update is already running.")
    report = await asyncio.to_thread(UPDATES.get, True)
    if not report.can_update:
        # The reason first, and git's own words after it when the check
        # never reached the network: "there is nothing to update" is a
        # statement about the code, and a fetch that failed has not earned
        # the right to make one.
        why = report.reason or "There is nothing to update."
        if not report.checked and report.error:
            why = f"{why} {report.error}"
        raise HTTPException(400, why)

    UPDATE_JOB.clear()
    UPDATE_JOB.update({"state": "running", "log": [], "step": "", "queue": []})
    spawn(_run_update(report), "the update")
    return JSONResponse({"started": True}, status_code=202)


@app.post("/api/update/restart")
async def update_restart():
    """Restart this process, for an install that has been updated and not
    restarted.

    The footer's restart line used to offer Reload, which reloads the page
    from the same process: `head` is read once at start and cannot move
    while it runs, so the reader pressed the only control on the line and
    got back the identical sentence.  This is the control that sentence was
    asking for.  Where nothing would start NextTex again, there is no
    control and the line says to do it by hand instead.
    """
    if not updates.supervised():
        raise HTTPException(409, "Nothing here would start NextTex again, so it cannot restart itself. Stop it and start it again.")

    async def leave() -> None:
        await asyncio.sleep(0.3)          # let the answer reach the page
        os._exit(3)

    spawn(leave(), "the restart")
    return JSONResponse({"restarting": True}, status_code=202)


def _update_say(kind: str, **fields) -> None:
    """Record a line and hand it to whoever is watching."""
    event = {"type": kind, **fields}
    if kind == "output":
        log = UPDATE_JOB.setdefault("log", [])
        assert isinstance(log, list)
        log.append(fields.get("text", ""))
    if kind == "step":
        UPDATE_JOB["step"] = fields.get("label", "")
    for queue in list(UPDATE_JOB.get("queue", [])):      # type: ignore[arg-type]
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass


# What the raw output means, so the screen can say something better than the
# last line of pip's chatter.
_STEPS = (
    ("Fetching", "Fetching the new version"),
    ("Dependencies", "Installing Python packages"),
    ("interface", "Building the interface"),
    ("Restarting", "Finishing"),
    ("Done", "Finishing"),
)


async def _run_update(report) -> None:
    loop = asyncio.get_running_loop()

    def pump() -> int:
        # Windows has its own script, and used to have no route to it at
        # all: this hardcoded bash, so the update button could not work
        # there whatever it said.  The scripts differ because the service
        # managers do; the button should not care which one it is.
        if os.name == "nt":
            script = INSTALL_ROOT / "scripts" / "update.ps1"
            argv = [
                "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", str(script), "-NoRestart",
            ]
        else:
            script = INSTALL_ROOT / "scripts" / "update.sh"
            argv = ["bash", str(script), "--no-restart"]
            if instance_name():
                argv.append(f"--instance={instance_name()}")
        process = subprocess.Popen(
            argv,
            # The third place a child that might be Windows PowerShell is
            # started, and the one that would have been rediscovered later:
            # the server inherits its environment from whatever launched it,
            # which on a machine with PowerShell 7 is a pwsh lineage.
            env=child_env(argv),
            cwd=INSTALL_ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            text = line.rstrip()
            for needle, label in _STEPS:
                if needle in text:
                    # `call_soon_threadsafe` forwards positional arguments
                    # only, so the keywords have to be bound here.
                    loop.call_soon_threadsafe(partial(_update_say, "step", label=label))
                    break
            loop.call_soon_threadsafe(partial(_update_say, "output", text=text))
        return process.wait()

    try:
        code = await asyncio.to_thread(pump)
    except Exception as error:            # noqa: BLE001 -- the job must end
        # Anything at all: the writer is looking at a progress card, and a
        # card that never finishes is worse than one that says it failed.
        code = 1
        _update_say("output", text=f"{type(error).__name__}: {error}")

    if code != 0:
        UPDATE_JOB["state"] = "failed"
        _update_say("failed", message="The update did not finish.")
        UPDATES.forget()
        return

    UPDATE_JOB["state"] = "restarting"
    restart = "auto" if updates.supervised() else "manual"
    _update_say("done", ok=True, restart=restart)
    UPDATES.forget()

    if restart == "auto":
        # There is no way to ask uvicorn to stop from in here -- `serve()`
        # keeps its servers as locals -- so the exit *is* the restart.  Both
        # supervisors this app installs bring a service back after a
        # non-zero exit and leave it down after a clean one.
        await asyncio.sleep(0.6)          # let the stream flush
        os._exit(3)


@app.get("/api/update/stream")
async def update_stream():
    """Progress, joinable late: a tab that reloads mid-update is shown
    everything that has happened rather than an empty box."""

    async def events():
        queue: asyncio.Queue = asyncio.Queue(maxsize=512)
        UPDATE_JOB.setdefault("queue", []).append(queue)   # type: ignore[union-attr]
        try:
            yield "retry: 2000\n\n"
            for line in list(UPDATE_JOB.get("log", [])):   # type: ignore[arg-type]
                yield f"data: {json.dumps({'type': 'output', 'text': line})}\n\n"
            if UPDATE_JOB.get("step"):
                yield f"data: {json.dumps({'type': 'step', 'label': UPDATE_JOB['step']})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"data: {json.dumps(event)}\n\n"
                if event["type"] in ("done", "failed"):
                    break
        finally:
            watchers = UPDATE_JOB.get("queue", [])
            if isinstance(watchers, list) and queue in watchers:
                watchers.remove(queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/agent/status")
async def agent_status():
    """Which agent this instance uses, and whether it can be used yet.

    One route for all three providers, because the sign-in screen has one
    question to answer -- can the writer get to work -- and the answer for
    "no agent" is yes, immediately.
    """
    provider = SETTINGS.provider if SETTINGS.provider in PROVIDERS else "claude"
    if provider == "none":
        return {"provider": "none", "ready": True}
    if provider == "openai":
        return {
            "provider": "openai",
            "ready": bool(SETTINGS.openai_key),
            "model": SETTINGS.model or OPENAI_DEFAULT_MODEL,
            # Never the key itself.  Enough to show that one is set.
            "keyTail": SETTINGS.openai_key[-4:] if SETTINGS.openai_key else "",
        }
    status = claude_auth.status()
    return {"provider": "claude", "ready": bool(status.get("loggedIn")), **status}


@app.post("/api/agent/provider")
async def agent_provider(
    provider: str = Body(...), key: str = Body(""), model: str = Body("")
):
    """Choose the agent, and hand over a key if the choice needs one."""
    if provider not in PROVIDERS:
        raise HTTPException(400, f"provider must be one of {', '.join(PROVIDERS)}")
    changed = SETTINGS.provider != provider
    SETTINGS.provider = provider
    if changed and not model.strip():
        # A model chosen for the old provider means nothing to the new one,
        # and carrying it across is how `claude-opus-5` ends up in a request
        # to OpenAI.  Falling back to empty means "this provider's default".
        SETTINGS.model = ""
    if provider == "openai":
        if key:
            SETTINGS.openai_key = key.strip()
        SETTINGS.model = model.strip() or SETTINGS.model or OPENAI_DEFAULT_MODEL
    if provider == "claude" and _model_is_wrong_provider("claude", SETTINGS.model):
        SETTINGS.model = ""
    if provider == "none":
        # The key is not kept for a provider that is switched off.  Leaving
        # a credential in a config file for a feature nobody is using is
        # how credentials outlive the reason they existed.
        SETTINGS.openai_key = ""
    try:
        SETTINGS.save()
    except OSError as error:
        raise HTTPException(500, f"could not save settings: {error}")

    # Every open project is holding an agent built for the old provider, so
    # all of them go.  Two things this used to get wrong.  A project with a
    # turn running had its transport closed underneath it, and that turn
    # then ended without ever saying so -- `interrupt()` ends it visibly
    # instead.  And clearing the registry without closing the sessions
    # orphaned each one's event pump, which went on running against an
    # agent nothing could reach.
    open_sessions = list(SESSIONS.values())
    # Interrupted first and closed second, with a turn of the loop between,
    # so that each `done` has a live event pump to travel out on.  Closing a
    # session cancels that pump, so doing both in one pass would end the
    # turns and then swallow the news of it.
    for session in open_sessions:
        if session.agent.busy:
            await session.agent.interrupt()
    await asyncio.sleep(0)
    for session in open_sessions:
        await session.close()
    SESSIONS.clear()
    return await agent_status()


@app.get("/api/claude/status")
async def claude_status():
    return claude_auth.status()


@app.post("/api/claude/login/start")
async def claude_login_start(console: bool = Body(False, embed=True)):
    return await claude_auth.start_login(console=console)


@app.post("/api/claude/login/input")
async def claude_login_input(text: str = Body(..., embed=True)):
    return await claude_auth.send_input(text)


@app.get("/api/claude/login/stream")
async def claude_login_stream():
    async def events():
        async for chunk in claude_auth.stream():
            yield f"data: {chunk}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/api/claude/login/cancel")
async def claude_login_cancel():
    await claude_auth.cancel_login()
    return {"ok": True}


@app.post("/api/claude/install")
async def claude_install():
    """Install the Claude CLI on this machine, for somebody who opted out.

    Modelled on the login pair above and streamed the same way, because it
    is the same shape of thing: a subprocess whose output the browser
    watches.  A failure comes back on the stream as `done, ok: false`, never
    as a 500 -- a vendor installer that refuses is an outcome the screen
    renders, and OpenAI and no agent are still there afterwards.
    """
    return await claude_auth.start_install()


@app.get("/api/claude/install/stream")
async def claude_install_stream():
    async def events():
        async for chunk in claude_auth.install_stream():
            yield f"data: {chunk}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/api/claude/logout")
async def claude_logout():
    return claude_auth.logout()


# ---------------------------------------------------------------------------
# The event stream


@app.get("/api/projects/{project_id}/events")
async def events(project_id: str, request: Request):
    session = session_for(project_id)
    queue = session.events.subscribe()

    async def stream():
        import json as _json
        try:
            yield "retry: 2000\n\n"
            # The first frame is what this connection missed. `compile_start`
            # goes to whoever is subscribed at that instant and is not kept,
            # so a tab that opens a project and builds in the same breath
            # misses its own build starting, and a stream that dropped
            # during a build comes back with the strip still saying
            # Compiling. Both are answered by beginning with the state
            # rather than only with the news.
            yield f"data: {_json.dumps(session.compile_snapshot())}\n\n"
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    if event is CLOSED:
                        # The server gave up on this subscriber because it
                        # had stopped reading.  Ending the response is what
                        # makes EventSource reconnect and re-read state; the
                        # alternative is keepalives on a queue nothing
                        # writes to, which looks alive and is not.
                        return
                    yield f"data: {_json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # A comment frame keeps intermediaries from closing an
                    # idle stream, and tells us when the client has gone.
                    yield ": keepalive\n\n"
        finally:
            session.events.unsubscribe(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# The frontend


class PrecompressedStatic(StaticFiles):
    """Static files, with the compressed copy served when one exists.

    Compression is not free, and doing it per request is the wrong trade
    for this app.  Starlette's GZipMiddleware compresses on every response:
    measured on the real bundle that is about 38 ms of CPU before the first
    byte moves, which over loopback took the file from 1.9 ms to 40 ms.
    Somebody running NextTex on the machine they are sitting at would have
    paid twenty times the latency for a saving their link did not need.

    So `npm run build` writes `.br` and `.gz` beside each asset and this
    hands over whichever one the browser asked for.  The bytes are already
    small, serving them costs a file read, and the ratio is better than
    anything worth computing per request: brotli at quality 11 gets the
    bundle to 202 kB where gzip on the fly managed 236 kB.

    `Vary: Accept-Encoding` is essential rather than decorative: without it
    a cache between the browser and here can hand a brotli body to a client
    that never asked for one.
    """

    async def get_response(self, path: str, scope):
        request = Request(scope)
        accepted = request.headers.get("accept-encoding", "")
        for suffix, encoding in ((".br", "br"), (".gz", "gzip")):
            if encoding not in accepted:
                continue
            try:
                full = Path(self.directory) / f"{path}{suffix}"  # type: ignore[arg-type]
                if not full.is_file():
                    continue
            except (OSError, ValueError):
                continue
            response = await super().get_response(f"{path}{suffix}", scope)
            if response.status_code != 200:
                continue
            # The type is the type of what it decompresses to, not of the
            # envelope: a browser handed `application/gzip` would download
            # the file rather than run it.
            kind, _ = mimetypes.guess_type(path)
            response.headers["content-type"] = kind or "application/octet-stream"
            response.headers["content-encoding"] = encoding
            response.headers["vary"] = "Accept-Encoding"
            return response
        response = await super().get_response(path, scope)
        response.headers["vary"] = "Accept-Encoding"
        return response


if FRONTEND.is_dir():
    app.mount(
        "/assets", PrecompressedStatic(directory=FRONTEND / "assets"), name="assets"
    )

    @app.get("/{path:path}")
    async def spa(path: str):
        # Not for the API. This is registered last and catches everything
        # no route claimed, which is right for a single-page app and wrong
        # for `/api/anything`: a typo in a path, or a route removed while a
        # tab was open, answered 200 with the whole interface as its body,
        # and the browser's error path read that as a successful response
        # and tried to parse a page of HTML as JSON.
        if path.startswith("api/"):
            raise HTTPException(404, "no such route")
        index = FRONTEND / "index.html"
        if not index.exists():
            return HTMLResponse("<h1>NextTex</h1><p>The frontend is not built.</p>")
        return FileResponse(index)
else:
    @app.get("/")
    async def unbuilt():
        return HTMLResponse(
            "<h1>NextTex</h1><p>The frontend has not been built yet. "
            "Run <code>npm ci &amp;&amp; npm run build</code> in "
            "<code>frontend/</code>.</p>"
        )
