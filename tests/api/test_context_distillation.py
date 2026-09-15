"""What a distillation writes marks the context stale.

A distilled `voice.md` or `style.md` lands under `.nexttex/`, which the
file watcher ignores by design, so nothing published `context_changed`
and the panel's marker was computed from what it last saw.  Both agent
write paths, the SDK's own Write and the app's tools, end in the same
hook now.
"""

import time

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


def test_an_sdk_write_of_the_voice_summary_announces_the_context(client, opened):
    session, seen = spy_on(opened["id"])
    target = session.context.voice_summary
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("Short sentences.\n", encoding="utf-8")
    client.portal.call(session.note_agent_edit, target, None, "Short sentences.\n")
    assert until(lambda: any(e["type"] == "context_changed" for e in seen))


def test_a_tool_write_of_the_style_summary_announces_the_context(client, opened):
    session, seen = spy_on(opened["id"])
    target = session.context.style_summary
    target.parent.mkdir(parents=True, exist_ok=True)
    client.portal.call(session.write_from_agent, target, "House style.\n")
    assert until(lambda: any(e["type"] == "context_changed" for e in seen))


def test_an_ordinary_agent_edit_announces_nothing_about_the_context(client, opened, project_dir):
    session, seen = spy_on(opened["id"])
    client.portal.call(session.write_from_agent, project_dir / "main.tex",
                       "\\documentclass{article}\\begin{document}x\\end{document}\n")
    assert until(lambda: any(e["type"] == "files_changed" for e in seen))
    assert not any(e["type"] == "context_changed" for e in seen)
