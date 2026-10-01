"""A typeset PDF of what changed since a commit (Q-048).

The stand-in `tests/fake_latexdiff.py` takes latexdiff's place, since
neither CI nor the development machine has it; what is under test is the
plumbing: the document as it was, exported from git, compared with the
document as it is, and the result built with the document's engine.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from nexttex import changes

FAKE = Path(__file__).with_name("fake_latexdiff.py")
needs_tex = pytest.mark.skipif(shutil.which("pdflatex") is None, reason="pdflatex is needed")
DOC = "\\documentclass{article}\n\\begin{document}\n{}\n\\end{document}\n"


def git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True,
    ).stdout


@pytest.fixture
def repo(tmp_path, monkeypatch):
    root = tmp_path / "paper"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.name", "t")
    git(root, "config", "user.email", "t@t")
    (root / "main.tex").write_text(DOC.replace("{}", "The fast component is in hexane."))
    git(root, "add", "-A")
    git(root, "commit", "-qm", "submitted")
    (root / "main.tex").write_text(DOC.replace("{}", "The fast component is in cyclohexane."))
    monkeypatch.setenv("NEXTTEX_LATEXDIFF", str(FAKE))
    return root


@needs_tex
def test_the_document_since_a_commit_is_built_marked(repo, monkeypatch, tmp_path):
    log = tmp_path / "latexdiff.jsonl"
    monkeypatch.setenv("NEXTTEX_FAKE_LATEXDIFF_LOG", str(log))
    sha = git(repo, "rev-parse", "HEAD").strip()
    pdf = changes.marked_up(repo, "main.tex", sha, repo / "build", "pdflatex", {})
    assert pdf.name == f"main-since-{sha[:7]}.pdf"
    assert pdf.read_bytes().startswith(b"%PDF")
    source = (repo / "build" / "changes" / f"main-since-{sha[:7]}.tex").read_text()
    assert "\\textbf{The fast component is in cyclohexane.}" in source
    # The old side came from git, not from the working tree.
    assert log.read_text().count("--flatten") == 1


def test_no_latexdiff_is_said(repo, monkeypatch):
    monkeypatch.setattr(changes, "binary", lambda: "")
    with pytest.raises(changes.ChangesError, match="latexdiff is not installed"):
        changes.marked_up(repo, "main.tex", "a" * 7, repo / "build", "pdflatex", {})


def test_a_commit_that_is_not_one_is_refused(repo):
    with pytest.raises(changes.ChangesError, match="not a commit"):
        changes.marked_up(repo, "main.tex", "--output=x", repo / "build", "pdflatex", {})


@needs_tex
def test_the_document_against_a_moment_in_history_is_built_marked(tmp_path, monkeypatch):
    """The old side is a tree History assembled, not a commit: a chapter
    that did not exist then stands empty, so it is marked as added."""
    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text(DOC.replace("{}", "In cyclohexane.\n\\input{added}"))
    (root / "added.tex").write_text("A new chapter.\n")
    monkeypatch.setenv("NEXTTEX_LATEXDIFF", str(FAKE))
    log = tmp_path / "latexdiff.jsonl"
    monkeypatch.setenv("NEXTTEX_FAKE_LATEXDIFF_LOG", str(log))
    old = {"main.tex": DOC.replace("{}", "In hexane.").encode(), "added.tex": b""}
    pdf = changes.marked_up_from(root, "main.tex", old, "20261001-143200", root / "build", "pdflatex", {})
    assert pdf.name == "main-at-20261001-143200.pdf" and pdf.is_file()
    argv = json.loads(log.read_text().splitlines()[-1])
    assert argv[0] == "--flatten" and argv[2] == str(root / "main.tex")


def test_a_moment_that_is_not_one_is_refused(tmp_path):
    with pytest.raises(changes.ChangesError):
        changes.marked_up_from(tmp_path, "main.tex", {}, "../../x", tmp_path / "b", "pdflatex", {})
