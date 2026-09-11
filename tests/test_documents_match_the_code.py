"""The documents name things, and the things have to exist.

Every document in this repository is full of file paths, HTTP routes and
environment variables, written as running prose rather than as a reference
table. That is deliberate and it is why they are worth reading, but it means
a rename moves the code and leaves a document quietly describing a world
that no longer exists. Nothing looked, which is the same failure that let
three hundred em dashes and a stale palette accumulate, and the fix is the
same shape: something that looks on every run.

These are not tests of the prose. A sentence can be wrong in ways no test
can see, and the way to catch that is still to read the passage next to the
code. What is checked here is only the part that is mechanical: a name that
is written as a name.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DOCUMENTS = [
    "README.md",
    "TRACKER.md",
    "docs/architecture.md",
    "docs/design.md",
    "docs/testing.md",
    "docs/first-session.md",
    "docs/project-context.md",
]

# Paths that are real and are not in this repository, each for its own
# reason. Anything not listed here has to exist, so adding to this list is a
# deliberate act rather than a way past a failure.
NOT_OURS = {
    # Inside a writer's own project or their own state directory, created at
    # runtime. `.nexttex/` is gitignored precisely so none of this is here.
    ".nexttex/collab/share.json",
    ".nexttex/dictionary.txt",
    # Examples of what a writer's project holds, in the passage about the
    # agent drawing a figure from a dataset.
    "figures/plot.png",
    "scripts/figure.py",
    # A URL path being discussed, not a file on disk.
    "/logo.svg",
}

NAMED_FILE = re.compile(
    r"`([A-Za-z0-9_./-]+\.(?:py|ts|tsx|css|json|sh|ps1|md|html|svg|ico|png|txt))`"
)
NAMED_ROUTE = re.compile(r"`(/api/[A-Za-z0-9_/{}.-]+)`")
NAMED_VARIABLE = re.compile(r"\bNEXTTEX_[A-Z0-9_]+")
ROUTE_DEFINITION = re.compile(
    r'@\w+\.(?:get|post|put|delete|patch|websocket)\("([^"]+)"'
)


def documents() -> list[tuple[str, str]]:
    return [(name, (ROOT / name).read_text(encoding="utf-8")) for name in DOCUMENTS]


def test_every_file_a_document_names_is_there():
    """Only names carrying a directory, because a bare `store.ts` is usually
    prose about a module rather than a path, and there are two of some of
    those."""
    missing = []
    for name, text in documents():
        for found in sorted(set(NAMED_FILE.findall(text))):
            if "/" not in found or found in NOT_OURS:
                continue
            if not (ROOT / found).exists():
                missing.append(f"{name} names {found}")
    assert not missing, "\n".join(missing)


def _routes() -> set[str]:
    placeholder = re.compile(r"\{[^}]+\}")
    found = set()
    for path in (ROOT / "server").rglob("*.py"):
        for route in ROUTE_DEFINITION.findall(path.read_text(encoding="utf-8")):
            found.add(placeholder.sub("{}", route))
    return found


def test_every_route_a_document_names_is_served():
    """A renamed route is the worst of these to get wrong: the document reads
    like instructions, and following them gets a 404 rather than a hint that
    the name has moved."""
    placeholder = re.compile(r"\{[^}]+\}")
    served = _routes()
    assert served, "no routes found, so this test is not testing anything"

    wrong = []
    for name, text in documents():
        for found in sorted(set(NAMED_ROUTE.findall(text))):
            shape = placeholder.sub("{}", found)
            if shape in served or shape.rstrip("/") in served:
                continue
            wrong.append(f"{name} names {found}")
    assert not wrong, "\n".join(wrong)


def test_every_variable_a_document_names_is_read_somewhere():
    """`NEXTTEX_*` is the whole of this application's configuration surface,
    so a document naming one that nothing reads is telling somebody to set a
    variable that will do nothing at all, silently."""
    code = []
    for pattern in ("nexttex", "server", "scripts", "bench", "e2e", "tests"):
        base = ROOT / pattern
        for path in base.rglob("*"):
            if path.suffix not in {".py", ".ts", ".tsx", ".sh", ".ps1"}:
                continue
            if "node_modules" in path.parts:
                continue
            code.append(path.read_text(encoding="utf-8", errors="ignore"))
    for path in (ROOT / "frontend" / "src").rglob("*.ts*"):
        code.append(path.read_text(encoding="utf-8", errors="ignore"))
    defined = set(NAMED_VARIABLE.findall("\n".join(code)))
    assert defined, "no variables found, so this test is not testing anything"

    unknown = []
    for name, text in documents():
        for found in sorted(set(NAMED_VARIABLE.findall(text))):
            if found not in defined:
                unknown.append(f"{name} names {found}")
    assert not unknown, "\n".join(unknown)


def test_the_benchmark_table_quotes_the_budgets_that_are_set():
    """The README's table has a budget column, and it is a transcription.

    It was wrong: the interface bundle was listed against 782 kB when
    `bench/thresholds.json` had held 800 since the agent panel rework, so a
    reader comparing the two numbers in that row was comparing a measurement
    from one run against a budget from an older one. Only the budget column
    is checked. The measured column is a measurement and will differ on
    every machine, which is the point of it being labelled measured.
    """
    import json

    thresholds = json.loads((ROOT / "bench" / "thresholds.json").read_text())
    readme = (ROOT / "README.md").read_text(encoding="utf-8")

    def cell(key: str) -> str:
        """The budget as the table writes it.

        The table is read by a person, so a budget of 4000 ms is written as
        `4 s`. That is the only rule, and deriving the expected string rather
        than listing it is the whole point: a hardcoded expectation would
        just be a second transcription, green while the README and the
        thresholds disagreed with each other.
        """
        value = thresholds[key]
        if key.endswith("_kb"):
            return f"{value:g} kB"
        if value >= 1000 and value % 1000 == 0:
            return f"{value // 1000:g} s"
        return f"{value:g} ms"

    rows = {
        "Chapter build, as an edit triggers": "compile.chapter_ms",
        "Full build with `biber`": "compile.full_ms",
        "Full symbol scan": "symbols.scan_ms",
        "Symbol lookup, cached": "symbols.cached_ms",
        "Opening a project": "project.open_ms",
        "Recording a version": "history.record_ms",
        "Rebuilding a transcript": "transcript.items_ms",
        "Project file tree": "project.tree_ms",
        "A collaborator's edit, applied": "collab.ingest_ms",
        "Whole project as a zip": "download.zip_ms",
        "Interface bundle": "bundle.initial_kb",
    }
    for label, key in rows.items():
        assert key in thresholds, f"{key} is no longer a budget"
        row = next(
            (line for line in readme.splitlines() if line.startswith(f"| {label} |")),
            None,
        )
        assert row, f"the benchmark table no longer has a row for {label}"
        stated = row.rstrip().rsplit("|", 2)[1].strip()
        assert stated == cell(key), (
            f"{label}: the table says {stated}, thresholds.json says {cell(key)}"
        )
