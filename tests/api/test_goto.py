"""`goto` says whether any editor was there to show the line.

The resume project's agent called `goto` on a root off the strip and was
told "Showing ... in the editor", then found the document had not joined
the strip. The browser's follow does put it there, as
`e2e/specs/previews.spec.ts` shows, but only a browser holding the
project's event stream receives the reveal, and with none the tool
claimed a success that never happened. The session now says whether it
asked anyone, and the tool says so to the agent.
"""

import time
from pathlib import Path

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


def test_with_no_browser_on_the_project_nothing_is_published(client, opened):
    session, seen = spy_on(opened["id"])
    assert session.events.watchers == 0
    assert client.portal.call(session.reveal_in_editor, "main.tex", 3) is False
    time.sleep(0.1)
    assert not any(e["type"] == "reveal" for e in seen)


def test_with_a_browser_on_the_project_the_reveal_reaches_it(client, opened):
    session, seen = spy_on(opened["id"])
    queue = session.events.subscribe()
    try:
        assert client.portal.call(session.reveal_in_editor, "main.tex", 3) is True
        assert until(lambda: any(e["type"] == "reveal" for e in seen))
        assert {"type": "reveal", "path": "main.tex", "line": 3} in seen
    finally:
        session.events.unsubscribe(queue)


def _agent(reveal):
    from nexttex.agent import ProjectAgent

    return ProjectAgent(Path("/tmp"), Path("/tmp/.nexttex"), reveal=reveal)


def test_the_tool_says_when_no_editor_saw_the_line():
    said = _agent(lambda path, line: False).goto_tool("letters/cover.tex", 3)
    text = said["content"][0]["text"]
    assert "No editor window has this project open" in text
    assert "letters/cover.tex:3" in text
    assert "Showing" not in text


def test_the_tool_says_the_line_is_shown_when_an_editor_was_asked():
    said = _agent(lambda path, line: True).goto_tool("letters/cover.tex", 3)
    assert said["content"][0]["text"] == "Showing letters/cover.tex:3 in the editor."


def test_a_reveal_that_answers_nothing_is_still_taken_as_shown():
    """A stand-in that returns None, as the session's did before, is not
    read as a refusal."""
    said = _agent(lambda path, line: None).goto_tool("main.tex", 1)
    assert said["content"][0]["text"] == "Showing main.tex:1 in the editor."
