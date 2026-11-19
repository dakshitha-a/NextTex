"""Finding papers and adding them, without ever inventing one.

A fabricated citation in a dissertation is an academic integrity failure,
and a language model asked for "a reference for X" will produce a plausible
one every time.  The defence is structural rather than a matter of care: the
agent can search, and it can add an entry *by DOI* -- but the bibliography
text always comes from the publisher's own record, never from the model.

The three scripts this wraps came from the dissertation project, where they
already ran as a command-line pipeline; they are vendored so the two copies
cannot drift apart in behaviour.  One addition has been made here and
nowhere else: each search result carries `authors` (the full list) and
`abstract` beside the fields the pipeline reads, for the Papers drawer's
hover card.
"""

from __future__ import annotations

import importlib.util
import io
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from pathlib import Path

from .atomic import write_atomically

_VENDOR = Path(__file__).resolve().parent / "vendor"


def _load(name: str):
    """Import a vendored script by path, without putting it on sys.path."""
    key = f"nexttex._vendor_{name}"
    if key in sys.modules:
        return sys.modules[key]
    path = _VENDOR / f"{name}.py"
    # The scripts import each other by their plain names, as
    # `bib_from_doi` does `from verify_bib import isbn_record`. One module
    # object under both names, so that what one sees of another, its HTTP
    # client among them, is what this module hands out: with two copies the
    # ISBN tests stubbed one and reached Open Library through the other.
    plain = sys.modules.get(name)
    if plain is not None and Path(getattr(plain, "__file__", "") or "").resolve() == path.resolve():
        sys.modules[key] = plain
        _apply_contact(plain)
        return plain
    spec = importlib.util.spec_from_file_location(key, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    _apply_contact(module)
    return module


#: The literature sources, in the order a refused one falls back through.
SOURCES = ("crossref", "openalex", "semanticscholar")
#: Each source by the name a writer would know it by.
SOURCE_NAMES = {"crossref": "Crossref", "openalex": "OpenAlex",
                "semanticscholar": "Semantic Scholar"}


#: The address the vendored scripts send as their contact, from the
#: install's settings; `NEXTTEX_CONTACT` in the environment wins over it.
_CONTACT = ""
#: Just enough of an address to be one: a name, an @, a dotted domain.
CONTACT_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def contact() -> tuple[str, bool]:
    """The contact address in use, and whether the environment set it."""
    import os

    from_environment = os.environ.get("NEXTTEX_CONTACT", "").strip()
    return (from_environment or _CONTACT), bool(from_environment)


def set_contact(address: str) -> None:
    """Give every vendored script `address` as its contact, or none.

    The scripts compute `MAILTO` and `UA` when they are loaded, from the
    environment alone, so a setting has to be applied to each module, now
    and to any loaded later (`_apply_contact` in `_load`)."""
    global _CONTACT
    _CONTACT = address.strip()
    for name in ("verify_bib", "lit_search", "bib_from_doi"):
        # Under NextTex's name, and under the plain one a script that
        # imports another loads it by, which can come first.
        for key in (f"nexttex._vendor_{name}", name):
            module = sys.modules.get(key)
            if module is not None and _is_vendored(module, name):
                _apply_contact(module)


def _is_vendored(module, name: str) -> bool:
    found = getattr(module, "__file__", "") or ""
    return bool(found) and Path(found).resolve() == (_VENDOR / f"{name}.py").resolve()


def _apply_contact(module) -> None:
    address, _ = contact()
    base = re.sub(r" \(mailto:.*\)$", "", getattr(module, "UA", "") or "")
    module.MAILTO = address or None
    module.UA = base + (f" (mailto:{address})" if address else "")


def search(
    query: str,
    *,
    source: str = "crossref",
    author: str = "",
    years: str = "",
    limit: int = 10,
) -> list[dict]:
    """Papers matching a query, each with the DOI its record carries and
    the `source` that answered."""
    return search_any(query, source=source, author=author, years=years, limit=limit)[0]


def search_any(
    query: str,
    *,
    source: str = "crossref",
    author: str = "",
    years: str = "",
    limit: int = 10,
) -> tuple[list[dict], str, list[str]]:
    """`search`, falling back through the other sources when one gives no
    answer: the results, the source that answered, and a sentence for each
    source that did not.

    Crossref, OpenAlex and Semantic Scholar all answered 429 within a few
    calls of each other for the thesis session, and the tool returned the
    first refusal as an error rather than asking the next source (19
    November 2026). A source that answers with nothing is an answer, and
    is not fallen back from.
    """
    lit = _load("lit_search")
    checker = _load("verify_bib")
    # The scripts take a (from, to) pair, with None for an open end.
    span = lit.year_filter(years) if years else (None, None)
    finders = {
        "crossref": lit.search_crossref,
        "openalex": lit.search_openalex,
        "semanticscholar": lit.search_semanticscholar,
    }
    if source not in finders:
        raise ValueError(f"unknown source: {source}")
    refused: list[str] = []
    last: Exception | None = None
    for name in [source] + [other for other in SOURCES if other != source]:
        try:
            results = finders[name](query, author or None, span, max(1, min(limit, 25)))
        except Exception as error:
            if not checker.unreachable(error):
                raise
            refused.append(f"{SOURCE_NAMES[name]} did not answer ({error})")
            last = error
            continue
        # Publishers register supplementary files as their own DOIs; citing
        # one cites a spreadsheet rather than the paper.
        kept = [
            {**item, "source": name} for item in results
            if not re.search(r"\.s\d{3}$", str(item.get("doi") or ""))
            and item.get("type") != "component"
        ]
        return kept, name, refused
    assert last is not None
    raise last


_DOI = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/\S+)$", re.I)


def doi_in(text: str) -> str:
    """The DOI a search box holds, or nothing.

    A string starting `10.` with a registrant and a suffix is a DOI, with or
    without the doi.org prefix a paper's page puts in front of it; anything
    else is a query for a publisher.  One box for both, so the writer does
    not have to know which they are holding.
    """
    match = _DOI.match((text or "").strip())
    return match.group(1) if match else ""


def isbn_in(text: str) -> str:
    """The ISBN a search box holds, as thirteen digits, or nothing.

    Ten or thirteen digits, hyphens and spaces allowed, an ISBN-10's final
    X too, and nothing else: a DOI never qualifies, and neither does a
    query that merely contains a number.
    """
    raw = (text or "").strip()
    if raw.lower().startswith("isbn"):
        raw = raw[4:].lstrip(" :")
    if not re.fullmatch(r"[0-9Xx][0-9Xx\- ]{8,20}", raw):
        return ""
    return _load("verify_bib").normalise_isbn(raw) or ""


def book_for(isbn: str) -> dict:
    """One search row for a book, from its catalogue record, the shape
    `record_for` gives a paper, with `isbn` where a paper has `doi`."""
    record = _load("verify_bib").isbn_record(isbn)
    if not record:
        return {}
    names = [author.get("full", "") for author in record.get("author") or [] if author.get("full")]
    parts = ((record.get("issued") or {}).get("date-parts") or [[None]])[0]
    title = (record.get("title") or [""])[0]
    if record.get("subtitle"):
        title += ": " + record["subtitle"][0]
    return {
        "doi": "",
        "isbn": isbn,
        "title": title,
        "first": (record.get("author") or [{}])[0].get("family", ""),
        "n_authors": len(names),
        "year": parts[0] if parts else None,
        "journal": record.get("publisher", ""),
        "authors": names,
        "abstract": "",
    }


def record_for(doi: str) -> dict:
    """One search result for one DOI, from the publisher's record.

    The same shape `search` returns, so the Papers drawer draws it as a row
    like any other and its Add goes through the same path.  Nothing is
    invented: a DOI nobody has comes back as no record.
    """
    fetch = _load("bib_from_doi")
    clean = fetch.normalise_doi(doi)
    meta = fetch.fetch_metadata(clean)
    if not meta:
        return {}
    authors = []
    for author in meta.get("author") or []:
        name = " ".join(filter(None, [author.get("given"), author.get("family")])).strip()
        if name:
            authors.append(name)
    parts = (meta.get("issued", {}).get("date-parts") or [[None]])[0]
    return {
        "doi": clean,
        "title": (meta.get("title") or [""])[0],
        "first": (meta.get("author") or [{}])[0].get("family", ""),
        "n_authors": len(meta.get("author") or []),
        "year": parts[0] if parts else None,
        "journal": (meta.get("container-title") or [""])[0],
        "cites": meta.get("is-referenced-by-count"),
        "authors": authors,
        "abstract": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", meta.get("abstract") or "")).strip(),
    }


def cited_by(doi: str, limit: int = 20) -> list[dict]:
    """Papers that cite this one -- how a literature review actually grows."""
    lit = _load("lit_search")
    try:
        return lit.cited_by(doi, max(1, min(limit, 50)))
    except Exception as error:
        status = getattr(getattr(error, "response", None), "status_code", None)
        if status == 404:
            # What the 404 actually says, which is narrower than it reads.
            # Semantic Scholar answers this for a paper it holds under some
            # other id as readily as for one it has never seen: the review
            # got it for the Nature deep learning paper and for
            # `10.1126/science.1127647`, while two other well-known DOIs
            # resolved and returned their citations in full. Telling a
            # writer building a literature review that a paper is unknown
            # is a different instruction from telling them this lookup
            # failed, and only the second one is true.
            raise LookupError(
                f"Semantic Scholar could not find {doi} under that DOI. It "
                "may hold the paper under another id, or not at all."
            ) from error
        raise


def book_entry_for(isbn: str, existing: str) -> dict:
    """`entry_for` for a book: a @book entry from its catalogue record.

    Never accepted silently: the result carries `check`, the sentence that
    tells whoever added it to compare the authors and the title's capitals
    with the title page, and the entry carries it as a comment.
    """
    fetch = _load("bib_from_doi")
    clean = _load("verify_bib").normalise_isbn(isbn)
    if not clean:
        return {"added": False, "reason": "that is not an ISBN", "isbn": isbn}
    if clean in fetch.existing_isbns(existing):
        return {"added": False, "reason": "that ISBN is already in the file", "isbn": clean}
    try:
        key, entry, record = fetch.book_entry(clean, fetch.existing_keys(existing))
    except LookupError as error:
        return {"added": False, "reason": str(error), "isbn": clean}
    return {
        "added": True,
        "key": key,
        "isbn": clean,
        "title": (record.get("title") or [""])[0],
        "entry": entry,
        "check": fetch.CHECK_BOOK,
    }


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
    An ISBN is a book, and goes to `book_entry_for`.
    """
    fetch = _load("bib_from_doi")
    if fetch.looks_like_isbn(doi) and not doi_in(doi):
        return book_entry_for(doi, existing)
    clean = fetch.normalise_doi(doi)
    if clean.lower() in {d.lower() for d in fetch.existing_dois(existing)}:
        return {"added": False, "reason": "that DOI is already in the file", "doi": clean}

    raw = fetch.fetch_bibtex(clean)
    meta = fetch.fetch_metadata(clean)
    parsed = fetch.parse_bib(raw)
    fields = parsed[0]["fields"] if parsed else {}
    key = fetch.make_key(meta, fields)
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
        "title": (meta.get("title") or [fields.get("title", "")])[0] if meta else fields.get("title", ""),
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


#: Entries looked up at once. Each host's own limit is kept by
#: `polite_get` in the vendored checker, so four at once means a Crossref
#: entry, a book and a preprint can be asked about together, not that
#: Crossref is asked four times at once.
CHECKED_AT_ONCE = 4
#: Lookups in a row that got no answer before the rest are not asked:
#: a service refusing the fifth will refuse the two hundredth, and asking
#: anyway only lengthens the wait it asks for.
GIVE_UP_AFTER = 5

#: How long a record fetched for a check is used before it is fetched
#: again. A publisher's record barely changes; a re-check of a bibliography
#: that has not changed should not cost 258 requests.
RECORD_DAYS = 30
#: Off in the test suite, which would otherwise keep records in the
#: developer's own state directory.
CACHE_RECORDS = True
#: Where the records are kept, when not in the state directory: the tests.
RECORDS_FILE: Path | None = None
#: The fields `check` reads from a record. A Crossref record carries its
#: whole reference list too, often more than all of these together.
_RECORD_FIELDS = ("title", "subtitle", "author", "issued", "published-print",
                  "published-online", "created", "container-title", "publisher",
                  "source")


class RecordCache:
    """Records fetched for a check, by identifier, install-wide.

    A record, never a verdict: `check` compares the entry against it every
    time, so an entry edited since is judged afresh. Only a record that was
    found is kept; a lookup that failed or got no answer is asked again.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()
        self.records: dict | None = None
        self.changed = False

    def _all(self) -> dict:
        if self.records is None:
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                loaded = {}
            self.records = loaded if isinstance(loaded, dict) else {}
        return self.records

    @staticmethod
    def _key(kind: str, ident: str) -> str:
        return f"{kind}:{ident.strip().lower()}"

    def get(self, kind: str, ident: str) -> dict | None:
        with self.lock:
            kept = self._all().get(self._key(kind, ident))
        if not isinstance(kept, dict) or not isinstance(kept.get("record"), dict):
            return None
        if time.time() - float(kept.get("at") or 0) > RECORD_DAYS * 86400:
            return None
        return kept["record"]

    def put(self, kind: str, ident: str, record: dict) -> None:
        slim = {name: record[name] for name in _RECORD_FIELDS if name in record}
        if isinstance(slim.get("author"), list):
            slim["author"] = [{"family": a.get("family", "")} for a in slim["author"][:1]
                              if isinstance(a, dict)]
        with self.lock:
            self._all()[self._key(kind, ident)] = {"at": time.time(), "record": slim}
            self.changed = True

    def save(self) -> None:
        with self.lock:
            if not self.changed or self.records is None:
                return
            fresh = time.time() - RECORD_DAYS * 86400
            self.records = {key: kept for key, kept in self.records.items()
                            if isinstance(kept, dict) and float(kept.get("at") or 0) > fresh}
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                write_atomically(self.path, json.dumps(self.records))
                self.changed = False
            except OSError:
                pass


_CACHES: dict[Path, RecordCache] = {}


def _record_cache() -> RecordCache | None:
    if not CACHE_RECORDS:
        return None
    from .paths import state_home

    path = RECORDS_FILE or state_home() / "reference-records.json"
    if path not in _CACHES:
        _CACHES[path] = RecordCache(path)
    return _CACHES[path]


def verify(bib_path: Path) -> dict:
    """Re-check every entry against the record it claims to come from."""
    checker = _load("verify_bib")
    if not bib_path.exists():
        return {"checked": 0, "problems": [], "report": "no bibliography file"}
    entries = checker.parse_bib(bib_path.read_text(encoding="utf-8"))
    records = _record_cache()
    checker.RECORDS = records
    problems: list[dict] = []
    unchecked: list[str] = []
    buffer = io.StringIO()
    in_a_row = [0]
    lock = threading.Lock()
    given_up = threading.Event()

    def one(entry: dict) -> tuple[str, list[str]]:
        fields = entry.get("fields") or {}
        looks_up = any(fields.get(name, "").strip() for name in ("doi", "isbn", "eprint"))
        if looks_up and given_up.is_set():
            return "unchecked", ["not asked: the services stopped answering"]
        status, messages = checker.check(entry)
        if looks_up:
            with lock:
                in_a_row[0] = in_a_row[0] + 1 if status == "unchecked" else 0
                if in_a_row[0] >= GIVE_UP_AFTER:
                    given_up.set()
        return status, messages

    with redirect_stdout(buffer), ThreadPoolExecutor(max_workers=CHECKED_AT_ONCE) as pool:
        # Four at a time, each a request or two to the publisher's record,
        # where one at a time a hundred entries waited on a hundred round
        # trips in a row. `map` keeps the entries' order.
        verdicts = pool.map(one, entries)
        by_hand: list[str] = []
        for entry, (status, messages) in zip(entries, verdicts):
            # Checked by hand is neither a problem nor a lookup that passed,
            # and the report keeps it apart from both.
            if status == "hand":
                by_hand.append(entry.get("key", "?"))
                continue
            # Nor is a lookup that got no answer: a rate limit is not 236
            # bad references, which is how it read until 19 November 2026.
            if status == "unchecked":
                unchecked.append(entry.get("key", "?"))
                continue
            # `check` answers a status and its messages, and the status is
            # the verdict: a manually verified entry comes back "ok" with a
            # message saying so, and an entry whose record was reached and
            # matched comes back "ok" with none.  Reading the pair as a
            # list made every entry a problem and the join over it fail.
            if status != "ok":
                fields = entry.get("fields") or {}
                unidentified = not any(
                    fields.get(name, "").strip() for name in ("doi", "isbn", "eprint"))
                problem = {
                    "key": entry.get("key", "?"),
                    "status": status,
                    "issues": list(messages),
                    # Nothing to look up: the writer can check it by hand.
                    "unidentified": unidentified,
                }
                if unidentified and entry.get("type", "").lower() == "book":
                    problem["isbn"] = _suggested_isbn(checker, fields)
                problems.append(problem)
    if records is not None:
        records.save()
    return {
        "checked": len(entries),
        "problems": problems,
        "by_hand": by_hand,
        "unchecked": unchecked,
        # Seconds until the services that refused will answer again, so
        # the writer is told when to try rather than just "later".
        "retry_after": round(checker.refusing_for()) if unchecked else 0,
        "refusing": checker.refusing() if unchecked else [],
        "report": buffer.getvalue()[-4000:],
    }


def said(result: dict) -> str:
    """`verify`'s answer in words, for either agent's check tool."""
    by_hand = result.get("by_hand") or []
    hand = (f" {len(by_hand)} have nothing to look up and were checked by hand "
            f"({', '.join(by_hand)})." if by_hand else "")
    unchecked = result.get("unchecked") or []
    waiting = ""
    if unchecked:
        minutes = max(1, -(-int(result.get("retry_after") or 0) // 60))
        shown = ", ".join(unchecked[:10]) + (", ..." if len(unchecked) > 10 else "")
        who = result.get("refusing") or []
        why = (f"{' and '.join(who)} {'is' if len(who) == 1 else 'are'} rate-limiting"
               if who else "the services that hold their records did not answer")
        waiting = (f" {len(unchecked)} could not be checked, because {why} "
                   f"({shown}). These are not failures: run the check again in "
                   f"about {minutes} minute{'s' if minutes != 1 else ''}.")
    looked = result["checked"] - len(unchecked) - len(by_hand)
    if not result["problems"]:
        if unchecked:
            passed = (f"The {looked} entries that could be looked up match their "
                      "records." if looked else "")
            return (passed + waiting + hand).strip()
        return (f"All {result['checked']} entries check out against their "
                f"published records.{hand}")
    lines = [f"{len(result['problems'])} of {result['checked']} entries have problems:{hand}"]
    for problem in result["problems"]:
        line = (f"- {problem['key']} ({problem.get('status', 'FAIL')}): "
                f"{'; '.join(problem['issues'])}")
        if problem.get("isbn"):
            line += (f" Open Library has ISBN {problem['isbn']} for this title; "
                     "offer it to the writer, who decides whether it is the edition cited.")
        elif problem.get("unidentified"):
            line += (" If the writer has checked the source itself, they can mark "
                     "it checked by hand; do not write verified = {manual} yourself.")
        lines.append(line)
    if waiting:
        lines.append(waiting.strip())
    return "\n".join(lines)


def _suggested_isbn(checker, fields: dict) -> str:
    """An ISBN for a book entry that has none, or "": offered, never
    written, since a title can name several editions."""
    title = re.sub(r"[{}\\]", "", fields.get("title", "")).strip()
    if not title:
        return ""
    author = checker.first_surname(fields.get("author", ""))
    try:
        return checker.isbn_for(title, author) or ""
    except Exception:
        return ""


MANUAL_FIELD = "verified = {manual}"


def checked_by_hand(text: str, key: str) -> str | None:
    """The .bib text with `key` marked `verified = {manual}`, or None when
    there is no such entry, or it carries an identifier to check instead.

    The writer's say-so, from the check's own button: the agent may propose
    it and never writes it. A line is added after the entry's opening; the
    rest of the entry is left exactly as it was.
    """
    match = re.search(r"^@(\w+)\s*\{\s*" + re.escape(key) + r"\s*,", text, re.M)
    if not match:
        return None
    entry = _load("verify_bib").parse_bib(text[match.start():])
    fields = (entry[0].get("fields") if entry else None) or {}
    if any(fields.get(name, "").strip() for name in ("doi", "isbn", "eprint")):
        return None
    if fields.get("verified", "").strip().lower() in {"manual", "true"}:
        return text
    return text[:match.end()] + f"\n  {MANUAL_FIELD}," + text[match.end():]
