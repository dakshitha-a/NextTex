"""Which build path an edit takes, and how a document is scoped.

The rule these protect: testing whether a file *contains* a citation puts
every real chapter on the slow path forever, because every real chapter cites
something.  What matters is whether the set of keys changed.
"""

from pathlib import Path

import pytest

from nexttex.compile import (
    CompileScheduler,
    ProjectPaths,
    included_targets,
    reference_fingerprint,
    supports_partial,
)

CHAPTER = r"""\section{Theory}
The wavefunction \cite{smith2020} evolves. See \ref{fig:one}.
\label{sec:theory}
"""


def scheduler(tmp_path: Path) -> CompileScheduler:
    paths = ProjectPaths(
        root=tmp_path, main=tmp_path / "main.tex", build_dir=tmp_path / "build"
    )
    return CompileScheduler(paths)


def test_typing_prose_beside_a_citation_stays_on_the_fast_path(tmp_path):
    build = scheduler(tmp_path)
    build._needs_full = False
    build.note_edit(tmp_path / "ch.tex", CHAPTER + "More prose.\n", CHAPTER)
    assert build._needs_full is False


def test_a_new_citation_key_forces_a_full_build(tmp_path):
    build = scheduler(tmp_path)
    build._needs_full = False
    build.note_edit(
        tmp_path / "ch.tex",
        CHAPTER.replace("smith2020", "smith2020,jones2021"),
        CHAPTER,
    )
    assert build._needs_full is True


def test_a_new_label_forces_a_full_build(tmp_path):
    build = scheduler(tmp_path)
    build._needs_full = False
    build.note_edit(tmp_path / "ch.tex", CHAPTER + r"\label{sec:new}", CHAPTER)
    assert build._needs_full is True


def test_editing_the_bibliography_forces_a_full_build(tmp_path):
    build = scheduler(tmp_path)
    build._needs_full = False
    build.note_edit(tmp_path / "references.bib", "@article{a,}", "")
    assert build._needs_full is True


def test_without_a_baseline_it_assumes_the_worst(tmp_path):
    build = scheduler(tmp_path)
    build._needs_full = False
    build.note_edit(tmp_path / "ch.tex", CHAPTER, None)
    assert build._needs_full is True


def test_fingerprint_ignores_where_the_keys_appear():
    a, b = reference_fingerprint(CHAPTER)
    moved, moved_labels = reference_fingerprint(
        "\\label{sec:theory}\n" + CHAPTER.replace("\\label{sec:theory}\n", "")
    )
    assert (a, b) == (moved, moved_labels)


def test_partial_builds_need_include_not_input():
    assert supports_partial(r"\include{chapters/one}")
    assert not supports_partial(r"\input{chapters/one}")


def test_included_targets_are_listed_in_order():
    source = r"""
    \include{chapters/01_introduction/01_introduction}
    % \include{chapters/commented_out}
    \include{chapters/02_theory/02_theory}
    """
    assert included_targets(source) == [
        "chapters/01_introduction/01_introduction",
        "chapters/02_theory/02_theory",
    ]


def test_a_full_build_asks_the_engine_for_synctex_data(tmp_path):
    """latexmk accepts -synctex=1 and quietly does not pass it on, so the
    engine has to be given its own command line.  Without this, adding a
    citation -- which forces a full build -- silently breaks double-click
    navigation until the next fast build."""
    from nexttex.compile import CompileScheduler

    build = scheduler(tmp_path)
    argv = build.full_argv(tmp_path / "main.tex")
    directive = next((a for a in argv if a.startswith("-pdflatex=")), "")
    assert "-synctex=1" in directive


def test_a_full_build_refuses_the_project_its_own_rc_file(tmp_path):
    """latexmk reads `latexmkrc` and then `.latexmkrc` out of the directory it
    runs in, which is the project root, and that file is arbitrary Perl.  The
    editor starts a build on its own a second and a half after somebody stops
    typing, so a project carrying one runs it without anybody deciding to --
    and a project is not always the writer's own work: it can be cloned, come
    from a template, or arrive from a collaborator."""
    build = scheduler(tmp_path)
    assert "-norc" in build.full_argv(tmp_path / "main.tex")


def test_the_rc_file_can_be_turned_back_on(tmp_path):
    """A project that genuinely needs one is a real thing to have.  The switch
    is on the install rather than in `nexttex.toml`, because a project
    carrying permission to run its own code is the same hole with a step in
    front of it."""
    paths = ProjectPaths(
        root=tmp_path, main=tmp_path / "main.tex", build_dir=tmp_path / "build"
    )
    build = CompileScheduler(paths, allow_rc=True)
    assert "-norc" not in build.full_argv(tmp_path / "main.tex")


def test_the_fast_path_never_read_one_anyway(tmp_path):
    """`fast_argv` is bare pdflatex, which has no rc file, so an ordinary
    keystroke was never the exposure -- only the full build was."""
    build = scheduler(tmp_path)
    assert build.fast_argv(tmp_path / "main.tex")[0] == "pdflatex"


def test_an_edit_during_a_build_still_gets_its_full_pass(tmp_path, monkeypatch):
    """The bug this defends against: a bibliography edit made while a full
    build was already running had its rebuild cancelled by that build
    finishing, and the new citation printed as [?] until something else
    happened to touch the preamble."""
    import asyncio

    scheduler = _scheduler(tmp_path)
    assert scheduler._needs_full is True

    started = asyncio.Event()
    let_it_finish = asyncio.Event()

    class SlowBuild:
        returncode = 0
        pid = 1

        async def wait(self):
            started.set()
            await let_it_finish.wait()
            return 0

    async def fake_exec(*args, **kwargs):
        return SlowBuild()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    async def scenario():
        build = asyncio.create_task(scheduler.build())
        await asyncio.wait_for(started.wait(), 2)
        # Mid-build, the writer edits the bibliography.
        scheduler.note_edit(tmp_path / "references.bib")
        let_it_finish.set()
        await asyncio.wait_for(build, 2)

    asyncio.run(scenario())
    assert scheduler._needs_full is True, "the newer edit still needs a full pass"


def test_a_build_with_nothing_new_behind_it_clears_the_flag(tmp_path, monkeypatch):
    """The other half: it must still stop asking for full builds forever."""
    import asyncio

    scheduler = _scheduler(tmp_path)

    class Build:
        returncode = 0
        pid = 1

        async def wait(self):
            return 0

    monkeypatch.setattr(
        asyncio, "create_subprocess_exec",
        lambda *a, **k: asyncio.sleep(0, result=Build()),
    )
    asyncio.run(scheduler.build())
    assert scheduler._needs_full is False


def _scheduler(tmp_path):
    from nexttex.compile import CompileScheduler, ProjectPaths

    (tmp_path / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}x\\end{document}\n",
        encoding="utf-8",
    )
    return CompileScheduler(ProjectPaths(
        root=tmp_path, main=tmp_path / "main.tex", build_dir=tmp_path / "build",
    ))
