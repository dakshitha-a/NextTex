"""The three things the dissertation surfaced on its first real day.

All three were invisible against a one-file example project, which is why
they shipped: a `main.tex` that inputs nothing cannot be mis-attributed, a
document that builds in one second never makes you want to stop it
building, and a project with no warnings has none to be distracted by.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess

import pytest

from nexttex.config import ensure_tex_on_path
from server import main as server_main

# The TeX tree is not on the default PATH here any more than it is for the
# app, and chktex lives in it.  Put it there before deciding to skip, or
# these tests skip on the one machine they were written for.
ensure_tex_on_path()

chktex = pytest.mark.skipif(
    shutil.which("chktex") is None, reason="chktex is not installed here"
)

MAIN = """\\documentclass{article}
\\begin{document}
%% ======== a comment banner, and nothing else on this line ========
\\input{chapters/one}
\\end{document}
"""

# A space before a \label, which chktex objects to, on line 3 of the chapter
# -- which is the banner comment's line in main.tex.  That coincidence is
# the whole bug: the finding was reported against main.tex at the chapter's
# own line number, and landed on a comment, where chktex never looks.
#
# Deliberately a warning the project's own .chktexrc leaves switched on;
# most of the obvious ones (straight quotes, for instance) are silenced
# there, and a fixture built on a silenced warning tests nothing.
CHAPTER = """Some prose.
More prose.
A line with \\label{a } in it.
"""


def with_chapter(client, project_dir, project):
    (project_dir / "main.tex").write_text(MAIN, encoding="utf-8")
    (project_dir / "chapters").mkdir(exist_ok=True)
    (project_dir / "chapters" / "one.tex").write_text(CHAPTER, encoding="utf-8")
    return project["id"]


@chktex
def test_chktex_only_reports_the_file_that_was_asked_about(
    client, project_dir, opened
):
    """The negative half is the one that matters.

    A test that only checked the chapter's warning is found would pass
    against the broken code too -- it found the warning, it just filed it
    under the wrong document.
    """
    project_id = with_chapter(client, project_dir, opened)

    main = client.get(f"/api/projects/{project_id}/lint", params={"path": "main.tex"})
    assert main.status_code == 200, main.text
    assert main.json()["diagnostics"] == [], (
        "main.tex has no problems of its own; every finding here belongs to "
        "a file it inputs"
    )

    chapter = client.get(
        f"/api/projects/{project_id}/lint", params={"path": "chapters/one.tex"}
    )
    found = chapter.json()["diagnostics"]
    assert found, "the chapter's own warning should be reported when it is open"
    assert {item["file"] for item in found} == {"chapters/one.tex"}
    assert all(item["line"] == 3 for item in found), found


@chktex
def test_chktex_is_told_not_to_follow_inputs(client, project_dir, opened):
    """Belt and braces, and this is the belt.

    Verified against the tool rather than assumed: `-I0` is what makes the
    common case right, and `%f` is only the guard that catches it if this
    flag ever goes away.
    """
    project_id = with_chapter(client, project_dir, opened)
    without = subprocess.run(
        ["chktex", "-q", "-f", "%f:%l\n", "main.tex"],
        cwd=project_dir, capture_output=True, text=True,
    ).stdout
    with_flag = subprocess.run(
        ["chktex", "-q", "-I0", "-f", "%f:%l\n", "main.tex"],
        cwd=project_dir, capture_output=True, text=True,
    ).stdout
    assert without.strip(), "the fixture should produce a finding somewhere"
    assert not with_flag.strip()
    _ = project_id


def test_the_three_switches_round_trip(client, project_dir, opened):
    project_id = opened["id"]
    response = client.post(
        f"/api/projects/{project_id}/settings",
        json={"autocompile": False, "markWarnings": True},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "main": "main.tex",
        # Every previewed document, main first.  A project that has not
        # asked for a second one still reports the one it has.
        "previews": ["main.tex"],
        "autocompile": False,
        "markErrors": True,
        "markWarnings": True,
    }

    # Written, not just held in memory.  `save()` writes its optional fields
    # only when they are truthy, which is right for a string and wrong for a
    # switch: `autocompile = false` used to be dropped on every save.
    written = (project_dir / "nexttex.toml").read_text(encoding="utf-8")
    assert "autocompile = false" in written
    assert "mark_warnings = true" in written

    # And they come back with the project.
    reopened = client.post(f"/api/projects/{project_id}/open").json()
    assert reopened["autocompile"] is False
    assert reopened["markWarnings"] is True


def test_a_partial_update_leaves_the_others_alone(client, opened):
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/settings", json={"markErrors": False})
    body = client.post(
        f"/api/projects/{project_id}/settings", json={"autocompile": False}
    ).json()
    assert body["markErrors"] is False
    assert body["autocompile"] is False


def test_nothing_is_scheduled_when_compiling_as_you_type_is_off(client, opened):
    """Gated in the scheduler rather than in the editor.

    Only two of the twelve callers are the writer's own keystrokes; the rest
    are the agent's edits, uploads, restores and template loads, and a
    switch that let those keep building would not be the switch it says it
    is.
    """
    session = server_main.SESSIONS[opened["id"]]

    async def schedule(on: bool):
        # The debounce is per document now -- a project can have several
        # previewed, and each waits on its own timer.
        session.project.config.autocompile = on
        for state in session.documents.values():
            state.debounce = None
        session.schedule_compile()
        await asyncio.sleep(0)
        pending = [
            state for state in session.documents.values()
            if state.debounce is not None and not state.debounce.done()
        ]
        for state in pending:
            state.debounce.cancel()
        return bool(pending)

    assert asyncio.run(schedule(False)) is False
    assert asyncio.run(schedule(True)) is True


def test_the_raw_log_can_be_read_without_leaving_the_drawer(client, opened, tmp_path):
    """R-094. `build/` is excluded from the file tree, deliberately, so the
    full latexmk log was unreachable from the app entirely: no route, and
    no way to open the file.

    Section 7 of the design document rejects a bottom console with
    Problems, Output and Terminal tabs, so the log goes inside the row it
    belongs to rather than into a panel of its own.
    """
    session = server_main.SESSIONS[opened["id"]]
    session.paths.build_dir.mkdir(parents=True, exist_ok=True)
    session.paths.log.write_text("This is pdfTeX\n! Undefined control sequence.\n",
                                 encoding="utf-8")

    answer = client.get(f"/api/projects/{opened['id']}/log")
    assert answer.status_code == 200, answer.text
    assert "Undefined control sequence" in answer.json()["text"]


def test_a_log_that_is_not_there_is_not_an_error(client, opened):
    """A project that has never built has no log, and saying so is the
    answer rather than a 404 the drawer would have to translate."""
    session = server_main.SESSIONS[opened["id"]]
    if session.paths.log.exists():
        session.paths.log.unlink()
    answer = client.get(f"/api/projects/{opened['id']}/log")
    assert answer.status_code == 200
    assert answer.json()["text"] == ""


def test_a_document_nobody_has_is_refused(client, opened):
    answer = client.get(f"/api/projects/{opened['id']}/log?document=../../etc/passwd")
    assert answer.status_code in (400, 403, 404)
