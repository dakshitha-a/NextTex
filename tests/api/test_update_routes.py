"""The routes behind the update affordance.

The checker is pointed at a real temporary repository rather than at the
install, so these tests never depend on what the real remote happens to
hold -- and never reach the network.
"""

import subprocess

import pytest

from nexttex import updates
from server import main as server_main


def git(root, *arguments):
    subprocess.run(["git", *arguments], cwd=root, check=True,
                   capture_output=True, text=True)


@pytest.fixture
def behind(tmp_path, monkeypatch):
    """An install one commit behind its remote."""
    remote = tmp_path / "remote.git"
    remote.mkdir()
    git(remote, "init", "--bare", "--initial-branch=main")
    work = tmp_path / "work"
    work.mkdir()
    git(work, "init", "--initial-branch=main")
    git(work, "config", "user.email", "t@example.com")
    git(work, "config", "user.name", "T")
    (work / "README.md").write_text("one\n")
    git(work, "add", "-A"); git(work, "commit", "-m", "first")
    git(work, "remote", "add", "origin", str(remote))
    git(work, "push", "-u", "origin", "main")
    clone = tmp_path / "clone"
    git(tmp_path, "clone", str(remote), str(clone))

    (work / "server").mkdir()
    (work / "server" / "main.py").write_text("x\n")
    git(work, "add", "-A"); git(work, "commit", "-m", "a real change")
    git(work, "push")

    monkeypatch.setattr(server_main, "INSTALL_ROOT", clone)
    monkeypatch.setattr(server_main, "UPDATES", updates.Cache(clone))
    server_main.UPDATE_JOB.clear()
    return clone


def test_the_instance_route_says_who_this_is(client):
    body = client.get("/api/instance").json()
    assert set(body) >= {"instance", "boot", "supervised", "root"}
    assert body["boot"]


def test_the_boot_nonce_is_stable_within_one_process(client):
    first = client.get("/api/instance").json()["boot"]
    assert client.get("/api/instance").json()["boot"] == first


def test_a_check_reports_what_is_waiting(client, behind):
    body = client.get("/api/update?force=true").json()
    assert body["behind"] == 1
    assert body["changing"] == 1
    assert body["can_update"] is True
    assert body["commits"][0]["subject"] == "a real change"


def test_an_install_that_is_level_refuses_to_start_one(client, behind):
    # Bring it level first.
    git(behind, "pull", "--ff-only")
    client.get("/api/update?force=true")
    response = client.post("/api/update")
    assert response.status_code == 400
    assert "up to date" in response.json()["detail"]


def test_a_second_update_is_refused_while_one_runs(client, behind, monkeypatch):
    server_main.UPDATE_JOB.update({"state": "running", "log": [], "queue": []})
    response = client.post("/api/update")
    assert response.status_code == 409
    server_main.UPDATE_JOB.clear()


def test_a_check_says_whether_one_is_running(client, behind):
    server_main.UPDATE_JOB.update({"state": "running", "log": [], "queue": []})
    assert client.get("/api/update").json()["updating"] is True
    server_main.UPDATE_JOB.clear()
    assert client.get("/api/update").json()["updating"] is False


def test_a_dirty_install_is_refused_with_a_reason(client, behind):
    (behind / "scratch.txt").write_text("mine\n")
    git(behind, "add", "-A")
    body = client.get("/api/update?force=true").json()
    assert body["can_update"] is False
    assert "uncommitted" in body["reason"]
    assert client.post("/api/update").status_code == 400
