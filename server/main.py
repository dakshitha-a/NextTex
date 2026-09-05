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

from nexttex import claude_auth, synctex
from nexttex.config import Settings, ensure_tex_on_path, missing_tools
from nexttex.project import Project, Registry
from server.session import ProjectSession

SESSIONS: dict[str, ProjectSession] = {}
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
    to reach the open tab, or it will save over changes it never saw.
    """
    from watchfiles import awatch

    while True:
        roots = [Path(s.project.root) for s in SESSIONS.values()]
        if not roots:
            await asyncio.sleep(1.0)
            continue
        try:
            async for changes in awatch(*roots, step=300, recursive=True):
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
                        touched.setdefault(session.project.id, set()).add(str(rel))
                for project_id, paths in touched.items():
                    session = SESSIONS.get(project_id)
                    if session:
                        await session.events.publish(
                            {"type": "files_changed", "paths": sorted(paths)}
                        )
                if set(Path(s.project.root) for s in SESSIONS.values()) != set(roots):
                    break  # a project was opened or closed; restart the watch
        except (asyncio.CancelledError, GeneratorExit):
            raise
        except Exception:
            await asyncio.sleep(1.0)


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

    supplied = request.query_params.get("token") or request.cookies.get(COOKIE)
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
    temp = target.with_name(target.name + ".nexttex-tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(target)

    session.note_edit(target, text)
    if compile:
        session.schedule_compile()
    return {"ok": True, "mtime": target.stat().st_mtime}


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


@app.get("/api/projects/{project_id}/download")
async def download(project_id: str, path: str = ""):
    """Download one file, or a directory (the whole project by default) as a zip."""
    session = session_for(project_id)
    target = _safe(session, path) if path else session.project.root

    if target.is_file():
        return FileResponse(
            target, filename=target.name,
            media_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream",
        )

    build_dir = session.project.build_dir.resolve()

    def stream() -> io.BytesIO:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in target.rglob("*"):
                if not item.is_file():
                    continue
                # Build output is regenerated from the source and would
                # multiply the archive size for nothing.
                if build_dir == item or build_dir in item.parents:
                    continue
                if any(p in {".git", ".nexttex", "__pycache__"} for p in item.parts):
                    continue
                archive.write(item, item.relative_to(target))
        buffer.seek(0)
        return buffer

    name = (target.name or session.project.config.name) + ".zip"
    return StreamingResponse(
        stream(), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


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
    session.note_edit(target, before)
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
