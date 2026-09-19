"""The permission card's shared parts, on their own.

`permission_gate` holds what the two providers' cards must agree on: the
rule an "always" remembers, the three script cards' texts, and a gate an
agent without `agent.py`'s own fence can put a card up through.  These
tests hold the gate to the same on-disk shape and the same events the
Claude agent's fence produces, because the browser and the replay do not
know which provider put a card up and must not be able to tell.
"""

import asyncio
import json

import pytest

from nexttex import permission_gate as gate
from nexttex.permission_gate import PermissionGate

try:
    from nexttex.agent import ProjectAgent
except ImportError:                                  # no SDK on this machine
    ProjectAgent = None


def describe(tool: str, data: dict) -> dict:
    return {"headline": f"Do {tool}", "detail": json.dumps(data),
            "consequence": "", "reason": "why"}


def make(tmp_path):
    events: list[dict] = []

    async def emit(event: dict) -> None:
        events.append(event)

    return PermissionGate(tmp_path / "state", emit, describe), events


# -- rule keys and texts ----------------------------------------------------

def test_a_script_rule_is_the_digest_of_the_script_under_the_claude_name():
    rule = gate.script_rule("run_script", "print(1)\n")
    assert rule.startswith("mcp__nexttex__run_script:")
    assert len(rule.split(":", 1)[1]) == 16
    assert gate.script_rule("mcp__nexttex__run_script", "print(1)\n") == rule
    assert gate.script_rule("run_script", "") == ""
    assert gate.install_rule(" numpy ") == "install:numpy"
    assert gate.install_rule("") == ""


def test_the_same_script_draws_the_same_card_on_either_provider():
    text = "import matplotlib\n"
    one = gate.script_card("run_plot_script", "project", text=text)
    two = gate.script_card("mcp__nexttex__run_plot_script", "project", text=text)
    assert one == two
    assert one["headline"] == "Run a script to draw a figure"
    assert one["detail"] == text
    assert one["reason"].startswith("Asked at this setting: a script")
    assert gate.script_card("run_script", "ask", name="fig", text=text)["reason"] == ""
    install = gate.script_card("install_package", "project", name="numpy",
                               command="pip install numpy")
    assert install["headline"] == "Install a Python package: numpy"
    assert install["reason"].startswith("Asked at this setting, because what is sent")


@pytest.mark.skipif(ProjectAgent is None, reason="no SDK here")
def test_the_claude_agent_spells_its_script_rules_and_cards_through_the_module(tmp_path):
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "scripts" / "fig.py").write_text("print('hi')\n")
    agent = ProjectAgent(project, project / ".nexttex")
    plot = {"name": "fig", "script": "print('hi')\n"}
    assert agent._rule_for("mcp__nexttex__run_plot_script", plot) == \
        gate.script_rule("run_plot_script", "print('hi')\n")
    assert agent._rule_for("mcp__nexttex__run_script", {"name": "fig"}) == \
        gate.script_rule("run_script", "print('hi')\n")
    assert agent._rule_for("mcp__nexttex__install_package", {"name": "numpy"}) == \
        "install:numpy"
    card = agent.describe("mcp__nexttex__run_plot_script", plot)
    assert card == gate.script_card("run_plot_script", agent.mode, text="print('hi')\n")


# -- the gate ---------------------------------------------------------------

def test_a_card_is_emitted_and_the_answer_comes_back(tmp_path):
    g, events = make(tmp_path)

    async def scenario():
        asking = asyncio.ensure_future(g.ask("run_script", {"name": "fig"}, "r1", "call-1"))
        await asyncio.sleep(0)
        card = events[-1]
        assert card["type"] == "permission" and card["id"].startswith("perm-")
        assert card["tool"] == "run_script" and card["rule"] == "r1"
        assert card["toolId"] == "call-1" and card["headline"] == "Do run_script"
        assert g.pending_cards == [card]
        assert g.resolve(card["id"], "allow") is True
        assert g.resolve(card["id"], "allow") is False, "answered once"
        assert await asking == "allow"
        assert g.pending_cards == []

    asyncio.run(scenario())


def test_always_is_written_in_the_shape_the_claude_agent_writes(tmp_path):
    g, events = make(tmp_path)

    async def scenario():
        asking = asyncio.ensure_future(g.ask("run_script", {}, "mcp__nexttex__run_script:abcd", ""))
        await asyncio.sleep(0)
        g.resolve(events[-1]["id"], "always")
        assert await asking == "always"

    asyncio.run(scenario())
    stored = json.loads((tmp_path / "state" / "agent-settings.json").read_text())
    assert stored == {"mode": "ask", "auto": False,
                      "allow": ["mcp__nexttex__run_script:abcd"]}
    # And a fresh gate over the same file remembers it.
    again, _ = make(tmp_path)
    assert again.already_answered("mcp__nexttex__run_script:abcd") == "always"


@pytest.mark.skipif(ProjectAgent is None, reason="no SDK here")
def test_an_always_from_one_provider_holds_for_the_other(tmp_path):
    """The rule names the code approved, not the model, so an answer given
    under OpenAI holds under Claude and back."""
    g, events = make(tmp_path)
    rule = gate.script_rule("run_script", "print(1)\n")

    async def scenario():
        asking = asyncio.ensure_future(g.ask("run_script", {}, rule, ""))
        await asyncio.sleep(0)
        g.resolve(events[-1]["id"], "always")
        await asking

    asyncio.run(scenario())
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "scripts" / "one.py").write_text("print(1)\n")
    claude = ProjectAgent(project, tmp_path / "state")
    assert claude.already_answered("mcp__nexttex__run_script", {"name": "one"}) == "always"
    # And the other way: the Claude agent's file read by the gate.
    claude._always_allow.add("install:numpy")
    claude._save_settings()
    assert PermissionGate(tmp_path / "state", g._emit, describe).already_answered("install:numpy") == "always"


def test_a_remembered_rule_is_recorded_as_settled_rather_than_passed_silently(tmp_path):
    g, events = make(tmp_path)
    g.always.add("r1")

    async def scenario():
        assert await g.ask("run_script", {}, "r1", "call-2") == "allow"

    asyncio.run(scenario())
    assert events[-1]["decision"] == "always" and events[-1]["toolId"] == "call-2"
    assert events[-1]["reason"] == "", "nothing stopped, so no sentence about why"


def test_conversation_is_remembered_until_forgotten(tmp_path):
    g, events = make(tmp_path)

    async def scenario():
        asking = asyncio.ensure_future(g.ask("run_script", {}, "r1", ""))
        await asyncio.sleep(0)
        g.resolve(events[-1]["id"], "conversation")
        assert await asking == "conversation"
        assert g.already_answered("r1") == "conversation"
        g.forget_conversation()
        assert g.already_answered("r1") == ""

    asyncio.run(scenario())
    assert not (tmp_path / "state" / "agent-settings.json").exists()


def test_a_card_nobody_answers_expires_as_a_no_with_a_notice(tmp_path, monkeypatch):
    monkeypatch.setattr(gate, "PERMISSION_TIMEOUT", 0.05)
    g, events = make(tmp_path)

    async def scenario():
        return await g.ask("run_script", {}, "r1", "call-3")

    assert asyncio.run(scenario()) == "deny"
    kinds = [e["type"] for e in events]
    assert kinds == ["permission", "permission", "notice"]
    assert events[1]["decision"] == "expired"
    assert "did not get one, so it said no" in events[2]["message"]
    assert g.pending_cards == []


def test_cancel_all_answers_every_open_card_with_no(tmp_path):
    g, events = make(tmp_path)

    async def scenario():
        one = asyncio.ensure_future(g.ask("run_script", {}, "r1", ""))
        two = asyncio.ensure_future(g.ask("run_script", {}, "r2", ""))
        await asyncio.sleep(0)
        assert len(g.pending_cards) == 2
        g.cancel_all()
        assert await one == "deny" and await two == "deny"

    asyncio.run(scenario())


def test_the_mode_is_validated_and_read_back_including_the_old_boolean(tmp_path):
    g, _ = make(tmp_path)
    with pytest.raises(ValueError):
        g.set_mode("nonsense")
    g.set_mode("project")
    assert g.auto is True
    assert make(tmp_path)[0].mode == "project"
    (tmp_path / "state" / "agent-settings.json").write_text('{"auto": true}')
    assert make(tmp_path)[0].mode == "project"
    (tmp_path / "state" / "agent-settings.json").write_text('{"allow": "not a list"}')
    assert make(tmp_path)[0].always == set()
