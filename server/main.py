"""The NextTex server.

A single uvicorn process serves the built frontend, the API and the event
stream. There is no nginx and no container: this runs on one person's
machine, for that person, and every extra moving part is one more thing
between someone cloning the repository and having an editor open.
"""

from __future__ import annotations

import asyncio
import hashlib
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
from pathlib import Path

from starlette.background import BackgroundTask
from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import (
    FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

from nexttex import claude_auth, gitrepo, synctex
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
from nexttex.context import KINDS
from nexttex.project import (
    IGNORED_FILES, Project, ProjectConfig, Registry, instance_name,
)
from nexttex import updates
from server.session import ProjectSession

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
    print(f"  LaTeX      {tex or 'NOT FOUND — compiling will fail'}")
    for item in missing_tools():
        print(f"  missing    {item}")
    watcher = asyncio.create_task(_watch_projects())
    reaper = asyncio.create_task(_reap_idle())
    try:
        yield
    finally:
        watcher.cancel()
        reaper.cancel()
        for session in list(SESSIONS.values()):
            await session.close()


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
                        if path.name in IGNORED_FILES or path.suffix in {
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
                    if session:
                        await session.events.publish(
                            {"type": "files_changed", "paths": sorted(paths)}
                        )
        except (asyncio.CancelledError, GeneratorExit):
            raise
        except Exception:
            await asyncio.sleep(1.0)
        finally:
            if stop in WATCH_RESTART:
                WATCH_RESTART.remove(stop)


def _restart_watch() -> None:
    """Wake the file watcher so it picks up a newly opened or closed project."""
    while WATCH_RESTART:
        WATCH_RESTART.pop().set()


async def _reap_idle() -> None:
    while True:
        await asyncio.sleep(60)
        for session in list(SESSIONS.values()):
            try:
                await session.reap_idle_agent()
            except Exception:
                pass


app = FastAPI(title="NextTex", lifespan=lifespan, docs_url=None, redoc_url=None)


# ---------------------------------------------------------------------------
# Authentication: a printed token, exchanged once for a cookie.
#
# EventSource cannot send an Authorization header, so the session has to live
# in a cookie for the event stream to be authenticated at all.


@app.middleware("http")
async def authenticate(request: Request, call_next):
    if request.url.path.startswith(("/assets/", "/favicon")):
        return await call_next(request)

    # The cookie is what the browser uses after the first load; the query
    # parameter is what the printed URL carries; the header is for anything
    # scripted, which cannot easily hold a cookie jar.
    header = request.headers.get("authorization", "")
    supplied = (
        request.query_params.get("token")
        or request.cookies.get(COOKIE)
        or request.headers.get("x-nexttex-token")
        or (header[7:] if header.lower().startswith("bearer ") else "")
    )
    if not supplied or not secrets.compare_digest(supplied, SETTINGS.token):
        if request.url.path.startswith("/api/"):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return HTMLResponse(_token_page(), status_code=401)

    response = await call_next(request)
    if request.query_params.get("token"):
        response.set_cookie(
            COOKIE, SETTINGS.token,
            httponly=True, samesite="lax",
            secure=request.url.scheme == "https",
            max_age=60 * 60 * 24 * 365,
        )
    return response


def _token_page() -> str:
    return (
        "<!doctype html><meta charset=utf-8>"
        "<title>NextTex</title>"
        "<style>body{font:15px/1.6 system-ui;margin:12vh auto;max-width:34rem;"
        "padding:0 1.5rem;color:#191c1a;background:#edf0ec}"
        "code{background:#e2e6e1;padding:.15rem .35rem;border-radius:3px}"
        "@media(prefers-color-scheme:dark){body{background:#1a1e1b;color:#dde2dd}"
        "code{background:#222623}}</style>"
        "<h1>NextTex</h1><p>This link needs the access token that was printed "
        "when the server started.</p><p>Open the URL it gave you, which looks "
        "like <code>?token=…</code>. If you have lost it, run "
        "<code>.venv/bin/python server/run.py --print-url</code> in the "
        "install directory on the machine running the server.</p>"
    )


# ---------------------------------------------------------------------------
# Helpers


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
    session = SESSIONS.get(project_id)
    if session is not None:
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


def _safe(session: ProjectSession, relative: str) -> Path:
    try:
        return session.project.resolve(relative)
    except PermissionError:
        raise HTTPException(403, "path is outside the project")
    except (OSError, ValueError):
        # ValueError is what a NUL byte in the path raises out of resolve();
        # a mistyped URL is a bad request, not a server error.
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
    session = SESSIONS.pop(project_id, None)
    project = session.project if session else REGISTRY.find(project_id)
    if session:
        await session.close()
        _restart_watch()
    if project is None:
        raise HTTPException(404, "unknown project")
    # Registry removal does not depend on the project being open: the
    # projects most likely to be removed are the ones nobody has opened.
    REGISTRY.remove(project.root)
    return {"ok": True}


@app.post("/api/projects/{project_id}/open")
async def open_project(project_id: str):
    """Open a project in a window, and hand back everything it needs.

    Other routes open a session on demand; this one is what the *user*
    means by opening a project, so it is the only place that marks the
    project as recently opened.
    """
    fresh = project_id not in SESSIONS
    session = session_for(project_id)
    if fresh:
        REGISTRY.touch(session.project.root)
    return {
        **session.project.as_dict(),
        "tree": session.project.tree(),
        "context": [d.as_dict() for d in session.context.documents()],
        "transcript": session.transcript.items(),
    }


@app.get("/api/projects/{project_id}/tree")
async def project_tree(project_id: str):
    return session_for(project_id).project.tree()


# ---------------------------------------------------------------------------
# Files


@app.get("/api/projects/{project_id}/file")
async def read_file(project_id: str, path: str):
    session = session_for(project_id)
    target = _safe(session, path)
    if not target.is_file():
        raise HTTPException(404, "no such file")
    try:
        text = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(415, "not a text file")
    stat = target.stat()
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

    `base` is the tag the browser was given when it last agreed with this
    file.  Without it this route was whole-file last-writer-wins with
    nothing watching: two tabs on one project, or one tab and a `git
    checkout`, and a chapter written in the other window was gone with no
    error and no dirty marker.  When the file has moved on underneath the
    caller, nothing is written -- the answer carries what is on disk now and
    the browser asks the writer which copy survives.

    `origin` names the tab that saved, so the broadcast below can tell every
    *other* tab to reload without the saving tab reloading itself.
    """
    session = session_for(project_id)
    target = _safe(session, path)
    if not target.exists() and not create:
        # A save must not bring a file back.  Renaming or deleting one that
        # was open left the tab pointing at the old name, and this route's
        # mkdir-and-write then recreated it -- so the writer went on editing
        # an orphan nothing includes.
        raise HTTPException(404, "no such file")
    previous = read_text(target)
    created = previous is None
    if base and previous is not None and previous != text:
        current = _tag(previous)
        if current != base:
            return {
                "ok": False, "conflict": True,
                "text": previous, "tag": current,
            }
    try:
        write_atomically(target, text)
    except NotAFile as error:
        raise HTTPException(400, str(error))
    except OSError as error:
        raise HTTPException(500, f"could not save: {error}")
    session.mark_written(target)
    session.record_version(target, text, by="you", previous=previous, source=origin)

    session.note_edit(target, text, previous)
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


@app.post("/api/projects/{project_id}/file/beacon")
async def file_beacon(project_id: str, request: Request):
    """Last-gasp save from a tab that is closing.

    `navigator.sendBeacon` cannot wait for a reply and cannot set headers,
    so this takes the body as-is and saves without compiling.  It is the
    difference between losing the last quarter second of typing and not.
    """
    session = session_for(project_id)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "bad body")
    path = payload.get("path")
    text = payload.get("text")
    base = payload.get("base")
    if not isinstance(path, str) or not isinstance(text, str):
        raise HTTPException(400, "path and text are required")
    target = _safe(session, path)
    if not target.is_file():
        raise HTTPException(404, "no such file")
    previous = read_text(target)
    if isinstance(base, str) and base and previous is not None and previous != text:
        if _tag(previous) != base:
            # A closing tab cannot be asked anything, and it is the one that
            # is going away: the window that is still open keeps its work.
            # The text is not lost -- it is in the file's own history.
            session.record_version(
                target, text, by="you",
                why="from a tab that closed holding an older copy",
                op="orphan", previous=previous,
            )
            return {"ok": False, "conflict": True}
    try:
        write_atomically(target, text)
    except (NotAFile, OSError) as error:
        raise HTTPException(400, str(error))
    session.mark_written(target)
    session.record_version(
        target, text, by="you", why="as the tab closed", previous=previous,
    )
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
    source, target = _safe(session, path), _safe(session, to)
    if not source.exists():
        raise HTTPException(404, "no such file")
    if target.exists():
        raise HTTPException(409, "a file of that name already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        source.rename(target)
    except OSError as error:
        raise HTTPException(400, f"could not rename: {error}")
    session.history.note_rename(path, to)
    return {"ok": True}


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
    for relative in result["restored"]:
        restored = session.project.root / relative
        session.note_edit(restored, read_text(restored), None)
    session.schedule_compile()
    return {"ok": True, **result}


@app.delete("/api/projects/{project_id}/trash/{entry_id}")
async def purge_trash(project_id: str, entry_id: str):
    """Delete one entry for good, along with the history of what it held."""
    session = session_for(project_id)
    if not session.trash.purge(entry_id):
        raise HTTPException(404, "no such trash entry")
    session.history.collect()
    await session.events.publish({"type": "trash_changed"})
    return {"ok": True}


@app.delete("/api/projects/{project_id}/trash")
async def empty_trash(project_id: str):
    session = session_for(project_id)
    count = session.trash.empty()
    session.history.collect()
    await session.events.publish({"type": "trash_changed"})
    return {"ok": True, "removed": count}


# ---------------------------------------------------------------------------
# Version history


@app.get("/api/projects/{project_id}/history")
async def file_history(project_id: str, path: str):
    session = session_for(project_id)
    _safe(session, path)   # refuse to describe anything outside the project
    versions = [v.as_dict() for v in session.history.versions(path)]
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
    _safe(session, path)
    if raw or download:
        data = session.history.bytes_of(path, sha)
        if data is None:
            raise HTTPException(404, "that version is no longer stored")
        name = Path(path).name
        disposition = "attachment" if download else "inline"
        return Response(
            content=data,
            media_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
            headers={
                "content-disposition": f'{disposition}; filename="{name}"',
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
    target = _safe(session, path)
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
    _safe(session, path)
    if not session.history.set_label(path, sha, label.strip() or None):
        raise HTTPException(404, "no such version")
    return {"ok": True}


@app.get("/api/projects/{project_id}/history/timeline")
async def history_timeline(project_id: str, limit: int = 80):
    session = session_for(project_id)
    return {"versions": session.history.timeline(max(1, min(limit, 500)))}


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

    written: list[str] = []
    results: list[dict] = []
    for item in files:
        # The name is taken apart, never trusted: an upload called
        # "../../.bashrc" lands in this directory like anything else.
        name = Path(item.filename or "upload").name
        target = destination / name
        choice = str(wanted.get(name, "replace"))

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
        session.mark_written(target)
        relative = session.project.relative(target)
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
            "There is no .bib file in this project. Make one first — "
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

    asyncio.create_task(work())
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
        data = await item.read()
        document = session.context.add(
            kind, Path(item.filename or "upload").name, data, note
        )
        added.append(document.as_dict())
    await session.events.publish({"type": "context_changed"})
    return {"added": added, "stale": session.context.needs_distillation()}


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
                    if item.name in IGNORED_FILES:
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
        for item in project.root.rglob("*"):
            if item.suffix.lower() not in {".tex", ".bib", ".cls", ".sty"}:
                continue
            if project.build_dir in item.parents or item.name in IGNORED_FILES:
                continue
            if item.stat().st_mtime > stamp:
                fresh = False
                break
    if fresh:
        return paths.pdf

    result = await scheduler.build(force_full=True)
    if not paths.pdf.is_file():
        message = "compilation produced no PDF"
        if result.diagnostics:
            first = result.diagnostics[0]
            message = f"{message}: {first.get('message', '')}"
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
    try:
        if action == "commit":
            return {"ok": True, "output": gitrepo.commit(root, message)}
        if action == "push":
            return {"ok": True, "output": gitrepo.push(root)}
        if action == "pull":
            output = gitrepo.pull(root)
            await session.events.publish({"type": "files_changed", "paths": []})
            return {"ok": True, "output": output}
        if action == "init":
            gitrepo.initialise(root)
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
    try:
        if url:
            remote = gitrepo.attach_remote(root, url, token)
        else:
            remote = gitrepo.create_github(
                root, name or session.project.config.name, private
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
    await session.events.publish({"type": "project_changed", "main": path})
    session.schedule_compile()
    return {"ok": True, "main": path}


# ---------------------------------------------------------------------------
# Compiling and the PDF


@app.post("/api/projects/{project_id}/compile")
async def compile_now(project_id: str, full: bool = Body(False, embed=True)):
    session = session_for(project_id)
    result = await session.compile(force_full=full)
    return session.as_client_dict(result)


@app.post("/api/projects/{project_id}/editor")
async def editor_state(project_id: str, state: dict = Body(...)):
    session_for(project_id).set_editor_state(state)
    return {"ok": True}


@app.get("/api/projects/{project_id}/pdf")
async def get_pdf(project_id: str, request: Request):
    session = session_for(project_id)
    pdf = session.paths.pdf
    if not pdf.exists():
        raise HTTPException(404, "nothing has been built yet")
    # An ETag from the file's own mtime and size means PDF.js re-fetches
    # only when the document actually changed, which matters when a build
    # runs every time typing pauses.
    stat = pdf.stat()
    etag = f'W/"{int(stat.st_mtime_ns)}-{stat.st_size}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return FileResponse(
        pdf, media_type="application/pdf",
        headers={"ETag": etag, "Cache-Control": "no-cache"},
    )


@app.get("/api/projects/{project_id}/synctex/inverse")
async def synctex_inverse(project_id: str, page: int, x: float, y: float):
    """PDF click to source position."""
    session = session_for(project_id)
    # A synctex query on a thesis-sized .synctex.gz is not free, and this
    # runs on every double-click in the preview.
    position = await asyncio.to_thread(
        synctex.pdf_to_source,
        session.paths.pdf, page, x, y, session.project.root,
        shadow_main=session.paths.shadow, main_file=session.paths.main,
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
async def synctex_forward(project_id: str, path: str, line: int, column: int = 0):
    """Source position to places on the page."""
    session = session_for(project_id)
    target = _safe(session, path)
    positions = await asyncio.to_thread(
        synctex.source_to_pdf,
        session.paths.pdf, target, line, session.project.root, column,
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
    argv = ["chktex", "-q", "-f", "%l:%c:%k:%n:%m\n"]
    if rcfile.exists():
        argv += ["-l", str(rcfile)]
    argv.append(str(target))
    try:
        out = await asyncio.to_thread(
            lambda: subprocess.run(
                argv, capture_output=True, text=True, timeout=15,
            ).stdout
        )
    except (subprocess.SubprocessError, OSError):
        return {"diagnostics": []}
    diagnostics = []
    for row in out.splitlines():
        parts = row.split(":", 4)
        if len(parts) != 5:
            continue
        line, column, kind, _number, message = parts
        if not line.isdigit():
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


@app.post("/api/projects/{project_id}/agent/ask")
async def agent_ask(project_id: str, prompt: str = Body(..., embed=True)):
    session = session_for(project_id)
    session.start_agent_pump()
    try:
        await session.agent.ask(prompt)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True}


@app.post("/api/projects/{project_id}/agent/permission")
async def agent_permission(
    project_id: str, id: str = Body(...), decision: str = Body(...)
):
    if decision not in {"allow", "always", "deny"}:
        raise HTTPException(400, "decision must be allow, always or deny")
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
    {"id": "claude-haiku-4-5-20251001", "name": "Haiku 4.5", "note": "Fastest, for small edits"},
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
    return {"ok": True, "model": model}


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
    """
    try:
        head = gitrepo._run(INSTALL_ROOT, "rev-parse", "--short", "HEAD").strip()
    except gitrepo.GitError:
        head = ""
    return {
        "instance": instance_name(),
        "head": head,
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
        raise HTTPException(400, report.reason or "There is nothing to update.")

    UPDATE_JOB.clear()
    UPDATE_JOB.update({"state": "running", "log": [], "step": "", "queue": []})
    asyncio.create_task(_run_update(report))
    return JSONResponse({"started": True}, status_code=202)


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
        script = INSTALL_ROOT / "scripts" / "update.sh"
        process = subprocess.Popen(
            ["bash", str(script), "--no-restart"]
            + ([f"--instance={instance_name()}"] if instance_name() else []),
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

    # Every open project is holding an agent built for the old provider.
    for session in list(SESSIONS.values()):
        await session.agent.disconnect()
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
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
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


if FRONTEND.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
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
