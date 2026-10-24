"""The agent's page tools: publishing fills a page in, wears its icon,
opens it to look, and tells the agent what it found; a page is read back
and changed one string at a time."""

import asyncio

import pytest

from nexttex import page_check
from nexttex.agent import ProjectAgent

DOC = "<!doctype html><html><head><title>Fits</title></head><body>{body}</body></html>"


@pytest.fixture
def agent(tmp_path):
    root = tmp_path / "thesis"
    root.mkdir()
    (root / "main.tex").write_text(
        "\\documentclass{article}\\newcommand{\\Ham}{\\hat{H}}\\begin{document}"
        "\\begin{equation}\\label{eq:tdse}i\\partial_t\\Psi=\\Ham\\Psi\\end{equation}\\end{document}",
        encoding="utf-8")
    state = tmp_path / "state"
    state.mkdir()
    return ProjectAgent(root, state)


def text_of(answer: dict) -> str:
    return "\n".join(part["text"] for part in answer["content"] if part["type"] == "text")


def test_an_icon_that_is_not_in_the_set_is_refused_with_the_set(agent):
    answer = asyncio.run(agent.publish_tool({"name": "fits", "html": DOC.format(body="x"), "icon": "rocket"}))
    assert text_of(answer).startswith("Not published: there is no icon called rocket.")
    assert "timer (" in text_of(answer)
    assert agent.pages.list() == []


def test_a_placeholder_that_cannot_be_filled_publishes_nothing(agent):
    answer = asyncio.run(agent.publish_tool({"name": "fits", "html": DOC.format(body="{{equation:eq:none}}")}))
    assert text_of(answer) == "Not published: No label eq:none is in the project."
    assert agent.pages.list() == []


def test_a_page_wears_its_icon_and_is_read_back_and_changed_as_written(agent, monkeypatch):
    monkeypatch.setattr(page_check, "find_browser", lambda: None)
    answer = asyncio.run(agent.publish_tool({
        "name": "Derivation", "icon": "derivation",
        "html": DOC.format(body="<p>{{equation:eq:tdse}}</p>{{maths}}")}))
    assert text_of(answer).startswith("Published as derivation.")
    assert "Not checked: No Chrome" in text_of(answer)
    served = agent.pages.read("derivation").decode()
    assert 'rel="icon"' in served and "katex.min.js" in served and "\\Ham\\Psi" in served
    written = text_of(agent.read_page_tool("derivation"))
    assert "{{maths}}" in written and 'rel="icon"' in written

    refused = asyncio.run(agent.edit_page_tool("derivation", "html>", "x>"))
    assert text_of(refused).startswith("Not changed: `old` occurs 3 times in derivation")
    changed = asyncio.run(agent.edit_page_tool("derivation", "<title>Fits</title>", "<title>TDSE</title>"))
    assert text_of(changed).startswith("Published as derivation.")
    assert "<title>TDSE</title>" in agent.pages.read("derivation").decode()
    assert agent.read_page_tool("")["content"][0]["text"] == "derivation"


@pytest.mark.skipif(page_check.find_browser() is None, reason="no Chromium-family browser here")
def test_a_broken_page_comes_back_to_the_agent_with_its_error_and_a_picture(agent):
    answer = asyncio.run(agent.publish_tool({"name": "broken", "html": DOC.format(
        body='<div id="eq"></div>\n<script>\nfoo(1));\n</script>')}))
    assert "has problems" in text_of(answer) and "SyntaxError" in text_of(answer)
    images = [part for part in answer["content"] if part["type"] == "image"]
    assert images and images[0]["mimeType"] == "image/png"
