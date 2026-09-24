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

import json
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


@pytest.fixture
def state(tmp_path, monkeypatch):
    """A state directory of its own, so `config.json` is this test's."""
    home = tmp_path / "state"
    home.mkdir()
    monkeypatch.setattr("nexttex.paths.state_home", lambda: home)
    return home


def test_what_the_installer_recorded_wins_over_the_list(tmp_path, monkeypatch,
                                                        clean_path, state):
    """The cure the backlog asked for: nobody sets a variable to get the TeX
    they asked the installer for. A machine that had a TinyTeX before and
    was given MiKTeX on request builds with the MiKTeX."""
    tinytex = a_tex(tmp_path / "TinyTeX" / "bin", "pdflatex", "latexmk", "synctex",
                    "biber", "chktex", "texcount")
    miktex = a_tex(tmp_path / "MiKTeX" / "bin", "pdflatex")
    monkeypatch.setattr(tools, "TEX_HINTS", [tinytex, miktex])
    (state / "config.json").write_text(json.dumps({"tex": str(miktex)}))

    assert tools.recorded_tex_dir() == miktex
    assert tools.ensure_tex_on_path() == miktex


def test_a_named_tex_still_beats_the_recorded_one(tmp_path, monkeypatch,
                                                  clean_path, state):
    recorded = a_tex(tmp_path / "recorded", "pdflatex")
    named = a_tex(tmp_path / "named", "pdflatex")
    monkeypatch.setattr(tools, "TEX_HINTS", [recorded, named])
    (state / "config.json").write_text(json.dumps({"tex": str(recorded)}))
    monkeypatch.setenv("NEXTTEX_TEX", str(named))

    assert tools.ensure_tex_on_path() == named


def test_nothing_recorded_changes_nothing(tmp_path, monkeypatch, clean_path, state):
    rich = a_tex(tmp_path / "rich", "pdflatex", "latexmk")
    poor = a_tex(tmp_path / "poor", "pdflatex")
    monkeypatch.setattr(tools, "TEX_HINTS", [poor, rich])
    (state / "config.json").write_text(json.dumps({"tex": ""}))

    assert tools.recorded_tex_dir() is None
    assert tools.ensure_tex_on_path() == rich


def test_a_chosen_tex_already_on_path_behind_another_moves_in_front(
        tmp_path, monkeypatch, clean_path, state):
    """The laptop's shape: MiKTeX on the user's PATH, behind a TinyTeX. A
    choice that is only prepended when absent left it where it was, and
    the engine came from the TinyTeX."""
    tinytex = a_tex(tmp_path / "TinyTeX" / "bin", "pdflatex", "latexmk")
    miktex = a_tex(tmp_path / "MiKTeX" / "bin", "pdflatex")
    monkeypatch.setattr(tools, "TEX_HINTS", [tinytex])
    monkeypatch.setenv("PATH", os.pathsep.join([str(tinytex), str(miktex)]))
    monkeypatch.setenv("NEXTTEX_TEX", str(miktex))

    assert tools.ensure_tex_on_path() == miktex
    assert os.environ["PATH"].split(os.pathsep)[0] == str(miktex)


def test_the_installer_records_the_distribution_it_installed(tmp_path, monkeypatch, state):
    from nexttex.install import __main__ as installer

    miktex = a_tex(tmp_path / "AppData" / "Local" / "Programs" / "MiKTeX" / "bin", "pdflatex")
    tinytex = a_tex(tmp_path / "AppData" / "Roaming" / "TinyTeX" / "bin", "pdflatex")
    monkeypatch.setattr(tools, "TEX_HINTS", [tinytex, miktex])
    monkeypatch.setattr("nexttex.config.state_home", lambda: state)

    installer._record_tex("miktex")

    assert json.loads((state / "config.json").read_text())["tex"] == str(miktex)
