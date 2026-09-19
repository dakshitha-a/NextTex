"""The bibliography styles this TeX has."""

import shutil
import subprocess

import pytest

from nexttex import texstyles


@pytest.fixture(autouse=True)
def _fresh():
    texstyles.installed.cache_clear()
    yield
    texstyles.installed.cache_clear()


def test_without_kpsewhich_the_four_every_bibtex_has(monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda name: None)
    assert texstyles.installed() == ["abbrv", "alpha", "plain", "unsrt"]


def test_the_trees_are_walked_for_bst_files(monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    (dist / "bibtex" / "bst" / "base").mkdir(parents=True)
    (dist / "bibtex" / "bst" / "base" / "plain.bst").write_text("")
    (dist / "bibtex" / "bst" / "natbib").mkdir()
    (dist / "bibtex" / "bst" / "natbib" / "plainnat.bst").write_text("")
    (dist / "bibtex" / "bst" / "natbib" / "README").write_text("")
    home = tmp_path / "home"
    (home / "bibtex" / "bst").mkdir(parents=True)
    (home / "bibtex" / "bst" / "mine.bst").write_text("")
    answers = {"TEXMFDIST": str(dist), "TEXMFLOCAL": str(tmp_path / "nowhere"), "TEXMFHOME": str(home)}

    def fake_run(argv, **_kw):
        variable = argv[1].split("=", 1)[1]
        return subprocess.CompletedProcess(argv, 0, stdout=answers[variable] + "\n", stderr="")

    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/kpsewhich")
    monkeypatch.setattr(subprocess, "run", fake_run)
    assert texstyles.installed() == ["mine", "plain", "plainnat"]


def test_a_kpsewhich_that_fails_falls_back(monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/kpsewhich")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(OSError("no")))
    assert texstyles.installed() == list(texstyles.FALLBACK)


@pytest.mark.skipif(shutil.which("kpsewhich") is None, reason="a TeX is needed")
def test_a_real_tex_has_plain():
    assert "plain" in texstyles.installed()
