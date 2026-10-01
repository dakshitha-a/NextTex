r"""What is wrong with a `.bib` file, while it is being typed.

A `.tex` file gets chktex rows in the drawer; a `.bib` file got nothing,
and the mistakes a bibliography carries are the ones a venue's copy
editor sends back: the same key pasted twice, an `@article` with no
journal, a year that is a note rather than a number, one paper added
twice under two keys with the same DOI, and entries nobody cites.

The roadmap said the field rules were the ones `vendor/verify_bib.py`
applies. They are not: that script checks an entry against the
publisher's own record for the DOI it names, and has no notion of which
fields a type needs. The table below is BibTeX's own, from the manual,
and it is new here. The parser is that script's `parse_bib`, read-only
through `references._load`, because it is the one `.bib` reader in the
tree that carries an entry's line, which is what a drawer row needs.
"""

from __future__ import annotations

import re

from . import bibfix
from .references import _load

#: The fields BibTeX's standard styles require, per entry type.  A tuple
#: inside the list is an either: a book needs an author or an editor.
REQUIRED: dict[str, list[str | tuple[str, ...]]] = {
    "article": ["author", "title", "journal", "year"],
    "book": [("author", "editor"), "title", "publisher", "year"],
    "booklet": ["title"],
    "inbook": [("author", "editor"), "title", ("chapter", "pages"), "publisher", "year"],
    "incollection": ["author", "title", "booktitle", "publisher", "year"],
    "inproceedings": ["author", "title", "booktitle", "year"],
    "conference": ["author", "title", "booktitle", "year"],
    "manual": ["title"],
    "mastersthesis": ["author", "title", "school", "year"],
    "phdthesis": ["author", "title", "school", "year"],
    "misc": [],
    "proceedings": ["title", "year"],
    "techreport": ["author", "title", "institution", "year"],
    "unpublished": ["author", "title", "note"],
    # biblatex's commonest additions, with the fields its standard styles
    # complain about.
    "online": ["title", ("url", "doi")],
    "software": ["title"],
    "thesis": ["author", "title", "type", "institution", "year"],
    "report": ["author", "title", "type", "institution", "year"],
    "collection": ["editor", "title", "year"],
}

#: The fields the `@` snippet offers beyond the required ones, in the
#: order they are usually written.  Read by the completion table too.
OPTIONAL: dict[str, list[str]] = {
    "article": ["volume", "number", "pages", "month", "doi", "note"],
    "book": ["volume", "series", "address", "edition", "month", "isbn", "note"],
    "inproceedings": ["editor", "volume", "series", "pages", "address", "organization", "publisher", "doi"],
    "conference": ["editor", "volume", "series", "pages", "address", "organization", "publisher", "doi"],
    "incollection": ["editor", "volume", "series", "chapter", "pages", "address", "edition"],
    "phdthesis": ["type", "address", "month", "url"],
    "mastersthesis": ["type", "address", "month", "url"],
    "techreport": ["type", "number", "address", "month", "url"],
    "misc": ["author", "title", "howpublished", "year", "url", "note"],
    "unpublished": ["month", "year", "url"],
    "online": ["author", "year", "urldate"],
}

#: Not an entry: what `parse_bib` returns for the three directives.
NOT_ENTRIES = {"comment", "string", "preamble"}
#: A year is four digits.  `\the\year` and "in press" are not years and
#: the row says so.
YEAR = re.compile(r"^\s*\d{4}\s*$")
DOI_PREFIX = re.compile(r"^(?:https?://)?(?:dx\.)?doi\.org/", re.I)

EXPLAIN = {
    "duplicate-key": {
        "title": "A key defined twice",
        "detail": "BibTeX takes the first entry and warns about the second; biblatex refuses the file.",
        "fix": "Delete one, or rename it; Rename from the key's hover changes every \\cite with it.",
    },
    "missing-field": {
        "title": "A required field is missing",
        "detail": "The standard styles print a warning and leave a gap in the reference: an article with no journal is a title floating on its own.",
        "fix": "Add the field. The publisher's page for the DOI has every value.",
    },
    "year": {
        "title": "Not a year",
        "detail": "Styles sort and print the year as a number; \"in press\", \"forthcoming\" or \\the\\year sort last and print as written.",
        "fix": "Write the four digits; put \"in press\" in the note field.",
    },
    "duplicate-doi": {
        "title": "The same DOI twice",
        "detail": "Two entries carry one DOI, which is one paper added twice under two keys, and the reference list will show it twice.",
        "fix": "Merge keeps the fuller of the two and points every \\cite of the other at it.",
    },
    "title-caps": {
        "title": "Capitals a style will lower",
        "detail": "Most bibliography styles lowercase a title after its first word, so BERT prints as bert and LaTeX as latex unless the word is in braces.",
        "fix": "Protect capitals wraps each such word in braces; nothing else in the title changes.",
    },
    "bulky-fields": {
        "title": "Fields the reference list never prints",
        "detail": "An abstract, or a url beside a DOI, is carried by every entry a reference manager exported and printed by no standard style; a venue's copy editor asks for them gone, and a url beside a DOI can print the address twice.",
        "fix": "Drop them takes those fields out of every entry in the file, and leaves everything else as it is.",
    },
    "key-style": {
        "title": "A key unlike the others",
        "detail": "Most keys in this file are a surname and a year, and this one is not, which makes it the one a co-author has to look up.",
        "fix": "Rename gives it the author and year key, and every \\cite of it follows.",
    },
    "uncited": {
        "title": "Not cited",
        "detail": "No document cites this entry. BibTeX leaves it out of the reference list; nothing is wrong unless the venue wants the .bib tidy.",
        "fix": "Cite it, or leave it.",
    },
}


def _normalise_doi(value: str) -> str:
    return DOI_PREFIX.sub("", value.strip()).strip().lower()


def _row(
    kind: str, severity: str, message: str, path: str, line: int,
    fix: dict | None = None,
) -> dict:
    row = {
        "severity": severity,
        "message": message,
        "file": path,
        "line": line,
        "column": None,
        "source": "bib",
        "kind": kind,
        "explain": EXPLAIN[kind],
    }
    # A row whose repair is mechanical says so: the verb the drawer shows,
    # and what `bibfix.repair` needs to make it.
    if fix:
        row["fix"] = fix
    return row


def _has(fields: dict[str, str], name: str | tuple[str, ...]) -> bool:
    names = name if isinstance(name, tuple) else (name,)
    return any(fields.get(candidate, "").strip() for candidate in names)


def _said(name: str | tuple[str, ...]) -> str:
    return " or ".join(name) if isinstance(name, tuple) else name


def check(text: str, path: str, cited: set[str] | None = None) -> list[dict]:
    """Every row the file earns, in the drawer's shape.

    `cited` is the set of keys the documents cite, or None when nothing
    can be said about citing: either no document was read, or one of
    them says `\\nocite{*}`.
    """
    parse_bib = _load("verify_bib").parse_bib
    rows: list[dict] = []
    seen_keys: dict[str, int] = {}
    seen_dois: dict[str, str] = {}
    for entry in parse_bib(text):
        kind, key, fields, line = entry["type"], entry["key"], entry["fields"], entry["line"]
        if kind in NOT_ENTRIES:
            continue
        if key in seen_keys:
            rows.append(_row(
                "duplicate-key", "warning",
                f"{key} is defined again; the first is at line {seen_keys[key]}", path, line,
            ))
        else:
            seen_keys[key] = line
        for name in REQUIRED.get(kind, []):
            if not _has(fields, name):
                rows.append(_row(
                    "missing-field", "warning",
                    f"@{kind} {key} has no {_said(name)}", path, line,
                ))
        year = fields.get("year")
        if year is not None and year.strip() and not YEAR.match(year):
            rows.append(_row("year", "warning", f"{key}'s year is \"{year.strip()}\", not four digits", path, line))
        doi = _normalise_doi(fields.get("doi", ""))
        if doi:
            if doi in seen_dois:
                rows.append(_row(
                    "duplicate-doi", "warning",
                    f"{key} has the same DOI as {seen_dois[doi]}", path, line,
                    {"kind": "duplicate-doi", "key": key, "verb": "Merge"},
                ))
            else:
                seen_dois[doi] = key
        if cited is not None and key not in cited:
            rows.append(_row("uncited", "info", f"{key} is not cited by any document", path, line))
    rows.extend(_repairable(text, path))
    return sorted(rows, key=lambda row: row["line"])


def _repairable(text: str, path: str) -> list[dict]:
    """The rows `bibfix` can repair that the checks above do not raise."""
    rows: list[dict] = []
    every = bibfix.entries(text)
    heavy = 0
    first_heavy = 0
    for entry in every:
        if entry.kind in NOT_ENTRIES:
            continue
        title = entry.get("title")
        words = bibfix.unprotected_capitals(title.value) if title else []
        if words:
            listed = " and ".join(words[:2]) if len(words) <= 2 else ", ".join(words[:2]) + " and more"
            rows.append(_row(
                "title-caps", "info",
                f"{entry.key}'s title has {listed} unprotected, so most styles lowercase them",
                path, entry.line,
                {"kind": "title-caps", "key": entry.key, "verb": "Protect capitals"},
            ))
        if bibfix.bulky(entry):
            heavy += 1
            first_heavy = first_heavy or entry.line
        if bibfix.wants_key_style(entry, every):
            to = bibfix.proposed_key(entry, every)
            rows.append(_row(
                "key-style", "info",
                f"{entry.key} is not in author and year form, as most keys here are",
                path, entry.line,
                {"kind": "key-style", "key": entry.key, "verb": f"Rename to {to}"},
            ))
    if heavy:
        many = "1 entry carries" if heavy == 1 else f"{heavy} entries carry"
        rows.append(_row(
            "bulky-fields", "info",
            f"{many} an abstract, or a url beside its DOI",
            path, first_heavy,
            {"kind": "bulky-fields", "key": "", "verb": "Drop them"},
        ))
    return rows
