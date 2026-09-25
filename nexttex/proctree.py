"""Ending a process and everything it started, on either platform.

A build is latexmk, which starts the engine and biber; a figure is a
Python that may start more. On POSIX each runs in its own session and the
group is signalled. Windows has no process groups to signal and no
`os.killpg`, and calling it there raised AttributeError out of a build's
timeout: the route answered a 500 and latexmk was left running, which the
owner's laptop showed on 24 September 2026 with a build stuck behind a
MiKTeX dialog. There, `taskkill /T` ends the tree and `/F` does not ask.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys


def end_tree(pid: int, *, hard: bool = False, platform: str | None = None, run=None) -> None:
    """Ask the tree rooted at `pid` to end, or make it, quietly if it has
    already gone. On Windows it is always made to: a console program there
    has no polite signal from outside its console."""
    if (platform or sys.platform) == "win32":
        try:
            (run or subprocess.run)(
                ["taskkill", "/T", "/F", "/PID", str(int(pid))],
                capture_output=True, timeout=15,
            )
        except (OSError, subprocess.SubprocessError):
            pass
        return
    try:
        os.killpg(os.getpgid(pid), signal.SIGKILL if hard else signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        pass
