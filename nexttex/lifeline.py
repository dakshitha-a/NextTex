"""A running server's record of itself, for when it ends without a word.

A Windows server has twice been found gone in the morning with nothing
anywhere to say why: its log ending at its start line, no crash record,
no Windows Error Reporting entry, no reboot or logoff, and Modern Standby
somewhere in the night. The machine kept no record of the exit, so the
server keeps one: `heartbeat.json` in the state directory, rewritten every
minute while it serves, and marked `stopped` with a reason by every exit
it gets to see. At the next start a heartbeat with no `stopped` means the
previous server ended without seeing it, and when it was last alive
places that to within a minute. Nothing here depends on Windows; it is
there that it is needed.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .atomic import write_atomically

FILE = "heartbeat.json"
#: How often the heartbeat is rewritten: the precision of "last alive".
EVERY = 60.0


def _stamp(at: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(at))


def previous(state: Path, windows=None) -> str | None:
    """What the last server left, said in a line, or None when it said
    goodbye or there was none.

    `windows(since, until)` names what Windows did in between, a restart
    or a shutdown, when the server could not hear it: a server with no
    console and no window is ended at shutdown without a word, so a
    restart the writer chose read exactly like the silent exit this file
    exists to catch. On Windows it is `windows_ended`; elsewhere nothing.
    """
    try:
        data = json.loads((state / FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("stopped") or data.get("pid") == os.getpid():
        return None
    try:
        alive = float(data.get("alive") or 0)
        started = float(data.get("started") or 0)
    except (TypeError, ValueError):
        return None
    if not alive:
        return None
    ask = windows if windows is not None else (windows_ended if sys.platform == "win32" else None)
    said = ask(alive, time.time()) if ask else None
    how = f"ended when {said}" if said else "stopped without saying why"
    return (
        f"The previous server, pid {data.get('pid')}, started {_stamp(started)}, "
        f"{how}; it was last alive at {_stamp(alive)}."
    )


#: The System log's events for a Windows that went down: a restart or
#: shutdown asked for (User32 1074), the kernel shutting down (13), and the
#: event log stopping (6006).
_ENDS = (1074, 13, 6006)
_EVENT = re.compile(r"<Event[ >].*?</Event>", re.S)
_ID = re.compile(r"<EventID[^>]*>(\d+)</EventID>")
_WHEN = re.compile(r"<TimeCreated SystemTime=['\"]([^'\"]+)['\"]")
_KIND = re.compile(r"<Data Name=['\"]param5['\"]>([^<]*)</Data>")


def _utc(text: str) -> float | None:
    try:
        return datetime.fromisoformat(text.rstrip("Z")[:26]).replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def windows_said(xml: str, since: float, until: float) -> str | None:
    """The first of `_ENDS` between `since` and `until` in `wevtutil`'s
    XML, said as the rest of a sentence: "Windows was restarted at
    20:12:06", or None."""
    found: list[tuple[float, int, str]] = []
    for event in _EVENT.findall(xml or ""):
        number = _ID.search(event)
        when = _WHEN.search(event)
        if not number or not when:
            continue
        at = _utc(when.group(1))
        if at is None or not since <= at <= until or int(number.group(1)) not in _ENDS:
            continue
        kind = _KIND.search(event)
        found.append((at, int(number.group(1)), kind.group(1).strip().lower() if kind else ""))
    if not found:
        return None
    at, number, kind = min(found)
    clock = time.strftime("%H:%M:%S", time.localtime(at))
    if number == 1074:
        verb = "restarted" if "restart" in kind else "shut down" if kind else "restarted or shut down"
        return f"Windows was {verb} at {clock}"
    return f"Windows shut down at {clock}"


def windows_ended(since: float, until: float, run=None) -> str | None:
    """Asks the System log with `wevtutil`, which is on every Windows and
    starts in a moment, where PowerShell's Get-WinEvent takes seconds a
    logon start cannot spare."""
    moment = datetime.fromtimestamp(since, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    query = (
        "*[System[(" + " or ".join(f"EventID={n}" for n in _ENDS) + ")"
        f" and TimeCreated[@SystemTime>='{moment}']]]"
    )
    argv = ["wevtutil", "qe", "System", f"/q:{query}", "/f:xml", "/c:20"]
    try:
        output = (run or _run)(argv)
    except Exception:
        return None
    return windows_said(output, since, until)


def _run(argv: list[str]) -> str:
    return subprocess.run(argv, capture_output=True, text=True, timeout=10).stdout


def _write(state: Path, record: dict) -> None:
    try:
        state.mkdir(parents=True, exist_ok=True)
        write_atomically(state / FILE, json.dumps(record))
    except OSError:
        pass   # a state directory that cannot be written is said elsewhere


class Lifeline:
    """This server's heartbeat."""

    def __init__(self, state: Path, version: str = "") -> None:
        self.state = state
        self.started = time.time()
        self.version = version
        self.ended = False

    def beat(self) -> None:
        if self.ended:
            return
        _write(self.state, {
            "pid": os.getpid(), "version": self.version,
            "started": self.started, "alive": time.time(),
        })

    def stopped(self, why: str) -> None:
        """Mark the end, once, with the reason this process saw."""
        if self.ended:
            return
        self.ended = True
        _write(self.state, {
            "pid": os.getpid(), "version": self.version,
            "started": self.started, "alive": time.time(), "stopped": why,
        })


#: The running server's, once `run.py` has made it, so the restart route
#: can mark the end it causes, which leaves through `os._exit`.
current: Lifeline | None = None


def stopped(why: str) -> None:
    if current is not None:
        current.stopped(why)
