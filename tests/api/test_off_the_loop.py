"""Work that used to hold the whole server while it ran.

NextTex is one process with one event loop. Every autosave, every event
stream and every collaborator's socket goes through it, so anything
synchronous in an `async def` route is not slow for the person who asked, it
is slow for everybody who happens to be writing at the time.

These tests do not measure the work. They fire a slow request and a cheap one
together and assert the cheap one came back while the slow one was still
going, which is the only claim worth making and the only one that would
notice the `await asyncio.to_thread` being dropped.
"""

import pathlib
import threading
import time

import httpx

from server import main as server_main

# Long enough to be unmistakable against a request that should take
# milliseconds, short enough that the suite does not notice.
HELD = 0.4


def race(client, slow_path, body=None, quick="/api/auth", method="post"):
    """Fire a slow request, then time a cheap one from outside the loop.

    The timing has to be done from the test's own thread, and that is the
    whole difficulty. A blocked event loop cannot run the code that would
    notice it is blocked, so an earlier version of this raced two requests
    from inside the loop and measured nothing: the cheap one either finished
    before the slow one had started, or was scheduled after the block had
    already been suffered. Both readings looked fast, and all three tests
    passed with the fix reverted.

    So the slow request is handed to the loop through the portal, this
    thread sleeps long enough for the loop to pick it up and start blocking,
    and only then does it ask for something cheap. `TestClient` submits that
    through the same portal, so a loop that is stuck cannot answer it.
    """
    outcome: dict = {}
    done = threading.Event()

    async def fire():
        try:
            transport = httpx.ASGITransport(app=server_main.app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as browser:
                browser.cookies.set(server_main.COOKIE, server_main.SETTINGS.token)
                answer = await getattr(browser, method)(slow_path, json=body)
                outcome["slow_status"] = answer.status_code
        finally:
            done.set()

    started = time.monotonic()
    client.portal.start_task_soon(fire)
    time.sleep(0.05)                      # this thread, so the loop may start it

    asked = time.monotonic()
    answer = client.get(quick)
    outcome["quick_took"] = time.monotonic() - asked
    outcome["quick_status"] = answer.status_code

    assert done.wait(timeout=30), "the slow request never finished"
    outcome["whole_race"] = time.monotonic() - started
    return outcome


def test_a_push_does_not_stop_everybody_else(client, opened, monkeypatch):
    """`git push` to a remote that is not answering runs for two minutes
    before its timeout, and it used to run there on the loop."""
    def slow_push(root):
        time.sleep(HELD)
        return "pushed"

    monkeypatch.setattr(server_main.gitrepo, "push", slow_push)
    result = race(client, f"/api/projects/{opened['id']}/git/push", body={})

    assert result["slow_status"] == 200
    assert result["quick_status"] == 200
    assert result["whole_race"] > HELD, "the slow call did not actually take time"
    assert result["quick_took"] < HELD / 2, (
        f"the cheap request took {result['quick_took']:.3f}s while a push ran"
    )


def test_a_commit_does_not_stop_everybody_else(client, opened, monkeypatch):
    def slow_commit(root, message):
        time.sleep(HELD)
        return "committed"

    monkeypatch.setattr(server_main.gitrepo, "commit", slow_commit)
    result = race(client, f"/api/projects/{opened['id']}/git/commit",
                  body={"message": "a commit"})

    assert result["quick_status"] == 200
    assert result["whole_race"] > HELD
    assert result["quick_took"] < HELD / 2


def test_pointing_a_project_at_github_does_not_stop_everybody_else(
    client, opened, monkeypatch
):
    """This one was not in the finding. It shells out to `gh`, which makes
    its own network calls, so it is the slowest thing on this route."""
    def slow_create(root, name, private):
        time.sleep(HELD)
        return "git@github.com:someone/thesis.git"

    monkeypatch.setattr(server_main.gitrepo, "create_github", slow_create)
    result = race(
        client,
        f"/api/projects/{opened['id']}/git/backup/github",
        body={"name": "thesis", "private": True},
    )

    assert result["quick_status"] == 200
    assert result["whole_race"] > HELD
    assert result["quick_took"] < HELD / 2


def test_parsing_a_build_log_happens_off_the_loop():
    """The log is multi-megabyte on a thesis and the parser is regex-heavy,
    and it runs after every build, on the path that publishes the result to
    every subscriber.

    Checked at the seam rather than by racing it, deliberately. Racing it
    would mean driving a real build, and calling `to_thread` on the parser
    from the test would only prove that `to_thread` works. What matters is
    that the build path is the caller, so that is what is asserted: the
    parser is an ordinary synchronous method, and the one place that reaches
    it does so through a thread.
    """
    import inspect

    from nexttex.compile import CompileScheduler

    assert not inspect.iscoroutinefunction(CompileScheduler._read_log)

    build = inspect.getsource(CompileScheduler._run)
    assert "await asyncio.to_thread(self._read_log)" in build
    # And nothing else parses it inline behind the scheduler's back.
    module = inspect.getsource(inspect.getmodule(CompileScheduler))
    assert module.count("parse_log(") == 1


def test_opening_a_project_does_not_stop_everybody_else(client, opened, monkeypatch):
    """The route a writer waits for when they click a project in the list.

    It had no `await` in it at all.  The bench puts the filesystem work at
    125 ms on a thesis: a directory walk, the transcript, and a dependency
    scan that read every `.tex` in the project.  All of it ran on the loop,
    so for that eighth of a second nobody else's autosave, event stream or
    collaborator socket made any progress.

    The session for `opened` is already built, and rebuilding one here would
    measure construction rather than this.  So the session is left alone and
    the scan inside the route is what is made slow.
    """
    from nexttex.deps import DependencyGraph

    def slow_scan(self, documents):
        time.sleep(HELD)
        return []

    monkeypatch.setattr(DependencyGraph, "standalone_candidates", slow_scan)
    result = race(client, f"/api/projects/{opened['id']}/open")

    assert result["slow_status"] == 200
    assert result["quick_status"] == 200
    assert result["whole_race"] > HELD, "the slow call did not actually take time"
    assert result["quick_took"] < HELD / 2, (
        f"the cheap request took {result['quick_took']:.3f}s while a project opened"
    )


def test_the_dependency_scan_does_not_read_the_build_directory(tmp_path):
    """It listed everything and filtered afterwards, which is not the same thing.

    `rglob("*")` walks the whole of `.git` and the whole build directory
    before anything is discarded, and on a real project that is thousands of
    objects and intermediates.  Asserted on the work done rather than on the
    result, because filtering afterwards produces the right answer while
    doing all of it.
    """
    from nexttex.deps import DependencyGraph

    root = tmp_path / "project"
    (root / "build").mkdir(parents=True)
    (root / ".git").mkdir()
    (root / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}x\\end{document}",
        encoding="utf-8",
    )
    decoy = "\\documentclass{article}\\begin{document}decoy\\end{document}"
    (root / "build" / "leftover.tex").write_text(decoy, encoding="utf-8")
    (root / ".git" / "hook.tex").write_text(decoy, encoding="utf-8")

    opened: list[str] = []
    graph = DependencyGraph(root, skip=lambda path: path.name == "build")

    real_read = pathlib.Path.read_text

    def watched(self, *args, **kwargs):
        opened.append(str(self))
        return real_read(self, *args, **kwargs)

    import pytest as _pytest  # noqa: F401  (monkeypatching without the fixture)

    pathlib.Path.read_text = watched
    try:
        found = graph.standalone_candidates(["main.tex"])
    finally:
        pathlib.Path.read_text = real_read

    assert found == []
    assert not any("build" in name for name in opened), opened
    assert not any(".git" in name for name in opened), opened


def test_saving_a_file_does_not_stop_everybody_else(client, opened, monkeypatch):
    """A save writes atomically, hashes for a version, compresses it, and
    scans the text three times. None of that is anybody's keystroke and all
    of it was on the loop: a 40 MB body measured at 1.61 seconds during
    which nothing else on the install was answered."""
    real = server_main.write_atomically

    def slow_write(target, text, **kwargs):
        time.sleep(HELD)
        return real(target, text, **kwargs)

    monkeypatch.setattr(server_main, "write_atomically", slow_write)
    result = race(
        client,
        f"/api/projects/{opened['id']}/file",
        body={"path": "main.tex", "text": "A line.\n", "compile": False},
        method="put",
    )

    assert result["quick_status"] == 200
    assert result["whole_race"] > HELD
    assert result["quick_took"] < HELD / 2, (
        f"the cheap request took {result['quick_took']:.3f}s while a save ran"
    )


def test_a_file_too_big_for_the_editor_is_refused_rather_than_written(client, opened):
    """There was no ceiling at all on this route, so the writer could put a
    file into their project that the editor then refused to open."""
    body = {
        "path": "huge.tex",
        "text": "x" * (server_main.MAX_TEXT_BYTES + 1),
        "compile": False,
        "create": True,
    }
    answer = client.put(f"/api/projects/{opened['id']}/file", json=body)

    assert answer.status_code == 413
    assert "was not written" in answer.json()["detail"]
    tree = client.get(f"/api/projects/{opened['id']}/tree").json()
    assert "huge.tex" not in str(tree)
