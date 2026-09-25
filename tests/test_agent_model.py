"""Changing the model, and changing your mind about it.

The client carries the model it was started with, so a change ends the
current one and the next question starts a fresh client. That cannot happen
mid-turn, because disconnecting closes the transport the running turn is
reading from, so a change that arrives during a turn is remembered and
applied when the turn ends.

Remembered in two fields, `_model_pending` and `_model_deferred`, written by
two paths and cleared by one. That is the shape the review kept finding.
"""

import asyncio

import pytest

from nexttex.agent import ProjectAgent


def an_agent(tmp_path, model="claude-sonnet-5"):
    project = tmp_path / "project"
    (project / ".nexttex").mkdir(parents=True)
    (project / "main.tex").write_text("x", encoding="utf-8")
    agent = ProjectAgent(project, project / ".nexttex")
    agent.model = model
    return agent


def test_changing_your_mind_back_does_not_lose_the_model(tmp_path, monkeypatch):
    """The case that fell back to the account's default.

    Change to another model while a turn is running: remembered, deferred.
    Change back to the one already in use: the pending model is cleared and
    the deferred flag is left raised. When the turn ends,
    `_apply_deferred_model` runs with nothing pending and sets the model to
    None, so the project quietly stops using the model the writer chose.
    """
    agent = an_agent(tmp_path)
    monkeypatch.setattr(type(agent), "busy", property(lambda self: True))

    asyncio.run(agent.set_model("claude-opus-5-5"))
    assert agent._model_deferred is True

    asyncio.run(agent.set_model("claude-sonnet-5"))

    assert agent._model_deferred is False, (
        "a change that came to nothing is still waiting to be applied"
    )
    asyncio.run(agent._apply_deferred_model())
    assert agent.model == "claude-sonnet-5"


def test_a_real_deferred_change_is_still_applied(tmp_path, monkeypatch):
    agent = an_agent(tmp_path)
    monkeypatch.setattr(type(agent), "busy", property(lambda self: True))

    asyncio.run(agent.set_model("claude-opus-5-5"))

    monkeypatch.setattr(type(agent), "busy", property(lambda self: False))
    asyncio.run(agent._apply_deferred_model())

    assert agent.model == "claude-opus-5-5"


def test_a_retired_model_choice_is_carried_to_the_row_that_replaced_it(tmp_path, monkeypatch):
    """A writer who chose "The most careful" when it was Opus 5 still has
    that row chosen after the menu moved to Opus 5.5: the saved id is
    carried on load, so the menu never shows no model chosen."""
    from nexttex.config import Settings
    monkeypatch.setattr(Settings, "path", classmethod(lambda cls: tmp_path / "config.json"))
    (tmp_path / "config.json").write_text('{"model": "claude-opus-5"}', encoding="utf-8")
    assert Settings.load().model == "claude-opus-5-5"
    (tmp_path / "config.json").write_text('{"model": "claude-sonnet-5"}', encoding="utf-8")
    assert Settings.load().model == "claude-sonnet-5"


def test_the_menu_offers_opus_5_5_as_the_most_careful():
    from server.main import CLAUDE_MODELS
    careful = [m for m in CLAUDE_MODELS if m["note"] == "The most careful"]
    assert careful == [{"id": "claude-opus-5-5", "name": "Opus 5.5", "note": "The most careful"}]
