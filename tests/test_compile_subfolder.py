"""A document in a subfolder compiles from its own directory.

The in-app agent found that a document at `cas_paper/x.tex` had its
`\\input`, `\\graphicspath` and local `\\usepackage` resolved against the
project root, silently, and that a root copy of a style shadowed the one
beside the document.  The engine runs from the document's directory now,
which is what `pdflatex x.tex` does by hand, with the root kept on the
search path so a root-relative path that worked before still works.

These run the real engine, so they skip where there is none; CI's python
workflow has no TeX.  What they pin is not the engine but the seams the
change touches: the working directory and search path the scheduler
sets, where the log parser puts a relative path, and where synctex sends
a click.
"""

import asyncio
import shutil
from pathlib import Path

import pytest

from nexttex import synctex
from nexttex.compile import CompileScheduler, Outcome, ProjectPaths

needs_tex = pytest.mark.skipif(
    shutil.which("pdflatex") is None or shutil.which("synctex") is None,
    reason="pdflatex and synctex are needed",
)


def subfolder_project(root: Path, *, error: bool = False) -> ProjectPaths:
    (root / "papers" / "a" / "sec").mkdir(parents=True)
    (root / "shared").mkdir()
    (root / "papers" / "a" / "main.tex").write_text(
        "\\documentclass{article}\n"
        "\\input{shared/preamble}\n"   # root-relative, as before
        "\\begin{document}\n"
        "Hello.\n"
        "\\input{sec/one}\n"           # beside the document
        "\\end{document}\n",
        encoding="utf-8",
    )
    (root / "shared" / "preamble.tex").write_text("\\usepackage{amsmath}\n", encoding="utf-8")
    body = "A line of text.\n\nAnother paragraph"
    body += " with \\undefinedthing in it.\n" if error else " of prose.\n"
    (root / "papers" / "a" / "sec" / "one.tex").write_text(body, encoding="utf-8")
    return ProjectPaths(
        root=root, main=root / "papers" / "a" / "main.tex", build_dir=root / "build"
    )


def test_the_engine_runs_in_the_documents_directory_with_the_root_on_the_search_path(tmp_path):
    paths = subfolder_project(tmp_path)
    assert paths.workdir == tmp_path / "papers" / "a"
    env = paths.search_env()
    for name in ("TEXINPUTS", "BIBINPUTS", "BSTINPUTS"):
        assert env[name].split(":")[:2] == [str(tmp_path / "papers" / "a"), str(tmp_path)]
        assert env[name].endswith(":"), "the trailing separator keeps the installation's own path"


@needs_tex
def test_a_subfolder_document_finds_its_own_input_and_the_roots(tmp_path):
    paths = subfolder_project(tmp_path)
    result = asyncio.run(CompileScheduler(paths).build())
    assert result.outcome is Outcome.OK, result.log.raw_tail if result.log else result
    assert paths.pdf.exists()
    assert result.log is not None and result.log.pages == 1


@needs_tex
def test_an_error_in_a_sibling_file_is_attributed_to_that_file(tmp_path):
    paths = subfolder_project(tmp_path, error=True)
    result = asyncio.run(CompileScheduler(paths).build())
    assert result.outcome is Outcome.ERRORS
    files = {d.file.resolve() for d in result.log.errors if d.file}
    assert files == {(tmp_path / "papers" / "a" / "sec" / "one.tex").resolve()}


@needs_tex
def test_synctex_maps_both_ways_for_a_subfolder_document(tmp_path):
    paths = subfolder_project(tmp_path)
    assert asyncio.run(CompileScheduler(paths).build()).outcome is Outcome.OK
    one = tmp_path / "papers" / "a" / "sec" / "one.tex"
    # Forward: the third line of the sibling file lands on the page.
    positions = synctex.source_to_pdf(paths.pdf, one, 3, tmp_path, base=paths.workdir)
    assert positions, "forward search knew nothing about the sibling file"
    # And back: a click there names the sibling file, not the main one.
    hit = positions[0]
    found = synctex.pdf_to_source(
        paths.pdf, hit.page, hit.x + 1, hit.y - 1, tmp_path,
        shadow_main=paths.shadow, main_file=paths.main, base=paths.workdir,
    )
    assert found is not None
    assert found.file.resolve() == one.resolve()
    assert found.line == 3
