"""What the writer had selected goes with the question.

There was already an `editor_state` tool the agent could call to find out,
and it is still right for "put this here". But a tool is only read when the
model decides to call one, and somebody who highlights a paragraph and types
"make this shorter" has already said what they mean. Waiting to be asked
lost that, and worse, the cursor was reported on a 400 ms debounce -- select
a paragraph, press Send quickly, and the question beat the selection to the
server, so even a model that did ask got the previous answer.
"""

from __future__ import annotations

import pytest

from server import main


def test_a_selection_becomes_a_preamble_naming_its_lines() -> None:
    context = main._selected_context({
        "file": "chapters/03.tex",
        "text": "The wavepacket leaves the Franck-Condon region.",
        "fromLine": 12,
        "toLine": 14,
    })
    assert "chapters/03.tex" in context
    assert "12" in context and "14" in context
    assert "Franck-Condon" in context
    # Fenced, so the model can tell the passage from the question about it.
    assert "<selection>" in context and "</selection>" in context


def test_one_line_is_not_described_as_a_range() -> None:
    context = main._selected_context({
        "file": "main.tex", "text": "one line", "fromLine": 7, "toLine": 7,
    })
    assert "line 7" in context
    assert "lines 7" not in context


def test_nothing_selected_costs_nothing() -> None:
    assert main._selected_context(None) == ""
    assert main._selected_context({"text": "   ", "file": "a.tex"}) == ""


def test_a_whole_chapter_is_cut_down_and_says_so() -> None:
    body = "\n".join(f"line {index}" for index in range(1, 1001))
    context = main._selected_context({
        "file": "big.tex", "text": body, "fromLine": 1, "toLine": 1000,
    })
    assert "line 1\n" in context
    assert "line 999" not in context
    # Said rather than silently truncated: a model that is not told will
    # answer about the passage as though it ended where the text stopped.
    assert "more lines" in context


class Recorder:
    """Stands in for the agent, and remembers what it was handed."""

    def __init__(self) -> None:
        self.prompt = ""
        self.context = ""
        self.busy = False

    async def ask(self, prompt: str, *, context: str = "") -> None:
        self.prompt = prompt
        self.context = context


@pytest.fixture()
def recorded(client, project, monkeypatch):
    """A session with a stand-in agent in it.

    Opened through the app rather than by calling `session_for` here: the
    session builds its shared documents with pycrdt observers, and pycrdt
    refuses to have those made on one thread and dropped on another. The
    request runs on the test client's portal thread, which is where the
    server's own would have been made.
    """
    client.get(f"/api/projects/{project['id']}/tree")
    session = main.SESSIONS[project["id"]]
    agent = Recorder()
    monkeypatch.setattr(session, "agent", agent)
    monkeypatch.setattr(session, "start_agent_pump", lambda: None)
    return session, agent


def test_the_question_reaches_the_agent_with_the_passage(
    client, project, recorded,
) -> None:
    session, agent = recorded
    response = client.post(
        f"/api/projects/{project['id']}/agent/ask",
        json={
            "prompt": "make this shorter",
            "selection": {
                "file": "main.tex",
                "text": "A sentence that goes on rather longer than it needs to.",
                "fromLine": 3,
                "toLine": 3,
            },
        },
    )
    assert response.status_code == 200
    # The question the writer typed, unchanged -- it is what the
    # conversation on screen shows.
    assert agent.prompt == "make this shorter"
    # And the passage, separately.
    assert "rather longer than it needs to" in agent.context
    assert "main.tex" in agent.context


def test_it_is_recorded_where_the_editor_state_tool_will_find_it(
    client, project, recorded,
) -> None:
    """The debounce race, closed: the question carries its own copy."""
    session, _ = recorded
    client.post(
        f"/api/projects/{project['id']}/agent/ask",
        json={
            "prompt": "and this?",
            "selection": {
                "file": "main.tex", "text": "the selected words",
                "fromLine": 2, "toLine": 2,
            },
        },
    )
    assert session._editor_state["selection"] == "the selected words"
    assert session._editor_state["file"] == "main.tex"


def test_a_question_with_no_selection_still_works(
    client, project, recorded,
) -> None:
    session, agent = recorded
    response = client.post(
        f"/api/projects/{project['id']}/agent/ask",
        json={"prompt": "what is this project about?"},
    )
    assert response.status_code == 200
    assert agent.context == ""
