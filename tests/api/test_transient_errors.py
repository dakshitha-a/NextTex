"""An error from a build whose file changed under it is set apart.

The thesis's writer pasted "File ended while scanning use of \\revised"
from a build that ran while a brace was half deleted, and the agent went
looking for a fault that was already gone.
"""

import time

from nexttex.compile import CompileResult, Outcome
from nexttex.latexlog import parse
from server import main as server_main

HALF_AN_EDIT = (
    "(./main.tex\n"
    "! File ended while scanning use of \\revised.\n"
    "<inserted text>\n"
    "l.12 \\revised{is\n"
)


def _erring(session, state, edited_during):
    async def fake_build(focus=None, force_full=False, clean=False):
        if edited_during:
            state.edited_at = time.time() + 1
        log = parse(HALF_AN_EDIT, session.project.root, state.paths.main)
        return CompileResult(outcome=Outcome.ERRORS, log=log, pdf=None, duration=0.2,
                             scope="full", engine_pass="fast")

    async def cancel():
        return None

    state.compiler.build = fake_build
    state.compiler.cancel = cancel


def test_an_error_from_half_an_edit_is_marked_and_kept_from_the_agent(client, opened):
    session = server_main.SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    _erring(session, state, edited_during=True)
    payload = client.post(f"/api/projects/{opened['id']}/compile",
                          json={"document": "main.tex"}).json()
    errors = [d for d in payload["diagnostics"] if d["severity"] == "error"]
    assert errors and all(d.get("transient") for d in errors)
    assert payload["transientErrors"] == len(errors)
    assert payload["summary"] is None
    assert not [d for d in session._diagnostics if d["severity"] == "error"]


def test_the_same_error_with_nothing_changed_is_an_error(client, opened):
    session = server_main.SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    _erring(session, state, edited_during=False)
    payload = client.post(f"/api/projects/{opened['id']}/compile",
                          json={"document": "main.tex"}).json()
    assert not any(d.get("transient") for d in payload["diagnostics"])
    assert payload["summary"] is not None
    assert [d for d in session._diagnostics if d["severity"] == "error"]
