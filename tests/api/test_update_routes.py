"""The routes behind the update affordance.

The checker is pointed at a real temporary repository rather than at the
install, so these tests never depend on what the real remote happens to
hold -- and never reach the network.
"""

import subprocess
import time

import pytest

from nexttex import updates
from nexttex.version import VERSION
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
    assert set(body) >= {"instance", "version", "boot", "supervised", "root"}
    assert body["boot"]
    assert body["version"] == VERSION


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


def test_an_unsupervised_install_will_not_pretend_it_can_restart(client, monkeypatch):
    """Nothing brings NextTex back on Windows, so the route says so.

    The footer's restart line used to carry a Reload button, which on that
    line is a dead end: the page comes back from the same process, `head`
    is fixed at process start, and the reader is returned to exactly what
    they were already reading.  The control is a real restart now, and
    where there is no supervisor to do it there is no control at all.
    """
    monkeypatch.setattr(updates, "supervised", lambda: False)
    answer = client.post("/api/update/restart")
    assert answer.status_code == 409
    assert "restart" in answer.json()["detail"].lower()


def test_a_supervised_install_restarts_by_leaving(client, monkeypatch):
    """The exit is the restart, which is how the update path does it too."""
    monkeypatch.setattr(updates, "supervised", lambda: True)
    left = []
    monkeypatch.setattr(server_main.os, "_exit", left.append)
    answer = client.post("/api/update/restart")
    assert answer.status_code == 202
    assert answer.json() == {"restarting": True}
    # The exit waits a moment so the answer reaches the page before the
    # socket goes; the route is the only thing that ever calls `os._exit`
    # with the supervisor's code.
    for _ in range(100):
        if left:
            break
        time.sleep(0.05)
    assert left == [3]


# --- Windows brings itself back --------------------------------------------
#
# I-021.  A scheduled task is not a supervisor: a task that ends stays
# ended.  So the update button on Windows finished with "stop it and start
# it again", and for a server the task started that meant Task Scheduler.
# The server now starts a detached helper before it leaves, which waits for
# the pid and starts NextTex the way it was started.


def test_the_windows_helper_waits_for_the_pid_and_starts_the_command_line(tmp_path):
    argv = updates.windows_restart_argv(4242, tmp_path, "thesis", r"C:\py\python.exe",
                                        tmp_path / "state")
    assert argv[0] == "powershell" and "-Command" in argv
    script = argv[-1]
    assert "Get-Process -Id 4242" in script and "WaitForExit" in script
    # The pid first; then the task, once it has left Running; the Startup
    # shortcut; the command line last, hidden, logging where the old
    # server did.
    assert script.index("WaitForExit") < script.index("Start-ScheduledTask") \
        < script.index("elseif (Test-Path $link)") \
        < script.index("Start-Process -FilePath 'C:\\py\\python.exe'")
    assert "'nexttex-thesis'" in script and "'nexttex-thesis.lnk'" in script
    assert "'--log-to-state'" in script and "'--instance', 'thesis'" in script
    assert "-WindowStyle Hidden" in script
    assert "restart.log" in script


def test_the_helper_breaks_away_from_the_task_job_first():
    """Everything a scheduled task's action starts is inside the task's
    job, and the job is torn down when the action's process exits, which
    took the helper with it.  Breakaway first; a job that forbids it
    refuses, and the plain flags are the fallback."""
    assert updates.windows_restart_flags(True) & updates.CREATE_BREAKAWAY_FROM_JOB
    assert not updates.windows_restart_flags(False) & updates.CREATE_BREAKAWAY_FROM_JOB


def test_the_helper_gets_a_console_it_does_not_show():
    """Started DETACHED_PROCESS, with no console at all, PowerShell's host
    stopped before the helper's first statement, and the lane's restart.log
    held the server's line and nothing from the helper.  CREATE_NO_WINDOW
    is a console it does not show, which is what every hidden launcher
    gives it."""
    for breakaway in (True, False):
        flags = updates.windows_restart_flags(breakaway)
        assert flags & updates.CREATE_NO_WINDOW
        assert not flags & 0x00000008  # DETACHED_PROCESS


def test_the_helper_writes_its_own_lines_rather_than_a_transcript(tmp_path):
    """A transcript needs the console host up; Add-Content needs a path.
    Every step is a line and a failure is one too, so a restart that did
    not happen is a helper that can be asked."""
    script = updates.windows_restart_argv(1, tmp_path, "", "python", tmp_path / "state")[-1]
    assert "Start-Transcript" not in script and "Write-Host" not in script
    assert "Add-Content" in script and "catch { say ('failed: ' + $_) }" in script
    # The if chain is one statement: a semicolon before elseif or else
    # would be a parse error, and the helper would write nothing.
    assert "; elseif" not in script and "; else" not in script


def test_the_windows_helper_carries_no_double_quote(tmp_path):
    """Windows PowerShell 5.1 does not escape a double quote inside an
    argument (I-017), and -Command is one argument."""
    script = updates.windows_restart_argv(7, tmp_path / "a b", "x", r"C:\Program Files\py.exe", tmp_path)[-1]
    assert '"' not in script


def test_the_windows_helper_names_the_default_instance_plainly(tmp_path):
    script = updates.windows_restart_argv(1, tmp_path, "", "python", tmp_path)[-1]
    assert "--instance" not in script


def test_on_windows_the_exit_starts_the_helper_first(client, monkeypatch):
    started = []
    left = []
    monkeypatch.setattr(server_main.os, "_exit", left.append)

    class Child:
        pid = 99

    monkeypatch.setattr(server_main.subprocess, "Popen",
                        lambda argv, **kw: (started.append((argv, kw)), Child())[1])
    server_main._leave_for_restart(windows=True)
    assert left == [3]
    assert len(started) == 1 and started[0][0][0] == "powershell"
    # Started with nothing of ours attached, so it survives the exit it is
    # waiting for and holds no handle on the port, and out of the job.
    assert started[0][1]["close_fds"] is True
    assert started[0][1]["stdin"] is subprocess.DEVNULL
    assert started[0][1]["creationflags"] & updates.CREATE_BREAKAWAY_FROM_JOB


def test_a_job_that_forbids_breakaway_gets_the_helper_inside_it(client, monkeypatch):
    started = []
    monkeypatch.setattr(server_main.os, "_exit", lambda code: None)

    class Child:
        pid = 100

    def popen(argv, **kw):
        started.append(kw["creationflags"])
        if kw["creationflags"] & updates.CREATE_BREAKAWAY_FROM_JOB:
            raise OSError(5, "Access is denied")
        return Child()

    monkeypatch.setattr(server_main.subprocess, "Popen", popen)
    server_main._leave_for_restart(windows=True)
    assert len(started) == 2
    assert not started[1] & updates.CREATE_BREAKAWAY_FROM_JOB


def test_off_windows_the_exit_is_the_whole_act(client, monkeypatch):
    started = []
    left = []
    monkeypatch.setattr(server_main.os, "_exit", left.append)
    monkeypatch.setattr(server_main.subprocess, "Popen",
                        lambda argv, **kw: started.append(argv))
    server_main._leave_for_restart(windows=False)
    assert left == [3] and started == []


def test_windows_counts_as_supervised_when_powershell_is_there(monkeypatch):
    monkeypatch.delenv("INVOCATION_ID", raising=False)
    monkeypatch.delenv("XPC_SERVICE_NAME", raising=False)
    monkeypatch.setattr(updates.os, "name", "nt")
    monkeypatch.setattr(updates.shutil, "which", lambda name: r"C:\ps.exe" if name == "powershell" else None)
    assert updates.supervised() is True
    monkeypatch.setattr(updates.shutil, "which", lambda name: None)
    assert updates.supervised() is False


def test_an_update_that_went_back_says_so_and_is_not_offered_again(client, behind):
    """Q-012: the next page load after a rollback reads what happened, and
    the commit it went back from is held back until a newer one exists."""
    import json

    from nexttex.paths import state_home
    from server import comeback

    git(behind, "fetch")
    upstream = subprocess.run(["git", "rev-parse", "@{upstream}"], cwd=behind,
                              capture_output=True, text=True, check=True).stdout.strip()
    here = subprocess.run(["git", "rev-parse", "HEAD"], cwd=behind,
                          capture_output=True, text=True, check=True).stdout.strip()
    note = state_home() / comeback.ROLLED_BACK
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(json.dumps({"from": upstream, "to": here, "at": time.time()}))
    body = client.get("/api/update", params={"force": "true"}).json()
    assert body["rolledBack"]["from"] == upstream
    assert body["rolledBack"]["toVersion"] == VERSION
    assert body["avoided"] is True and body["can_update"] is False
    note.unlink()
    assert client.get("/api/update", params={"force": "true"}).json()["rolledBack"] is None


def test_an_update_writes_down_the_commit_it_leaves(client, behind, monkeypatch):
    """Before the script runs, so a new version that will not start can be
    gone back from."""
    from nexttex.paths import state_home
    from server import comeback

    left = []
    monkeypatch.setattr(comeback, "leaving", lambda state, root: left.append((state, root)))
    monkeypatch.setattr(server_main.subprocess, "Popen", lambda *a, **k: (_ for _ in ()).throw(OSError("no script here")))
    import asyncio
    asyncio.run(server_main._run_update(None))
    assert left == [(state_home(), behind)]
    assert server_main.UPDATE_JOB["state"] == "failed"
