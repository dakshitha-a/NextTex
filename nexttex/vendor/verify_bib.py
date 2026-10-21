#!/usr/bin/env python3
"""Check every references.bib entry against the publisher's record.

A hallucinated citation in a dissertation is an integrity failure, not
a typo, so this runs as a gate rather than a courtesy:

    make check-refs

Every entry must carry a DOI, an ISBN (for a book) or an arXiv ID (for
a preprint).  For each one the script fetches the authoritative record
(Crossref for DOIs, Open Library with Google Books as fallback for
ISBNs, arXiv for preprints) and compares title, first author, year and
journal or publisher.  It exits nonzero if anything cannot be verified
or does not match, so it can be wired into a pre-commit hook or CI.

A source with none of the three, an older thesis, a 1932 paper, a
database, a program, is checked by hand and marked `verified = {manual}`.
That mark counts only where there is nothing to look up: an entry that
carries an identifier is checked against it whatever it says.

Report symbols:
    ok       record matches
    hand     no identifier, marked verified = {manual}
    WARN     record found, a field differs (often just formatting)
    FAIL     no DOI/ISBN/arXiv ID, the identifier does not resolve,
             or the record is a different work

    --strict   treat warnings as failures
    --only KEY check a single entry
"""

import argparse
import difflib
import html
import re
import os
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote

import requests

# Crossref and OpenAlex ask callers to identify themselves, and reward the
# ones that do with a faster, less rate-limited pool.  This used to be the
# author's own email address, which was fine while this was one person's
# dissertation tooling and became a small privacy leak the moment it was
# published: every user's searches identified as, and gave a contact
# address for, somebody else.  Set NEXTTEX_CONTACT to join the polite pool.
#
# Inlined rather than imported: these are standalone scripts, loaded by
# path and runnable on their own, and self-containment is the point of
# this directory.
MAILTO = os.environ.get("NEXTTEX_CONTACT", "").strip() or None
UA = f"nexttex-refcheck/1.0" + (f" (mailto:{MAILTO})" if MAILTO else "")
TIMEOUT = 30
TITLE_THRESHOLD = 0.87      # below this, it is a different paper

# Journal names appear both abbreviated and in full; neither form is
# wrong, so compare them loosely.
ABBREV = {
    "j": "journal", "phys": "physical", "chem": "chemical",
    "lett": "letters", "rev": "review", "am": "american",
    "soc": "society", "int": "international", "ed": "edition",
    "theory": "theory", "comput": "computation", "commun": "communications",
    "mol": "molecular", "annu": "annual", "acc": "accounts", "res": "research",
    "sci": "science", "natl": "national", "acad": "academy", "proc": "proceedings",
    "angew": "angewandte", "engl": "english", "adv": "advances",
}


def fold(text):
    """Lowercase ASCII, no accents, no punctuation -- for comparison."""
    text = html.unescape(re.sub(r"<[^>]+>", "", text or ""))
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[\{\}\\$]", "", text)
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).strip()


def squash(text):
    return re.sub(r"\s+", " ", fold(text))


def expand_journal(name):
    words = [ABBREV.get(w, w) for w in squash(name).split()]
    return " ".join(w for w in words if w not in {"the", "of", "and"})


def parse_bib(text):
    """Minimal BibTeX reader: enough to pull fields out, brace-aware.

    Written by hand rather than pulling in a dependency, because the
    only job is reading fields back out of files this project wrote.
    """
    entries = []
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", text):
        kind, key = m.group(1).lower(), m.group(2)
        # Scan from the entry's OWN opening brace, not from the comma
        # after the key -- otherwise the depth counter starts at the
        # first field's brace and the entry ends after one field.
        i, depth = text.index("{", m.start()), 0
        while i < len(text):                    # find the closing brace
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = text[m.end():i]

        fields, pos = {}, 0
        while True:
            fm = re.compile(r"(\w[\w-]*)\s*=\s*").search(body, pos)
            if not fm:
                break
            j = fm.end()
            if j < len(body) and body[j] == "{":
                d, k = 0, j
                while k < len(body):
                    if body[k] == "{":
                        d += 1
                    elif body[k] == "}":
                        d -= 1
                        if d == 0:
                            break
                    k += 1
                value, pos = body[j + 1:k], k + 1
            elif j < len(body) and body[j] == '"':
                k = body.index('"', j + 1)
                value, pos = body[j + 1:k], k + 1
            else:
                k = body.find(",", j)
                k = len(body) if k == -1 else k
                value, pos = body[j:k], k
            fields[fm.group(1).lower()] = value.strip()
        entries.append({"type": kind, "key": key, "fields": fields,
                        "line": text[:m.start()].count("\n") + 1})
    return entries


def first_surname(author_field):
    """First author's family name from a BibTeX author list."""
    if not author_field:
        return ""
    first = re.split(r"\s+and\s+", author_field, maxsplit=1)[0].strip()
    if "," in first:
        return fold(first.split(",")[0])
    return fold(first.split()[-1]) if first.split() else ""


# One connection pool for every lookup. A bare `requests.get` opened a new
# connection, TLS handshake and all, for every entry, and a bibliography of
# a hundred entries paid that a hundred times over to the same two hosts.
# A Session is safe to share between the threads NextTex checks entries on.
HTTP = requests.Session()


def crossref(doi):
    """The record behind a DOI: Crossref's, or, for a DOI Crossref does
    not hold (arXiv, Zenodo, a dataset), the CSL JSON doi.org negotiates
    from whichever agency does, folded into Crossref's shape."""
    url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
    r = HTTP.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    if r.status_code != 404:
        r.raise_for_status()
        return r.json()["message"]
    r = HTTP.get(f"https://doi.org/{quote(doi, safe='/')}",
                 headers={"User-Agent": UA, "Accept": "application/vnd.citationstyles.csl+json"},
                 timeout=TIMEOUT, allow_redirects=True)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    record = dict(r.json() or {})
    for field in ("title", "container-title"):
        if isinstance(record.get(field), str):
            record[field] = [record[field]]
    return record


def arxiv(arxiv_id):
    url = f"https://export.arxiv.org/api/query?id_list={quote(arxiv_id, safe='')}"
    r = HTTP.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    m = re.search(r"<entry>.*?<title>(.*?)</title>", r.text, re.DOTALL)
    if not m:
        return None
    names = re.findall(r"<name>(.*?)</name>", r.text)
    year = re.search(r"<published>(\d{4})", r.text)
    return {"title": [m.group(1)],
            "author": [{"family": names[0].split()[-1]}] if names else [],
            "issued": {"date-parts": [[int(year.group(1))]]} if year else {},
            "container-title": ["arXiv"]}


def normalise_isbn(raw):
    """Digits only, ISBN-10 converted to ISBN-13; None if malformed."""
    s = re.sub(r"[^0-9Xx]", "", raw or "").upper()
    if len(s) == 10:
        core = "978" + s[:9]
        check = (10 - sum((1 if i % 2 == 0 else 3) * int(c)
                          for i, c in enumerate(core)) % 10) % 10
        return core + str(check)
    if len(s) == 13 and s.isdigit():
        return s
    return None


def isbn_record(isbn):
    """Book record by ISBN, shaped like a Crossref record.

    Open Library first; Google Books if Open Library has nothing.  Returns
    None if neither knows the ISBN.  Catalogue records are less careful
    than publishers': they drop co-authors (Open Library lists only Szabo
    for Szabo and Ostlund, 9780486691862) and lower-case titles, so an
    entry built from one is for the writer to check against the title page.
    """
    r = HTTP.get("https://openlibrary.org/api/books",
                 params={"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"},
                 headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    rec = r.json().get(f"ISBN:{isbn}")
    if rec:
        names = [a.get("name", "") for a in rec.get("authors", [])]
        year = re.search(r"\d{4}", rec.get("publish_date", "") or "")
        return {"title": [rec.get("title", "")],
                "subtitle": [rec.get("subtitle", "")] if rec.get("subtitle") else [],
                "author": [{"family": n.split()[-1], "full": n} for n in names if n],
                "issued": {"date-parts": [[int(year.group())]]} if year else {},
                "publisher": ", ".join(p.get("name", "") for p in rec.get("publishers", [])),
                "place": ", ".join(p.get("name", "") for p in rec.get("publish_places", [])),
                "source": "Open Library"}
    r = HTTP.get("https://www.googleapis.com/books/v1/volumes",
                 params={"q": f"isbn:{isbn}"}, headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    items = r.json().get("items") or []
    if not items:
        return None
    v = items[0].get("volumeInfo") or {}
    year = re.search(r"\d{4}", v.get("publishedDate", "") or "")
    return {"title": [v.get("title", "")],
            "subtitle": [v["subtitle"]] if v.get("subtitle") else [],
            "author": [{"family": n.split()[-1], "full": n} for n in v.get("authors", []) if n],
            "issued": {"date-parts": [[int(year.group())]]} if year else {},
            "publisher": v.get("publisher", ""), "place": "",
            "source": "Google Books"}


def isbn_for(title, author=""):
    """An ISBN Open Library holds for a book by its title and first author,
    or None.  A suggestion for a book entry that has no identifier, never
    written by itself: a title can name several editions."""
    params = {"title": title, "limit": 1, "fields": "isbn,title"}
    if author:
        params["author"] = author
    r = HTTP.get("https://openlibrary.org/search.json", params=params,
                 headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    docs = r.json().get("docs") or []
    for raw in (docs[0].get("isbn") or []) if docs else []:
        isbn = normalise_isbn(raw)
        if isbn:
            return isbn
    return None


def record_year(meta):
    for field in ("published-print", "published-online", "issued", "created"):
        parts = (meta.get(field) or {}).get("date-parts") or []
        if parts and parts[0] and parts[0][0]:
            return int(parts[0][0])
    return None


def check(entry):
    """Return (status, [messages]) for one entry."""
    f, msgs = entry["fields"], []
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", f.get("doi", "").strip())
    eprint = f.get("eprint", "").strip()
    archive = f.get("eprinttype", f.get("archiveprefix", "")).lower()

    isbn_raw = f.get("isbn", "").strip()

    # A source with no DOI, no ISBN and no arXiv ID (a thesis, some
    # software) gets an explicit escape hatch, but it has to be
    # deliberate.  An entry that does carry an identifier is checked
    # against it even if it is also marked manual.
    if not (doi or isbn_raw or eprint) and \
            f.get("verified", "").lower() in {"manual", "true"}:
        return "hand", ["checked by hand (verified = {manual})"]

    if doi:
        try:
            meta = crossref(doi)
        except Exception as exc:
            return "FAIL", [f"Crossref lookup failed: {exc}"]
        if meta is None:
            return "FAIL", [f"DOI does not resolve at Crossref or doi.org: {doi}"]
        source = f"doi:{doi}"
    elif eprint and "arxiv" in archive:
        try:
            meta = arxiv(eprint)
        except Exception as exc:
            return "FAIL", [f"arXiv lookup failed: {exc}"]
        if meta is None:
            return "FAIL", [f"arXiv ID not found: {eprint}"]
        source = f"arXiv:{eprint}"
    elif isbn_raw:
        isbn = normalise_isbn(isbn_raw)
        if not isbn:
            return "FAIL", [f"malformed ISBN: {isbn_raw}"]
        try:
            meta = isbn_record(isbn)
        except Exception as exc:
            return "FAIL", [f"ISBN lookup failed: {exc}"]
        if meta is None:
            return "FAIL", [f"ISBN not found in Open Library or Google Books: {isbn}"]
        source = f"isbn:{isbn} ({meta['source']})"
    else:
        return "FAIL", ["no DOI, ISBN or arXiv ID, so it cannot be looked up. "
                        "Add one (an ISBN for a book), or set verified = {manual} "
                        "after checking the source by hand."]

    status = "ok"

    bib_title = squash(f.get("title", ""))
    rec_title = squash((meta.get("title") or [""])[0])
    if bib_title and rec_title:
        candidates = [rec_title]
        if meta.get("subtitle"):            # books: "Title: Subtitle"
            candidates.append(squash(rec_title + " " + meta["subtitle"][0]))
        ratio = max(difflib.SequenceMatcher(None, bib_title, c).ratio()
                    for c in candidates)
        if ratio < TITLE_THRESHOLD:
            status = "FAIL"
            shown = re.sub(r"\s+", " ",
                           re.sub(r"<[^>]+>", "", (meta.get("title") or [""])[0])).strip()
            msgs.append(f"title mismatch ({ratio:.0%}) for {source}\n"
                        f"           bib: {f.get('title','')}\n"
                        f"        record: {shown}")
    elif not bib_title:
        status = "WARN"
        msgs.append("entry has no title field")

    bib_author = first_surname(f.get("author", ""))
    rec_authors = meta.get("author") or []
    rec_author = fold(rec_authors[0].get("family", "")) if rec_authors else ""
    if bib_author and rec_author and bib_author != rec_author:
        status = "FAIL"
        msgs.append(f"first author mismatch: bib '{bib_author}' vs record '{rec_author}'")

    bib_year = re.search(r"\d{4}", f.get("year", "") or f.get("date", ""))
    rec_y = record_year(meta)
    if bib_year and rec_y and abs(int(bib_year.group()) - rec_y) > 1:
        status = "FAIL"
        msgs.append(f"year mismatch: bib {bib_year.group()} vs record {rec_y}")

    bib_journal = f.get("journal", "") or f.get("journaltitle", "")
    rec_journal = (meta.get("container-title") or [""])[0]
    if bib_journal and rec_journal:
        a, b = expand_journal(bib_journal), expand_journal(rec_journal)
        if a != b and difflib.SequenceMatcher(None, a, b).ratio() < 0.8:
            if status == "ok":
                status = "WARN"
            msgs.append(f"journal differs: bib '{bib_journal}' vs record '{rec_journal}'")

    # A catalogue's publisher is the least reliable field it has (Open
    # Library gives "University of Cambridge ESOL Examinations" for Sakurai's
    # Modern Quantum Mechanics), so it only ever warns.
    bib_pub = f.get("publisher", "")
    rec_pub = meta.get("publisher", "")
    if isbn_raw and not doi and bib_pub and rec_pub:
        a, b = squash(bib_pub), squash(rec_pub)
        if a not in b and b not in a and \
                difflib.SequenceMatcher(None, a, b).ratio() < 0.6:
            if status == "ok":
                status = "WARN"
            msgs.append(f"publisher differs: bib '{bib_pub}' vs record '{rec_pub}'")

    return status, msgs


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bib", nargs="?", default="references.bib")
    ap.add_argument("--strict", action="store_true", help="warnings fail too")
    ap.add_argument("--only", help="check one citation key")
    args = ap.parse_args()

    path = Path(args.bib)
    if not path.exists():
        print(f"error: {path} not found", file=sys.stderr)
        return 2

    entries = parse_bib(path.read_text(encoding="utf-8"))
    if args.only:
        entries = [e for e in entries if e["key"] == args.only]
        if not entries:
            print(f"error: no entry with key '{args.only}'", file=sys.stderr)
            return 2

    # A duplicate key silently overrides an earlier entry in LaTeX,
    # so the second paper simply disappears from the bibliography.
    seen, dupes = set(), set()
    for e in entries:
        if e["key"] in seen:
            dupes.add(e["key"])
        seen.add(e["key"])

    counts = {"ok": 0, "hand": 0, "WARN": 0, "FAIL": 0}
    for e in entries:
        status, msgs = check(e)
        counts[status] += 1
        marker = {"ok": "ok  ", "hand": "hand", "WARN": "WARN", "FAIL": "FAIL"}[status]
        print(f"{marker}  {e['key']}")
        for m in msgs:
            print(f"        {m}")
        time.sleep(0.2)

    if dupes:
        print(f"\nFAIL  duplicate citation keys: {', '.join(sorted(dupes))}")
        counts["FAIL"] += 1

    total = len(entries)
    print(f"\n{total} entr{'y' if total == 1 else 'ies'}: "
          f"{counts['ok']} ok, {counts['hand']} checked by hand, "
          f"{counts['WARN']} warning, {counts['FAIL']} failed")

    if counts["FAIL"] or (args.strict and counts["WARN"]):
        print("\nreferences.bib is NOT clean -- fix the entries above before citing them.")
        return 1
    print("\nreferences.bib verified against publisher records.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
