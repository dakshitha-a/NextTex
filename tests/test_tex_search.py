"""Which TeX a machine with two of them compiles with.

NextTex finds TeX by looking in a fixed list of the places distributions
put themselves, because PATH alone is not enough: TinyTeX does not put its
bin directory on PATH, and a server started by a logon task inherits a
PATH that a terminal's does not have. The list is in a fixed order.

On a machine with two TeXs that order decides, and it decided wrongly. A
real install on 23 September 2026 had MiKTeX put there by NextTex's own
installer, at the writer's explicit request, and compiled with the TinyTeX
that happened to already be there, because TinyTeX is four lines earlier
in the list. Asking for MiKTeX installed MiKTeX and changed nothing about
what ran.

Two faults, and this file covers both.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from nexttex import tools


def a_tex(directory: Path, *names: str) -> Path:
    """A directory that looks like a TeX installation's bin."""
    directory.mkdir(parents=True, exist_ok=True)
    for name in names:
        (directory / name).write_text("#!/bin/sh\n", encoding="utf-8")
        (directory / name).chmod(0o755)
    return directory


@pytest.fixture
def clean_path(monkeypatch):
    monkeypatch.setenv("PATH", "/nowhere-at-all")
    monkeypatch.delenv("NEXTTEX_TEX", raising=False)


def test_the_richest_directory_goes_in_front(tmp_path, monkeypatch, clean_path):
    """The docstring said richest first and the code did the opposite.

    Prepending one directory at a time reverses the order they are given
    in: the first one prepended ends up behind every one prepended after
    it. So the *poorest* directory was first on PATH, and on a machine
    with two TeXs that inversion alone decided which one ran.
    """
    poor = a_tex(tmp_path / "poor", "pdflatex")
    rich = a_tex(tmp_path / "rich", "pdflatex", "latexmk", "synctex", "biber")
    monkeypatch.setattr(tools, "TEX_HINTS", [poor, rich])

    found = tools.ensure_tex_on_path()
    assert found == rich, "the poorer TeX won, which is the inversion"
    assert os.environ["PATH"].split(os.pathsep)[0] == str(rich)


def test_a_named_tex_wins_however_poor_it_looks(tmp_path, monkeypatch, clean_path):
    """Naming one is the answer to the question, not an opinion about it.

    A basic MiKTeX carries fewer of the tools this counts than a TinyTeX
    with the extras added, so richness alone would still have picked the
    one the writer did not ask for.
    """
    rich = a_tex(tmp_path / "tinytex", "pdflatex", "latexmk", "synctex", "biber",
                 "chktex", "texcount")
    named = a_tex(tmp_path / "miktex", "pdflatex")
    monkeypatch.setattr(tools, "TEX_HINTS", [rich, named])
    monkeypatch.setenv("NEXTTEX_TEX", str(named))

    assert tools.named_tex_dir() == named
    found = tools.ensure_tex_on_path()
    assert found == named, "the TeX that was asked for did not win"


def test_a_name_that_is_not_a_directory_is_ignored(tmp_path, monkeypatch, clean_path):
    """A stale variable must not take TeX away from a machine that has one."""
    rich = a_tex(tmp_path / "tinytex", "pdflatex", "latexmk")
    monkeypatch.setattr(tools, "TEX_HINTS", [rich])
    monkeypatch.setenv("NEXTTEX_TEX", str(tmp_path / "not-here"))

    assert tools.named_tex_dir() is None
    assert tools.ensure_tex_on_path() == rich


def test_no_tex_anywhere_is_still_none(tmp_path, monkeypatch, clean_path):
    monkeypatch.setattr(tools, "TEX_HINTS", [tmp_path / "empty"])
    assert tools.ensure_tex_on_path() is None
