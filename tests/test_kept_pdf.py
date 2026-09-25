"""A fatal build keeps the last good PDF.

The probe's writer journey (Q-066) left a `\\ref{` without its closing
brace. pdfTeX stopped with "File ended while scanning use of \\T@ref" and
"Fatal error occurred, no output PDF file produced!", and in stopping it
deleted `main.pdf`. NextTex built into the one file the preview serves and
kept no copy, so the preview lost the article's pages and then called the
document empty. The PDF is now moved aside while the engine runs and put
back if the engine wrote none.
"""

import asyncio
import shutil
from pathlib import Path

import pytest

from nexttex.compile import CompileScheduler, Outcome, ProjectPaths

needs_tex = pytest.mark.skipif(shutil.which("pdflatex") is None, reason="pdflatex is needed")

GOOD = r"""\documentclass{article}
\begin{document}
\section{Intro}\label{sec:intro}
First page.
\newpage
Second page, see Section~\ref{sec:intro}.
\end{document}
"""


def scheduler(root: Path) -> CompileScheduler:
    return CompileScheduler(ProjectPaths(root=root, main=root / "main.tex", build_dir=root / "build"))


@needs_tex
def test_an_unclosed_brace_keeps_the_last_good_pdf(tmp_path):
    main = tmp_path / "main.tex"
    main.write_text(GOOD)
    build = scheduler(tmp_path)
    first = asyncio.run(build.build(force_full=True))
    assert first.pdf is not None and first.pdf.exists()
    good = first.pdf.read_bytes()
    assert not first.pdf_kept

    main.write_text(GOOD.replace(r"\end{document}", "See also \\ref{sec:intro\n\\end{document}"))
    second = asyncio.run(build.build())
    assert second.outcome is Outcome.ERRORS
    assert second.pdf_kept, "the engine wrote no PDF, so the last one was put back"
    assert build.paths.pdf.read_bytes() == good
    assert not build.paths.kept_pdf.exists()
    assert second.as_dict()["pdfKept"] is True

    main.write_text(GOOD)
    third = asyncio.run(build.build())
    assert third.outcome is Outcome.OK and not third.pdf_kept
    assert not build.paths.kept_pdf.exists()


def test_a_half_written_pdf_loses_to_the_kept_one(tmp_path):
    build = scheduler(tmp_path)
    build.paths.build_dir.mkdir()
    build.paths.pdf.write_bytes(b"%PDF-1.5 whole\n%%EOF\n")
    scope = build._set_aside_pdf()
    assert scope is not None and not build.paths.pdf.exists()
    # A cancelled engine leaves the start of a document and no end.
    build.paths.pdf.write_bytes(b"%PDF-1.5 half")
    assert build._settle_pdf(scope)
    assert build.paths.pdf.read_bytes().endswith(b"%%EOF\n")


def test_a_finished_pdf_replaces_the_kept_one(tmp_path):
    build = scheduler(tmp_path)
    build.paths.build_dir.mkdir()
    build.paths.pdf.write_bytes(b"%PDF-1.5 old\n%%EOF\n")
    scope = build._set_aside_pdf()
    build.paths.pdf.write_bytes(b"%PDF-1.5 new\n%%EOF\n")
    assert not build._settle_pdf(scope)
    assert b"new" in build.paths.pdf.read_bytes()
    assert not build.paths.kept_pdf.exists()


def test_while_a_build_runs_the_kept_pdf_is_the_one_shown(tmp_path):
    build = scheduler(tmp_path)
    build.paths.build_dir.mkdir()
    assert build.paths.shown_pdf() is None
    build.paths.pdf.write_bytes(b"%PDF-1.5\n%%EOF\n")
    build._set_aside_pdf()
    assert build.paths.shown_pdf() == build.paths.kept_pdf
