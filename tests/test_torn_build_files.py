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


# -- recovery and the clean build -------------------------------------------
#
# Against the real engine, since what is being shown is that pdflatex and
# latexmk get past files that stopped them on 28 September.

import shutil

import pytest

REAL = shutil.which("latexmk") and shutil.which("pdflatex")
needs_tex = pytest.mark.skipif(not REAL, reason="needs latexmk and pdflatex")

CITING = (
    "\\documentclass{article}\n"
    "\\begin{document}\n"
    "\\section{One}\\label{sec:one}\n"
    "See \\ref{sec:one} and \\cite{knuth1984}.\n"
    "\\bibliographystyle{plain}\n"
    "\\bibliography{refs}\n"
    "\\end{document}\n"
)
BIB = "@book{knuth1984, title={The TeXbook}, author={Knuth, Donald}, year={1984}, publisher={Addison-Wesley}}\n"


def _real(tmp_path: Path) -> CompileScheduler:
    (tmp_path / "main.tex").write_text(CITING, encoding="utf-8")
    (tmp_path / "refs.bib").write_text(BIB, encoding="utf-8")
    return CompileScheduler(ProjectPaths(
        root=tmp_path, main=tmp_path / "main.tex", build_dir=tmp_path / "build",
    ))


def _counted(scheduler: CompileScheduler) -> list[tuple[bool, bool]]:
    runs: list[tuple[bool, bool]] = []
    original = scheduler._run

    async def counting(focus, force_full, clean=False):
        runs.append((force_full, clean))
        return await original(focus, force_full, clean)

    scheduler._run = counting
    return runs


@needs_tex
def test_an_aux_full_of_nul_bytes_is_cleared_before_the_engine_reads_it(tmp_path):
    scheduler = _real(tmp_path)
    assert asyncio.run(scheduler.build()).outcome is Outcome.OK
    aux = tmp_path / "build" / "main.aux"
    whole = aux.read_bytes()
    lines = whole.split(b"\n")
    aux.write_bytes(b"\n".join(lines[:2]) + b"\n" + b"\0" * 8144 + b"\n".join(lines[2:]))

    result = asyncio.run(scheduler.build())

    assert result.outcome is Outcome.OK, result.log.errors if result.log else None
    assert b"\0" not in aux.read_bytes()
    assert not result.log.undefined_citations
    assert result.recovered == "main.aux was damaged"


@needs_tex
def test_an_aux_cut_off_mid_line_is_cleared_before_the_engine_reads_it(tmp_path):
    scheduler = _real(tmp_path)
    asyncio.run(scheduler.build())
    aux = tmp_path / "build" / "main.aux"
    aux.write_bytes(aux.read_bytes()[:40])
    runs = _counted(scheduler)

    result = asyncio.run(scheduler.build())

    assert result.outcome is Outcome.OK, result.log.errors if result.log else None
    assert result.recovered
    assert len(runs) == 1, "cleared before the engine read it, so no second run"


@needs_tex
def test_an_empty_bibliography_from_a_short_aux_is_rebuilt_once(tmp_path):
    """bibtex read an `.aux` cut short, said "I found no \\citation
    commands" and wrote an empty `.bbl`. The full pass that ran it stored
    its undefined keys as the ones a full pass leaves, so every fast pass
    after it agreed and none asked for bibtex again: all 67 citations
    undefined until bibtex was run by hand."""
    import subprocess

    scheduler = _real(tmp_path)
    asyncio.run(scheduler.build())
    build = tmp_path / "build"
    aux = build / "main.aux"
    whole = aux.read_bytes()
    aux.write_bytes(b"\\relax \n")
    subprocess.run(["bibtex", "main"], cwd=build, capture_output=True)
    # And the pass after it, typeset against the empty `.bbl`, wrote an
    # `.aux` with the citations and none of their `\\bibcite` answers.
    aux.write_bytes(b"".join(
        line for line in whole.splitlines(keepends=True)
        if not line.startswith(b"\\bibcite")
    ))
    assert (build / "main.bbl").stat().st_size == 0
    # What that full pass left the scheduler believing.
    scheduler._needs_full = False
    scheduler._unresolved_after_full = frozenset({"knuth1984"})
    runs = _counted(scheduler)

    result = asyncio.run(scheduler.build())

    assert not result.log.undefined_citations, "the empty .bbl was kept"
    assert result.recovered
    assert len(runs) == 2, "recovery must run once, not loop"
    assert (build / "main.bbl").stat().st_size > 0


@needs_tex
def test_a_clean_build_removes_this_documents_files_and_no_one_elses(tmp_path):
    scheduler = _real(tmp_path)
    asyncio.run(scheduler.build())
    build = tmp_path / "build"
    (build / "si.aux").write_text("si's own\n", encoding="utf-8")
    (build / "main.toc").write_text("left from long ago\n", encoding="utf-8")
    stale = build / "main.fdb_latexmk"
    stale.write_text("stale\n", encoding="utf-8")

    result = asyncio.run(scheduler.build(clean=True))

    assert result.outcome is Outcome.OK
    assert (build / "si.aux").read_text(encoding="utf-8") == "si's own\n"
    assert not (build / "main.toc").exists()
    assert stale.read_text(encoding="utf-8") != "stale\n"
    assert not result.log.undefined_citations


def test_an_unclosed_brace_in_the_writers_text_costs_no_clean_build(tmp_path, monkeypatch):
    """"File ended while scanning" is also what the writer's own unclosed
    brace says; it points at their file, not the build directory, and must
    not turn every keystroke into a clean full pass."""
    from nexttex.latexlog import Diagnostic, ParsedLog

    scheduler = _scheduler(tmp_path, monkeypatch)
    log = ParsedLog()
    log.diagnostics.append(Diagnostic(
        file=tmp_path / "main.tex", line=3, severity="error",
        message="File ended while scanning use of \\textbf.",
    ))
    result = build_module.CompileResult(Outcome.ERRORS, log, None, 0.1, "full", "fast")
    assert scheduler._damaged(result) == ""

    log.diagnostics[0].file = tmp_path / "build" / "main.aux"
    log.diagnostics[0].message = "Text line contains an invalid character."
    assert scheduler._damaged(result)
