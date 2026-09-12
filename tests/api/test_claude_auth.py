"""Signing in to Claude.

Both bugs here were first-run blockers on the one screen every new user
sees before anything else works.
"""

from pathlib import Path

FAKE_CLI = Path(__file__).resolve().parents[1] / "fake_claude.py"


def test_the_console_flow_is_actually_asked_for(client, monkeypatch):
    """The screen sent `{"mode": "console"}` and the route reads a `console`
    boolean, so the key never matched and both buttons ran the same flow."""
    from nexttex import claude_auth

    asked = {}

    async def fake_start(*, console: bool = False):
        asked["console"] = console
        return {"started": True}

    monkeypatch.setattr(claude_auth, "start_login", fake_start)
    client.post("/api/claude/login/start", json={"console": True})
    assert asked == {"console": True}


def test_the_default_flow_is_the_claude_ai_one(client, monkeypatch):
    from nexttex import claude_auth

    asked = {}

    async def fake_start(*, console: bool = False):
        asked["console"] = console
        return {"started": True}

    monkeypatch.setattr(claude_auth, "start_login", fake_start)
    client.post("/api/claude/login/start", json={})
    assert asked == {"console": False}


def test_a_whole_sign_in_runs_from_the_url_to_the_done(monkeypatch, tmp_path):
    """The screen waited for `exit`, which nothing publishes -- so after a
    *successful* sign-in the buttons never came back.

    Driven against `tests/fake_claude.py` under the real pseudo-terminal,
    because the bug was in the seam between the two halves and no mock of
    either half would have had a seam to get wrong.
    """
    import asyncio
    import json

    from nexttex import claude_auth

    state = tmp_path / "signed-in"
    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", str(FAKE_CLI))
    monkeypatch.setenv("NEXTTEX_FAKE_CLAUDE_STATE", str(state))
    monkeypatch.delenv("NEXTTEX_FAKE_CLAUDE_AUTH", raising=False)

    async def sign_in() -> list[dict]:
        assert claude_auth.status()["loggedIn"] is False
        assert (await claude_auth.start_login())["ok"] is True

        seen: list[dict] = []
        stream = claude_auth.stream()

        async def read() -> None:
            async for line in stream:
                event = json.loads(line)
                seen.append(event)
                if event["type"] == "url":
                    await claude_auth.send_input("the-code")
                if event["type"] == "done":
                    return

        await asyncio.wait_for(read(), timeout=20)
        return seen

    seen = asyncio.run(sign_in())
    kinds = [event["type"] for event in seen]
    assert "url" in kinds, "the verification link never reached the browser"
    assert kinds[-1] == "done", f"the stream ended on {kinds[-1]!r}, not done"
    assert seen[-1]["status"]["loggedIn"] is True
    assert seen[-1]["exitCode"] == 0
    # The one the screen listens for.  Renaming it is how this broke.
    assert "exit" not in kinds


def test_the_screen_waits_for_the_event_the_server_sends(client):
    """Text, not behaviour: it reads SignIn.tsx and checks which event name
    it waits for.  The behaviour is covered above and by the browser tier
    (`e2e/specs/sign-in.spec.ts`); this is only here to fail loudly if the
    name is changed on one side of the wire and not the other."""
    screen = (
        __import__("pathlib").Path(__file__).resolve().parents[2]
        / "frontend" / "src" / "panes" / "SignIn.tsx"
    ).read_text(encoding="utf-8")
    assert 'payload.type === "done"' in screen
    assert 'payload.type === "exit"' not in screen


def test_status_is_reported_without_running_the_cli(client, monkeypatch):
    from nexttex import claude_auth

    monkeypatch.setattr(claude_auth, "_claude", lambda: None)
    body = client.get("/api/claude/status").json()
    assert body["installed"] is False and body["loggedIn"] is False


def test_signing_out_actually_signs_out(monkeypatch, tmp_path, client):
    state = tmp_path / "signed-in"
    state.write_text("a-code", encoding="utf-8")
    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", str(FAKE_CLI))
    monkeypatch.setenv("NEXTTEX_FAKE_CLAUDE_STATE", str(state))
    monkeypatch.delenv("NEXTTEX_FAKE_CLAUDE_AUTH", raising=False)

    body = client.post("/api/claude/logout").json()
    assert body["ok"] is True
    assert body["status"]["loggedIn"] is False


def test_a_sign_out_that_failed_is_not_reported_as_done(monkeypatch, tmp_path, client):
    """Telling the writer they are signed out when the CLI refused leaves
    the credentials on the machine they believe they have just cleared."""
    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", str(FAKE_CLI))
    monkeypatch.setenv("NEXTTEX_FAKE_CLAUDE_STATE", str(tmp_path / "never-written"))
    monkeypatch.delenv("NEXTTEX_FAKE_CLAUDE_AUTH", raising=False)

    body = client.post("/api/claude/logout").json()
    assert body["ok"] is False
    assert body["error"]


def test_signing_out_without_the_cli_says_so(monkeypatch, client):
    from nexttex import claude_auth

    monkeypatch.setattr(claude_auth, "_claude", lambda: None)
    body = client.post("/api/claude/logout").json()
    assert body["ok"] is False


def test_cancelling_a_login_leaves_nothing_running(monkeypatch, tmp_path, client):
    import asyncio
    import json

    from nexttex import claude_auth

    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", str(FAKE_CLI))
    monkeypatch.setenv("NEXTTEX_FAKE_CLAUDE_STATE", str(tmp_path / "signed-in"))

    async def start_then_cancel() -> dict:
        assert (await claude_auth.start_login())["ok"] is True
        await claude_auth.cancel_login()
        # Nothing in flight, so the stream says so instead of hanging.
        async for line in claude_auth.stream():
            return json.loads(line)
        return {}

    assert asyncio.run(start_then_cancel()) == {"type": "idle"}
    # And the code never reached the CLI, so nobody was signed in.
    assert not (tmp_path / "signed-in").exists()


def test_cancelling_when_nothing_is_running_is_not_an_error(client):
    assert client.post("/api/claude/login/cancel").json()["ok"] is True


def test_the_suite_never_reaches_the_real_cli():
    """The guard in `tests/conftest.py`, and the reason it is there.

    `/api/claude/logout` runs `claude auth logout` for real, and the CLI it
    finds is whichever one is installed on the machine running the suite.  For
    one day it found the developer's own, and every full run deleted their
    credentials and signed them out of Claude Code.  Nothing failed, because
    signing out is what that route is for; the damage was entirely outside the
    repository.  This asserts the stand-in is what the code resolves to, so
    that removing the guard fails here rather than on somebody's login."""
    from nexttex import claude_auth

    assert Path(claude_auth._claude() or "") == FAKE_CLI


def test_the_live_file_still_has_its_way_back_to_the_real_cli():
    """The other half of the guard above, which nothing was checking.

    Pointing the whole suite at the stand-in was the right fix and it also
    disabled `tests/test_live_agent.py`, the one file written to drive the
    real SDK. It stayed disabled for three days because it is opt-in and
    nobody ran it, and when somebody did it reported that the SDK had
    renamed its events, which is the exact thing it exists to catch.

    So the escape hatch is a thing that can be broken, and this is what
    breaks when it is: an autouse fixture in that module, which runs after
    this conftest has imported and puts the real binary back for its own
    two tests only.
    """
    import inspect

    from tests import test_live_agent

    fixture = getattr(test_live_agent, "the_real_cli", None)
    assert fixture is not None, (
        "tests/test_live_agent.py has no fixture undoing the conftest guard, "
        "so it is testing the stand-in it exists to bypass"
    )
    marker = getattr(fixture, "_fixture_function_marker", None) or getattr(
        fixture, "_pytestfixturefunction", None
    )
    assert marker is not None and marker.autouse, (
        "the fixture is not autouse, so it runs only for tests that ask for it"
    )
    assert "NEXTTEX_CLAUDE_BINARY" in inspect.getsource(
        getattr(fixture, "__wrapped__", fixture)
    )


def test_the_browser_tests_cannot_sign_the_machine_out(monkeypatch, client):
    """`e2e/server.ts` sets NEXTTEX_FAKE_CLAUDE_AUTH so the browser tests get
    past the sign-in screen without an account.  `status` honoured that flag
    and `logout` did not, so a browser test that clicked sign out would have
    run the real CLI against the account of whoever was running it."""
    monkeypatch.setenv("NEXTTEX_FAKE_CLAUDE_AUTH", "1")
    monkeypatch.delenv("NEXTTEX_CLAUDE_BINARY", raising=False)

    body = client.post("/api/claude/logout").json()
    assert body["ok"] is True
