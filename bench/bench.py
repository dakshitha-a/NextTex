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
import re
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
from nexttex.deps import DependencyGraph
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

    # The shared documents, on a project this size. Both of these are on the
    # keystroke path now: an edit reaching this install from a collaborator
    # is an `apply_update`, and every edit that settles becomes a projection.
    from server.collab.store import CollabStore

    store = CollabStore(project)
    store.adopt()
    biggest = max(
        (fid for fid, record in store.files.items() if record.get("kind") == "text"),
        key=lambda fid: store.files[fid].get("size") or 0,
        default=None,
    )
    if biggest is not None:
        # A fresh store each run, because that is what "opening a document"
        # is: reading its log off disk and rebuilding it. Measuring it on a
        # store that already has it open would measure a dictionary lookup.
        def open_one() -> None:
            fresh = CollabStore(project)
            fresh.body(biggest)
            fresh.close()

        results.append(timed("collab.open_document_ms", open_one, runs=3))

        whole = str(store.body(biggest))
        edits = iter(range(10_000))
        results.append(timed(
            "collab.ingest_ms",
            lambda: store.ingest(
                store.path_for(biggest), f"{whole}\n% line {next(edits)}\n",
            ),
            runs=5,
        ))

        # The other half of that path, and the half that had never been
        # measured. An edit that settles is written back to disk by a timer
        # callback on the event loop, and that write is not one line: the
        # document is materialised to a string, the file on disk is read to
        # find what changed, the new text is written and flushed, and a
        # version is recorded. Timed together with the edit that dirties it,
        # because separating them would need a handle on the document that
        # nothing outside the store has, and because an edit reaching the
        # disk is the thing a writer actually waits for.
        #
        # What this does *not* cover: there is no session attached here, so
        # the version record, the edit note and the compile schedule that a
        # real flush also performs are absent. `history.record_ms` measures
        # the largest of those three on its own. Read the two together
        # rather than reading this one as the whole path.
        results.append(timed(
            "collab.edit_to_disk_ms",
            lambda: (
                store.ingest(
                    store.path_for(biggest), f"{whole}\n% settled {next(edits)}\n",
                ),
                store.flush(),
            ),
            runs=5,
        ))
    store.close()

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

    # What opening a project costs, which is what a writer waits for when
    # they click one in the list.  Not the session construction, which cannot
    # run outside the app's own loop, but the three things the route does with
    # the filesystem: walking the tree, working out what else could be
    # previewed, and working out who reads what.  Those are the parts that
    # were on the event loop, so this is the number the change has to move.
    def open_work() -> None:
        project.tree()
        deps = DependencyGraph(root)
        names = [project.config.main]
        deps.standalone_candidates(names)
        deps.reverse(names)

    results.append(timed("project.open_ms", open_work, runs=3))

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
    """The JavaScript a first visit has to download before anything draws.

    Read out of the built index.html rather than matched by name.  Globbing
    `index-*.js` meant any lazily imported module that happened to live in
    an `index.ts` was counted as though a first visit downloaded it -- the
    spell checker's word list did exactly that, and turned a 98 kB chunk
    nobody fetches unless they ask for it into an apparent 300 kB
    regression.  The entry point is a fact the build already records.
    """
    dist = ROOT / "frontend" / "dist"
    try:
        html = (dist / "index.html").read_text(encoding="utf-8")
    except OSError:
        return None
    entries = re.findall(r'<script[^>]+src="([^"]+\.js)"', html)
    total = 0.0
    for src in entries:
        path = dist / src.lstrip("/")
        if path.is_file():
            total += path.stat().st_size / 1024
    if not total:
        return None
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
