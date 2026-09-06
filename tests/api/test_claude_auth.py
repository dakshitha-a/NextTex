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
