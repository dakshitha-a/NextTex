"""The diagnostics log, as the routes feed it.

`POST /api/client-log` takes no path and opens no file the caller names, so
it has no path-escape assertion; what it can leak is what it writes, and
that is what is asserted. The rest is what the server writes on its own: a
line per request template, per build and per agent turn.
"""

import json

import pytest
from starlette.testclient import TestClient

from conftest import wait_idle
from nexttex import diag
from server import main as server_main


@pytest.fixture
def log(tmp_path):
    path = diag.install(tmp_path / "state", secrets=[server_main.SETTINGS.token])

    def lines(kind=None):
        diag._file.flush()
        rows = [json.loads(row) for row in path.read_text().splitlines() if row]
        return [row for row in rows if kind is None or row["kind"] == kind]

    yield lines
    diag.uninstall()


def test_what_the_browser_saw_is_written_and_redacted(client, log):
    token = server_main.SETTINGS.token
    response = client.post("/api/client-log", json={
        "errors": [{"at": "10:00:00", "kind": "rejection",
                    "message": f"failed at https://h/?token={token}", "stack": "one\ntwo"}],
        "slow": [{"path": "/projects/abc/tree", "ms": 2500, "status": 200}],
        "long_tasks": 3, "long_task_max_ms": 640,
        "frames": [{"cause": "click > open in Pdf-bb.js", "n": 2, "ms": 900, "max": 640}],
        "page": "/", "browser": "Browser/9",
    })
    assert response.status_code == 204
    [error] = log("client")
    assert error["error_kind"] == "rejection" and error["browser"] == "Browser/9"
    assert token not in json.dumps(log())
    assert "?token=[redacted]" in error["message"]
    [perf] = log("client-perf")
    assert perf["long_tasks"] == 3 and perf["slow"][0]["ms"] == 2500
    assert perf["frames"] == [{"cause": "click > open in Pdf-bb.js", "n": 2, "ms": 900, "max": 640}]


def test_a_quiet_tab_writes_nothing(client, log):
    assert client.post("/api/client-log", json={}).status_code == 204
    assert not log("client") and not log("client-perf")


def test_without_a_credential_it_is_refused(log):
    with TestClient(server_main.app) as anonymous:
        assert anonymous.post("/api/client-log", json={}).status_code == 401


def test_what_the_browser_sends_is_bounded(client, log):
    assert client.post("/api/client-log", json={"errors": [{}] * 1000}).status_code == 422
    assert client.post("/api/client-log", json={"slow": [{}] * 1000}).status_code == 422
    assert client.post("/api/client-log", json={"frames": [{}] * 1000}).status_code == 422
    assert client.post("/api/client-log",
                       json={"frames": [{"cause": "c" * 5000}]}).status_code == 422
    assert client.post("/api/client-log",
                       json={"errors": [{"message": "m" * 5000}]}).status_code == 422
    assert not log("client")


def test_requests_are_counted_under_their_route_template(client, opened, log):
    for _ in range(3):
        assert client.get(f"/api/projects/{opened['id']}/tree").status_code == 200
    client.get("/api/projects/not-a-project/tree")
    diag.flush_routes()
    routes = log("routes")[-1]["routes"]
    tree = routes["GET /api/projects/{project_id}/tree"]
    assert tree["n"] == 4
    assert not any(opened["id"] in key for key in routes)


def test_a_finished_build_is_recorded(client, opened, log):
    from nexttex.compile import CompileResult, Outcome

    state = server_main.SESSIONS[opened["id"]].documents["main.tex"]

    async def fake_build(focus=None, force_full=False, clean=False):
        return CompileResult(outcome=Outcome.OK, log=None, pdf=None, duration=1.25,
                             scope="full", engine_pass="full")

    async def cancel():
        return None

    state.compiler.build = fake_build
    state.compiler.cancel = cancel
    assert client.post(f"/api/projects/{opened['id']}/compile",
                       json={"full": True}).status_code == 200
    build = [row for row in log("build") if not row["settling"]][0]
    assert build["outcome"] == "ok" and build["ms"] == 1250
    assert build["document"] == "main.tex" and build["errors"] == 0


def test_a_finished_agent_turn_is_recorded(client, opened, log):
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "hello"})
    wait_idle(opened["id"])
    [turn] = log("turn")
    assert turn["ended"] and turn["ms"] >= turn["first_ms"] >= 0
    assert turn["errors"] == 0


def test_every_gauge_reads_with_a_project_open(client, opened):
    """Each minute's sample reads these; one that raises is written as
    "unreadable", which is how `event_streams` shipped in 4.35.0."""
    from nexttex import diag

    found = {name: read() for name, read in diag.gauges.items()}
    assert found["sessions"] == 1
    assert all(isinstance(value, int) for value in found.values()), found
