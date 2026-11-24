"""A stop finishes, and one that would not is written down and ended.

On 18 November 2026 systemd asked the server to stop and, 90 s later,
killed it, with nothing anywhere to say what it had been waiting for. A
stop with a tab open had the same shape and could be reproduced: every
tab holds an event stream that never finishes by itself, and uvicorn
waits for open responses before it stops, for ever by default.
"""

from __future__ import annotations

import asyncio
import http.client
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from nexttex import lifeline
from server import main

ROOT = Path(__file__).resolve().parent.parent


def _free_port() -> int:
    import socket

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.mark.skipif(sys.platform == "win32", reason="SIGTERM is how a service manager stops it here")
def test_a_stop_with_an_event_stream_open_finishes_at_once(tmp_path):
    env = {**os.environ, "XDG_DATA_HOME": str(tmp_path / "state"),
           "XDG_CONFIG_HOME": str(tmp_path / "config")}
    port = _free_port()
    argv = [sys.executable, "-u", str(ROOT / "server" / "run.py"),
            "--instance", "stopping", "--port", str(port)]
    state = tmp_path / "state" / "nexttex-stopping"
    server = subprocess.Popen(argv + ["--log-to-state"], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stream = None
    try:
        deadline = time.monotonic() + 90
        log = state / "server.log"
        while "Answering after" not in (log.read_text() if log.exists() else ""):
            assert time.monotonic() < deadline, "the server never started"
            assert server.poll() is None, "the server exited while starting"
            time.sleep(0.2)
        url = subprocess.run(argv + ["--print-url"], cwd=ROOT, env=env,
                             capture_output=True, text=True, timeout=60).stdout
        token = url.split("token=", 1)[1].split()[0]

        signin = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        signin.request("GET", f"/?token={token}")
        answer = signin.getresponse()
        answer.read()
        cookie = answer.getheader("Set-Cookie").split(";", 1)[0]

        stream = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        stream.request("GET", "/api/update/stream", headers={"Cookie": cookie})
        response = stream.getresponse()
        assert response.status == 200
        assert response.read1(64).startswith(b"retry:")

        began = time.monotonic()
        server.send_signal(signal.SIGTERM)
        server.wait(timeout=30)
        took = time.monotonic() - began
    finally:
        if stream is not None:
            stream.close()
        if server.poll() is None:
            server.kill()
    # Not the 90 s systemd allows. The bound is loose because this host's
    # load has reached 200; the line below is what says the stream ended
    # by itself rather than being cancelled after `GRACE`.
    assert took < 10, took
    errors = (state / "server.err.log").read_text()
    assert "timeout graceful shutdown exceeded" not in errors
    assert "has been stopping" not in errors


def test_the_next_event_is_the_queue_s_a_timeout_or_the_stop():
    async def scenario() -> None:
        queue: asyncio.Queue = asyncio.Queue()
        queue.put_nowait("first")
        assert await main._next_or_stop(queue, 1) == "first"
        assert await main._next_or_stop(queue, 0.01) is None

        waiting = asyncio.ensure_future(main._next_or_stop(queue, 30))
        await asyncio.sleep(0.01)
        main.STOPPING.set()
        assert await asyncio.wait_for(waiting, 1) is main.STOPPED
        assert queue._getters == type(queue._getters)()   # nothing left waiting on it
        assert await main._next_or_stop(queue, 30) is main.STOPPED

    try:
        asyncio.run(scenario())
        # And on another loop, as the suite and two listeners both have.
        main.STOPPING.clear()
        asyncio.run(scenario())
    finally:
        main.STOPPING.clear()


def test_a_stop_that_overruns_is_written_down_and_then_ended(monkeypatch):
    seen: list[tuple[str, dict]] = []
    monkeypatch.setattr(lifeline.diag, "event", lambda kind, **fields: seen.append((kind, fields)))
    monkeypatch.setattr(lifeline, "_stop_watch", None)
    ended = threading.Event()
    codes: list[int] = []

    def end(code: int) -> None:
        codes.append(code)
        ended.set()

    held = threading.Event()
    stuck = threading.Thread(target=held.wait, name="stuck-in-teardown", daemon=True)
    stuck.start()
    try:
        lifeline.stop_deadline(None, slow=0.05, longest=0.15, end=end)
        # Once a process: a second signal does not start a second clock.
        lifeline.stop_deadline(None, slow=0.0, longest=0.0, end=end)
        assert ended.wait(5)
    finally:
        held.set()
    time.sleep(0.05)
    assert codes == [0]
    kinds = [kind for kind, _ in seen]
    assert kinds == ["slow-stop", "stop-forced"]
    threads = seen[0][1]["threads"]
    assert any("wait" in line for line in threads["stuck-in-teardown"])
