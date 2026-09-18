"""Which engine a document is built with.

pdflatex was the only engine for a long time, hardcoded in both argv
builders.  A paper in a non-Latin script or one whose venue hands out a
font needs fontspec, and fontspec needs XeTeX or LuaTeX, so a document can
now say which engine it wants: the `% !TeX program` line every other
editor honours, then the project's `engine` key, then pdflatex.
"""

import asyncio
import shutil
from pathlib import Path

import pytest

from nexttex.compile import (
    ENGINES,
    CompileScheduler,
    Outcome,
    ProjectPaths,
    engine_for,
    engine_in,
)
from nexttex.project import ProjectConfig


def paths_in(tmp_path: Path) -> ProjectPaths:
    return ProjectPaths(
        root=tmp_path, main=tmp_path / "main.tex", build_dir=tmp_path / "build"
    )


# -- reading the choice --------------------------------------------------

@pytest.mark.parametrize("line,expected", [
    ("% !TeX program = xelatex", "xelatex"),
    ("%!TEX program=lualatex", "lualatex"),
    ("% !TeX TS-program = XeLaTeX", "xelatex"),
    ("%  ! TeX  program  =  pdflatex", "pdflatex"),
    ("% !TeX program = typst", ""),
    ("% !TeX root = main.tex", ""),
    ("", ""),
])
def test_the_magic_comment_is_read_in_every_spelling_editors_use(line, expected):
    assert engine_in(line + "\n\\documentclass{article}\n") == expected


def test_a_magic_comment_deep_in_the_file_does_not_count():
    """The first lines are where every editor looks, and where a writer
    puts it on purpose; a line quoted in a comment forty lines down is
    somebody's note, not a choice."""
    text = "\\documentclass{article}\n" + "% filler\n" * 30 + "% !TeX program = xelatex\n"
    assert engine_in(text) == ""


def test_the_comment_wins_over_the_setting_and_the_setting_over_the_default():
    assert engine_for("% !TeX program = lualatex\n", "xelatex") == "lualatex"
    assert engine_for("\\documentclass{article}\n", "xelatex") == "xelatex"
    assert engine_for("\\documentclass{article}\n", "") == "pdflatex"
    # A setting that names nothing NextTex runs is the default, not an error.
    assert engine_for("\\documentclass{article}\n", "typst") == "pdflatex"


# -- the command lines ----------------------------------------------------

@pytest.mark.parametrize("engine,mode,command", [
    ("pdflatex", "-pdf", "-pdflatex"),
    ("xelatex", "-pdfxe", "-pdfxelatex"),
    ("lualatex", "-pdflua", "-pdflualatex"),
])
def test_the_full_pass_names_the_engine_twice_the_way_latexmk_wants(tmp_path, engine, mode, command):
    """latexmk 4.88: a mode switch picks the engine and an option says how
    to run it, and the inner flags, synctex included, are the same for all
    three."""
    argv = CompileScheduler(paths_in(tmp_path)).full_argv(tmp_path / "main.tex", engine)
    assert argv[:2] == ["latexmk", mode]
    inner = [a for a in argv if a.startswith(f"{command}=")]
    assert inner == [
        f"{command}={engine} -synctex=1 -interaction=nonstopmode -file-line-error %O %S"
    ]
    assert not any(a.startswith("-pdflatex=") for a in argv if command != "-pdflatex")


@pytest.mark.parametrize("engine", ENGINES)
def test_the_fast_pass_is_one_run_of_the_chosen_engine(tmp_path, engine):
    argv = CompileScheduler(paths_in(tmp_path)).fast_argv(tmp_path / "main.tex", engine)
    assert argv[0] == engine
    assert "-synctex=1" in argv


def test_the_engine_is_asked_for_at_each_build_not_copied_at_construction(tmp_path):
    """The settings card changes the project's config in place; the
    scheduler reads it through a callable so the next build sees the
    change without a restart."""
    config = ProjectConfig(engine="")
    build = CompileScheduler(paths_in(tmp_path), engine_setting=lambda: config.engine)
    assert engine_for("", build.engine_setting()) == "pdflatex"
    config.engine = "lualatex"
    assert engine_for("", build.engine_setting()) == "lualatex"


# -- the project's key ------------------------------------------------------

def test_the_engine_key_round_trips_through_the_toml(tmp_path):
    config = ProjectConfig(name="T", engine="xelatex")
    config.save(tmp_path)
    text = (tmp_path / "nexttex.toml").read_text(encoding="utf-8")
    assert 'engine = "xelatex"' in text
    assert ProjectConfig.load(tmp_path).engine == "xelatex"


def test_no_engine_key_is_written_for_the_default(tmp_path):
    ProjectConfig(name="T").save(tmp_path)
    assert "engine" not in (tmp_path / "nexttex.toml").read_text(encoding="utf-8")


def test_an_engine_nextTex_does_not_run_is_read_as_the_default(tmp_path):
    """A malformed value must not make the project unopenable, and a value
    from an editor with more engines than this one is not malformed."""
    (tmp_path / "nexttex.toml").write_text(
        '[project]\nname = "T"\nengine = "Typst"\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).engine == ""


# -- a real build ----------------------------------------------------------

needs_xelatex = pytest.mark.skipif(
    shutil.which("xelatex") is None, reason="xelatex is needed"
)


def fontspec_project(root: Path, first_line: str = "") -> ProjectPaths:
    (root / "main.tex").write_text(
        (first_line + "\n" if first_line else "")
        + "\\documentclass{article}\n"
        "\\usepackage{fontspec}\n"
        "\\begin{document}\n"
        "Hello.\n"
        "\\end{document}\n",
        encoding="utf-8",
    )
    return paths_in(root)


@needs_xelatex
def test_a_fontspec_document_builds_under_xelatex_when_its_first_line_asks(tmp_path):
    paths = fontspec_project(tmp_path, "% !TeX program = xelatex")
    result = asyncio.run(CompileScheduler(paths).build())
    assert result.engine == "xelatex"
    assert result.outcome is Outcome.OK, result.log.raw_tail if result.log else result
    assert paths.pdf.exists()
    assert result.as_dict()["engine"] == "xelatex"


@pytest.mark.skipif(shutil.which("pdflatex") is None, reason="pdflatex is needed")
def test_the_same_document_under_pdflatex_is_explained_not_just_failed(tmp_path):
    """The drawer's rule keys on fontspec's own message, taken from a real
    log rather than typed."""
    from nexttex.explain import explain

    paths = fontspec_project(tmp_path)
    result = asyncio.run(CompileScheduler(paths).build())
    assert result.engine == "pdflatex"
    assert result.outcome is Outcome.ERRORS
    messages = [d.message for d in result.log.errors]
    found = [explain(m) for m in messages]
    assert any(f and f["title"] == "This package needs xelatex or lualatex" for f in found), messages


def test_changing_the_engine_makes_the_next_build_a_full_one(tmp_path, monkeypatch):
    """The `.aux` files of one engine are not the other's; a fast pass
    over them can leave stale numbers, so the switch is a full pass."""
    paths = fontspec_project(tmp_path)
    config = ProjectConfig(engine="pdflatex")
    build = CompileScheduler(paths, engine_setting=lambda: config.engine)
    seen: list[list[str]] = []

    class Done:
        returncode = 0
        pid = 0

        async def wait(self):
            return 0

    async def fake_exec(*argv, **_):
        seen.append(list(argv))
        return Done()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    asyncio.run(build.build())          # the first build is always full
    build._needs_full = False
    asyncio.run(build.build())
    assert seen[-1][0] == "pdflatex", "a quiet second build is a fast pass"
    config.engine = "xelatex"
    asyncio.run(build.build())
    assert seen[-1][0] == "latexmk" and "-pdfxe" in seen[-1]


# -- the engine's version ---------------------------------------------------

def test_the_engines_version_is_asked_once_per_process_and_rides_on_every_result(tmp_path, monkeypatch):
    from nexttex import compile as build_module

    calls: list[list[str]] = []

    class Out:
        stdout = "pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)\nkpathsea version 6.4.2\n"
        stderr = ""

    def fake_run(argv, **_):
        calls.append(list(argv))
        return Out()

    monkeypatch.setattr(build_module, "_VERSIONS", {})
    monkeypatch.setattr(build_module.subprocess, "run", fake_run)
    assert build_module.engine_version("pdflatex") == "pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)"
    assert build_module.engine_version("pdflatex").startswith("pdfTeX")
    assert calls == [["pdflatex", "--version"]]

    (tmp_path / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}x\\end{document}\n", encoding="utf-8"
    )

    class Done:
        returncode = 0
        pid = 0

        async def wait(self):
            return 0

    async def fake_exec(*argv, **_):
        return Done()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    build = CompileScheduler(paths_in(tmp_path))
    result = asyncio.run(build.build())
    assert result.as_dict()["engineVersion"] == "pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)"
    asyncio.run(build.build())
    assert len(calls) == 1, "a second build must not spawn a second --version"


def test_an_engine_that_cannot_be_run_has_no_version_and_no_error(monkeypatch):
    from nexttex import compile as build_module

    monkeypatch.setattr(build_module, "_VERSIONS", {})
    assert build_module.engine_version("no-such-engine-here") == ""
