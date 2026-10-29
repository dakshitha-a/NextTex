"""Opening a project shows the PDF on disk when nothing has changed since.

Every open asked for a build of every previewed document; on the thesis
that was a 9 s full pass, and 37 s after a restart, for a PDF that was
already current. The 26 to 28 October 2026 diagnostics log had one on
every open. The compile route's `open` cause now answers from disk when
the scheduler vouches for the PDF and no file of the writer's is newer.
"""

import os
import time

from server import main as server_main


def _built(state, log_text="Output written on main.pdf (1 page).\n"):
    """A whole build left on disk: the PDF, its log and its scope marker."""
    state.paths.build_dir.mkdir(parents=True, exist_ok=True)
    state.paths.log.write_text(log_text, encoding="utf-8")
    state.paths.pdf.write_bytes(b"%PDF-1.5\n%%EOF\n")
    state.compiler._note_pdf_scope("")
    later = time.time() + 5
    os.utime(state.paths.pdf, (later, later))


def _counting(state):
    calls = []

    async def fake_build(focus=None, force_full=False, clean=False):
        from nexttex.compile import CompileResult, Outcome
        calls.append(force_full)
        return CompileResult(outcome=Outcome.OK, log=None, pdf=state.paths.pdf,
                             duration=0.1, scope="full", engine_pass="full")

    state.compiler.build = fake_build
    return calls


def test_an_open_with_nothing_changed_builds_nothing(client, opened):
    state = server_main.SESSIONS[opened["id"]].documents["main.tex"]
    _built(state)
    calls = _counting(state)
    answer = client.post(f"/api/projects/{opened['id']}/compile",
                         json={"document": "main.tex", "cause": "open"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["outcome"] == "ok"
    assert calls == []
    assert state.last_result is not None


def test_a_file_newer_than_the_pdf_is_built(client, opened, project_dir):
    state = server_main.SESSIONS[opened["id"]].documents["main.tex"]
    _built(state)
    calls = _counting(state)
    figure = project_dir / "figures" / "plot.png"
    figure.write_bytes(b"\x89PNG")
    later = time.time() + 60
    os.utime(figure, (later, later))
    client.post(f"/api/projects/{opened['id']}/compile",
                json={"document": "main.tex", "cause": "open"})
    assert calls


def test_a_log_that_asks_for_a_rerun_is_built(client, opened):
    state = server_main.SESSIONS[opened["id"]].documents["main.tex"]
    _built(state, "LaTeX Warning: Label(s) may have changed. "
                  "Rerun to get cross-references right.\n")
    calls = _counting(state)
    client.post(f"/api/projects/{opened['id']}/compile",
                json={"document": "main.tex", "cause": "open"})
    assert calls


def test_a_slice_of_the_document_is_built(client, opened):
    state = server_main.SESSIONS[opened["id"]].documents["main.tex"]
    _built(state)
    state.compiler._note_pdf_scope("chapter1")
    calls = _counting(state)
    client.post(f"/api/projects/{opened['id']}/compile",
                json={"document": "main.tex", "cause": "open"})
    assert calls


def test_the_button_always_builds(client, opened):
    state = server_main.SESSIONS[opened["id"]].documents["main.tex"]
    _built(state)
    calls = _counting(state)
    client.post(f"/api/projects/{opened['id']}/compile",
                json={"document": "main.tex", "cause": "rebuild"})
    assert calls


def test_an_open_during_a_build_joins_it_rather_than_replacing_it(client, opened):
    """Four opens after the 27 October restart waited up to 78 s, behind
    builds of one document that each replaced the one before."""
    import asyncio

    from nexttex.compile import CompileResult, Outcome

    session = server_main.SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    calls = []
    joined = []

    async def fake_build(focus=None, force_full=False, clean=False):
        calls.append(force_full)
        if len(calls) == 1:
            # A second tab opens while this one runs.
            joined.append(asyncio.get_running_loop().create_task(
                session.compile(document="main.tex", cause="open")))
            await asyncio.sleep(0.1)
        return CompileResult(outcome=Outcome.OK, log=None, pdf=None, duration=0.4,
                             scope="full", engine_pass="full")

    async def cancel():
        calls.append("cancel")

    state.compiler.build = fake_build
    state.compiler.cancel = cancel
    answer = client.post(f"/api/projects/{opened['id']}/compile",
                         json={"document": "main.tex", "cause": "rebuild"})
    assert answer.status_code == 200
    # One build, cancelled by nobody after it started.
    assert [call for call in calls if call != "cancel"] == [False]
    assert calls[-1] is False


def test_a_project_with_no_document_yet_is_a_404_not_a_500(client, project, project_dir):
    (project_dir / "main.tex").write_text("", encoding="utf-8")
    assert client.post(f"/api/projects/{project['id']}/open").status_code == 200
    answer = client.post(f"/api/projects/{project['id']}/compile", json={"cause": "open"})
    assert answer.status_code == 404
    assert "no document" in answer.json()["detail"]
