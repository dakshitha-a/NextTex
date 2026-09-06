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


def _claude() -> str | None:
    # A test points this at a stand-in that answers `auth status` and `auth
    # login` predictably.  Everything else about the sign-in -- the
    # pseudo-terminal, the pump, the URL it finds, the `done` it ends with
    # -- then runs exactly as it does in earnest, which is the only way the
    # seam between the two halves is worth testing at all.
    stand_in = os.environ.get("NEXTTEX_CLAUDE_BINARY", "")
    if stand_in:
        return stand_in if os.path.exists(stand_in) else None
    return shutil.which("claude") or (
        str(p) if (p := os.path.expanduser("~/.local/bin/claude")) and os.path.exists(p) else None
    )


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
                "once, then reload this page — or use an OpenAI key instead."
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


def logout() -> dict:
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
