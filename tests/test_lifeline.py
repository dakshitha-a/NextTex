"""A server's record of itself, for when it ends without a word.

A Windows server has twice been found gone in the morning with no record
anywhere of how. The server now keeps one: a heartbeat every minute, a
`stopped` mark from every exit it sees, and at the next start a line
saying when a previous server that never said goodbye was last alive.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from nexttex import lifeline

ROOT = Path(__file__).resolve().parent.parent


def test_a_server_that_said_goodbye_leaves_nothing_to_report(tmp_path):
    life = lifeline.Lifeline(tmp_path, "9.9.9")
    life.beat()
    life.stopped("exited")
    data = json.loads((tmp_path / lifeline.FILE).read_text())
    assert data["stopped"] == "exited"
    assert lifeline.previous(tmp_path) is None


def test_one_that_did_not_is_reported_with_when_it_was_last_alive(tmp_path):
    (tmp_path / lifeline.FILE).write_text(json.dumps({
        "pid": 424242, "started": 1_790_000_000, "alive": 1_790_003_600,
    }))
    said = lifeline.previous(tmp_path)
    assert said is not None
    assert "pid 424242" in said
    assert "stopped without saying why" in said
    assert time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(1_790_003_600)) in said


def test_nothing_or_nonsense_reports_nothing(tmp_path):
    assert lifeline.previous(tmp_path) is None
    (tmp_path / lifeline.FILE).write_text("not json")
    assert lifeline.previous(tmp_path) is None


def test_the_end_is_marked_once_and_the_beat_stops_after_it(tmp_path):
    life = lifeline.Lifeline(tmp_path)
    life.stopped("restarting for an update")
    life.stopped("exited")
    life.beat()
    assert json.loads((tmp_path / lifeline.FILE).read_text())["stopped"] == "restarting for an update"


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _start(tmp_path: Path, port: int) -> subprocess.Popen:
    env = {**os.environ, "XDG_DATA_HOME": str(tmp_path / "state"),
           "XDG_CONFIG_HOME": str(tmp_path / "config")}
    return subprocess.Popen(
        [sys.executable, "-u", str(ROOT / "server" / "run.py"), "--log-to-state",
         "--instance", "life", "--port", str(port)],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def _wait_for(path: Path, text: str, seconds: float = 90, times: int = 1) -> str:
    """The log once `text` is in it `times` times: the log is appended to by
    every start, so the second start's line is the second one."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = path.read_text(encoding="utf-8") if path.exists() else ""
        if found.count(text) >= times:
            return found
        time.sleep(0.2)
    raise AssertionError(f"{text!r} never appeared in {path}")


def test_a_server_killed_outright_is_reported_by_the_next_one(tmp_path):
    if sys.platform == "win32":
        return   # SIGKILL has no Windows counterpart that skips the handlers the same way
    state = tmp_path / "state" / "nexttex-life"
    log = state / "server.log"
    port = _free_port()

    first = _start(tmp_path, port)
    try:
        _wait_for(log, "Answering after")
        assert json.loads((state / lifeline.FILE).read_text())["pid"] != os.getpid()
        first.send_signal(signal.SIGKILL)
        first.wait(timeout=30)
    finally:
        if first.poll() is None:
            first.kill()

    second = _start(tmp_path, port)
    try:
        text = _wait_for(log, "Answering after", 90, times=2)
        assert "stopped without saying why" in text
    finally:
        second.send_signal(signal.SIGTERM)
        second.wait(timeout=30)
    # And one that is stopped the ordinary way says so, so the third start
    # has nothing to report.
    assert json.loads((state / lifeline.FILE).read_text()).get("stopped")


RESTART = """<Events><Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System>
<Provider Name='User32'/><EventID Qualifiers='32768'>1074</EventID>
<TimeCreated SystemTime='2026-09-24T19:12:06.8320000Z'/></System><EventData>
<Data Name='param1'>C:\\Windows\\SystemApps\\StartMenuExperienceHost.exe</Data>
<Data Name='param5'>restart</Data></EventData></Event>
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System>
<EventID>13</EventID><TimeCreated SystemTime='2026-09-24T19:12:22.8290000Z'/></System></Event></Events>"""


def _at(text):
    from datetime import datetime, timezone
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp()


def test_a_restart_the_writer_chose_is_named_not_mistaken_for_a_crash(tmp_path):
    """A server with no console is ended at shutdown without a word, so a
    restart read "stopped without saying why", like the silent exit. The
    System log says what happened, and the line names it."""
    alive = _at("2026-09-24T19:11:36")
    said = lifeline.windows_said(RESTART, alive, alive + 600)
    stamp = time.strftime("%H:%M:%S", time.localtime(_at("2026-09-24T19:12:06.832")))
    assert said == f"Windows was restarted at {stamp}"

    (tmp_path / lifeline.FILE).write_text(json.dumps({"pid": 7, "started": alive - 60, "alive": alive}))
    line = lifeline.previous(tmp_path, windows=lambda since, until: said)
    assert "ended when Windows was restarted" in line and "without saying why" not in line


def test_nothing_in_the_log_between_is_still_unexplained(tmp_path):
    alive = _at("2026-09-24T19:13:00")          # after both events
    assert lifeline.windows_said(RESTART, alive, alive + 600) is None
    assert lifeline.windows_said("", 0, 1) is None
    (tmp_path / lifeline.FILE).write_text(json.dumps({"pid": 7, "started": 1, "alive": alive}))
    assert "stopped without saying why" in lifeline.previous(tmp_path, windows=lambda a, b: None)


def test_the_query_asks_the_system_log_from_the_last_heartbeat():
    seen = []
    lifeline.windows_ended(_at("2026-09-24T19:11:36"), _at("2026-09-24T19:20:00"),
                           run=lambda argv: seen.append(argv) or RESTART)
    argv = seen[0]
    assert argv[:3] == ["wevtutil", "qe", "System"]
    assert "EventID=1074" in argv[3] and "@SystemTime>='2026-09-24T19:11:36'" in argv[3]
    # A wevtutil that cannot run is no answer, not an error.
    def broken(argv):
        raise OSError("no wevtutil")
    assert lifeline.windows_ended(0, 1, run=broken) is None
