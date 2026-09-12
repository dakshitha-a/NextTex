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


def test_the_running_commit_and_the_one_on_disk_are_two_answers(client, monkeypatch):
    """R-041. They were one, read at request time, which is the disk one.

    An update moves the files and does not touch the process, so an install
    that has been updated and not restarted answered with a commit it was
    not running, and the footer, comparing that same disk commit against
    the remote, said it was up to date. A Windows laptop was found three
    commits deep in this: working tree at b16bf6d, process serving 664f237,
    remote at b832d28, with the middle one reported as though it were the
    answer.
    """
    monkeypatch.setattr(server_main, "HEAD_AT_BOOT", "664f237")
    monkeypatch.setattr(server_main, "_head_now", lambda: "b16bf6d")

    body = client.get("/api/instance").json()

    assert body["head"] == "664f237", "the running commit moved under the process"
    assert body["diskHead"] == "b16bf6d"


def test_the_running_commit_is_read_once(client, monkeypatch):
    """It cannot change while the process runs, so reading it again is
    reading a different fact and calling it this one."""
    calls = []
    monkeypatch.setattr(server_main, "_head_now",
                        lambda: calls.append(1) or "whatever")

    first = client.get("/api/instance").json()["head"]
    monkeypatch.setattr(server_main, "_head_now", lambda: "moved")
    assert client.get("/api/instance").json()["head"] == first


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


def test_a_real_run_streams_its_output_and_finishes(client, tmp_path, monkeypatch):
    """Drives the actual pump against a stand-in script.

    The pump runs on a worker thread and hands each line back to the loop.
    `call_soon_threadsafe` forwards positional arguments only, so passing
    the line as a keyword raised a TypeError on the very first line of
    output: the update pulled, then stopped, and never restarted.  Nothing
    in the browser tier runs a real update, so only a live one found it --
    hence this, which runs the real code path with a fake script.
    """
    import asyncio

    from nexttex import updates as updates_module
    from server import main as server_main

    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "update.sh").write_text(
        "#!/usr/bin/env bash\n"
        "echo 'Fetching the new version'\n"
        "echo 'some ordinary output'\n"
        "echo 'Done'\n"
    )
    monkeypatch.setattr(server_main, "INSTALL_ROOT", tmp_path)
    # Never let the test exit the interpreter.
    monkeypatch.setattr(updates_module, "supervised", lambda: False)

    server_main.UPDATE_JOB.clear()
    server_main.UPDATE_JOB.update({"state": "running", "log": [], "step": "", "queue": []})
    asyncio.run(server_main._run_update(None))

    assert "some ordinary output" in server_main.UPDATE_JOB["log"]
    assert server_main.UPDATE_JOB["state"] == "restarting"
    assert server_main.UPDATE_JOB["step"] == "Finishing"
    server_main.UPDATE_JOB.clear()


def test_a_script_that_fails_ends_the_job_rather_than_hanging(
    client, tmp_path, monkeypatch
):
    """A card that never finishes is worse than one that says it failed."""
    import asyncio

    from server import main as server_main

    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "update.sh").write_text("#!/usr/bin/env bash\necho nope\nexit 1\n")
    monkeypatch.setattr(server_main, "INSTALL_ROOT", tmp_path)

    server_main.UPDATE_JOB.clear()
    server_main.UPDATE_JOB.update({"state": "running", "log": [], "step": "", "queue": []})
    asyncio.run(server_main._run_update(None))
    assert server_main.UPDATE_JOB["state"] == "failed"
    server_main.UPDATE_JOB.clear()
