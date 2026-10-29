"""A biblatex document whose full pass never ran biber is not called clean.

With a latexmk on the PATH that had no biber beside it, a 222-page thesis
built in one pass, wrote no `.bbl`, and came back "ok" with no errors and
every citation a question mark (seen 25 October 2026). latexmk goes on
without biber and exits 0, and the engine says so only as a warning.
"""

import os
from pathlib import Path

from nexttex.compile import CompileScheduler, ProjectPaths
from nexttex.latexlog import parse

UNRESOLVED = (
    "LaTeX Warning: Citation `knuth1984' on page 1 undefined on input line 9.\n"
    "Package biblatex Warning: Please (re)run Biber on the file:\n"
    "(biblatex)                main\n"
)


def _scheduler(tmp_path: Path) -> tuple[CompileScheduler, Path]:
    (tmp_path / "main.tex").write_text("\\documentclass{article}\n", encoding="utf-8")
    paths = ProjectPaths(root=tmp_path, main=tmp_path / "main.tex", build_dir=tmp_path / "build")
    paths.build_dir.mkdir()
    (paths.build_dir / "main.bcf").write_text("<bcf/>", encoding="utf-8")
    return CompileScheduler(paths), paths.build_dir


def _log(tmp_path: Path, text: str = UNRESOLVED):
    return parse(text, tmp_path, tmp_path / "main.tex")


def test_no_biber_on_the_path_is_an_error_that_says_so(tmp_path):
    build, _ = _scheduler(tmp_path)
    why = build._biber_missing(_log(tmp_path), {"PATH": str(tmp_path / "empty")})
    assert "biber did not run" in why and "no biber on the PATH" in why


def test_a_biber_that_ran_and_wrote_nothing_points_at_its_log(tmp_path):
    build, outdir = _scheduler(tmp_path)
    tools = tmp_path / "tools"
    tools.mkdir()
    biber = tools / "biber"
    biber.write_text("#!/bin/sh\n", encoding="utf-8")
    biber.chmod(0o755)
    (outdir / "main.bbl").write_text("", encoding="utf-8")
    why = build._biber_missing(_log(tmp_path), {"PATH": str(tools)})
    assert "main.blg" in why


def test_a_bibliography_that_was_written_is_left_alone(tmp_path):
    build, outdir = _scheduler(tmp_path)
    (outdir / "main.bbl").write_text("\\begingroup\n\\endgroup\n", encoding="utf-8")
    assert build._biber_missing(_log(tmp_path), {"PATH": os.defpath}) == ""


def test_a_document_with_every_citation_resolved_is_left_alone(tmp_path):
    build, _ = _scheduler(tmp_path)
    assert build._biber_missing(_log(tmp_path, "Output written on main.pdf.\n"),
                                {"PATH": str(tmp_path)}) == ""


def test_a_bibtex_document_is_not_asked_about_biber(tmp_path):
    build, outdir = _scheduler(tmp_path)
    (outdir / "main.bcf").unlink()
    assert build._biber_missing(_log(tmp_path), {"PATH": str(tmp_path)}) == ""


import asyncio
import shutil
import subprocess

import pytest

from nexttex.compile import Outcome

LATEXMK = shutil.which("latexmk")


def _has_biblatex() -> bool:
    finder = shutil.which("kpsewhich")
    if not (LATEXMK and finder):
        return False
    found = subprocess.run([finder, "biblatex.sty"], capture_output=True, text=True)
    return bool(found.stdout.strip())


@pytest.mark.skipif(not _has_biblatex(), reason="needs latexmk and biblatex")
def test_a_real_full_pass_without_biber_comes_back_with_the_error(tmp_path, monkeypatch):
    # Every TeX program but biber, and the system's own tools for Perl.
    # The folder the binaries are in; latexmk itself is a link to a script.
    tex_bin = Path(os.path.realpath(shutil.which("kpsewhich"))).parent
    tools = tmp_path / "bin"
    tools.mkdir()
    for program in tex_bin.iterdir():
        if program.name != "biber":
            (tools / program.name).symlink_to(program)
    monkeypatch.setenv("PATH", os.pathsep.join([str(tools), "/usr/bin", "/bin"]))
    project = tmp_path / "paper"
    project.mkdir()
    (project / "main.tex").write_text(
        "\\documentclass{article}\n\\usepackage{biblatex}\n\\addbibresource{refs.bib}\n"
        "\\begin{document}\nSee \\cite{knuth1984}.\n\\printbibliography\n\\end{document}\n",
        encoding="utf-8")
    (project / "refs.bib").write_text(
        "@book{knuth1984, title={The TeXbook}, author={Knuth, Donald}, year={1984}}\n",
        encoding="utf-8")
    build = CompileScheduler(ProjectPaths(
        root=project, main=project / "main.tex", build_dir=project / "build"))

    result = asyncio.run(build.build(force_full=True))

    assert result.outcome is Outcome.ERRORS
    assert "biber did not run" in result.log.errors[0].message
