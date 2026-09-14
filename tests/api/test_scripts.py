"""Running a script from the source pane.

Five routes, one fence.  What is asserted is what the pane relies on: the
output comes back, the run is announced on the event stream, a failure says
what package is missing, the last run can be asked for later, a figure is
served only under the name the runner gave it, a run can be stopped, and
none of it reaches outside the project.
"""

import os
import time

import pytest

import server.main as server_main

ESCAPES = [
    "../outside.py",
    "scripts/../../outside.py",
    "/etc/passwd",
    "./../../outside.py",
]


def script(project_dir, name: str, body: str) -> str:
    target = project_dir / "scripts" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")
    return f"scripts/{name}"


def spy_on(project_id):
    session = server_main.SESSIONS[project_id]
    seen = []
    original = session.events.publish

    async def record(event):
        seen.append(event)
        await original(event)

    session.events.publish = record
    return session, seen, original


def test_a_script_runs_and_what_it_printed_comes_back(client, opened, project_dir):
    path = script(project_dir, "hello.py", "print('hello from the pane')\n")
    session, seen, original = spy_on(opened["id"])
    try:
        response = client.post(
            f"/api/projects/{opened['id']}/scripts/run", json={"path": path}
        )
    finally:
        session.events.publish = original
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["out"].strip() == "hello from the pane"
    assert body["script"] == path
    assert body["run"] == 1
    assert body["by"] == "writer"
    assert body["figures"] == [] and body["saved"] == []
    # Announced to every window, with the same shape the answer has.
    kinds = [event["type"] for event in seen]
    assert kinds.index("script_start") < kinds.index("script_done")
    done = next(event for event in seen if event["type"] == "script_done")
    assert done["out"] == body["out"] and done["run"] == 1


def test_a_run_sees_what_was_just_typed_not_what_is_on_disk(client, opened, project_dir):
    """The disk trails the editor by the debounce, so a run flushes the
    shared documents first.  The document says one thing and the file
    still says another when the run is asked for."""
    path = script(project_dir, "typed.py", "print('old')\n")
    session = server_main.SESSIONS[opened["id"]]

    def type_into_the_document() -> None:
        # On the app's loop: a CRDT object is bound to the thread that made
        # it, and pycrdt panics rather than raises from any other.
        session.collab.ingest(path, "print('old')\n")
        body = session.collab.body(session.collab.file_id_for(path))
        del body[0:len(str(body))]
        body += "print('new')\n"

    client.portal.call(type_into_the_document)
    assert (project_dir / "scripts" / "typed.py").read_text() == "print('old')\n"
    response = client.post(f"/api/projects/{opened['id']}/scripts/run", json={"path": path})
    assert response.json()["out"].strip() == "new"


def test_a_failing_script_says_so_and_names_a_missing_package(client, opened, project_dir):
    path = script(project_dir, "needy.py", "import seaborn_definitely_absent\n")
    body = client.post(f"/api/projects/{opened['id']}/scripts/run", json={"path": path}).json()
    assert body["ok"] is False
    assert body["code"] == 1
    assert "ModuleNotFoundError" in body["err"]
    assert body["missing"] == "seaborn_definitely_absent"
    # The runner's own frames are not in the writer's traceback.
    assert "script_runner" not in body["err"]


def test_the_last_run_is_remembered(client, opened, project_dir):
    path = script(project_dir, "again.py", "print('once')\n")
    absent = client.get(f"/api/projects/{opened['id']}/scripts/last", params={"path": path})
    assert absent.status_code == 404
    client.post(f"/api/projects/{opened['id']}/scripts/run", json={"path": path})
    last = client.get(f"/api/projects/{opened['id']}/scripts/last", params={"path": path})
    assert last.status_code == 200
    assert last.json()["out"].strip() == "once"
    assert last.json()["running"] is False


def test_a_first_run_still_going_answers_its_name_and_nothing_it_did_yet(
    client, opened, project_dir,
):
    """A second window opening the script mid-run asks `last` before any
    `result.json` exists.  The answer says it is running and carries no
    result, rather than a half result the pane would try to draw."""
    path = script(project_dir, "midway.py", "import time\ntime.sleep(30)\n")
    session = server_main.SESSIONS[opened["id"]]
    future = client.portal.start_task_soon(session.scripts.run, path)
    deadline = time.monotonic() + 5
    while not session.scripts.running(path) and time.monotonic() < deadline:
        time.sleep(0.02)
    try:
        last = client.get(
            f"/api/projects/{opened['id']}/scripts/last", params={"path": path}
        )
        assert last.status_code == 200
        assert last.json() == {"script": path, "running": True}
    finally:
        client.post(f"/api/projects/{opened['id']}/scripts/stop", json={"path": path})
        with pytest.raises(BaseException):
            future.result(timeout=5)


def test_a_figure_is_served_only_under_the_name_the_runner_gave_it(
    client, opened, project_dir,
):
    path = script(project_dir, "draws.py", "print('nothing drawn')\n")
    client.post(f"/api/projects/{opened['id']}/scripts/run", json={"path": path})
    session = server_main.SESSIONS[opened["id"]]
    directory = session.scripts.directory(path)
    (directory / "figure-1.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (directory / "result.json").write_bytes(b"{}")
    good = client.get(
        f"/api/projects/{opened['id']}/scripts/figure",
        params={"path": path, "name": "figure-1.png"},
    )
    assert good.status_code == 200
    assert good.headers["content-type"] == "image/png"
    assert good.headers["cache-control"] == "no-store"
    for name in ["result.json", "../result.json", "figure-1.png/..", "figure-x.png", ""]:
        bad = client.get(
            f"/api/projects/{opened['id']}/scripts/figure",
            params={"path": path, "name": name},
        )
        assert bad.status_code in (404, 422), name


def test_a_run_can_be_stopped_and_the_interpreter_goes_with_it(
    client, opened, project_dir,
):
    path = script(
        project_dir, "forever.py",
        "import os, sys, time\nprint(os.getpid(), flush=True)\ntime.sleep(30)\n",
    )
    session = server_main.SESSIONS[opened["id"]]
    pids = []
    from nexttex import plots
    original = plots.asyncio.create_subprocess_exec

    async def noting(*args, **kwargs):
        process = await original(*args, **kwargs)
        pids.append(process.pid)
        return process

    plots.asyncio.create_subprocess_exec = noting
    try:
        future = client.portal.start_task_soon(session.scripts.run, path)
        deadline = time.monotonic() + 5
        while not pids and time.monotonic() < deadline:
            time.sleep(0.02)
        assert pids, "the run never started"
        time.sleep(0.2)
        began = time.monotonic()
        stopped = client.post(
            f"/api/projects/{opened['id']}/scripts/stop", json={"path": path}
        )
        assert stopped.status_code == 200
        assert stopped.json()["stopped"] is True
        assert time.monotonic() - began < 2
        with pytest.raises(BaseException):
            future.result(timeout=5)
    finally:
        plots.asyncio.create_subprocess_exec = original
    with pytest.raises(ProcessLookupError):
        os.kill(pids[0], 0)
    # Stopping what is not running is still a 200.
    again = client.post(f"/api/projects/{opened['id']}/scripts/stop", json={"path": path})
    assert again.json()["stopped"] is False


def test_a_second_run_supersedes_the_first(client, opened, project_dir):
    path = script(
        project_dir, "slow.py", "import time\ntime.sleep(30)\nprint('finished')\n",
    )
    session = server_main.SESSIONS[opened["id"]]
    first = client.portal.start_task_soon(session.scripts.run, path)
    deadline = time.monotonic() + 5
    while not session.scripts.running(path) and time.monotonic() < deadline:
        time.sleep(0.02)
    (project_dir / "scripts" / "slow.py").write_text("print('quick')\n", encoding="utf-8")
    second = client.post(f"/api/projects/{opened['id']}/scripts/run", json={"path": path})
    assert second.json()["out"].strip() == "quick"
    assert second.json()["run"] == 2
    with pytest.raises(BaseException):
        first.result(timeout=5)


def test_only_a_python_file_in_the_project_can_be_run(client, opened, project_dir):
    response = client.post(f"/api/projects/{opened['id']}/scripts/run", json={"path": "main.tex"})
    assert response.status_code == 400
    response = client.post(
        f"/api/projects/{opened['id']}/scripts/run", json={"path": "scripts/none.py"}
    )
    assert response.status_code == 400


@pytest.mark.parametrize("name", ["--index-url", "seaborn; curl evil", "../../etc", ""])
def test_an_install_argument_that_is_not_a_package_is_refused(client, opened, name):
    response = client.post(
        f"/api/projects/{opened['id']}/scripts/install", json={"name": name}
    )
    assert response.status_code == 400


@pytest.mark.parametrize("path", ESCAPES)
def test_running_outside_the_project_is_refused(client, opened, path):
    response = client.post(f"/api/projects/{opened['id']}/scripts/run", json={"path": path})
    assert response.status_code in (400, 403)


@pytest.mark.parametrize("path", ESCAPES)
def test_stopping_outside_the_project_is_refused(client, opened, path):
    response = client.post(f"/api/projects/{opened['id']}/scripts/stop", json={"path": path})
    assert response.status_code in (400, 403)


@pytest.mark.parametrize("path", ESCAPES)
def test_asking_about_a_run_outside_the_project_is_refused(client, opened, path):
    response = client.get(f"/api/projects/{opened['id']}/scripts/last", params={"path": path})
    assert response.status_code in (400, 403)


@pytest.mark.parametrize("path", ESCAPES)
def test_a_figure_outside_the_project_is_refused(client, opened, path):
    response = client.get(
        f"/api/projects/{opened['id']}/scripts/figure",
        params={"path": path, "name": "figure-1.png"},
    )
    assert response.status_code in (400, 403)
