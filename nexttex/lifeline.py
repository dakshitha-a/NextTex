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
import time
from pathlib import Path

from .atomic import write_atomically

FILE = "heartbeat.json"
#: How often the heartbeat is rewritten: the precision of "last alive".
EVERY = 60.0


def _stamp(at: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(at))


def previous(state: Path) -> str | None:
    """What the last server left, said in a line, or None when it said
    goodbye or there was none."""
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
    return (
        f"The previous server, pid {data.get('pid')}, started {_stamp(started)}, "
        f"stopped without saying why; it was last alive at {_stamp(alive)}."
    )


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
