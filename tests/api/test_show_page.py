"""The agent turning the preview to a page.

`goto` moves the editor and nothing moved the preview, so an agent
reviewing a long document could name a page and not show it.  The
session publishes `show_page` for a document on the strip, the browser
puts that tab in front and turns to the page, and a name the strip does
not hold is refused rather than passed on.
"""

import asyncio
import time

import pytest

import server.main as server_main


def spy_on(project_id):
    session = server_main.SESSIONS[project_id]
    seen = []
    original = session.events.publish

    async def record(event):
        seen.append(event)
        await original(event)

    session.events.publish = record
    return session, seen


def until(check, seconds=3.0):
    stop = time.monotonic() + seconds
    while time.monotonic() < stop:
        if check():
            return True
        time.sleep(0.02)
    return check()


def test_a_page_of_a_document_on_the_strip_is_announced(client, opened):
    session, seen = spy_on(opened["id"])
    shown = client.portal.call(session.show_page, "main.tex", 3)
    assert shown == "main.tex"
    assert until(lambda: any(e["type"] == "show_page" for e in seen))
    event = next(e for e in seen if e["type"] == "show_page")
    assert event == {"type": "show_page", "document": "main.tex", "page": 3}


def test_an_empty_name_means_the_document_in_front(client, opened):
    session, seen = spy_on(opened["id"])
    assert client.portal.call(session.show_page, "", 2) == "main.tex"
    assert until(lambda: any(e.get("document") == "main.tex" and e.get("page") == 2 for e in seen))


def test_a_page_below_one_is_page_one(client, opened):
    session, seen = spy_on(opened["id"])
    client.portal.call(session.show_page, "main.tex", 0)
    assert until(lambda: any(e["type"] == "show_page" for e in seen))
    assert next(e for e in seen if e["type"] == "show_page")["page"] == 1


@pytest.mark.parametrize("name", ["nosuch.tex", "../outside.tex", "chapters/one.tex"])
def test_a_name_the_strip_does_not_hold_is_refused(client, opened, name):
    session, seen = spy_on(opened["id"])
    with pytest.raises(LookupError):
        client.portal.call(session.show_page, name, 1)
    assert not any(e["type"] == "show_page" for e in seen)


def test_the_tool_refuses_before_the_session_is_asked():
    """The agent's own check, with the list of what the strip holds."""
    from nexttex.agent import ProjectAgent

    asked: list[tuple[str, int]] = []
    subject = ProjectAgent(
        __import__("pathlib").Path("/tmp"), __import__("pathlib").Path("/tmp/.nexttex"),
        show_page=lambda document, page: asked.append((document, page)) or document,
        documents=lambda: ["main.tex", "esi.tex"],
    )
    refused = subject.show_page_tool({"document": "nope.tex", "page": 2})
    assert "nope.tex is not a document on the preview strip" in refused["content"][0]["text"]
    assert "main.tex, esi.tex" in refused["content"][0]["text"]
    assert asked == []
    shown = subject.show_page_tool({"document": "esi.tex", "page": 2})
    assert asked == [("esi.tex", 2)]
    assert shown["content"][0]["text"] == "Showing page 2 of esi.tex."
    assert "Which page" in subject.show_page_tool({"page": "two"})["content"][0]["text"]
