r"""What the publishers' records say about a document's citations now.

Two things a citation can have become since it was added: retracted, and,
for a preprint, published in a journal. Both are in the record Crossref
keeps for the cited DOI, which is the record NextTex takes every reference
from. A retraction is an `updated-by` entry of type `retraction` (or
`withdrawal`) on the cited work, which Crossref has carried since the
Retraction Watch data joined it; a journal version is the preprint's
`relation`, `is-preprint-of`, naming the journal's DOI. Both shapes were
read off Crossref's own answers for a retracted paper and a preprint, and
`tests/fixtures/crossref-*.json` keep those answers.

Only Crossref is asked. A DOI it does not hold, arXiv's and Zenodo's are
DataCite's, carries neither field anywhere NextTex reads, so it is counted
and nothing is said about it. Asking is the submission check's one
network call, so it is made only when the writer presses for it, and an
answer is kept for a day in this process.
"""

from __future__ import annotations

import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable
from urllib.parse import quote

from .submit import Finding

#: How long an answer is kept.
KEEP_SECONDS = 24 * 3600
#: Asked four at a time, as the bibliography check asks.
WORKERS = 4
RETRACTIONS = {"retraction", "withdrawal", "removal"}
DOI_PREFIX = re.compile(r"^(?:https?://)?(?:dx\.)?doi\.org/", re.I)
#: A DOI, as a `.bib` writes one, after its prefix is taken off.
DOI = re.compile(r"^10\.\d{4,9}/\S+$")

Fetch = Callable[[str], "dict | None"]

_kept: dict[str, tuple[float, dict | None]] = {}
_lock = threading.Lock()


def crossref(doi: str) -> dict | None:
    """Crossref's record for `doi`, its `message`; None when Crossref does
    not hold it. Raises on a network failure, which is not an answer."""
    import requests

    from .references import _load

    # The User-Agent the reference check sends, with the address Crossref
    # asks polite clients for when one is set.
    agent = _load("verify_bib").UA
    response = requests.get(
        f"https://api.crossref.org/works/{quote(doi, safe='')}",
        headers={"User-Agent": agent}, timeout=20,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json().get("message")


def normal(doi: str) -> str:
    return DOI_PREFIX.sub("", doi.strip()).strip().lower()


def _asked(doi: str, fetch: Fetch, now: float) -> tuple[bool, dict | None]:
    """(answered, record): a record, None when Crossref does not hold the
    DOI, and not answered when the asking failed."""
    with _lock:
        kept = _kept.get(doi)
    if kept and now - kept[0] < KEEP_SECONDS:
        return True, kept[1]
    try:
        record = fetch(doi)
    except Exception:
        return False, None
    with _lock:
        _kept[doi] = (now, record)
    return True, record


def forget() -> None:
    """Drop every kept answer; for the tests."""
    with _lock:
        _kept.clear()


def ask(entries: list[dict], fetch: Fetch | None = None, now: float | None = None) -> dict:
    """What the records say about `entries`, each `{key, doi, file, line}`.

    Answers `{asked, unknown, failed, findings}`: how many DOIs were asked
    about, how many Crossref does not hold, how many could not be asked,
    and the rows, in the submission check's shape."""
    now = time.time() if now is None else now
    # Looked up here rather than bound as a default, so a test that puts a
    # stand-in in `crossref`'s place is the one asked.
    fetch = fetch or crossref
    wanted: dict[str, list[dict]] = {}
    for entry in entries:
        doi = normal(entry.get("doi") or "")
        if DOI.match(doi):
            wanted.setdefault(doi, []).append(entry)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        answers = dict(zip(wanted, pool.map(lambda doi: _asked(doi, fetch, now), wanted)))
    findings: list[Finding] = []
    unknown = failed = 0
    for doi, (answered, record) in answers.items():
        if not answered:
            failed += 1
            continue
        if record is None:
            unknown += 1
            continue
        for entry in wanted[doi]:
            findings += _findings(entry, record)
    return {
        "asked": len(wanted),
        "unknown": unknown,
        "failed": failed,
        "findings": [finding.as_dict() for finding in findings],
    }


def _findings(entry: dict, record: dict) -> list[Finding]:
    out: list[Finding] = []
    key, file, line = entry["key"], entry.get("file"), entry.get("line")
    notices = [
        update for update in record.get("updated-by") or []
        if str(update.get("type", "")).lower() in RETRACTIONS
    ]
    if notices:
        # The notice's own DOI is on the publisher's page for the paper;
        # in the row it made the message too long to read at the drawer's
        # narrowest.
        out.append(Finding("retracted", "error", f"{key} has been retracted", file=file, line=line))
    journal = [
        item.get("id", "") for item in (record.get("relation") or {}).get("is-preprint-of") or []
        if str(item.get("id-type", "")).lower() == "doi" and item.get("id")
    ]
    if journal:
        out.append(Finding(
            "published", "warning",
            f"{key} is a preprint; its journal version is {journal[0]}",
            file=file, line=line,
        ))
    return out
