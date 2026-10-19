"""`nexttex/diag.py`: the diagnostics log the server keeps while it runs.

What is asserted is what a review of the log depends on: that it is
written, rotated and redacted, that the things nothing else records (a
stalled loop, a dying task or thread, a warning) land in it, and that the
request counts summarise rather than accumulate.
"""

import asyncio
import json
import logging
import threading
import time

import pytest

from nexttex import diag


@pytest.fixture
def log(tmp_path):
    path = diag.install(tmp_path, secrets=["PLANTEDSECRET"], home="/home/someone")

    def lines(kind=None):
        for handler in logging.getLogger("nexttex.diag").handlers:
            handler.flush()
        rows = [json.loads(row) for row in path.read_text().splitlines() if row]
        return [row for row in rows if kind is None or row["kind"] == kind]

    yield lines
    diag.uninstall()


def test_nothing_is_written_until_it_is_installed(tmp_path):
    diag.event("note", said="hello")
    diag.request_done("GET", "/api/x", 200, 0.1)
    assert not (tmp_path / diag.FILE).exists()
    assert not diag._routes


def test_a_line_is_one_json_object_with_its_time_and_kind(log):
    diag.event("note", said="hello", count=3)
    [row] = log("note")
    assert row["said"] == "hello" and row["count"] == 3
    assert row["at"][:2] == "20"


def test_secrets_tokens_and_the_home_directory_never_land(log):
    diag.event("note", url="https://h:1/?token=abc123&x=1",
                nested={"key": "PLANTEDSECRET", "list": ["/home/someone/thesis/main.tex"]})
    text = json.dumps(log("note"))
    assert "abc123" not in text
    assert "PLANTEDSECRET" not in text
    assert "/home/someone" not in text
    assert "~/thesis/main.tex" in text


def test_it_rotates_and_keeps_five_files(tmp_path, monkeypatch):
    monkeypatch.setattr(diag, "MAX_BYTES", 2000)
    diag.install(tmp_path)
    try:
        for index in range(400):
            diag.event("note", index=index, padding="x" * 100)
    finally:
        diag.uninstall()
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == ["diagnostics.log"] + [f"diagnostics.log.{n}" for n in range(1, 5)]
    assert all(p.stat().st_size <= 2200 for p in tmp_path.iterdir())


def test_a_warning_from_any_logger_is_copied_in_with_its_traceback(log):
    try:
        raise ValueError("planted")
    except ValueError:
        logging.getLogger("nexttex.somewhere").warning("it went wrong", exc_info=True)
    logging.getLogger("nexttex.somewhere").info("not this")
    [row] = log("log")
    assert row["level"] == "WARNING" and row["logger"] == "nexttex.somewhere"
    assert row["message"] == "it went wrong"
    assert "ValueError: planted" in row["trace"]


def test_a_thread_that_dies_is_recorded(log, monkeypatch):
    monkeypatch.setattr(diag, "_hooks", {**diag._hooks, "thread": lambda args: None})

    def die():
        raise RuntimeError("thread planted")

    worker = threading.Thread(target=die, name="worker")
    worker.start()
    worker.join()
    [row] = log("exception")
    assert row["where"] == "thread worker"
    assert "thread planted" in row["error"]


def test_a_stalled_loop_and_a_dying_task_are_recorded(log, monkeypatch):
    monkeypatch.setattr(diag, "LAG_EVERY", 0.05)
    monkeypatch.setattr(diag, "LAG_NOTE", 0.1)
    swallowed = []

    async def run():
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(lambda loop, context: swallowed.append(context))
        watcher = asyncio.create_task(diag.watch())
        await asyncio.sleep(0.1)
        diag.inflight[1] = ({"method": "GET", "path": "/api/projects/abc/tree"}, time.monotonic())
        time.sleep(0.3)
        await asyncio.sleep(0.1)
        diag.inflight.clear()

        async def fails():
            raise KeyError("task planted")

        task = asyncio.ensure_future(fails())
        await asyncio.sleep(0.01)
        del task
        import gc
        gc.collect()
        await asyncio.sleep(0.01)
        watcher.cancel()
        with pytest.raises(asyncio.CancelledError):
            await watcher

    asyncio.run(run())
    # A loaded machine can add stalls of its own; the planted one is the
    # one with the planted request in flight.
    [lag] = [row for row in log("lag") if row["inflight"]]
    assert lag["ms"] >= 150
    # No route matched in a bare scope, so the first segment stands in.
    assert lag["inflight"][0].startswith("GET /api/* ")
    [error] = log("exception")
    assert error["where"] == "event loop" and "task planted" in error["error"]
    assert swallowed, "the loop's own handler was not chained to"


def test_requests_are_summarised_per_route_and_slow_ones_said_at_once(log):
    for _ in range(18):
        diag.request_done("GET", "/api/projects/{project_id}/tree", 200, 0.010)
    diag.request_done("GET", "/api/projects/{project_id}/tree", 200, 0.020)
    diag.request_done("GET", "/api/projects/{project_id}/tree", 500, 0.020)
    diag.request_done("POST", "/api/projects/{project_id}/file", 200, diag.SLOW_REQUEST + 1)
    diag.request_done("POST", "/api/projects/{project_id}/compile", 200, diag.SLOW_REQUEST + 1)
    diag.flush_routes()
    [summary] = log("routes")
    tree = summary["routes"]["GET /api/projects/{project_id}/tree"]
    assert tree == {"n": 20, "errors": 1, "p50": 10, "p95": 20, "max": 20}
    singles = [(r["route"], r["status"]) for r in log("request")]
    assert singles == [("/api/projects/{project_id}/tree", 500),
                       ("/api/projects/{project_id}/file", 200)]
    diag.flush_routes()
    assert len(log("routes")) == 1, "an empty window wrote a line"


def test_a_busy_route_keeps_bounded_memory(log, monkeypatch):
    monkeypatch.setattr(diag, "KEEP_PER_ROUTE", 100)
    for index in range(10_000):
        diag.request_done("GET", "/api/x", 200, index / 10_000)
    stats = diag._routes["GET /api/x"]
    assert stats["n"] == 10_000 and len(stats["times"]) <= 100
    diag.flush_routes()
    row = log("routes")[0]["routes"]["GET /api/x"]
    assert 400 <= row["p50"] <= 600 and row["p95"] >= 900


def test_a_sample_says_what_the_process_holds(log):
    diag.gauges["planted"] = lambda: 7
    diag.gauges["broken"] = lambda: 1 / 0
    try:
        found = diag.resources(diag._cpu_now())
    finally:
        diag.gauges.pop("planted")
        diag.gauges.pop("broken")
    assert found["threads"] >= 1
    assert found["planted"] == 7
    assert found["broken"].startswith("unreadable")
    assert "cpu_pct" in found


def test_the_stop_reason_is_recorded(log, tmp_path):
    from nexttex import lifeline

    life = lifeline.Lifeline(tmp_path, "9.9.9")
    life.stopped("restarting for an update")
    life.stopped("exited")
    rows = log("stopped")
    assert [r["why"] for r in rows] == ["restarting for an update"]
    assert rows[0]["version"] == "9.9.9"


def test_the_journal_keeps_its_warnings_once_the_log_is_running(tmp_path):
    """`basicConfig` is a no-op on a root logger that already has a handler,
    and `diag.install` adds one. Installed first, it left the journal with
    none of NextTex's own warnings, so `server/run.py` sets up stderr first;
    this runs that order in a fresh interpreter and reads both ends."""
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    script = (
        "import logging, sys; from pathlib import Path\n"
        "sys.path.insert(0, sys.argv[1])\n"
        "from server import run\n"
        "from nexttex import diag\n"
        "run._log_warnings_to_stderr()\n"
        "diag.install(Path(sys.argv[2]))\n"
        "logging.getLogger('nexttex.server').warning('heard twice')\n"
    )
    done = subprocess.run([sys.executable, "-c", script, str(root), str(tmp_path)],
                          capture_output=True, text=True, timeout=60)
    assert "WARNING nexttex.server: heard twice" in done.stderr, done.stderr
    assert "heard twice" in (tmp_path / diag.FILE).read_text()
    source = (root / "server" / "run.py").read_text()
    assert source.index("    _log_warnings_to_stderr()") < source.index("    _keep_a_diagnostics_log(")
