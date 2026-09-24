"""A server says how long each part of its start took.

A logon-started server on the Windows laptop took five minutes to answer
on 23 September 2026, where the same build started from the desktop
shortcut took twenty-five seconds. A cold disk, an antivirus reading the
virtual environment and a freshly installed MiKTeX were all plausible and
none was measured, because nothing in server.log said where the time went.
One line per start does now.
"""

from __future__ import annotations

import importlib.util
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run_module():
    spec = importlib.util.spec_from_file_location("nexttex_run_timing", ROOT / "server" / "run.py")
    run = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(run)
    return run


def test_the_line_names_every_step_and_adds_them_up():
    run = _run_module()
    clock = run.StartClock(ran_at=100.0, age=None)
    clock.steps = [("imports", 2.0), ("finding TeX", 30.25), ("listening", 0.5)]
    line = clock.line()
    assert "Answering after 32.8 s:" in line
    assert "imports 2.0 s, finding TeX 30.2 s, listening 0.5 s." in line


def test_the_interpreter_before_the_file_is_counted_when_it_can_be_known():
    run = _run_module()
    clock = run.StartClock(ran_at=time.monotonic(), age=12.0)
    clock.steps = [("imports", 1.0)]
    line = clock.line()
    assert "the interpreter 12.0 s before this file ran" in line
    assert "Answering after 13.0 s:" in line


def test_this_process_knows_its_own_age():
    run = _run_module()
    age = run._process_age()
    if sys.platform in ("win32", "linux"):
        assert age is not None and 0 <= age < 24 * 3600


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_a_real_start_writes_the_line_to_server_log(tmp_path):
    state = tmp_path / "state"
    port = _free_port()
    env = {
        **os.environ,
        "XDG_DATA_HOME": str(state),
        "XDG_CONFIG_HOME": str(tmp_path / "config"),
    }
    server = subprocess.Popen(
        [sys.executable, "-u", str(ROOT / "server" / "run.py"), "--log-to-state",
         "--instance", "timed", "--port", str(port)],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    log = state / "nexttex-timed" / "server.log"
    try:
        deadline = time.monotonic() + 90
        text = ""
        while time.monotonic() < deadline:
            text = log.read_text(encoding="utf-8") if log.exists() else ""
            if "Answering after" in text:
                break
            time.sleep(0.2)
        assert "Answering after" in text, text
        line = next(entry for entry in text.splitlines() if "Answering after" in entry)
        for step in ("imports", "settings", "finding TeX", "the port", "the app",
                     "listening"):
            assert f"{step} " in line, line
    finally:
        server.terminate()
        server.wait(timeout=30)
