"""Mapping a missing file to its package, and installing it.

The stand-in for tlmgr is a fake `create_subprocess_exec`, as in
`test_plots.py`, fed with output copied from a real `tlmgr search
--file --global` on this machine rather than typed.
"""

import asyncio

import pytest

from nexttex import texpkg
from nexttex.explain import annotate, missing_file

SEARCH_MINTED = """\
tlmgr: package repository https://mirrors.rit.edu/CTAN/systems/texlive/tlnet (verified)
minted:
\ttexmf-dist/tex/latex/minted/minted.sty
tex4ht:
\ttexmf-dist/tex/generic/tex4ht/minted-sty-hooks.4ht
"""

SEARCH_DOC_FIRST = """\
tlmgr: package repository https://example.org/tlnet (verified)
somedoc:
\ttexmf-dist/doc/latex/somedoc/thing.sty
thing:
\ttexmf-dist/tex/latex/thing/thing.sty
"""


class Done:
    def __init__(self, code: int, output: bytes):
        self.returncode = code
        self._output = output

    async def communicate(self):
        return self._output, b""

    def kill(self):
        pass


def fake_tlmgr(monkeypatch, answers: dict[tuple[str, ...], tuple[int, str]]):
    """A tlmgr that answers by its argv tail, recording every call."""
    seen: list[list[str]] = []

    async def fake_exec(*argv, **_):
        seen.append(list(argv))
        for tail, (code, output) in answers.items():
            if tuple(argv[-len(tail):]) == tail:
                return Done(code, output.encode())
        return Done(1, "unexpected")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setenv("NEXTTEX_TLMGR", "/fake/tlmgr")
    monkeypatch.setattr(texpkg, "_KNOWN", {})
    return seen


# -- the search --------------------------------------------------------------

def test_the_package_is_the_one_whose_path_ends_in_the_file_under_a_tex_tree():
    assert texpkg.parse_search(SEARCH_MINTED, "minted.sty") == "minted"


def test_a_documentation_tree_does_not_win_over_the_package_itself():
    assert texpkg.parse_search(SEARCH_DOC_FIRST, "thing.sty") == "thing"


def test_nothing_answers_for_a_file_no_package_provides():
    assert texpkg.parse_search("tlmgr: package repository x (verified)\n", "nothere.sty") == ""


def test_the_search_is_one_call_and_its_answer_is_remembered(monkeypatch):
    seen = fake_tlmgr(monkeypatch, {("search", "--file", "--global", "/minted.sty"): (0, SEARCH_MINTED)})
    first = asyncio.run(texpkg.package_for_file("minted.sty"))
    second = asyncio.run(texpkg.package_for_file("minted.sty"))
    assert first == {"file": "minted.sty", "package": "minted", "manager": "tlmgr"}
    assert second == first
    assert len(seen) == 1, "the drawer re-renders on every build and must not ask the mirror each time"
    assert seen[0][0] == "/fake/tlmgr"


@pytest.mark.parametrize("bad", ["../x.sty", "a b.sty", "--help", "x.png", "x"])
def test_a_name_that_is_not_a_file_a_package_could_provide_is_not_searched(monkeypatch, bad):
    seen = fake_tlmgr(monkeypatch, {})
    assert asyncio.run(texpkg.package_for_file(bad)) == {"file": bad, "package": "", "manager": ""}
    assert seen == []


def test_a_search_that_fails_answers_nothing_rather_than_raising(monkeypatch):
    fake_tlmgr(monkeypatch, {("search", "--file", "--global", "/x.sty"): (1, "tlmgr: no repository")})
    assert asyncio.run(texpkg.package_for_file("x.sty"))["package"] == ""


def test_a_search_that_hangs_is_given_up_on(monkeypatch):
    class Never:
        returncode = None

        async def communicate(self):
            await asyncio.sleep(60)

        def kill(self):
            pass

    async def fake_exec(*argv, **_):
        return Never()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setenv("NEXTTEX_TLMGR", "/fake/tlmgr")
    monkeypatch.setattr(texpkg, "_KNOWN", {})
    monkeypatch.setattr(texpkg, "SEARCH_TIMEOUT", 0.05)
    assert asyncio.run(texpkg.package_for_file("x.sty"))["package"] == ""


def test_no_manager_means_no_button(monkeypatch):
    monkeypatch.delenv("NEXTTEX_TLMGR", raising=False)
    monkeypatch.setattr(texpkg.shutil, "which", lambda name, path=None: None)
    monkeypatch.setattr(texpkg, "_KNOWN", {})
    assert asyncio.run(texpkg.package_for_file("x.sty")) == {"file": "x.sty", "package": "", "manager": ""}


# -- the install ---------------------------------------------------------------

def test_an_install_runs_the_manager_with_the_package_and_nothing_else(monkeypatch):
    seen = fake_tlmgr(monkeypatch, {("install", "minted"): (0, "tlmgr: package log updated")})
    assert asyncio.run(texpkg.install("minted")) == {"ok": True, "err": ""}
    assert seen == [["/fake/tlmgr", "install", "minted"]]


@pytest.mark.parametrize("bad", ["--repository=http://evil", "a; rm -rf /", "../x", "a b", ""])
def test_anything_that_is_not_a_package_name_is_refused_before_the_manager_sees_it(monkeypatch, bad):
    seen = fake_tlmgr(monkeypatch, {})
    result = asyncio.run(texpkg.install(bad))
    assert result["ok"] is False and "not a package name" in result["err"]
    assert seen == []


def test_a_failing_install_returns_the_managers_own_words(monkeypatch):
    """A TinyTeX behind its mirror says "remote repository is newer than
    local", and the writer needs to read that rather than "failed"."""
    stale = (
        "tlmgr: Remote repository is newer than local (2025 < 2026)\n"
        "Cross release updates are only supported with\n"
        "  update-tlmgr-latest(.sh/.exe) --update\n"
    )
    fake_tlmgr(monkeypatch, {("install", "minted"): (1, stale)})
    result = asyncio.run(texpkg.install("minted"))
    assert result["ok"] is False
    assert "Remote repository is newer than local" in result["err"]


def test_an_install_that_hangs_is_given_up_on(monkeypatch):
    class Never:
        returncode = None

        async def communicate(self):
            await asyncio.sleep(60)

        def kill(self):
            pass

    async def fake_exec(*argv, **_):
        return Never()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setenv("NEXTTEX_TLMGR", "/fake/tlmgr")
    monkeypatch.setattr(texpkg, "INSTALL_TIMEOUT", 0.05)
    result = asyncio.run(texpkg.install("minted"))
    assert result["ok"] is False and "five minutes" in result["err"]


# -- the row's name for the file ----------------------------------------------

@pytest.mark.parametrize("message,expected", [
    ("! LaTeX Error: File `mhchem.sty' not found.", "mhchem.sty"),
    ("! LaTeX Error: File `acmart.cls' not found.", "acmart.cls"),
    ("! LaTeX Error: File `t1phv.fd' not found.", "t1phv.fd"),
    ("! LaTeX Error: File `figures/plot.png' not found.", ""),
    ("! LaTeX Error: File `chapters/one.tex' not found.", ""),
    ("! Undefined control sequence.", ""),
])
def test_the_missing_file_is_named_only_when_a_package_could_provide_it(message, expected):
    assert missing_file(message) == expected


def test_the_row_carries_the_missing_file_beside_its_explanation():
    rows = annotate([
        {"severity": "error", "message": "! LaTeX Error: File `mhchem.sty' not found."},
        {"severity": "error", "message": "! Undefined control sequence."},
    ])
    assert rows[0]["missingFile"] == "mhchem.sty"
    assert rows[0]["explain"]["title"] == "A package that is not installed"
    assert "missingFile" not in rows[1]


# -- which TeX's manager ---------------------------------------------------------

def _bin(tmp_path, name: str, *tools: str):
    directory = tmp_path / name
    directory.mkdir()
    for tool in tools:
        path = directory / tool
        path.write_text("#!/bin/sh\n")
        path.chmod(0o755)
    return directory


def test_the_manager_is_the_one_beside_the_recorded_tex_not_the_first_on_path(tmp_path, monkeypatch):
    """The owner's laptop on 24 September 2026: MiKTeX chosen and
    recorded, TinyTeX still installed and first on PATH. The button must
    install into MiKTeX, with its current console, not into TinyTeX."""
    tinytex = _bin(tmp_path, "tinytex", "tlmgr", "pdflatex")
    miktex = _bin(tmp_path, "miktex", "miktex", "pdflatex")
    monkeypatch.delenv("NEXTTEX_TLMGR", raising=False)
    monkeypatch.delenv("NEXTTEX_TEX", raising=False)
    monkeypatch.setenv("PATH", f"{tinytex}:{miktex}")
    monkeypatch.setattr(texpkg.tools, "recorded_tex_dir", lambda: miktex)
    assert texpkg.manager_here() == ("miktex", str(miktex / "miktex"))


def test_with_nothing_recorded_the_manager_follows_the_engine(tmp_path, monkeypatch):
    miktex = _bin(tmp_path, "miktex", "mpm", "pdflatex")
    elsewhere = _bin(tmp_path, "elsewhere", "tlmgr")
    monkeypatch.delenv("NEXTTEX_TLMGR", raising=False)
    monkeypatch.delenv("NEXTTEX_TEX", raising=False)
    monkeypatch.setenv("PATH", f"{elsewhere}:{miktex}")
    monkeypatch.setattr(texpkg.tools, "recorded_tex_dir", lambda: None)
    assert texpkg.manager_here() == ("mpm", str(miktex / "mpm"))


def test_a_tex_with_no_manager_of_its_own_falls_back_to_path(tmp_path, monkeypatch):
    bare = _bin(tmp_path, "bare", "pdflatex")
    other = _bin(tmp_path, "other", "tlmgr")
    monkeypatch.delenv("NEXTTEX_TLMGR", raising=False)
    monkeypatch.delenv("NEXTTEX_TEX", raising=False)
    monkeypatch.setenv("PATH", f"{bare}:{other}")
    monkeypatch.setattr(texpkg.tools, "recorded_tex_dir", lambda: None)
    assert texpkg.manager_here() == ("tlmgr", str(other / "tlmgr"))


@pytest.mark.parametrize("kind,argv", [
    ("tlmgr", ["/t/tlmgr", "install", "lipsum"]),
    ("miktex", ["/t/tlmgr", "packages", "install", "lipsum"]),
    ("mpm", ["/t/tlmgr", "--install=lipsum"]),
])
def test_each_manager_is_asked_in_its_own_words(kind, argv):
    assert texpkg.install_argv(kind, "/t/tlmgr", "lipsum") == argv


def test_miktex_is_given_the_files_stem_without_a_search(monkeypatch):
    seen = fake_tlmgr(monkeypatch, {})
    monkeypatch.setattr(texpkg, "manager_here", lambda: ("miktex", "/m/miktex"))
    assert asyncio.run(texpkg.package_for_file("lipsum.sty")) == {
        "file": "lipsum.sty", "package": "lipsum", "manager": "miktex",
    }
    assert seen == []


def test_an_install_that_hangs_ends_its_whole_tree(monkeypatch):
    """`tlmgr.bat` is a shell running Perl; killing the shell alone left
    the Perl holding tlmgr's lock."""
    ended = []

    class Never:
        returncode = None
        pid = 4242

        async def communicate(self):
            await asyncio.sleep(60)

        def kill(self):
            pass

    async def fake_exec(*argv, **_):
        return Never()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(texpkg, "end_tree", lambda pid, hard=False: ended.append((pid, hard)))
    monkeypatch.setenv("NEXTTEX_TLMGR", "/fake/tlmgr")
    monkeypatch.setattr(texpkg, "INSTALL_TIMEOUT", 0.05)
    assert asyncio.run(texpkg.install("minted"))["ok"] is False
    assert ended == [(4242, True)]


def test_the_advice_names_both_distributions_managers():
    rows = annotate([{"severity": "error", "message": "! LaTeX Error: File `lipsum.sty' not found."}])
    fix = rows[0]["explain"]["fix"]
    assert "tlmgr install" in fix and "miktex packages install" in fix
    assert "For TinyTeX that is" not in fix
