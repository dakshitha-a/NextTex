"""Ending a process and everything it started, on either platform.

A build is latexmk, which starts the engine and biber; a figure is a
Python that may start more. On POSIX each runs in its own session and the
group is signalled. Windows has no process groups to signal and no
`os.killpg`, and calling it there raised AttributeError out of a build's
timeout: the route answered a 500 and latexmk was left running, which the
owner's laptop showed on 24 September 2026 with a build stuck behind a
MiKTeX dialog. There, `taskkill /T` ends the tree and `/F` does not ask.

A group is not the whole tree. A script can start a child that calls
`setsid` and forks again, and that grandchild is in no group the stop
signals (Q-007). On Linux the script runner makes itself a child
subreaper, so such an orphan stays its descendant rather than going to
init, and `end_tree` walks `/proc` from the root down, freezes what it
finds, walks again for anything forked meanwhile, and ends the lot. On
Windows the runner puts itself in a job object that ends every member when
its last handle closes. macOS has neither, and the group is what it gets.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys


def _parents(proc: str) -> dict[int, list[int]]:
    """Each running pid's children, read from every `/proc/<pid>/stat`."""
    children: dict[int, list[int]] = {}
    try:
        names = os.listdir(proc)
    except OSError:
        return children
    for name in sorted(names, key=lambda n: (len(n), n)):
        if not name.isdigit():
            continue
        try:
            with open(os.path.join(proc, name, "stat"), encoding="utf-8", errors="replace") as stat:
                # The name in brackets may hold spaces and brackets itself,
                # so the fields are counted from the last closing one.
                fields = stat.read().rsplit(")", 1)[1].split()
        except (OSError, IndexError):
            continue
        if len(fields) > 1 and fields[1].isdigit():
            children.setdefault(int(fields[1]), []).append(int(name))
    return children


def descendants(pid: int, *, proc: str = "/proc") -> list[int]:
    """Every process below `pid`, nearest first; empty where there is no
    `/proc` to read."""
    children = _parents(proc)
    found: list[int] = []
    queue = list(children.get(pid, []))
    while queue:
        child = queue.pop(0)
        if child in found or child == pid:
            continue
        found.append(child)
        queue.extend(children.get(child, []))
    return found


def _signal_each(pids, sig) -> None:
    for pid in pids:
        try:
            os.kill(pid, sig)
        except (ProcessLookupError, PermissionError, OSError):
            pass


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
    sig = signal.SIGKILL if hard else signal.SIGTERM
    below: list[int] = []
    if (platform or sys.platform).startswith("linux"):
        # Frozen first, so nothing forks between the walk and the signal;
        # a stopped process still dies of SIGKILL, and one asked to end
        # politely is woken to hear it.
        below = descendants(pid)
        _signal_each(below, signal.SIGSTOP)
        below += [extra for extra in descendants(pid) if extra not in below]
        _signal_each(below, signal.SIGSTOP)
    try:
        os.killpg(os.getpgid(pid), sig)
    except (ProcessLookupError, PermissionError, OSError):
        pass
    _signal_each(below, sig)
    if not hard:
        _signal_each(below, signal.SIGCONT)
