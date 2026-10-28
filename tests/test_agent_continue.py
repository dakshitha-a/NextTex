"""A conversation picked up again: its name, its session id, and what
happens when Claude Code no longer has the session.

What the CLI says about a session it does not have was measured against
2.1.312 on 28 October 2026: `connect()` raises a `ResultError` whose text
is `NO_SESSION` followed by the id.
"""

from __future__ import annotations

import asyncio
import json

from nexttex import agent as agent_module
from nexttex.agent import NO_SESSION, ProjectAgent
from nexttex.conversation import CLAUDE_GONE_NOTICE, title_from


class Query:
    def __init__(self):
        self.sent: list[dict] = []

    async def _send_control_request(self, request: dict) -> dict:
        self.sent.append(request)
        return {}


def fake_cli(gone: set[str], built: list):
    """An SDK client whose CLI has deleted every session in `gone`."""

    class Fake:
        def __init__(self, options):
            self.resume = options.resume
            self._query = Query()
            self.queries: list[str] = []
            built.append(self)

        async def connect(self):
            if self.resume in gone:
                raise RuntimeError(
                    f"Claude Code returned an error result: {NO_SESSION}: {self.resume} (exit code: 1)"
                )

        async def disconnect(self):
            return None

        async def get_server_info(self):
            return {}

        async def get_context_usage(self):
            return {}

        async def query(self, prompt):
            self.queries.append(prompt)

        async def receive_response(self):
            return
            yield

    return Fake


def make_agent(tmp_path) -> ProjectAgent:
    state = tmp_path / "state"
    state.mkdir(parents=True, exist_ok=True)
    return ProjectAgent(tmp_path / "thesis", state)


async def until_done(subject: ProjectAgent) -> list[dict]:
    seen: list[dict] = []

    async def collect():
        async for event in subject.events():
            seen.append(event)
            if event.get("type") == "done":
                return

    await asyncio.wait_for(collect(), 5)
    return seen


def test_a_session_claude_code_deleted_starts_a_fresh_one_from_the_record(tmp_path, monkeypatch):
    """A project left for a month asked for a session the CLI had cleared,
    and every question after failed the same way. Now the gone id is
    forgotten, a fresh session starts, the column says so, and the next
    question is pointed at the record."""
    built: list = []
    monkeypatch.setattr(agent_module, "ClaudeSDKClient", fake_cli({"old-id"}, built))
    subject = make_agent(tmp_path)
    subject._save_session("old-id")
    record = tmp_path / "state" / "records" / "conversation.md"
    subject.conversation_record = lambda: record

    async def go():
        await subject.ask("Where were we with the figures?")
        first = await until_done(subject)
        # Once: the question after it is the writer's alone. The stub's
        # stream ends with no result, which drops the client, so the
        # second question builds one more.
        await subject.ask("And the captions?")
        await until_done(subject)
        return first

    events = asyncio.run(go())
    assert [client.resume for client in built[:2]] == ["old-id", None]
    assert {"type": "notice", "message": CLAUDE_GONE_NOTICE, "tone": "continued"} in events
    asked = built[1].queries[0]
    assert str(record) in asked and asked.endswith("Where were we with the figures?")
    assert subject._load_session() is None
    assert built[-1].queries[-1] == "And the captions?"


def test_any_other_connect_failure_is_still_a_failure(tmp_path, monkeypatch):
    class Broken:
        def __init__(self, options):
            pass

        async def connect(self):
            raise RuntimeError("the CLI could not start")

    monkeypatch.setattr(agent_module, "ClaudeSDKClient", Broken)
    subject = make_agent(tmp_path)
    subject._save_session("kept-id")

    async def go():
        await subject.ask("hello")
        return await until_done(subject)

    events = asyncio.run(go())
    assert any(e["type"] == "error" and "could not start" in e["message"] for e in events)
    # Not mistaken for a gone session: the id it remembers by is kept.
    assert subject._load_session() == "kept-id"


def test_the_first_question_names_the_conversation_and_tells_the_cli(tmp_path):
    subject = make_agent(tmp_path)
    query = Query()

    class Live:
        _query = query

    subject._client = Live()
    asyncio.run(subject._name_from("Why does biber fail on the thesis when I add the second bibliography?"))
    auto = title_from("Why does biber fail on the thesis when I add the second bibliography?")
    assert subject.session_settings["auto"] == auto
    assert query.sent == [{"subtype": "rename_session", "title": f"thesis: {auto}"}]
    # A later question leaves the name alone.
    asyncio.run(subject._name_from("And the third?"))
    assert len(query.sent) == 1
    subject._client = None


def test_a_name_is_cut_at_a_word():
    assert title_from("Tighten the abstract") == "Tighten the abstract"
    long = title_from("Why does biber fail on the thesis when I add the second bibliography to it?")
    assert len(long) <= 61 and long.endswith("…") and " bibliograph…" not in long
    assert title_from("\n\n  first line  \nsecond") == "first line"


def test_new_conversation_forgets_the_name_and_keeps_remote_control(tmp_path):
    subject = make_agent(tmp_path)
    subject.session_settings.update({"name": "Chapter 3", "auto": "x", "remote": True})
    subject._save_session("abc")
    asyncio.run(subject.reset())
    assert subject.session_settings == {"name": "", "auto": "", "remote": True}
    assert subject.conversation_state() == {"session_id": "", "name": "", "auto": ""}


def test_restoring_a_conversation_resumes_its_session(tmp_path, monkeypatch):
    built: list = []
    monkeypatch.setattr(agent_module, "ClaudeSDKClient", fake_cli(set(), built))
    subject = make_agent(tmp_path)

    async def go():
        remembered = await subject.restore_conversation(
            {"session_id": "kept-id", "name": "Chapter 3 figures", "auto": "Fix fig 2"})
        await subject._ensure_client()
        return remembered

    assert asyncio.run(go()) is True
    assert built[0].resume == "kept-id"
    assert subject.session_name == "thesis: Chapter 3 figures"
    saved = json.loads((tmp_path / "state" / "session-settings.json").read_text())
    assert saved["name"] == "Chapter 3 figures"
    assert subject.session_view()["id"] == "kept-id"


def test_restoring_one_with_no_session_id_reads_the_record(tmp_path):
    subject = make_agent(tmp_path)
    subject._save_session("live-id")
    assert asyncio.run(subject.restore_conversation({"name": ""})) is False
    assert subject._load_session() is None and subject._from_record is True


def test_remote_control_reopens_on_the_continued_conversation(tmp_path, monkeypatch):
    """Remote control is the project's and follows whichever conversation
    is live: the client a continue builds opens it under that one's name."""
    built: list = []
    Fake = fake_cli(set(), built)

    class Remote(Fake):
        async def get_server_info(self):
            return {"remote_control_available": True}

    monkeypatch.setattr(agent_module, "ClaudeSDKClient", Remote)
    subject = make_agent(tmp_path)
    subject.session_settings["remote"] = True

    async def go():
        await subject.restore_conversation({"session_id": "kept-id", "name": "Chapter 3 figures"})
        await subject.connect_now()
        await subject.disconnect()

    asyncio.run(go())
    assert built[0].resume == "kept-id"
    assert {"subtype": "remote_control", "enabled": True,
            "name": "thesis: Chapter 3 figures"} in built[0]._query.sent
