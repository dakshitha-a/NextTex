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

    asyncio.run(agent.set_model("claude-opus-5"))
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

    asyncio.run(agent.set_model("claude-opus-5"))

    monkeypatch.setattr(type(agent), "busy", property(lambda self: False))
    asyncio.run(agent._apply_deferred_model())

    assert agent.model == "claude-opus-5"
