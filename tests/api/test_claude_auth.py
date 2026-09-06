"""Signing in to Claude.

Both bugs here were first-run blockers on the one screen every new user
sees before anything else works.
"""


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


def test_the_event_that_ends_a_login_is_called_done(client, monkeypatch):
    """The screen waited for `exit`, which nothing publishes -- so after a
    *successful* sign-in the buttons never came back."""
    import inspect

    from nexttex import claude_auth

    source = inspect.getsource(claude_auth)
    assert '{"type": "done"' in source
    assert '"type": "exit"' not in source

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
