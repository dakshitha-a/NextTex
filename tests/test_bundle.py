"""The submission source bundle: what the document uses, and no more."""

import io
import shutil
import subprocess
import zipfile

import pytest

from nexttex import bundle

MAIN = r"""\documentclass{article}
\usepackage{ourmacros}% our own package
\usepackage{graphicx}
\graphicspath{{figs/}}
% A note to self the referee should not read.
\begin{document}
Hello 50\% of the time. % trailing note
\input{chapters/one}
\includegraphics{plot}
\begin{verbatim}
% this percent is code, kept
\end{verbatim}
\bibliographystyle{ourstyle}
\bibliography{refs}
\end{document}
"""


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "paper"
    (root / "chapters").mkdir(parents=True)
    (root / "figs").mkdir()
    (root / "build").mkdir()
    (root / "main.tex").write_text(MAIN)
    (root / "chapters" / "one.tex").write_text("A chapter.\n")
    (root / "ourmacros.sty").write_text("\\newcommand{\\x}{x}% keep\n")
    (root / "ourstyle.bst").write_text("ENTRY {} {} {}\n")
    (root / "refs.bib").write_text("@misc{a, title={A}}\n")
    (root / "figs" / "plot.png").write_bytes(b"\x89PNG fake")
    (root / "figs" / "unused.png").write_bytes(b"\x89PNG other")
    (root / "notes.tex").write_text("not read by main\n")
    (root / "build" / "main.bbl").write_text("\\begin{thebibliography}{1}\\end{thebibliography}\n")
    return root


def texts_of(root):
    return {
        path.relative_to(root).as_posix(): path.read_text()
        for path in root.rglob("*") if path.suffix in (".tex", ".bib", ".sty")
    }


READS = {"main.tex", "chapters/one.tex", "refs.bib"}


def test_the_bundle_holds_what_the_document_uses_and_its_bbl(project):
    data, names = bundle.build(project, "main.tex", READS, texts_of(project), project / "build" / "main.bbl")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert sorted(archive.namelist()) == names == [
            "chapters/one.tex", "figs/plot.png", "main.bbl", "main.tex",
            "ourmacros.sty", "ourstyle.bst", "refs.bib",
        ]
        assert archive.read("main.tex").decode() == MAIN


def test_comments_are_stripped_on_request_and_verbatim_is_kept(project):
    data, _ = bundle.build(project, "main.tex", READS, texts_of(project), None, strip=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        main = archive.read("main.tex").decode()
        sty = archive.read("ourmacros.sty").decode()
    assert "note to self" not in main and "trailing note" not in main
    assert "Hello 50\\% of the time. %\n" in main
    assert "\\usepackage{ourmacros}%\n" in main
    assert "% this percent is code, kept" in main
    assert sty == "\\newcommand{\\x}{x}%\n"
    assert "main.bbl" not in _


def test_strip_comments_leaves_a_line_join_as_it_was():
    assert bundle.strip_comments("a%x\nb\n% whole\n\nc") == "a%\nb\n\nc"


@pytest.mark.skipif(shutil.which("pdflatex") is None, reason="pdflatex is needed")
def test_the_bundle_builds_on_its_own(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    (root / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nHi. % gone\n\\input{two}\n\\end{document}\n",
    )
    (root / "two.tex").write_text("Two.\n")
    data, _ = bundle.build(root, "main.tex", {"main.tex", "two.tex"}, texts_of(root), None, strip=True)
    out = tmp_path / "out"
    zipfile.ZipFile(io.BytesIO(data)).extractall(out)
    subprocess.run(["pdflatex", "-interaction=nonstopmode", "main.tex"], cwd=out, capture_output=True, timeout=120)
    assert (out / "main.pdf").is_file()
