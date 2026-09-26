"""The two comment tools, as each provider hands them to its model.

What the model reads back is the same text under both, from
`nexttex/comment_tools.py`, so a thread reads the same to Claude and to
ChatGPT. The session's side, where a reply is written under the agent's
name, is `tests/api/test_agent_comments.py`.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from nexttex import comment_tools  # noqa: E402
from nexttex.agent import ProjectAgent  # noqa: E402
from nexttex.openai_agent import OpenAIAgent  # noqa: E402

THREADS = [
    {
        "id": "c1a2b3c4d5e6", "path": "results.tex", "line": 14, "quote": "hexane",
        "detached": False, "suggestion": "cyclohexane",
        "messages": [
            {"name": "Mira", "body": "Cyclohexane, surely?"},
            {"name": "Claude", "body": "Checking.", "agent": True},
        ],
    },
    {
        "id": "c9f8e7d6c5b4", "path": "results.tex", "line": 40, "quote": "a gone sentence",
        "detached": True, "suggestion": "",
        "messages": [{"name": "", "body": "Cut this?"}],
    },
]


def test_the_listing_names_each_thread_by_id_line_quote_and_who_said_what():
    said = comment_tools.listing(THREADS, "results.tex")
    assert said.startswith("2 open threads on results.tex.")
    assert "c1a2b3c4d5e6, line 14, on \"hexane\"" in said
    assert "  Mira: Cyclohexane, surely?" in said
    assert "  You (Claude): Checking." in said
    assert "  Suggests instead: \"cyclohexane\"" in said
    # A thread whose text was deleted still has its words, and says so.
    assert "its text has since been deleted" in said
    # Somebody who never gave a name is not a blank.
    assert "  Someone: Cut this?" in said
    assert "reply_to_comment" in said


def test_an_empty_listing_says_where_it_looked():
    assert comment_tools.listing([], "results.tex") == "No open comments on results.tex."
    assert comment_tools.listing([], "") == "No open comments in this project."


def test_the_claude_tools_read_and_reply_through_the_session(tmp_path):
    asked: list = []
    replied: list = []
    agent = ProjectAgent(
        tmp_path, tmp_path / ".nexttex",
        comments=lambda path: asked.append(path) or THREADS,
        reply_comment=lambda thread, text: replied.append((thread, text)) or "hexane",
    )
    said = agent.list_comments_tool({"path": "results.tex"})["content"][0]["text"]
    assert asked == ["results.tex"] and "c1a2b3c4d5e6" in said
    said = agent.reply_comment_tool({"thread": "c1a2b3c4d5e6", "text": "Yes, cyclohexane."})
    assert replied == [("c1a2b3c4d5e6", "Yes, cyclohexane.")]
    assert said["content"][0]["text"] == 'Replied to the comment on "hexane".'
    # Nothing to say is refused before it reaches the thread.
    said = agent.reply_comment_tool({"thread": "c1a2b3c4d5e6", "text": "  "})
    assert "What should the reply say" in said["content"][0]["text"] and len(replied) == 1


def test_a_thread_that_is_gone_is_said_in_a_sentence(tmp_path):
    def gone(_thread, _text):
        raise LookupError("There is no such thread; somebody may have deleted it.")

    agent = ProjectAgent(tmp_path, tmp_path / ".nexttex", comments=lambda _p: [], reply_comment=gone)
    said = agent.reply_comment_tool({"thread": "c0", "text": "Hello"})["content"][0]["text"]
    assert said == "There is no such thread; somebody may have deleted it."


def test_without_a_session_the_tools_say_comments_are_not_connected(tmp_path):
    agent = ProjectAgent(tmp_path, tmp_path / ".nexttex")
    assert "not connected" in agent.list_comments_tool({})["content"][0]["text"]
    assert "not connected" in agent.reply_comment_tool({"thread": "c", "text": "x"})["content"][0]["text"]


def test_the_openai_tools_are_offered_and_answer_the_same_words(tmp_path):
    from nexttex import openai_agent

    names = {tool["function"]["name"] for tool in openai_agent.TOOLS}
    assert {"list_comments", "reply_to_comment"} <= names
    root = tmp_path / "project"
    root.mkdir()
    replied: list = []
    agent = OpenAIAgent(
        root, tmp_path / "state", api_key="test-key",
        comments=lambda path: THREADS,
        reply_comment=lambda thread, text: replied.append((thread, text)) or "hexane",
    )
    said = asyncio.run(agent._dispatch("list_comments", {"path": "results.tex"}))
    assert said == comment_tools.listing(THREADS, "results.tex")
    said = asyncio.run(agent._dispatch("reply_to_comment", {"thread": "c1a2b3c4d5e6", "text": "Yes."}))
    assert said == 'Replied to the comment on "hexane".' and replied == [("c1a2b3c4d5e6", "Yes.")]


def test_the_claude_server_registers_both_tools():
    source = Path(sys.modules["nexttex.agent"].__file__).read_text(encoding="utf-8")
    assert '@tool("list_comments"' in source and '@tool("reply_to_comment"' in source
    assert "show_page, list_comments, reply_to_comment," in source
