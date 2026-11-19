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
    ----     not checked: the lookup got no answer (rate limited,
             timed out, a server error); run again later
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


# A LaTeX accent over one letter, `\'o`, `{\'o}`, `\'{o}`, `\v{s}` or
# `\v s`, is that letter for comparison: the record spells the name in
# Unicode, and NFKD below reduces it to the same letter.  Left alone, the
# backslash and braces were stripped and the accent mark became a space,
# so Cach{\'o}n folded to "cach on" and failed the first-author match.
_SYMBOL_ACCENT = re.compile(r"\\['`^\"~=.]\s*\{?\s*\\?([A-Za-z])\s*\}?")
_LETTER_ACCENT = re.compile(r"\\[uvHckrdbt](?:\s*\{\s*\\?([A-Za-z])\s*\}|\s+\\?([A-Za-z]))")
_LATEX_LETTER = re.compile(r"\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])\s*")
_LATEX_LETTERS = {"ss": "ss", "ae": "ae", "AE": "AE", "oe": "oe", "OE": "OE",
                  "aa": "a", "AA": "A", "o": "o", "O": "O", "l": "l", "L": "L",
                  "i": "i", "j": "j"}
# Letters NFKD leaves whole, since they are letters of their own rather
# than a letter and a mark: Ørsted, Łukasz, Gauß.
_WHOLE_LETTERS = str.maketrans({
    "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "ß": "ss", "æ": "ae", "Æ": "AE",
    "œ": "oe", "Œ": "OE", "đ": "d", "Đ": "D", "ı": "i", "þ": "th", "Þ": "Th",
    "ð": "d", "Ð": "D",
})


def unlatex(text):
    """Accented letters written in LaTeX, as the plain letters they are."""
    text = _LETTER_ACCENT.sub(lambda m: m.group(1) or m.group(2), text)
    text = _SYMBOL_ACCENT.sub(lambda m: m.group(1), text)
    return _LATEX_LETTER.sub(lambda m: _LATEX_LETTERS[m.group(1)], text)


def fold(text):
    """Lowercase ASCII, no accents, no punctuation -- for comparison."""
    text = html.unescape(re.sub(r"<[^>]+>", "", text or ""))
    text = unlatex(text).translate(_WHOLE_LETTERS)
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


# Every request goes through `polite_get`, which keeps to what each service
# asks of its clients.  Four lookups at once with no pacing and no contact
# address had Crossref answering 429 to nearly every one of 258 entries,
# and the check read each refusal as a reference that failed (the thesis,
# 19 November 2026).  A host not listed here gets the last line.
#
#: host: (seconds between requests, at once without a contact address,
#: at once with one).  Crossref's public pool allows one request at a
#: time and its polite pool three; arXiv asks for three seconds between
#: requests; Semantic Scholar, without a key, about one a second.
PACE = {
    "api.crossref.org": (0.2, 1, 3),
    "doi.org": (0.2, 2, 2),
    "api.openalex.org": (0.1, 2, 4),
    "api.semanticscholar.org": (1.0, 1, 1),
    "export.arxiv.org": (3.0, 1, 1),
    "openlibrary.org": (0.3, 1, 1),
    "www.googleapis.com": (0.2, 2, 2),
    "": (0.2, 2, 2),
}
#: The hosts that ask a client to name a contact, and the only ones sent
#: it: Crossref's and OpenAlex's polite pools.
CONTACT_HOSTS = ("api.crossref.org", "api.openalex.org")
#: Tries after a 429 or a 503 before the host counts as refusing.
RETRIES = 3
#: The longest a refused request waits to try again.  A host asking for
#: longer is reported as refusing, with the wait it asked for.
LONGEST_WAIT = 30.0
#: Off only in the test suite, which would otherwise sleep through arXiv's
#: three seconds wherever a stub stands in for it.
PACING = True


class RateLimited(Exception):
    """A host refused with 429 or 503 every time it was asked."""

    def __init__(self, host, retry_after):
        self.host, self.retry_after = host, retry_after
        super().__init__(f"{host} is refusing requests for now (rate limited); "
                         f"try again in about {max(1, round(retry_after / 60))} min")


class _Gate:
    """One host's turn-taking: how many at once, and how far apart."""

    def __init__(self, interval, at_once):
        import threading
        self.interval = interval
        self.slots = threading.BoundedSemaphore(at_once)
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait_turn(self):
        with self.lock:
            now = time.monotonic()
            at = max(now, self.next_at)
            self.next_at = at + self.interval
        if PACING and at > now:
            time.sleep(at - now)

    def hold(self, seconds):
        """Nobody asks this host again for `seconds`."""
        with self.lock:
            self.next_at = max(self.next_at, time.monotonic() + seconds)

    def held_for(self):
        with self.lock:
            return max(0.0, self.next_at - time.monotonic())


_GATES = {}


def _gate(host):
    """The gate for a host, at the concurrency the contact address earns.
    Read at each request, since NextTex sets the address after loading."""
    interval, plain, polite = PACE.get(host, PACE[""])
    at_once = polite if MAILTO else plain
    key = (host, at_once)
    if key not in _GATES:
        _GATES[key] = _Gate(interval, at_once)
    return _GATES[key]


def _retry_after(response, attempt):
    """Seconds the host asked for, or a doubling guess when it did not say."""
    raw = (getattr(response, "headers", None) or {}).get("Retry-After", "")
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        pass
    try:
        from email.utils import parsedate_to_datetime
        from datetime import datetime, timezone
        when = parsedate_to_datetime(raw)
        return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError, IndexError):
        return 2.0 * (2 ** attempt)


def polite_get(url, get=None, **kwargs):
    """`get(url, **kwargs)` at the host's pace, retried on 429 and 503.

    `get` defaults to the shared session's; the other scripts pass their
    own `requests.get`.  Raises `RateLimited` when the host still refuses
    after `RETRIES` tries, or asks for a wait longer than `LONGEST_WAIT`.
    """
    from urllib.parse import urlsplit
    host = (urlsplit(url).hostname or "").lower()
    gate = _gate(host)
    kwargs.setdefault("timeout", TIMEOUT)
    # The contact rides in the User-Agent, and every script sends its UA
    # to every host. Only the two services that ask for it are given it;
    # it was going to doi.org, arXiv, Semantic Scholar and the catalogues
    # too, though the setting says "Sent to them only".
    headers = dict(kwargs.get("headers") or {})
    agent = headers.get("User-Agent")
    if agent and host not in CONTACT_HOSTS:
        headers["User-Agent"] = re.sub(r" \(mailto:[^)]*\)", "", agent)
        kwargs["headers"] = headers
    for attempt in range(RETRIES + 1):
        # A host still inside a long refusal is not asked again: waiting it
        # out would hold each entry for minutes, and asking anyway would
        # only lengthen the refusal.
        held = gate.held_for()
        if held > LONGEST_WAIT:
            raise RateLimited(host, held)
        with gate.slots:
            gate.wait_turn()
            r = (get or HTTP.get)(url, **kwargs)
        if getattr(r, "status_code", 200) not in (429, 503):
            return r
        # The hold is the wait: the next turn, this request's or another
        # thread's, starts once it is over.
        wait = _retry_after(r, attempt)
        if attempt == RETRIES:
            # Refused every time it was asked: held past `LONGEST_WAIT`, so
            # the next entries are told at once instead of each waiting out
            # four more refusals. A medium wait, five to thirty seconds,
            # otherwise held one tool call for minutes.
            wait = max(wait, 2 * LONGEST_WAIT)
        gate.hold(wait)
        if attempt == RETRIES or wait > LONGEST_WAIT:
            raise RateLimited(host, wait)
    raise RateLimited(host, 0.0)  # not reached


#: The hosts by the names a writer knows them by.
HOST_NAMES = {"api.crossref.org": "Crossref", "doi.org": "doi.org",
              "export.arxiv.org": "arXiv", "openlibrary.org": "Open Library",
              "www.googleapis.com": "Google Books", "api.openalex.org": "OpenAlex",
              "api.semanticscholar.org": "Semantic Scholar"}


def refusing():
    """The services holding back right now, by name, in a stable order."""
    held = {HOST_NAMES.get(host, host) for (host, _), gate in list(_GATES.items())
            if gate.held_for() > 0}
    return sorted(held)


def refusing_for():
    """Seconds until every host that refused is willing again, or 0."""
    return max((gate.held_for() for gate in list(_GATES.values())), default=0.0)


def unreachable(exc):
    """Whether a lookup failed for want of an answer rather than with one:
    refused, timed out, not connected, or a server error.  Such an entry is
    not checked, which is a different thing from failing the check."""
    if isinstance(exc, (RateLimited, requests.Timeout, requests.ConnectionError)):
        return True
    status = getattr(getattr(exc, "response", None), "status_code", None)
    return isinstance(exc, requests.HTTPError) and status is not None and status >= 500


#: DOI prefixes registered with DataCite, which Crossref answers 404 for
#: every time: arXiv's and Zenodo's.  Asking Crossref first cost a request
#: per preprint, and when Crossref was refusing, the refusal came before
#: the doi.org request that would have answered (the thesis, 19 November
#: 2026).
NOT_CROSSREF = ("10.48550/", "10.5281/")


def not_crossref(doi):
    """Whether a DOI is one Crossref never holds, so doi.org is asked first."""
    return doi.strip().lower().startswith(NOT_CROSSREF)


def crossref(doi):
    """The record behind a DOI: Crossref's, or, for a DOI Crossref does
    not hold (arXiv, Zenodo, a dataset), the CSL JSON doi.org negotiates
    from whichever agency does, folded into Crossref's shape."""
    if not not_crossref(doi):
        url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
        r = polite_get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
        if r.status_code != 404:
            r.raise_for_status()
            return r.json()["message"]
    r = polite_get(f"https://doi.org/{quote(doi, safe='/')}",
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
    r = polite_get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
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
    r = polite_get("https://openlibrary.org/api/books",
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
    r = polite_get("https://www.googleapis.com/books/v1/volumes",
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
    r = polite_get("https://openlibrary.org/search.json", params=params,
                 headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    docs = r.json().get("docs") or []
    for raw in (docs[0].get("isbn") or []) if docs else []:
        isbn = normalise_isbn(raw)
        if isbn:
            return isbn
    return None


#: Somewhere to keep records already fetched, with `get(kind, id)` and
#: `put(kind, id, record)`, or None.  NextTex gives it one; the script on
#: its own has none.  Only a record that was found is kept, never a
#: verdict: the comparison below runs every time, so an entry edited since
#: is checked against the record anew.
RECORDS = None


def looked_up(kind, ident, fetch):
    """`fetch(ident)`, or the record `RECORDS` already holds for it."""
    store = RECORDS
    if store is not None:
        kept = store.get(kind, ident)
        if kept is not None:
            return kept
    meta = fetch(ident)
    if meta is not None and store is not None:
        store.put(kind, ident, meta)
    return meta


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
            meta = looked_up("doi", doi, crossref)
        except Exception as exc:
            if unreachable(exc):
                return "unchecked", [f"not checked, the DOI lookup got no answer: {exc}"]
            return "FAIL", [f"Crossref lookup failed: {exc}"]
        if meta is None:
            return "FAIL", [f"DOI does not resolve at Crossref or doi.org: {doi}"]
        source = f"doi:{doi}"
    elif eprint and "arxiv" in archive:
        try:
            meta = looked_up("arxiv", eprint, arxiv)
        except Exception as exc:
            if unreachable(exc):
                return "unchecked", [f"not checked, arXiv gave no answer: {exc}"]
            return "FAIL", [f"arXiv lookup failed: {exc}"]
        if meta is None:
            return "FAIL", [f"arXiv ID not found: {eprint}"]
        source = f"arXiv:{eprint}"
    elif isbn_raw:
        isbn = normalise_isbn(isbn_raw)
        if not isbn:
            return "FAIL", [f"malformed ISBN: {isbn_raw}"]
        try:
            meta = looked_up("isbn", isbn, isbn_record)
        except Exception as exc:
            if unreachable(exc):
                return "unchecked", [f"not checked, the catalogue gave no answer: {exc}"]
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

    # `polite_get` paces the requests, so there is no sleep here.
    counts = {"ok": 0, "hand": 0, "WARN": 0, "FAIL": 0, "unchecked": 0}
    for e in entries:
        status, msgs = check(e)
        counts[status] += 1
        marker = {"ok": "ok  ", "hand": "hand", "WARN": "WARN", "FAIL": "FAIL",
                  "unchecked": "----"}[status]
        print(f"{marker}  {e['key']}")
        for m in msgs:
            print(f"        {m}")

    if dupes:
        print(f"\nFAIL  duplicate citation keys: {', '.join(sorted(dupes))}")
        counts["FAIL"] += 1

    total = len(entries)
    print(f"\n{total} entr{'y' if total == 1 else 'ies'}: "
          f"{counts['ok']} ok, {counts['hand']} checked by hand, "
          f"{counts['WARN']} warning, {counts['FAIL']} failed, "
          f"{counts['unchecked']} not checked")

    if counts["unchecked"]:
        print(f"\n{counts['unchecked']} could not be looked up (no answer, or rate "
              "limited). They are not failures; run the check again later.")
    if counts["FAIL"] or counts["unchecked"] or (args.strict and counts["WARN"]):
        print("\nreferences.bib is NOT clean -- fix the entries above before citing them.")
        return 1
    print("\nreferences.bib verified against publisher records.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
