"""What the slow parts of NextTex cost, on a project the size of a thesis.

Run on demand, not on every commit:

    .venv/bin/python -m bench.bench
    .venv/bin/python -m bench.bench --out bench/report/latest.json

Every measurement is a median over several runs against a synthetic project
of the shape that actually hurts -- forty source files, two megabytes of
LaTeX, a build directory full of output, a .git, and four hundred versions
of one file.  The thresholds in thresholds.json are budgets: they exist so
that a change which makes typing slower says so, rather than being noticed
six months later on a real chapter.
"""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from nexttex.history import History                    # noqa: E402
from nexttex.project import Project, Registry, id_for   # noqa: E402
from nexttex.symbols import SymbolCache, scan           # noqa: E402
from server.transcript import Transcript                # noqa: E402

CHAPTERS = 40
LINES_PER_CHAPTER = 900
VERSIONS = 400
TRANSCRIPT_EDITS = 300


def build_project(root: Path) -> Path:
    """A project shaped like a dissertation, not like a test fixture."""
    (root / "chapters").mkdir(parents=True)
    (root / "figures").mkdir()
    (root / "build").mkdir()
    (root / ".git" / "objects" / "pack").mkdir(parents=True)

    body = []
    for chapter in range(CHAPTERS):
        lines = [f"\\section{{Section {chapter}}}", f"\\label{{sec:{chapter}}}"]
        for line in range(LINES_PER_CHAPTER):
            lines.append(
                f"Some prose about the results, line {line}, "
                f"citing \\cite{{source{line % 50}}} and \\ref{{eq:{line % 30}}}."
            )
        (root / "chapters" / f"{chapter:02d}.tex").write_text(
            "\n".join(lines), encoding="utf-8"
        )
        body.append(f"\\include{{chapters/{chapter:02d}}}")

    (root / "main.tex").write_text(
        "\\documentclass{report}\n\\begin{document}\n"
        + "\n".join(body)
        + "\n\\end{document}\n",
        encoding="utf-8",
    )
    (root / "references.bib").write_text(
        "\n".join(
            f"@article{{source{index},\n  title = {{Paper {index}}},\n"
            f"  author = {{Author, A.}},\n  year = {{20{index % 25:02d}}},\n}}"
            for index in range(500)
        ),
        encoding="utf-8",
    )
    for index in range(60):
        (root / "figures" / f"plot{index:02d}.pdf").write_bytes(b"%PDF-1.4" + b"\0" * 40_000)
    # Build output: the thing that used to invalidate the symbol cache on
    # every single compile.
    (root / "build" / "main.pdf").write_bytes(b"%PDF-1.4" + b"\0" * 4_000_000)
    for index in range(CHAPTERS):
        (root / "build" / f"{index:02d}.aux").write_text("\\relax\n", encoding="utf-8")
    for index in range(2000):
        (root / ".git" / "objects" / "pack" / f"o{index}").write_bytes(b"x" * 200)
    return root


def timed(label: str, work, runs: int = 5) -> dict:
    samples = []
    for _ in range(runs):
        started = time.perf_counter()
        work()
        samples.append((time.perf_counter() - started) * 1000)
    return {
        "name": label,
        "unit": "ms",
        "median": round(statistics.median(samples), 2),
        "p95": round(max(samples), 2),
        "runs": runs,
    }


def measure(root: Path) -> list[dict]:
    results = []
    project = Project.open(root)
    build = project.build_dir

    results.append(timed("symbols.scan_ms",
                         lambda: scan(root, build_dir=build), runs=3))

    cache = SymbolCache(root)
    cache.get(build_dir=build)          # warm
    results.append(timed("symbols.cached_ms",
                         lambda: cache.get(build_dir=build), runs=5))

    # The one that mattered: a compile rewrites build/main.pdf, and the
    # stamp walk used to count it -- so every build threw the whole index
    # away and rescanned the project, 1.6 seconds after every pause in
    # typing.  If that ever comes back, this measurement jumps from about a
    # millisecond to about twenty.
    def after_a_build() -> None:
        (build / "main.pdf").touch()
        cache.get(build_dir=build)

    results.append(timed("symbols.after_build_ms", after_a_build, runs=5))

    history = History(root / ".nexttex" / "history")
    for index in range(VERSIONS):
        history.record("chapters/00.tex", f"version {index}", source=f"s{index}")
    results.append(timed("history.versions_ms",
                         lambda: history.versions("chapters/00.tex")))
    counter = iter(range(VERSIONS, VERSIONS * 10))
    results.append(timed(
        "history.record_ms",
        lambda: history.record("chapters/00.tex", f"version {next(counter)}",
                               source=f"s{next(counter)}"),
    ))

    transcript = Transcript(root / ".nexttex" / "transcript.jsonl")
    chapter = (root / "chapters" / "00.tex").read_text(encoding="utf-8")
    for index in range(TRANSCRIPT_EDITS):
        transcript.record({
            "type": "edit", "path": "chapters/00.tex",
            "before": chapter, "after": chapter + f"\n% {index}",
        })
    results.append(timed("transcript.items_ms", transcript.items, runs=3))

    results.append(timed("project.tree_ms", project.tree, runs=3))

    registry = Registry(root / ".nexttex" / "projects.json")
    registry.add(root)
    results.append(timed("registry.list_ms", registry.list))
    project_id = id_for(root)
    results.append(timed("registry.find_ms",
                         lambda: registry.find(project_id)))

    results.append(timed("download.zip_ms", lambda: zip_size(root), runs=1))
    results.extend(compile_passes(root))
    return results


def compile_passes(root: Path) -> list[dict]:
    """What a build actually costs, which is the number people ask about.

    Everything else here measures NextTex.  This measures LaTeX, which is
    most of the wait between a keystroke and a redrawn page and was the one
    figure the README quoted without ever having measured it.

    Two passes, because they are different questions.  The fast one is what
    an ordinary edit triggers -- one engine run over the chapter being
    edited.  The full one is what a new citation or a new label forces:
    latexmk driving biber and running the engine until the references stop
    moving.  Skipped rather than failed where there is no TeX, so the
    benchmark still runs on a machine that cannot typeset.
    """
    import asyncio
    import shutil

    if not shutil.which("pdflatex"):
        print("   compile.*                  skipped (no pdflatex)")
        return []

    from nexttex.compile import CompileScheduler, ProjectPaths

    paths = ProjectPaths(root=root, main=root / "main.tex",
                         build_dir=root / "build")
    scheduler = CompileScheduler(paths)

    chapter = root / "chapters" / "05.tex"

    def full() -> None:
        asyncio.run(scheduler.build(force_full=True))

    def edit_a_chapter() -> None:
        # With a focus, which is the whole point.  An ordinary edit
        # typesets the chapter being edited; without `focus` the scheduler
        # has nothing to scope to and runs the engine over all forty files,
        # which is not what anybody's keystroke does.  Measuring it that
        # way said the fast pass was twice as slow as the full one -- true,
        # and about a path the app never takes.
        asyncio.run(scheduler.build(focus=chapter))

    # Twice first: the scoped path only engages once a whole-document pass
    # has been timed and found slow enough to be worth scoping, so a cold
    # scheduler always runs the full thing.
    full()
    edit_a_chapter()
    return [
        timed("compile.chapter_ms", edit_a_chapter, runs=3),
        timed("compile.full_ms", full, runs=2),
    ]


def zip_size(root: Path) -> int:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for item in root.rglob("*"):
            if not item.is_file():
                continue
            if {".git", ".nexttex", "build"} & set(item.parts):
                continue
            archive.write(item, item.relative_to(root))
    return buffer.tell()


def bundle_size() -> dict | None:
    """The JavaScript a first visit has to download before anything draws."""
    assets = ROOT / "frontend" / "dist" / "assets"
    if not assets.is_dir():
        return None
    initial = [
        path for path in assets.glob("index-*.js")
    ]
    if not initial:
        return None
    total = sum(path.stat().st_size for path in initial) / 1024
    return {"name": "bundle.initial_kb", "unit": "kB",
            "median": round(total, 1), "p95": round(total, 1), "runs": 1}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="write the measurements here")
    parser.add_argument("--keep", action="store_true",
                        help="leave the synthetic project on disk")
    arguments = parser.parse_args()

    sandbox = Path(tempfile.mkdtemp(prefix="nexttex-bench-"))
    try:
        print(f"building a thesis-shaped project in {sandbox} ...", flush=True)
        root = build_project(sandbox / "thesis")
        results = measure(root)
        extra = bundle_size()
        if extra:
            results.append(extra)
    finally:
        if not arguments.keep:
            shutil.rmtree(sandbox, ignore_errors=True)

    thresholds = json.loads((ROOT / "bench" / "thresholds.json").read_text())
    failures = []
    width = max(len(item["name"]) for item in results)
    print()
    for item in results:
        limit = thresholds.get(item["name"])
        item["threshold"] = limit
        item["ok"] = limit is None or item["median"] <= limit
        if not item["ok"]:
            failures.append(item)
        mark = "  " if item["ok"] else "!!"
        budget = f"  (budget {limit})" if limit is not None else ""
        print(f"{mark} {item['name']:<{width}}  {item['median']:>8} "
              f"{item['unit']}{budget}")

    if arguments.out:
        arguments.out.parent.mkdir(parents=True, exist_ok=True)
        arguments.out.write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"\nwritten to {arguments.out}")

    if failures:
        print(f"\n{len(failures)} over budget")
        return 1
    print("\nall within budget")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
