"""What the first MiKTeX build on a real Windows machine found.

On the owner's laptop on 24 September 2026 a build sat behind MiKTeX's
"Package Installation" dialog for its whole timeout; the timeout then
raised AttributeError, since Windows has no `os.killpg`, and left latexmk
running; and once the dialog was answered, MiKTeX's latexmk could not run
for want of a Perl.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from nexttex import compile as compile_mod
from nexttex import passes, proctree


# -- ending a tree ---------------------------------------------------------------

def test_windows_ends_the_whole_tree_with_taskkill():
    seen = []
    proctree.end_tree(4242, platform="win32", run=lambda argv, **k: seen.append(argv))
    assert seen == [["taskkill", "/T", "/F", "/PID", "4242"]]


def test_a_taskkill_that_cannot_run_is_quiet():
    def broken(argv, **k):
        raise OSError("no taskkill")
    proctree.end_tree(1, platform="win32", run=broken)


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX process groups")
def test_posix_ends_the_group_and_a_gone_process_is_quiet():
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
    proctree.end_tree(child.pid)
    assert child.wait(timeout=10) != 0
    proctree.end_tree(child.pid, hard=True)     # already gone


def _proc(tmp_path, parents):
    """A fake `/proc` where each pid has the parent given."""
    for pid, parent in parents.items():
        (tmp_path / str(pid)).mkdir()
        (tmp_path / str(pid) / "stat").write_text(f"{pid} (a) b) S {parent} 1 1 0", encoding="utf-8")
    (tmp_path / "self").mkdir()
    return str(tmp_path)


def test_descendants_are_walked_nearest_first_and_a_name_with_brackets_is_read(tmp_path):
    proc = _proc(tmp_path, {10: 1, 11: 10, 12: 10, 13: 11, 14: 13, 20: 1})
    assert proctree.descendants(10, proc=proc) == [11, 12, 13, 14]
    assert proctree.descendants(20, proc=proc) == []
    assert proctree.descendants(10, proc=str(tmp_path / "missing")) == []


def test_the_runner_keeps_descendants_on_linux_and_leaves_macos_alone():
    from nexttex import script_runner

    assert script_runner._keep_descendants("darwin") == ""
    if sys.platform.startswith("linux"):
        # In a throwaway child, so this test process does not become a
        # subreaper for the rest of the suite.
        code = "from nexttex import script_runner; print(script_runner._keep_descendants())"
        said = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30)
        assert said.stdout.strip() == "subreaper"


# -- never a window: MiKTeX's own installer ---------------------------------------

def paths(tmp_path):
    main = tmp_path / "main.tex"
    main.write_text("x", encoding="utf-8")
    return compile_mod.ProjectPaths(root=tmp_path, main=main, build_dir=tmp_path / "build")


def test_miktex_engines_are_told_not_to_install_on_the_fly(tmp_path):
    scheduler = compile_mod.CompileScheduler(paths(tmp_path))
    fast = scheduler.fast_argv(tmp_path / "main.tex", "pdflatex", miktex=True)
    assert fast[:2] == ["pdflatex", "--disable-installer"]
    full = scheduler.full_argv(tmp_path / "main.tex", "pdflatex", miktex=True)
    assert any("pdflatex --disable-installer" in part for part in full)
    # And nothing changes for TeX Live.
    assert "--disable-installer" not in " ".join(scheduler.fast_argv(tmp_path / "main.tex"))


def test_which_engine_is_miktex_and_whether_there_is_perl(tmp_path):
    bin_dir = tmp_path / "MiKTeX" / "miktex" / "bin" / "x64"
    bin_dir.mkdir(parents=True)
    engine = bin_dir / "pdflatex"
    engine.write_text("#!/bin/sh\n")
    engine.chmod(0o755)
    env = {"PATH": str(bin_dir)}
    assert compile_mod.is_miktex("pdflatex", env)
    assert not compile_mod.has_perl(env)
    assert not compile_mod.is_miktex("pdflatex", {"PATH": str(tmp_path)})


# -- the passes, without latexmk ----------------------------------------------------

class Fake:
    """An engine and its helpers that leave what a real run would."""

    def __init__(self, outdir: Path, *, bcf=False, bibdata=False, reruns=0):
        self.outdir, self.bcf, self.bibdata, self.reruns = outdir, bcf, bibdata, reruns
        self.calls: list[str] = []

    def __call__(self, argv, cwd):
        name = Path(argv[0]).name
        self.calls.append(name)
        if name == "pdflatex":
            engine_runs = self.calls.count("pdflatex")
            (self.outdir / "main.aux").write_text("\\bibdata{refs}" if self.bibdata else "")
            if self.bcf:
                (self.outdir / "main.bcf").write_text("<bcf/>")
            asks = engine_runs <= self.reruns
            (self.outdir / "main.log").write_text("LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right." if asks else "Output written")
        return 0


@pytest.mark.parametrize("kind,expected", [
    ({}, ["pdflatex"]),
    ({"bibdata": True}, ["pdflatex", "bibtex", "pdflatex"]),
    ({"bcf": True}, ["pdflatex", "biber", "pdflatex"]),
    ({"reruns": 2}, ["pdflatex", "pdflatex", "pdflatex"]),
    ({"reruns": 10}, ["pdflatex"] * passes.MAX_RUNS),
    ({"bibdata": True, "reruns": 2}, ["pdflatex", "bibtex", "pdflatex", "pdflatex"]),
])
def test_the_passes_are_latexmks(tmp_path, kind, expected):
    fake = Fake(tmp_path, **kind)
    passes.build(["pdflatex", "main.tex"], tmp_path, "main", fake)
    assert fake.calls == expected


def test_a_miktex_machine_without_perl_builds_through_the_passes(tmp_path, monkeypatch):
    """The whole command, as the scheduler would start it."""
    scheduler = compile_mod.CompileScheduler(paths(tmp_path))
    monkeypatch.setattr(compile_mod, "is_miktex", lambda engine, env: True)
    monkeypatch.setattr(compile_mod, "has_perl", lambda env: False)
    started = {}

    async def fake_exec(*argv, **kwargs):
        started["argv"], started["env"] = argv, kwargs["env"]
        raise FileNotFoundError

    monkeypatch.setattr(compile_mod.asyncio, "create_subprocess_exec", fake_exec)
    import asyncio
    asyncio.run(scheduler.build(force_full=True))
    argv = started["argv"]
    assert argv[1:3] == ("-m", "nexttex.passes")
    assert "--disable-installer" in argv
    assert str(compile_mod.ROOT) in started["env"]["PYTHONPATH"].split(os.pathsep)
