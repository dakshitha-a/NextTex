"""Warnings a document hides, kept in nexttex.toml.

The thesis session's standalone chapters number themselves with
`\\newlabel`, and every build said "Suppressing link with empty target"
for each reference, noise the writer had seen and could do nothing
about (19 November 2026). A document can now hide warnings like one,
never an error, and the table travels with the project.
"""

import asyncio

from nexttex.compile import CompileResult, Outcome
from nexttex.latexlog import Diagnostic, ParsedLog
from nexttex.project import ProjectConfig, clean_hidden_warnings, hidden_by, warning_shape

EMPTY = "Package hyperref Warning: Suppressing link with empty target on input line 55."


def built(project_dir, rows):
    log = ParsedLog()
    log.opened = {project_dir / "main.tex"}
    log.diagnostics = [
        Diagnostic(severity=severity, message=message, file=project_dir / "main.tex", line=line)
        for severity, message, line in rows
    ]
    return CompileResult(outcome=Outcome.OK, log=log, pdf=None, duration=0.01,
                         scope="full", engine_pass="fast")


def test_a_warning_hides_its_kind_not_only_itself():
    shape = warning_shape("Overfull \\hbox (3.2pt too wide) in paragraph at lines 12--14")
    assert shape == "Overfull \\hbox (#pt too wide) in paragraph at lines #--#"
    assert hidden_by("Overfull \\hbox (17.04pt too wide) in paragraph at lines 80--81", [shape])
    assert not hidden_by("Underfull \\hbox (badness 10000) in paragraph at lines 1--2", [shape])
    # A fragment written by hand hides what contains it.
    assert hidden_by(EMPTY, ["Suppressing link with empty target"])


def test_a_table_that_leaves_the_project_is_refused_whole():
    assert clean_hidden_warnings({"main.tex": ["x"], "../other.tex": ["y"]}) is None
    assert clean_hidden_warnings({"main.tex": "not a list"}) is None
    assert clean_hidden_warnings({"main.tex": ["a  b 12"], "empty.tex": []}) == {"main.tex": ["a b #"]}


def test_hidden_warnings_leave_the_build_and_the_count_and_errors_never_do(
    client, opened, project_dir
):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    answer = client.post(f"/api/projects/{opened['id']}/settings", json={
        "hiddenWarnings": {"main.tex": [warning_shape(EMPTY)]}})
    assert answer.status_code == 200, answer.text
    assert answer.json()["hiddenWarnings"] == {"main.tex": [warning_shape(EMPTY)]}
    assert 'hide_warnings' in (project_dir / "nexttex.toml").read_text(encoding="utf-8")
    assert ProjectConfig.load(project_dir).hide_warnings == {"main.tex": [warning_shape(EMPTY)]}

    payload = session.as_client_dict(built(project_dir, [
        ("warning", EMPTY, 55),
        ("warning", EMPTY.replace("55", "89"), 89),
        ("warning", "Citation `x' undefined", 12),
        ("error", "Suppressing link with empty target", 3),
    ]), "main.tex")
    assert [d["line"] for d in payload["diagnostics"]] == [12, 3]
    assert payload["warningCount"] == 1 and payload["hiddenWarnings"] == 2
    assert payload["errorCount"] == 1


def test_the_agents_compile_counts_what_the_writer_sees(client, opened, project_dir):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    session.project.config.hide_warnings = {"main.tex": [warning_shape(EMPTY)]}
    state = session.documents["main.tex"]

    async def fake_build(focus=None, force_full=False, clean=False):
        return built(project_dir, [("warning", EMPTY, 55), ("warning", "Citation `x' undefined", 12)])

    async def cancel():
        return None

    state.compiler.build = fake_build
    state.compiler.cancel = cancel
    payload = asyncio.run(session._compile_for_agent(document="main.tex"))
    assert payload["warningCount"] == 1 and payload["hiddenWarnings"] == 2 - 1
    from nexttex.explain import compile_report
    assert "1 warnings hidden by nexttex.toml" in compile_report("main.tex", payload)


def test_hiding_takes_the_rows_out_of_what_the_agent_already_holds(client, opened):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    state.diagnostics = [
        {"severity": "warning", "message": EMPTY, "file": "main.tex", "line": 55, "document": "main.tex"},
        {"severity": "error", "message": EMPTY, "file": "main.tex", "line": 3, "document": "main.tex"},
    ]
    client.post(f"/api/projects/{opened['id']}/settings", json={
        "hiddenWarnings": {"main.tex": ["Suppressing link with empty target"]}})
    assert [d["severity"] for d in state.diagnostics] == ["error"]


def test_a_hidden_warnings_table_that_leaves_the_project_is_refused(client, opened):
    answer = client.post(f"/api/projects/{opened['id']}/settings", json={
        "hiddenWarnings": {"../../etc/passwd": ["x"]}})
    assert answer.status_code == 400
