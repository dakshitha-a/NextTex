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

import threading
import time

import httpx

from server import main as server_main

# Long enough to be unmistakable against a request that should take
# milliseconds, short enough that the suite does not notice.
HELD = 0.4


def race(client, slow_path, body=None, quick="/api/auth"):
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
                answer = await browser.post(slow_path, json=body)
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
