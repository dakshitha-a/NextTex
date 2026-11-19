"""A chapter's build keeps the other chapters' errors.

Once a document's full build takes longer than two seconds, a fast build
compiles only the chapter being edited, through `\\includeonly`, and TeX
never opens the other chapters, so its log says nothing about them. The
probe (Q-017) found the session then replaced the document's whole list
of diagnostics with that build's: an error still in chapter one vanished
from the gutter, the drawer and the strip the moment the writer typed in
chapter two, and the strip said the build was clean. A scoped build now
replaces the diagnostics of the files it opened and keeps the rest.
"""

import asyncio

from nexttex.compile import CompileResult, Outcome
from nexttex.latexlog import Diagnostic, ParsedLog, parse


def result(project_dir, scope, opened, diagnostics, outcome=Outcome.OK):
    log = ParsedLog()
    log.opened = {project_dir / path for path in opened}
    log.diagnostics = [
        Diagnostic(severity=severity, message=message, file=project_dir / path, line=line)
        for severity, message, path, line in diagnostics
    ]
    return CompileResult(
        outcome=outcome, log=log, pdf=None, duration=0.01,
        scope=scope, engine_pass="fast",
    )


def build(session, outcome_of):
    """One compile with the scheduler's build stubbed, and its compile_done."""
    state = session.documents["main.tex"]
    state.compiler._needs_full = False

    async def fake_build(focus=None, force_full=False, clean=False):
        return outcome_of

    async def cancel():
        return None

    async def run():
        queue = session.events.subscribe()
        state.compiler.build = fake_build
        state.compiler.cancel = cancel
        try:
            await session.compile(document="main.tex")
        finally:
            session.events.unsubscribe(queue)
        events = []
        while not queue.empty():
            events.append(queue.get_nowait())
        return [e for e in events if e["type"] == "compile_done"][-1]

    return asyncio.run(run())


UNDEFINED = ("error", "Undefined control sequence.", "chapters/00.tex", 9)


def test_a_scoped_build_keeps_the_errors_of_the_chapters_it_did_not_open(
    client, opened, project_dir
):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    everything = ["main.tex", "chapters/00.tex", "chapters/01.tex"]
    first = build(session, result(project_dir, "full", everything, [UNDEFINED], Outcome.ERRORS))
    assert [d["file"] for d in first["diagnostics"]] == ["chapters/00.tex"]

    # Typing in chapter 01: the build opens main.tex and chapter 01 only.
    scoped = build(session, result(project_dir, "chapters/01", ["main.tex", "chapters/01.tex"], []))
    assert [(d["file"], d["message"]) for d in scoped["diagnostics"]] == [
        ("chapters/00.tex", "Undefined control sequence."),
    ]
    assert scoped["errorCount"] == 1
    assert scoped["summary"], "the drawer's Start here still names the error"
    assert session.documents["main.tex"].diagnostics == scoped["diagnostics"]


def test_a_scoped_build_replaces_the_diagnostics_of_the_files_it_opened(
    client, opened, project_dir
):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    everything = ["main.tex", "chapters/00.tex", "chapters/01.tex"]
    stale = ("warning", "Overfull \\hbox (3.0pt too wide)", "chapters/01.tex", 4)
    build(session, result(project_dir, "full", everything, [UNDEFINED, stale]))
    scoped = build(session, result(project_dir, "chapters/01", ["main.tex", "chapters/01.tex"], []))
    assert [d["file"] for d in scoped["diagnostics"]] == ["chapters/00.tex"]


def test_a_full_build_replaces_everything(client, opened, project_dir):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    everything = ["main.tex", "chapters/00.tex", "chapters/01.tex"]
    build(session, result(project_dir, "full", everything, [UNDEFINED], Outcome.ERRORS))
    clean = build(session, result(project_dir, "full", everything, []))
    assert clean["diagnostics"] == []


def test_the_log_parser_records_every_file_the_engine_opened(tmp_path):
    (tmp_path / "chapters").mkdir()
    for name in ("main.tex", "chapters/01.tex"):
        (tmp_path / name).write_text("x")
    log = (
        "(./main.tex LaTeX2e <2024-11-01>\n"
        "(/usr/share/texlive/texmf-dist/tex/latex/base/article.cls)\n"
        "(./chapters/01.tex)\n"
        ")\n"
    )
    parsed = parse(log, tmp_path, tmp_path / "main.tex")
    opened = {p.name for p in parsed.opened}
    assert {"main.tex", "01.tex", "article.cls"} <= opened


def test_the_agents_build_is_never_scoped_to_the_writers_chapter(
    client, opened, project_dir
):
    """The agent builds to check its own work. Scoped to the chapter the
    writer had open, its build of the thesis reported 95 pages and that
    chapter's warnings as the whole document (19 November 2026)."""
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    state.compiler._needs_full = False
    session._focus = project_dir / "chapters" / "01.tex"
    # The template has no chapters; this one belongs to main.tex.
    session._owns = lambda state, path: path == session._focus
    asked: list = []

    async def fake_build(focus=None, force_full=False, clean=False):
        asked.append(focus)
        return result(project_dir, "full", ["main.tex"], [])

    async def cancel():
        return None

    state.compiler.build = fake_build
    state.compiler.cancel = cancel

    async def run():
        await session.compile(document="main.tex", cause="edit")
        await session.compile(document="main.tex", cause="agent")

    asyncio.run(run())
    assert asked == [session._focus, None]


def test_a_scoped_build_does_not_list_the_main_files_warnings_twice(
    client, opened, project_dir
):
    """A scoped build compiles the stand-in, so its log names the stand-in
    as opened, not main.tex, while its diagnostics are remapped to main.tex.
    The old main.tex rows were then kept as unopened and the new ones added
    beside them: the thesis's agent saw main.tex lines 55, 89 and 154 twice
    in one listing (19 November 2026)."""
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    shadow = session.documents["main.tex"].paths.shadow.relative_to(project_dir)
    warning = ("warning", "Suppressing link with empty target", "main.tex", 55)
    build(session, result(project_dir, "full", ["main.tex", "chapters/01.tex"], [warning]))

    scoped = build(session, result(
        project_dir, "chapters/01", [str(shadow), "chapters/01.tex"], [warning]))
    assert [(d["file"], d["line"]) for d in scoped["diagnostics"]] == [("main.tex", 55)]
    assert scoped["warningCount"] == 1
