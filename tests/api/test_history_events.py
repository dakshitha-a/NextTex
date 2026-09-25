"""The browser hears that a file's log gained a version.

The history panel refreshed its list after a build and at no other time,
which is right for a `.tex` and for nothing else: a `.md` typed into never
builds, so its versions were recorded and the panel went on showing the
list from when it opened.  The session listens to the history's own hook
now, the one the peers already use, and publishes `history_changed` with
the paths whose logs grew, a moment after the last of them, so a `git
pull`'s forty files are one event rather than forty.
"""

from __future__ import annotations

import asyncio
import time

from nexttex.history import History
from server import main as server_main


def _events(queue) -> list[dict]:
    out = []
    while not queue.empty():
        out.append(queue.get_nowait())
    return out


def _wait_for(queue, kind: str, seconds: float = 3.0) -> list[dict]:
    """The events of one kind that arrive within the window."""
    deadline = time.monotonic() + seconds
    seen: list[dict] = []
    while time.monotonic() < deadline:
        seen.extend(e for e in _events(queue) if e.get("type") == kind)
        if seen:
            # A moment more, so a second event of the kind would be caught.
            time.sleep(0.4)
            seen.extend(e for e in _events(queue) if e.get("type") == kind)
            return seen
        time.sleep(0.05)
    return seen


def test_a_saved_markdown_file_announces_its_version_without_a_build(client, opened):
    project_id = opened["id"]
    session = server_main.session_for(project_id)
    queue = session.events.subscribe()

    response = client.put(
        f"/api/projects/{project_id}/file",
        json={"path": "notes.md", "text": "# Notes\n\nA line.\n",
              "compile": False, "origin": "tab-a", "create": True},
    )
    assert response.status_code == 200, response.text

    heard = _wait_for(queue, "history_changed")
    assert heard, "no history_changed reached the stream"
    assert heard[-1]["paths"] == ["notes.md"]
    # And no build was started for it.
    kinds = {e.get("type") for e in _events(queue)}
    assert "compile_start" not in kinds


def test_several_files_in_one_moment_are_one_event(client, opened, monkeypatch):
    # "One moment" is the session's delay, 0.3 s, and three saves through
    # the test client took longer than that on a CI runner of 23 September
    # and again on 25 September, so they were two events (Q-015). What is
    # under test is that saves inside the delay fold, so the delay is made
    # longer than any runner takes, rather than hoping the runner is quick.
    from server import session as session_module

    monkeypatch.setattr(session_module, "HISTORY_EVENT_DELAY", 3.0)
    project_id = opened["id"]
    session = server_main.session_for(project_id)
    queue = session.events.subscribe()

    for name in ("a.md", "b.md", "c.md"):
        client.put(
            f"/api/projects/{project_id}/file",
            json={"path": name, "text": f"# {name}\n", "compile": False,
                  "origin": "tab-a", "create": True},
        )

    heard = _wait_for(queue, "history_changed", seconds=8.0)
    assert len(heard) == 1, [e["paths"] for e in heard]
    assert heard[0]["paths"] == ["a.md", "b.md", "c.md"]


def test_a_history_tells_every_listener_and_each_only_once():
    """The hook was one slot, and the session's listener would have
    replaced the peers' or the other way round."""
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as folder:
        history = History(Path(folder) / "history")
        told: list[tuple[str, str]] = []
        history.listen(lambda key: told.append(("one", key)))
        second = lambda key: told.append(("two", key))  # noqa: E731
        history.listen(second)
        history.listen(second)
        history.record("main.tex", "the first draft")
        names = [name for name, _ in told]
        assert names == ["one", "two"]


def test_a_session_built_with_no_loop_records_without_complaint(tmp_path):
    """Tests and the shutdown flush record versions on threads with no
    loop; the listener has nothing to reach and must say so quietly."""
    from nexttex.project import Project
    from server.session import ProjectSession

    root = tmp_path / "project"
    root.mkdir()
    (root / "main.tex").write_text("\\documentclass{article}\\begin{document}x\\end{document}")
    session = ProjectSession(Project.open(root))
    assert session._loop is None
    try:
        session.record_version(root / "main.tex", "changed")
        assert session.history.versions("main.tex")
    finally:
        # Built on this thread, closed on this thread: a session left to
        # the garbage collector is dropped on whichever thread runs next,
        # and pycrdt objects to that out loud.
        asyncio.run(session.close())
