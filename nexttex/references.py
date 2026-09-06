"""Finding papers and adding them, without ever inventing one.

A fabricated citation in a dissertation is an academic integrity failure,
and a language model asked for "a reference for X" will produce a plausible
one every time.  The defence is structural rather than a matter of care: the
agent can search, and it can add an entry *by DOI* -- but the bibliography
text always comes from the publisher's own record, never from the model.

The three scripts this wraps came from the dissertation project, where they
already ran as a command-line pipeline; they are vendored unchanged so the
two copies cannot drift apart in behaviour.
"""

from __future__ import annotations

import importlib.util
import io
import re
import sys
from contextlib import redirect_stdout
from pathlib import Path

from .atomic import write_atomically

_VENDOR = Path(__file__).resolve().parent / "vendor"


def _load(name: str):
    """Import a vendored script by path, without putting it on sys.path."""
    key = f"nexttex._vendor_{name}"
    if key in sys.modules:
        return sys.modules[key]
    spec = importlib.util.spec_from_file_location(key, _VENDOR / f"{name}.py")
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    spec.loader.exec_module(module)
    return module


def search(
    query: str,
    *,
    source: str = "crossref",
    author: str = "",
    years: str = "",
    limit: int = 10,
) -> list[dict]:
    """Papers matching a query, each with the DOI its record carries."""
    lit = _load("lit_search")
    # The scripts take a (from, to) pair, with None for an open end.
    span = lit.year_filter(years) if years else (None, None)
    finder = {
        "crossref": lit.search_crossref,
        "openalex": lit.search_openalex,
        "semanticscholar": lit.search_semanticscholar,
    }.get(source)
    if finder is None:
        raise ValueError(f"unknown source: {source}")
    results = finder(query, author or None, span, max(1, min(limit, 25)))
    # Publishers register supplementary files as their own DOIs; citing one
    # cites a spreadsheet rather than the paper.
    return [
        item for item in results
        if not re.search(r"\.s\d{3}$", str(item.get("doi") or ""))
        and item.get("type") != "component"
    ]


def cited_by(doi: str, limit: int = 20) -> list[dict]:
    """Papers that cite this one -- how a literature review actually grows."""
    lit = _load("lit_search")
    try:
        return lit.cited_by(doi, max(1, min(limit, 50)))
    except Exception as error:
        status = getattr(getattr(error, "response", None), "status_code", None)
        if status == 404:
            raise LookupError(
                f"Semantic Scholar has no record of {doi}, so it cannot say "
                "what cites it."
            ) from error
        raise


def entry_for(doi: str, existing: str) -> dict:
    """Fetch one reference from the publisher's own record.

    Writes nothing.  The DOI lookup takes seconds over the network, and the
    caller reads the .bib file *after* this returns rather than before, so
    an edit made in the editor while the fetch was in flight is not silently
    overwritten -- which is exactly what used to happen.

    `existing` is only used to pick a key that is not already taken and to
    notice a DOI the file already has; it may be a moment out of date
    without any harm, since the caller re-reads before it writes.

    Never composes an entry: if the DOI does not resolve, nothing comes back.
    """
    fetch = _load("bib_from_doi")
    clean = fetch.normalise_doi(doi)
    if clean.lower() in {d.lower() for d in fetch.existing_dois(existing)}:
        return {"added": False, "reason": "that DOI is already in the file", "doi": clean}

    raw = fetch.fetch_bibtex(clean)
    meta = fetch.fetch_metadata(clean)
    key = fetch.make_key(meta)
    taken = fetch.existing_keys(existing)
    if key in taken:
        suffix = ord("a")
        while f"{key}{chr(suffix)}" in taken:
            suffix += 1
        key = f"{key}{chr(suffix)}"
    return {
        "added": True,
        "key": key,
        "doi": clean,
        "title": (meta.get("title") or [""])[0] if meta else "",
        "entry": fetch.tidy(raw, key, meta),
    }


def appended(existing: str, entry: str) -> str:
    """What the .bib file should say once one entry is added to it."""
    separator = "" if not existing or existing.endswith("\n\n") else "\n"
    return existing + separator + entry + "\n"


def add(doi: str, bib_path: Path) -> dict:
    """Add one reference to a .bib file. For the command-line tools."""
    existing = bib_path.read_text(encoding="utf-8") if bib_path.exists() else ""
    result = entry_for(doi, existing)
    if not result.get("added"):
        return result
    write_atomically(bib_path, appended(existing, result["entry"]))
    return result


def verify(bib_path: Path) -> dict:
    """Re-check every entry against the record it claims to come from."""
    checker = _load("verify_bib")
    if not bib_path.exists():
        return {"checked": 0, "problems": [], "report": "no bibliography file"}
    entries = checker.parse_bib(bib_path.read_text(encoding="utf-8"))
    problems: list[dict] = []
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        for entry in entries:
            issues = checker.check(entry)
            if issues:
                problems.append({"key": entry.get("key", "?"), "issues": issues})
    return {
        "checked": len(entries),
        "problems": problems,
        "report": buffer.getvalue()[-4000:],
    }
