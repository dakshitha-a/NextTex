"""The NextTex server.

A single uvicorn process serves the built frontend, the API and the event
stream. There is no nginx and no container: this runs on one person's
machine, for that person, and every extra moving part is one more thing
between someone cloning the repository and having an editor open.
"""

from __future__ import annotations

import asyncio
import io
import mimetypes
import secrets
import shutil
import subprocess
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import (
    FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

from nexttex import claude_auth, gitrepo, synctex
from nexttex.compile import CompileScheduler, ProjectPaths
from nexttex.config import Settings, ensure_tex_on_path, missing_tools
from nexttex.context import KINDS
from nexttex.project import IGNORED_FILES, Project, Registry
from server.session import ProjectSession

SESSIONS: dict[str, ProjectSession] = {}
# Stop events for the running file watch.  Setting one makes the watcher
# restart against the current set of open projects.
WATCH_RESTART: list[asyncio.Event] = []
SETTINGS = Settings.load()
REGISTRY = Registry()

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
        "<code>nexttex token</code> on the machine running the server.</p>"
    )


# ---------------------------------------------------------------------------
# Helpers


def session_for(project_id: str) -> ProjectSession:
    session = SESSIONS.get(project_id)
    if session is None:
        raise HTTPException(404, "project not open")
    return session


def _safe(session: ProjectSession, relative: str) -> Path:
    try:
        return session.project.resolve(relative)
    except PermissionError:
        raise HTTPException(403, "path is outside the project")
    except OSError:
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


@app.delete("/api/projects/{project_id}")
async def forget_project(project_id: str):
    session = SESSIONS.pop(project_id, None)
    if session:
        await session.close()
        REGISTRY.remove(session.project.root)
        _restart_watch()
    return {"ok": True}


@app.post("/api/projects/{project_id}/open")
async def open_project(project_id: str):
    if project_id in SESSIONS:
        session = SESSIONS[project_id]
    else:
        project = REGISTRY.find(project_id)
        if project is None:
            raise HTTPException(404, "unknown project")
        session = ProjectSession(project, model=SETTINGS.model)
        SESSIONS[project_id] = session
        REGISTRY.touch(project.root)
        _restart_watch()
    session.start_agent_pump()
    return {
        **session.project.as_dict(),
        "tree": session.project.tree(),
        "context": [d.as_dict() for d in session.context.documents()],
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
    return {"path": path, "text": text, "mtime": stat.st_mtime, "size": stat.st_size}


@app.put("/api/projects/{project_id}/file")
async def write_file(
    project_id: str,
    path: str = Body(...),
    text: str = Body(...),
    compile: bool = Body(True),
):
    session = session_for(project_id)
    target = _safe(session, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Through a temporary file in the same directory, so a crash mid-save
    # cannot truncate a chapter the user has been writing all afternoon.
    try:
        previous = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        previous = None
    temp = target.with_name(target.name + ".nexttex-tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(target)
    session.mark_written(target)

    session.note_edit(target, text, previous)
    if compile:
        session.schedule_compile()
    return {"ok": True, "mtime": target.stat().st_mtime}


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
    if not isinstance(path, str) or not isinstance(text, str):
        raise HTTPException(400, "path and text are required")
    target = _safe(session, path)
    if not target.is_file():
        raise HTTPException(404, "no such file")
    temp = target.with_name(target.name + ".nexttex-tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(target)
    session.mark_written(target)
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
    if target.exists():
        raise HTTPException(409, "a file of that name already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)
    return {"ok": True}


@app.delete("/api/projects/{project_id}/file")
async def delete_entry(project_id: str, path: str):
    session = session_for(project_id)
    target = _safe(session, path)
    if target == session.project.root:
        raise HTTPException(400, "refusing to delete the project root")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink(missing_ok=True)
    return {"ok": True}


@app.post("/api/projects/{project_id}/upload")
async def upload(project_id: str, directory: str = Form(""), files: list[UploadFile] = File(...)):
    session = session_for(project_id)
    destination = _safe(session, directory) if directory else session.project.root
    destination.mkdir(parents=True, exist_ok=True)
    written = []
    for item in files:
        # The name is taken apart, never trusted: an upload called
        # "../../.bashrc" lands in this directory like anything else.
        name = Path(item.filename or "upload").name
        target = destination / name
        temp = target.with_name(target.name + ".part")
        with temp.open("wb") as handle:
            while chunk := await item.read(1 << 20):
                handle.write(chunk)
        temp.replace(target)
        written.append(session.project.relative(target))
    return {"written": written}


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
    await session.agent.ask(prompt)
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
    except OSError:
        raise HTTPException(400, "bad path")

    if target.is_file() and format != "zip":
        return FileResponse(
            target, filename=target.name,
            media_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream",
        )
    if not target.exists():
        raise HTTPException(404, "no such path")

    build_dir = project.build_dir.resolve()

    def stream() -> io.BytesIO:
        buffer = io.BytesIO()
        base = target.parent if target.is_file() else target
        items = [target] if target.is_file() else target.rglob("*")
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in items:
                if not item.is_file():
                    continue
                # Build output is regenerated from the source and would
                # multiply the archive size for nothing.
                if build_dir == item or build_dir in item.parents:
                    continue
                if any(p in {".git", ".nexttex", "__pycache__"} for p in item.parts):
                    continue
                if item.name in IGNORED_FILES:
                    continue
                archive.write(item, item.relative_to(base))
        buffer.seek(0)
        return buffer

    stem = target.stem if target.is_file() else (target.name or project.config.name)
    return StreamingResponse(
        stream(), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{stem}.zip"'},
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
    ready, reason = gitrepo.gh_available()
    return {**gitrepo.status(project.root).as_dict(), "gh": ready, "ghReason": reason}


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
# Compiling and the PDF


@app.post("/api/projects/{project_id}/compile")
async def compile_now(project_id: str, full: bool = Body(False, embed=True)):
    session = session_for(project_id)
    result = await session.compile(force_full=full)
    return result.as_dict()


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
    position = synctex.pdf_to_source(
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
    positions = synctex.source_to_pdf(
        session.paths.pdf, target, line, session.project.root, column
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
    try:
        out = subprocess.run(
            argv, capture_output=True, text=True, timeout=45,
            cwd=session.project.root,
        ).stdout
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
        out = subprocess.run(argv, capture_output=True, text=True, timeout=15).stdout
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
    return {"resolved": session.agent.resolve_permission(id, decision)}


@app.post("/api/projects/{project_id}/agent/interrupt")
async def agent_interrupt(project_id: str):
    await session_for(project_id).agent.interrupt()
    return {"ok": True}


@app.post("/api/projects/{project_id}/agent/undo")
async def agent_undo(
    project_id: str, path: str = Body(...), before: str = Body(...), after: str = Body(...)
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
    temp = target.with_name(target.name + ".nexttex-tmp")
    temp.write_text(before, encoding="utf-8")
    temp.replace(target)
    session.mark_written(target)
    session.note_edit(target, before, current)
    session.schedule_compile()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Signing in to Claude


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
            last_ping = time.monotonic()
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
                    last_ping = time.monotonic()
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
