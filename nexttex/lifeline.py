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

A machine that went down takes its server with it without a word, and
that read exactly like the silent exit. So the next start asks the
machine what happened in between: Windows its System log, Linux and
macOS when they last booted, and a boot after the last heartbeat names
the machine rather than leaving NextTex under suspicion.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import diag
from .atomic import write_atomically

FILE = "heartbeat.json"
#: How often the heartbeat is rewritten: the precision of "last alive".
EVERY = 60.0


def _stamp(at: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(at))


def previous(state: Path, windows=None) -> str | None:
    """What the last server left, said in a line, or None when it said
    goodbye or there was none.

    `windows(since, until)` names what the machine did in between, a
    restart or a shutdown, when the server could not hear it: a server
    with no console and no window is ended at shutdown without a word, so
    a restart, chosen or a crash of the host, read exactly like the silent
    exit this file exists to catch. On Windows it is `windows_ended`;
    elsewhere `machine_restarted`.
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
    ask = windows if windows is not None else (
        windows_ended if sys.platform == "win32" else machine_restarted)
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


def booted_at(read=None, run=None) -> float | None:
    """When this machine last started, as a timestamp, or None where that
    cannot be found: `btime` in Linux's `/proc/stat`, `kern.boottime` from
    macOS's `sysctl`."""
    try:
        if sys.platform.startswith("linux"):
            text = (read or (lambda: Path("/proc/stat").read_text()))()
            found = re.search(r"^btime\s+(\d+)", text, re.M)
        elif sys.platform == "darwin":
            text = (run or _run)(["sysctl", "-n", "kern.boottime"])
            found = re.search(r"sec\s*=\s*(\d+)", text)
        else:
            return None
    except Exception:
        return None
    return float(found.group(1)) if found else None


def machine_restarted(since: float, until: float, booted=None) -> str | None:
    """A boot between `since` and `until`, said as the rest of a sentence:
    "the machine went down; it started again at 20:31:05", or None."""
    at = (booted or booted_at)()
    if at is None or not since < at <= until:
        return None
    return f"the machine went down; it started again at {time.strftime('%H:%M:%S', time.localtime(at))}"


def _run(argv: list[str]) -> str:
    return subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10).stdout


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
        diag.event("stopped", why=why, pid=os.getpid(), version=self.version,
                   up_s=round(time.time() - self.started))
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


#: When a stop that has not finished is written down, with where every
#: thread and task is, and when it is ended regardless. systemd kills a
#: unit 90 s after SIGTERM and leaves nothing behind to say what it was
#: waiting for; on 18 November 2026 it did that to a server whose
#: diagnostics said it was idle, so the end is made here first, with a
#: record of what was still running.
SLOW_STOP = 15.0
LONGEST_STOP = 45.0
#: Frames kept from each stack, innermost last.
STOP_FRAMES = 12

_stop_watch: threading.Thread | None = None


def _where_threads_are() -> dict[str, list[str]]:
    frames = sys._current_frames()
    held: dict[str, list[str]] = {}
    for thread in threading.enumerate():
        if thread is threading.current_thread():
            continue
        frame = frames.get(thread.ident or -1)
        if frame is None:
            continue
        stack = traceback.extract_stack(frame)[-STOP_FRAMES:]
        held[thread.name] = [f"{e.filename}:{e.lineno} {e.name}" for e in stack]
    return held


def _where_tasks_are(loop) -> list[str]:
    """Each unfinished task on the loop and the line it is waiting at.

    Read from another thread, which asyncio does not promise to allow, so
    anything it raises costs the list and nothing else."""
    import asyncio

    found: list[str] = []
    try:
        for task in list(asyncio.all_tasks(loop)):
            if task.done():
                continue
            stack = task.get_stack(limit=STOP_FRAMES)
            where = (f"{stack[-1].f_code.co_filename}:{stack[-1].f_lineno} "
                     f"{stack[-1].f_code.co_name}") if stack else "not started"
            found.append(f"{task.get_name()} {getattr(task.get_coro(), '__qualname__', '?')} at {where}")
    except Exception as error:      # a set that changed under us, say
        found.append(f"could not list the tasks: {error!r}")
    return found


def stop_deadline(loop=None, slow: float = SLOW_STOP, longest: float = LONGEST_STOP,
                  end=os._exit) -> None:
    """Start the clock on a stop, once a process.

    At `slow` seconds a stop still going writes `slow-stop` to the
    diagnostics log and its stacks to stderr; at `longest` it writes
    `stop-forced` and ends the process. A stop that finishes first ends the
    process and this thread with it, since it is a daemon."""
    global _stop_watch
    if _stop_watch is not None:
        return

    def watch() -> None:
        time.sleep(slow)
        threads = _where_threads_are()
        tasks = _where_tasks_are(loop) if loop is not None else []
        diag.event("slow-stop", after_s=slow, threads=threads, tasks=tasks)
        try:
            print(f"NextTex has been stopping for {slow:.0f} s; still running:",
                  file=sys.stderr)
            for name, stack in threads.items():
                print(f"  thread {name}", *(f"    {line}" for line in stack),
                      sep="\n", file=sys.stderr)
            for line in tasks:
                print(f"  task {line}", file=sys.stderr)
            sys.stderr.flush()
        except Exception:
            pass
        time.sleep(max(longest - slow, 0.0))
        diag.event("stop-forced", after_s=longest)
        try:
            print(f"NextTex did not stop within {longest:.0f} s, so it ends here.",
                  file=sys.stderr, flush=True)
        except Exception:
            pass
        end(0)

    _stop_watch = threading.Thread(target=watch, name="nexttex-stop-deadline", daemon=True)
    _stop_watch.start()
