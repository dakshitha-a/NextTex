"""`scripts/diag-review.py` reads what `nexttex/diag.py` writes.

The log is written through `diag` itself, so the two cannot drift apart
without this failing, and the script is run the way a reviewer runs it.
"""

import subprocess
import sys
from pathlib import Path

from nexttex import diag

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "diag-review.py"


def test_the_review_summarises_a_log(tmp_path):
    diag.install(tmp_path)
    try:
        diag.event("start", version="9.9.9", commit="abc1234", pid=1, previous="said goodbye")
        for _ in range(10):
            diag.request_done("GET", "/api/projects/{project_id}/tree", 200, 0.012)
        diag.request_done("POST", "/api/projects/{project_id}/file", 500, 0.050)
        diag.request_done("POST", "/api/projects/{project_id}/rename", 502, 0.050)
        # By design: the PDF route's "a build is rewriting it" is no failure.
        diag.request_done("GET", "/api/projects/{project_id}/pdf", 503, 0.002)
        diag.flush_routes()
        diag.event("lag", ms=900, inflight=["GET /api/projects/{project_id}/search 880ms"],
                   load=[151.2, 120.0, 80.0])
        diag.event("exception", where="event loop", error="KeyError: 'x'",
                   trace='File "/x/server/session.py", line 12, in spawn\nKeyError')
        diag.event("exception", where="event loop", error="KeyError: 'x'",
                   trace='File "/x/server/session.py", line 12, in spawn\nKeyError')
        for minute in range(40):
            diag.event("sample", rss_mb=200 + minute, fds=30, threads=8, worst_lag_ms=5)
        diag.event("build", project="thesis", document="main.tex", outcome="ok", ms=3200,
                   waited_ms=10, engine_pass="fast", settling=False, errors=0)
        diag.event("turn", project="thesis", agent="ClaudeAgent", ended="success",
                   ms=42000, first_ms=3000, tools=4, errors=0)
        diag.event("client", error_kind="rejection", message="boom in /projects/abc/tree")
        diag.event("client-perf", long_tasks=2, long_task_max_ms=700,
                   slow=[{"path": "/projects/abc/search", "ms": 4100, "status": 200}],
                   frames=[{"cause": "TimerHandler:setTimeout > draw in Pdf-bb.js",
                            "n": 2, "ms": 4000, "max": 3900}])
        diag.event("client-perf", long_tasks=1, long_task_max_ms=300, slow=[],
                   frames=[{"cause": "TimerHandler:setTimeout > draw in Pdf-bb.js",
                            "n": 1, "ms": 300, "max": 300},
                           {"cause": "style and layout", "n": 1, "ms": 250, "max": 250}])
        diag.event("stopped", why="restarting for an update")
    finally:
        diag.uninstall()

    out = subprocess.run([sys.executable, str(SCRIPT), "--state", str(tmp_path), "--no-journal"],
                         capture_output=True, text=True, check=True).stdout
    assert "started 9.9.9 at abc1234" in out
    assert "stopped 1x: restarting for an update" in out
    assert "2x  exception (event loop): KeyError: 'x'" in out
    assert "at session.py:12 spawn" in out
    assert "HTTP 500: POST /api/projects/{project_id}/file" in out
    assert "HTTP 502: POST /api/projects/{project_id}/rename" in out
    assert "/pdf" not in out.split("## Routes")[0]
    assert "GET /api/projects/{project_id}/tree" in out
    assert "worst 900 ms" in out
    assert "900 ms, host load 151" in out
    assert "of 0.7 h" in out and "memory moved +60.0 MB an hour" in out
    assert "thesis" in out and "3200ms" in out
    assert "1 agent turns: median 42.0 s" in out
    assert "rejection: boom in /projects/*/tree" in out
    assert "slow call /projects/*/search, worst 4100 ms" in out
    # Long frames grouped by cause across sends, the most time first.
    frames = out.split("Long frames by what held them")[1]
    assert frames.index("Pdf-bb.js") < frames.index("style and layout")
    assert "3x     4.3 s, worst 3900 ms  TimerHandler:setTimeout > draw in Pdf-bb.js" in frames


def test_an_empty_state_directory_says_so(tmp_path):
    out = subprocess.run([sys.executable, str(SCRIPT), "--state", str(tmp_path), "--no-journal"],
                         capture_output=True, text=True, check=True).stdout
    assert "empty or missing" in out
