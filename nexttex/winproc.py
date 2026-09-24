"""No console window for anything the server starts, on Windows.

The logon task and the shortcuts start the server with `pythonw.exe`, which
has no console: a server hosted in a Windows Terminal tab ended the moment
somebody closed that window, and on 24 September 2026 closing it on the
owner's laptop did exactly that, with "Windows said: the console window was
closed" in server.err.log. A windowless process that starts a console
program, latexmk, perl, git, the Claude CLI, gets a new visible console
window for each one unless it asks for none, so every child is started with
CREATE_NO_WINDOW. Their output still goes where it went: to the pipes the
caller asked for, or to the log files `--log-to-state` put on the server's
own descriptors.
"""

from __future__ import annotations

import subprocess
import sys

CREATE_NO_WINDOW = 0x08000000
#: Flags that already say what kind of console the child gets; a caller
#: that chose one is left alone.
_CHOSEN = 0x00000008 | 0x00000010   # DETACHED_PROCESS, CREATE_NEW_CONSOLE

_installed = False


def quiet_children(platform: str | None = None) -> bool:
    """Give every `subprocess.Popen` CREATE_NO_WINDOW, once, on Windows.

    `asyncio`'s subprocesses are built on `subprocess.Popen` there, so the
    agent's CLI is covered with the builds. Returns whether it applied."""
    global _installed
    if (platform or sys.platform) != "win32" or _installed:
        return False
    original = subprocess.Popen.__init__

    def init(self, *args, creationflags: int = 0, **kwargs):
        if not creationflags & _CHOSEN:
            creationflags |= CREATE_NO_WINDOW
        original(self, *args, creationflags=creationflags, **kwargs)

    subprocess.Popen.__init__ = init  # type: ignore[method-assign]
    _installed = True
    return True
