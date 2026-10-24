"""How the Claude agent reads its session off the CLI.

Every request and message shape here was measured against the real CLI,
2.1.310, on 23 October 2026, in a scratch folder: remote control and the
session's name are control requests the SDK has no method for, the
context comes from `get_context_usage`, the plan's limits arrive as
`RateLimitEvent`, a compaction as a `compact_boundary` system message and
remote control's state as `bridge_state` ones.
"""

from __future__ import annotations

import asyncio

import pytest
from claude_agent_sdk import RateLimitEvent, RateLimitInfo, SystemMessage

from nexttex import agent as agent_module
from nexttex.agent import REMOTE_REFUSAL, ProjectAgent


@pytest.fixture(autouse=True)
def _fresh_install():
    """The account and the limits are the install's, kept on the module;
    each test starts from what a fresh install knows, which is nothing."""
    agent_module.ACCOUNT.clear()
    agent_module.LIMITS.clear()
    yield
    agent_module.ACCOUNT.clear()
    agent_module.LIMITS.clear()


class Query:
    def __init__(self, answers: dict | None = None):
        self.sent: list[dict] = []
        self.answers = answers or {}

    async def _send_control_request(self, request: dict) -> dict:
        self.sent.append(request)
        return self.answers.get(request["subtype"], {})


class Client:
    def __init__(self, *, remote_available: bool = True, context: dict | None = None):
        self._query = Query({"remote_control": {"session_url": "https://claude.ai/code/session_x"}})
        self.remote_available = remote_available
        self.context = context or {"percentage": 14, "totalTokens": 140000,
                                   "maxTokens": 1000000, "autoCompactThreshold": 600000}

    async def get_server_info(self):
        return {"account": {"subscriptionType": "Claude Max", "apiProvider": "firstParty"},
                "remote_control_available": self.remote_available}

    async def get_context_usage(self):
        return self.context


def make_agent(tmp_path, **kwargs) -> ProjectAgent:
    state = tmp_path / "state"
    state.mkdir(parents=True, exist_ok=True)
    return ProjectAgent(tmp_path / "thesis", state, **kwargs)


async def drain(subject: ProjectAgent) -> list[dict]:
    seen = []
    queue = subject._queue()
    while not queue.empty():
        seen.append(queue.get_nowait())
    return seen


def test_a_new_client_is_named_and_asked_how_full_it_is(tmp_path):
    subject = make_agent(tmp_path)
    client = Client()
    asyncio.run(subject._after_connect(client))
    assert client._query.sent == [{"subtype": "rename_session", "title": "thesis"}]
    assert subject.context["percentage"] == 14
    assert subject.context["threshold"] == 600000
    assert agent_module.ACCOUNT["plan"] == "Claude Max"
    assert agent_module.ACCOUNT["remoteAvailable"] is True


def test_remote_control_is_opened_with_the_sessions_name(tmp_path):
    subject = make_agent(tmp_path)
    subject.session_settings = {"name": "thesis-ch3", "remote": True}
    client = Client()
    asyncio.run(subject._after_connect(client))
    assert {"subtype": "remote_control", "enabled": True, "name": "thesis-ch3"} in client._query.sent
    assert subject.remote == {"state": "connecting", "url": "https://claude.ai/code/session_x"}


def test_remote_control_is_not_asked_of_an_account_without_it(tmp_path):
    subject = make_agent(tmp_path)
    subject.session_settings = {"name": "", "remote": True}
    client = Client(remote_available=False)
    asyncio.run(subject._after_connect(client))
    assert all(r["subtype"] != "remote_control" for r in client._query.sent)
    assert subject.remote["state"] == "unavailable"


def test_renaming_and_switching_tell_a_live_client(tmp_path):
    subject = make_agent(tmp_path)
    client = Client()
    subject._client = client
    agent_module.ACCOUNT["remoteAvailable"] = True

    async def go():
        await subject.set_session(name="  chapter   three ")
        await subject.set_session(remote=True)
        await subject.set_session(remote=False)

    asyncio.run(go())
    assert client._query.sent == [
        {"subtype": "rename_session", "title": "chapter three"},
        {"subtype": "remote_control", "enabled": True, "name": "chapter three"},
        {"subtype": "remote_control", "enabled": False},
    ]
    # Kept for the next client, in the state folder.
    assert ProjectAgent(tmp_path / "thesis", tmp_path / "state").session_settings == {
        "name": "chapter three", "remote": False,
    }
    subject._client = None


def test_a_compaction_and_the_bridge_are_told_to_the_panel(tmp_path):
    subject = make_agent(tmp_path)
    subject.context = {"percentage": 61}

    async def go():
        await subject._system(SystemMessage(subtype="compact_boundary", data={
            "subtype": "compact_boundary",
            "compact_metadata": {"trigger": "auto", "pre_tokens": 610000},
        }))
        await subject._system(SystemMessage(subtype="bridge_state", data={"state": "connected"}))
        return await drain(subject)

    events = asyncio.run(go())
    assert events[0] == {"type": "compacted", "beforeTokens": 610000,
                         "beforePercent": 61, "trigger": "auto"}
    assert events[1]["type"] == "remote" and events[1]["state"] == "connected"


def test_a_limit_is_kept_for_the_whole_install(tmp_path):
    event = RateLimitEvent(
        rate_limit_info=RateLimitInfo(status="allowed_warning", resets_at=1792900000,
                                      rate_limit_type="five_hour", utilization=0.88),
        uuid="u", session_id="s",
    )
    entry = agent_module.note_limit(event)
    assert entry == {"type": "five_hour", "status": "allowed_warning",
                     "utilization": 0.88, "resetsAt": 1792900000}
    assert agent_module.LIMITS["five_hour"] == entry
    assert make_agent(tmp_path).session_view()["limits"][0]["type"] == "five_hour"


def test_the_compaction_point_reaches_the_cli_and_stays_in_bounds(tmp_path):
    subject = make_agent(tmp_path, compact_percent=lambda: 45)
    assert subject._options().env["CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"] == "45"
    assert make_agent(tmp_path, compact_percent=lambda: 3)._compact_now() == 20
    assert make_agent(tmp_path, compact_percent=lambda: "x")._compact_now() == 60


def test_a_new_compaction_point_builds_a_new_client_between_turns(tmp_path, monkeypatch):
    built = []

    class Fake:
        def __init__(self, options):
            built.append(options.env["CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"])
            self._query = Query()

        async def connect(self):
            return None

        async def disconnect(self):
            return None

        async def get_server_info(self):
            return {}

        async def get_context_usage(self):
            return {}

    monkeypatch.setattr(agent_module, "ClaudeSDKClient", Fake)
    point = {"value": 60}
    subject = make_agent(tmp_path, compact_percent=lambda: point["value"])

    async def go():
        first = await subject._ensure_client()
        same = await subject._ensure_client()
        point["value"] = 50
        moved = await subject._ensure_client()
        return first, same, moved

    first, same, moved = asyncio.run(go())
    assert first is same and moved is not first
    assert built == ["60", "50"]


def test_a_turn_from_outside_never_raises_a_card(tmp_path):
    subject = make_agent(tmp_path)
    subject._remote_turn = True

    async def go():
        return await subject._by_mode("Bash", {"command": "rm -rf build"}, "t1"), await drain(subject)

    result, events = asyncio.run(go())
    output = result["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"] == REMOTE_REFUSAL
    assert [e["type"] for e in events] == ["refused"]
    assert not subject.pending_cards


def test_a_turn_from_outside_still_runs_what_the_position_allows(tmp_path):
    subject = make_agent(tmp_path)
    subject._remote_turn = True
    subject.set_mode("project")
    result = asyncio.run(subject._by_mode("Bash", {"command": "latexmk -pdf main"}, "t1"))
    assert result["hookSpecificOutput"]["permissionDecision"] == "allow"
