"""A build that is stopped part way leaves the build directory as it found it.

A newer build cancels the one in flight, and the pdflatex it kills stops
wherever it was, which on 27 and 28 September 2026 was four times half way
through an `.aux`: "File ended while scanning use of \\@newl@bel", and once
a bibtex run over the short file that wrote an empty `.bbl` every later
build kept. The files one pass hands the next are now held before the
engine starts and put back when the build is cancelled or times out.
"""

import asyncio
import os
import sys
import time
from pathlib import Path

from nexttex import compile as build_module
from nexttex.compile import CompileScheduler, Outcome, ProjectPaths, job_files

#: An engine that starts rewriting the job's `.aux`, writes a `.toc` the
#: last pass never had, and then hangs until it is killed.
HALF_WRITTEN = (
    "import pathlib, sys, time\n"
    "build = pathlib.Path(sys.argv[1])\n"
    "handle = open(build / 'main.aux', 'w')\n"
    "handle.write('\\\\relax\\n\\\\newlabel{sec:half}{{1}{')\n"
    "handle.flush()\n"
    "(build / 'main.toc').write_text('torn')\n"
    "(build / 'started').write_text('')\n"
    "time.sleep(60)\n"
)

WHOLE_AUX = "\\relax\n\\newlabel{sec:one}{{1}{1}}\n\\gdef \\@abspage@last{1}\n"


def _scheduler(tmp_path: Path, monkeypatch) -> CompileScheduler:
    (tmp_path / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}x\\end{document}\n",
        encoding="utf-8",
    )
    build = tmp_path / "build"
    build.mkdir()
    engine = tmp_path / "engine.py"
    engine.write_text(HALF_WRITTEN, encoding="utf-8")
    argv = [sys.executable, str(engine), str(build)]
    monkeypatch.setattr(CompileScheduler, "full_argv", lambda self, *a, **k: argv)
    monkeypatch.setattr(CompileScheduler, "fast_argv", lambda self, *a, **k: argv)
    monkeypatch.setattr(build_module, "_VERSIONS", {"pdflatex": "pdfTeX"})
    return CompileScheduler(ProjectPaths(root=tmp_path, main=tmp_path / "main.tex", build_dir=build))


def test_a_cancelled_build_puts_the_aux_back(tmp_path, monkeypatch):
    scheduler = _scheduler(tmp_path, monkeypatch)
    build = tmp_path / "build"
    (build / "main.aux").write_text(WHOLE_AUX, encoding="utf-8")
    (build / "main.bbl").write_text("\\begin{thebibliography}{1}\n", encoding="utf-8")
    # The other document in the same build directory, and a job whose
    # name only starts with this one's.
    (build / "si.aux").write_text("si's own\n", encoding="utf-8")
    (build / "main.v2.aux").write_text("another job\n", encoding="utf-8")

    async def start_then_cancel():
        running = asyncio.ensure_future(scheduler.build())
        deadline = time.monotonic() + 20
        while not (build / "started").exists():
            assert time.monotonic() < deadline, "the stand-in engine never started"
            await asyncio.sleep(0.02)
        assert (build / "main.aux").read_text(encoding="utf-8") != WHOLE_AUX
        scheduler._generation += 1      # what a newer build does first
        await scheduler.cancel()
        return await running

    result = asyncio.run(start_then_cancel())

    assert result.outcome is Outcome.CANCELLED
    assert (build / "main.aux").read_text(encoding="utf-8") == WHOLE_AUX
    assert (build / "main.bbl").read_text(encoding="utf-8").startswith("\\begin")
    assert not (build / "main.toc").exists(), "a file the cancelled pass began stayed"
    assert (build / "si.aux").read_text(encoding="utf-8") == "si's own\n"
    assert (build / "main.v2.aux").read_text(encoding="utf-8") == "another job\n"


def test_cancel_returns_only_once_the_engine_itself_has_gone(tmp_path, monkeypatch):
    """latexmk going is not pdflatex going; until the engine has, the next
    build would open the `.aux` it still holds open."""
    scheduler = _scheduler(tmp_path, monkeypatch)
    build = tmp_path / "build"
    seen: list[int] = []

    async def start_then_cancel():
        running = asyncio.ensure_future(scheduler.build())
        while not (build / "started").exists():
            await asyncio.sleep(0.02)
        seen.append(scheduler._process.pid)
        scheduler._generation += 1
        await scheduler.cancel()
        return await running

    asyncio.run(start_then_cancel())

    assert not build_module._alive(seen[0])


def test_job_files_are_this_jobs_and_no_others(tmp_path):
    for name in (
        "main.aux", "main.run.xml", "main.synctex.gz", "main.kept.pdf",
        "main.v2.aux", "mainly.aux", "si.aux",
    ):
        (tmp_path / name).write_text("", encoding="utf-8")

    found = sorted(path.name for path in job_files(tmp_path, "main"))

    assert found == ["main.aux", "main.kept.pdf", "main.run.xml", "main.synctex.gz"]


def test_a_build_whose_task_is_cancelled_leaves_no_engine_running(tmp_path, monkeypatch):
    """The task awaiting a build can be cancelled from outside, as a
    keystroke once cancelled the debounced build it arrived during. The
    engine was left running with `_process` cleared, so the next build
    found nothing to stop and a second pdflatex wrote the same `.aux`:
    8144 NUL bytes in `si.aux`."""
    scheduler = _scheduler(tmp_path, monkeypatch)
    build = tmp_path / "build"
    (build / "main.aux").write_text(WHOLE_AUX, encoding="utf-8")
    seen: list[int] = []

    async def start_then_cancel_the_task():
        running = asyncio.ensure_future(scheduler.build())
        while not (build / "started").exists():
            await asyncio.sleep(0.02)
        seen.append(scheduler._process.pid)
        running.cancel()
        try:
            await running
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0.2)

    asyncio.run(start_then_cancel_the_task())

    assert not build_module._alive(seen[0]), "the engine outlived its build"
    assert (build / "main.aux").read_text(encoding="utf-8") == WHOLE_AUX
