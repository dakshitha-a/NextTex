"""Fixtures for the route tests.

The ordering here is load-bearing.  `server/main.py` builds `SETTINGS` and
`REGISTRY` at *import* time through `state_home()`, which reads
`XDG_DATA_HOME` -- and `Settings.load()` writes a config file when it finds
none.  So the environment has to be redirected before anything under
`server` is imported, or running the tests writes into the real instance's
state and hands out a different token to the browser tab somebody has open.
"""

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# --- before any server import ---------------------------------------------
_STATE = Path(tempfile.mkdtemp(prefix="nexttex-tests-"))
os.environ["XDG_DATA_HOME"] = str(_STATE / "data")
os.environ["XDG_CONFIG_HOME"] = str(_STATE / "config")
os.environ["NEXTTEX_SCRIPTED_AGENT"] = "reply"
# No test may open a real endpoint. The default transport is iroh, which
# would contact n0's discovery and relay hosts -- a network dependency in a
# suite that otherwise has none, and traffic from a machine running tests.
os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from starlette.testclient import TestClient          # noqa: E402

from server import main as server_main               # noqa: E402

TEMPLATE = Path(__file__).resolve().parent.parent.parent / "nexttex" / "templates" / "basic"


@pytest.fixture(scope="session", autouse=True)
def _cleanup():
    yield
    shutil.rmtree(_STATE, ignore_errors=True)


@pytest.fixture
def client(tmp_path):
    """A client whose every request carries the instance token."""
    with TestClient(server_main.app) as test_client:
        test_client.cookies.set(server_main.COOKIE, server_main.SETTINGS.token)
        yield test_client
    # Each test starts from an empty world.
    for session in list(server_main.SESSIONS.values()):
        session.events._subscribers.clear()
    server_main.SESSIONS.clear()
    server_main.REGISTRY._write([])


@pytest.fixture
def project_dir(tmp_path) -> Path:
    """A real project on disk, seeded from the template NextTex ships."""
    root = tmp_path / "project"
    root.mkdir()
    for item in TEMPLATE.rglob("*"):
        if item.is_file() and item.name != ".gitkeep":
            target = root / item.relative_to(TEMPLATE)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(item, target)
    (root / "figures").mkdir(exist_ok=True)
    return root


@pytest.fixture
def project(client, project_dir):
    """Registered, not opened."""
    response = client.post("/api/projects", json={"path": str(project_dir)})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def opened(client, project):
    """Registered and opened, which most routes require."""
    response = client.post(f"/api/projects/{project['id']}/open")
    assert response.status_code == 200, response.text
    return project


def wait_idle(project_id: str, seconds: float = 8.0) -> None:
    """Block the test thread until the scripted turn has finished.

    The event loop runs in the TestClient's own thread, so sleeping here is
    what lets it make progress.  Waiting on the agent rather than on the SSE
    stream avoids the race where a turn starts before anybody subscribes.
    """
    import time as _time

    session = server_main.SESSIONS.get(project_id)
    if session is None:
        return
    deadline = _time.monotonic() + seconds
    # `busy` is false for the instant between the route returning and the
    # task starting, so wait for it to become true first.
    while _time.monotonic() < deadline and not session.agent.busy:
        _time.sleep(0.01)
    while _time.monotonic() < deadline and session.agent.busy:
        _time.sleep(0.02)
    # The pump is a separate task; give it a turn to drain what it was sent.
    _time.sleep(0.15)


def use_script(project_id: str, name: str) -> None:
    """Point an open project's scripted agent at a different script."""
    session = server_main.SESSIONS.get(project_id)
    if session is not None:
        session.agent.script_name = name
