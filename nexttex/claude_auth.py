"""Signing in to Claude from the browser.

The server is headless and is usually reached from a different machine, so
the login cannot assume a browser on the same box. `claude auth login` is an
interactive terminal program: it prints a verification URL, waits, and reads
a code back. This module runs it under a pseudo-terminal, streams what it
prints to the browser, and writes what the user pastes back to its stdin.

A pseudo-terminal rather than a pipe, because the CLI checks whether it is
talking to a terminal and behaves differently when it is not -- and because
it prints its prompts without a trailing newline, which a pipe would buffer
until the process exited.

Nothing here stores credentials. `claude` writes them where it always does,
and NextTex only ever asks it what the current state is.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import signal
import subprocess
from typing import AsyncIterator

# A pseudo-terminal is how the browser drives `claude auth login`, and
# Windows has none of these modules.  Importing them at the top would make
# the whole server fail to start there rather than one feature be absent,
# so the login degrades to a message and everything else -- the status
# check, signing out, and the entire rest of NextTex -- goes on working.
try:
    import fcntl
    import pty
    import struct
    import termios

    HAVE_PTY = True
except ImportError:                                    # Windows
    HAVE_PTY = False

# Enough to render the CLI's output without wrapping mid-URL.
TERM_ROWS, TERM_COLS = 40, 200

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][B0]|[\x00-\x08\x0b\x0c\x0e-\x1f]")
URL = re.compile(r"https://\S+")


class _Login:
    """One login attempt in flight."""

    def __init__(self) -> None:
        self.pid: int | None = None
        self.fd: int | None = None
        self.buffer: list[str] = []
        self.subscribers: set[asyncio.Queue] = set()
        self.finished = False

    def publish(self, payload: dict) -> None:
        text = json.dumps(payload)
        for queue in list(self.subscribers):
            try:
                queue.put_nowait(text)
            except asyncio.QueueFull:
                self.subscribers.discard(queue)


_current: _Login | None = None


# What an executable is called, in the order worth trying.  Windows needs
# the extension: `claude.exe` is what the official installer writes, and a
# bare "claude" matches nothing there.
_SUFFIXES = ("", ".exe", ".cmd", ".bat")


def claude_binary() -> str | None:
    """Where the Claude CLI is, or None if it is not on this machine.

    PATH is asked first and is not the whole answer.  The official installer
    writes `~/.local/bin/claude.exe` on Windows and says so, then warns that
    the directory is not on PATH and asks the person to add it by hand
    through System Properties.  So the ordinary outcome of a successful
    install is a CLI that exists and that `shutil.which` cannot see, and
    NextTex told the user "The Claude CLI did not install" while it sat
    there, installed, with the installer's own success message still on
    screen above.

    The fallback used to check `~/.local/bin/claude` with no extension,
    which is the same mistake as running `tlmgr` by a name Windows cannot
    resolve: the file was found by the eye and missed by the code.
    """
    # A test points this at a stand-in that answers `auth status` and `auth
    # login` predictably.  Everything else about the sign-in -- the
    # pseudo-terminal, the pump, the URL it finds, the `done` it ends with
    # -- then runs exactly as it does in earnest, which is the only way the
    # seam between the two halves is worth testing at all.
    stand_in = os.environ.get("NEXTTEX_CLAUDE_BINARY", "")
    if stand_in:
        return stand_in if os.path.exists(stand_in) else None
    found = shutil.which("claude")
    if found:
        return found
    # Joined rather than spelled with slashes: `expanduser` leaves a
    # "~/.local/bin" exactly as written, so on Windows the answer came back
    # as C:\Users\name/.local/bin/claude.exe.  That resolves, and it is
    # still wrong to hand to a subprocess and worse to show to a person.
    base = os.path.join(os.path.expanduser("~"), ".local", "bin", "claude")
    for suffix in _SUFFIXES:
        if os.path.exists(base + suffix):
            return base + suffix
    return None


# The old private name, kept because this module uses it in five places and
# renaming them adds nothing.
_claude = claude_binary


def status() -> dict:
    """What `claude auth status` reports, as structured data.

    Returns `installed: False` rather than raising when the CLI is absent,
    because that is a state the setup screen has to render, not an error.
    """
    if os.environ.get("NEXTTEX_FAKE_CLAUDE_AUTH") == "1":
        # For the browser tests, which need past this screen without a real
        # account.  Set by the test harness and by nothing else.
        return {"installed": True, "loggedIn": True,
                "email": "tests@example.invalid", "plan": "test"}
    binary = _claude()
    if not binary:
        return {"installed": False, "loggedIn": False,
                "reason": "The Claude CLI is not installed."}
    try:
        result = subprocess.run(
            [binary, "auth", "status"], capture_output=True, text=True, timeout=30
        )
    except (subprocess.SubprocessError, OSError) as exc:
        return {"installed": True, "loggedIn": False, "reason": str(exc)}

    text = (result.stdout or "").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Older CLIs print prose. "Not logged in" is the only thing that
        # matters, and it is safer to assume signed out than signed in.
        return {
            "installed": True,
            "loggedIn": "not logged in" not in text.lower() and bool(text),
            "raw": text[:400],
        }
    return {"installed": True, **data}


async def start_login(console: bool = False) -> dict:
    """Launch `claude auth login` under a pseudo-terminal."""
    global _current
    if not HAVE_PTY:
        return {
            "ok": False,
            "error": (
                "Signing in from the browser needs a pseudo-terminal, which "
                "Windows does not have. Run `claude auth login` in a terminal "
                "once, then reload this page, or use an OpenAI key instead."
            ),
        }
    binary = _claude()
    if not binary:
        return {"ok": False, "error": "The Claude CLI is not installed."}

    await cancel_login()

    argv = [binary, "auth", "login", "--console" if console else "--claudeai"]
    pid, fd = pty.fork()
    if pid == 0:  # child
        try:
            os.environ["TERM"] = "xterm-256color"
            os.execvp(argv[0], argv)
        finally:
            os._exit(1)

    # Give the child a sensible window, or it wraps the verification URL.
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ,
                    struct.pack("HHHH", TERM_ROWS, TERM_COLS, 0, 0))
    except OSError:
        pass
    os.set_blocking(fd, False)

    login = _Login()
    login.pid, login.fd = pid, fd
    _current = login
    asyncio.create_task(_pump(login))
    return {"ok": True}


async def _pump(login: _Login) -> None:
    """Read the child's output and forward it, watching for the login URL.

    The descriptor is registered with the event loop rather than polled, so
    a prompt printed without a trailing newline reaches the browser the
    moment it is written instead of waiting on a timer.
    """
    loop = asyncio.get_running_loop()
    reader: asyncio.Queue[bytes | None] = asyncio.Queue()
    fd = login.fd
    assert fd is not None

    def on_readable() -> None:
        try:
            chunk = os.read(fd, 8192)
        except BlockingIOError:
            return
        except OSError:
            chunk = b""
        reader.put_nowait(chunk or None)

    loop.add_reader(fd, on_readable)
    pending = ""
    try:
        while True:
            chunk = await reader.get()
            if chunk is None:
                break
            text = ANSI.sub("", chunk.decode("utf-8", errors="replace"))
            if not text:
                continue
            login.buffer.append(text)
            pending += text
            login.publish({"type": "output", "text": text})

            match = URL.search(pending)
            if match:
                login.publish({"type": "url", "url": match.group(0).rstrip(".,)")})
                pending = pending[match.end():]
    finally:
        try:
            loop.remove_reader(fd)
        except (OSError, ValueError):
            pass
        login.finished = True
        code = None
        if login.pid:
            try:
                _, raw = os.waitpid(login.pid, 0)
                code = os.WEXITSTATUS(raw)
            except (ChildProcessError, OSError):
                pass
        login.publish({"type": "done", "status": status(), "exitCode": code})


async def send_input(text: str) -> dict:
    """Type something into the running login, as the user would."""
    login = _current
    if login is None or login.fd is None or login.finished:
        return {"ok": False, "error": "No sign-in is in progress."}
    payload = text if text.endswith("\n") else text + "\n"
    try:
        os.write(login.fd, payload.encode())
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True}


async def stream() -> AsyncIterator[str]:
    """The login's output, from the beginning, as it happens."""
    login = _current
    if login is None:
        yield json.dumps({"type": "idle"})
        return
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    login.subscribers.add(queue)
    try:
        # Replay what has already been printed, so a browser that connects
        # late still sees the verification URL.
        if login.buffer:
            yield json.dumps({"type": "output", "text": "".join(login.buffer)})
            for line in login.buffer:
                match = URL.search(line)
                if match:
                    yield json.dumps({"type": "url", "url": match.group(0).rstrip(".,)")})
                    break
        while True:
            yield await queue.get()
    finally:
        login.subscribers.discard(queue)


async def cancel_login() -> None:
    global _current
    login, _current = _current, None
    if login is None:
        return
    if login.pid:
        try:
            os.kill(login.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
    if login.fd is not None:
        try:
            os.close(login.fd)
        except OSError:
            pass
    login.finished = True


# ---------------------------------------------------------------------------
# Installing the CLI from inside the app
#
# Choosing "no agent" at install time must not be a one-way door.  Everything
# else needed to change your mind already existed -- the settings sheet
# returns to the chooser, `POST /api/agent/provider` switches provider, and
# the sign-in above drives the CLI from the browser -- and the one missing
# piece was that a machine with no `claude` on it had nowhere to go but a
# download page.
#
# It runs the vendor's installer, which is exactly what the terminal
# installer does, and it is the same code: the URL and the command come from
# `nexttex.install.steps`, so there is one answer to "how does the Claude CLI
# get installed" rather than one per caller.  It is an explicit, signed-in
# action behind the ordinary session gate, and never automatic.


class _Install:
    """One CLI install in flight."""

    def __init__(self) -> None:
        self.buffer: list[str] = []
        self.subscribers: set[asyncio.Queue] = set()
        self.finished = False
        self.ok: bool | None = None

    def publish(self, payload: dict) -> None:
        text = json.dumps(payload)
        for queue in list(self.subscribers):
            try:
                queue.put_nowait(text)
            except asyncio.QueueFull:
                self.subscribers.discard(queue)

    def emit(self, text: str) -> None:
        self.buffer.append(text)
        self.publish({"type": "output", "text": text})


_installing: _Install | None = None


async def start_install() -> dict:
    """Fetch and run the Claude CLI installer, streaming what it says."""
    global _installing

    if _claude():
        return {"ok": True, "installed": True, "status": status()}
    if _installing is not None and not _installing.finished:
        return {"ok": True, "running": True}
    install = _Install()
    _installing = install
    asyncio.get_running_loop().create_task(_run_install(install))
    return {"ok": True, "running": True}


async def _run_install(install: _Install) -> None:
    import tempfile
    from pathlib import Path

    from .install.steps import (
        claude_install_command,
        claude_install_url,
        claude_script_name,
        fetch,
    )
    from .install.ui import child_env

    platform = "windows" if os.name == "nt" else "posix"
    try:
        with tempfile.TemporaryDirectory() as work:
            script = Path(work) / claude_script_name(platform)
            install.emit("Downloading the installer...\n")
            error = await asyncio.to_thread(
                fetch, claude_install_url(platform), script
            )
            if error:
                install.emit(error + "\n")
                _finish_install(install, ok=False)
                return
            argv = claude_install_command(platform, script)
            install.emit("Running it...\n")
            process = await asyncio.create_subprocess_exec(
                *argv,
                # The installer is not the only thing that starts the Claude
                # CLI installer, and the PowerShell module path has to be
                # corrected wherever it is started from.
                env=child_env(argv),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            assert process.stdout is not None
            while True:
                chunk = await process.stdout.readline()
                if not chunk:
                    break
                install.emit(chunk.decode("utf-8", "replace"))
            code = await process.wait()
    except (OSError, asyncio.CancelledError) as exc:
        install.emit(f"{exc}\n")
        _finish_install(install, ok=False)
        return
    _finish_install(install, ok=code == 0 and bool(_claude()))


def _finish_install(install: _Install, *, ok: bool) -> None:
    install.finished = True
    install.ok = ok
    if ok:
        install.publish({"type": "done", "ok": True, "status": status()})
    else:
        # Never a 500.  A vendor installer that refuses is an ordinary
        # outcome the screen has to render, and the next screen still offers
        # OpenAI and no agent.
        install.publish({
            "type": "done",
            "ok": False,
            "error": "The Claude CLI did not install. You can install it "
                     "yourself from https://claude.ai/download, or choose "
                     "OpenAI or no agent.",
        })


async def install_stream() -> AsyncIterator[str]:
    """The installer's output, from the beginning, as it happens."""
    install = _installing
    if install is None:
        yield json.dumps({"type": "idle"})
        return
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    install.subscribers.add(queue)
    try:
        if install.buffer:
            yield json.dumps({"type": "output", "text": "".join(install.buffer)})
        if install.finished:
            yield json.dumps({"type": "done", "ok": bool(install.ok),
                              "status": status() if install.ok else None})
            return
        while True:
            yield await queue.get()
    finally:
        install.subscribers.discard(queue)


def logout() -> dict:
    if os.environ.get("NEXTTEX_FAKE_CLAUDE_AUTH") == "1":
        # The same flag `status` honours, and for the same reason.  It says
        # there is no real account behind this server, and a sign-out that
        # reached past it would reach the account of whoever is running the
        # browser tests, on their own machine.  `status` had this branch from
        # the start and this function did not, which is the whole of the
        # difference between a stand-in and the real CLI here.
        return {"ok": True, "status": status()}
    binary = _claude()
    if not binary:
        return {"ok": False, "error": "The Claude CLI is not installed."}
    try:
        result = subprocess.run(
            [binary, "auth", "logout"], capture_output=True, text=True, timeout=30
        )
    except (subprocess.SubprocessError, OSError) as exc:
        return {"ok": False, "error": str(exc)}
    if result.returncode != 0:
        # Saying "signed out" when the CLI refused leaves the credentials
        # exactly where they were, on a machine the writer believes they
        # have just cleared.  That is the one thing this must not do.
        reason = (result.stderr or result.stdout or "").strip()
        return {"ok": False, "error": reason[:200] or "could not sign out"}
    return {"ok": True, "status": status()}
