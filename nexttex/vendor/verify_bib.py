#!/usr/bin/env python3
"""Check every references.bib entry against the publisher's record.

A hallucinated citation in a dissertation is an integrity failure, not
a typo, so this runs as a gate rather than a courtesy:

    make check-refs

Every entry must carry a DOI (or an arXiv ID for a preprint).  For each
one the script fetches the authoritative record and compares title,
first author, year and journal.  It exits nonzero if anything cannot be
verified or does not match, so it can be wired into a pre-commit hook
or CI.

Report symbols:
    ok       record matches
    WARN     record found, a field differs (often just formatting)
    FAIL     no DOI, DOI does not resolve, or the record is a
             different paper

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


def crossref(doi):
    url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()["message"]


def arxiv(arxiv_id):
    url = f"https://export.arxiv.org/api/query?id_list={quote(arxiv_id, safe='')}"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
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

    # Books and theses have no DOI often enough that they get an
    # explicit escape hatch, but it has to be deliberate.
    if f.get("verified", "").lower() in {"manual", "true"}:
        return "ok", ["marked manually verified (verified = {manual})"]

    if doi:
        try:
            meta = crossref(doi)
        except Exception as exc:
            return "FAIL", [f"Crossref lookup failed: {exc}"]
        if meta is None:
            return "FAIL", [f"DOI does not resolve in Crossref: {doi}"]
        source = f"doi:{doi}"
    elif eprint and "arxiv" in archive:
        try:
            meta = arxiv(eprint)
        except Exception as exc:
            return "FAIL", [f"arXiv lookup failed: {exc}"]
        if meta is None:
            return "FAIL", [f"arXiv ID not found: {eprint}"]
        source = f"arXiv:{eprint}"
    else:
        return "FAIL", ["no DOI and no arXiv ID -- cannot be verified. "
                        "Add one, or set verified = {manual} after checking "
                        "the physical source by hand."]

    status = "ok"

    bib_title = squash(f.get("title", ""))
    rec_title = squash((meta.get("title") or [""])[0])
    if bib_title and rec_title:
        ratio = difflib.SequenceMatcher(None, bib_title, rec_title).ratio()
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

    counts = {"ok": 0, "WARN": 0, "FAIL": 0}
    for e in entries:
        status, msgs = check(e)
        counts[status] += 1
        marker = {"ok": "ok  ", "WARN": "WARN", "FAIL": "FAIL"}[status]
        print(f"{marker}  {e['key']}")
        for m in msgs:
            print(f"        {m}")
        time.sleep(0.2)

    if dupes:
        print(f"\nFAIL  duplicate citation keys: {', '.join(sorted(dupes))}")
        counts["FAIL"] += 1

    total = len(entries)
    print(f"\n{total} entr{'y' if total == 1 else 'ies'}: "
          f"{counts['ok']} ok, {counts['WARN']} warning, {counts['FAIL']} failed")

    if counts["FAIL"] or (args.strict and counts["WARN"]):
        print("\nreferences.bib is NOT clean -- fix the entries above before citing them.")
        return 1
    print("\nreferences.bib verified against publisher records.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
