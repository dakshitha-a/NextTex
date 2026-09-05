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
