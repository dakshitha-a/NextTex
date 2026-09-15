#!/usr/bin/env python3
"""Add a reference to references.bib by fetching the publisher's record.

The point of this script is that a BibTeX entry never gets composed by
hand or from memory.  You give it a DOI; it asks Crossref for that
DOI's own BibTeX and writes down what comes back.  If the DOI does not
exist, nothing is written.

    tools/bib_from_doi.py 10.1103/PhysRev.28.1049
    tools/bib_from_doi.py 10.1103/PhysRev.28.1049 --key Schrodinger1926undulatory
    tools/bib_from_doi.py --file dois.txt

Entries are appended to references.bib.  A DOI already present is
skipped rather than duplicated.  Run tools/verify_bib.py afterwards.
"""

import argparse
import html
import re
import os
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_bib import parse_bib  # noqa: E402  (same directory)

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
UA = f"nexttex-bibtool/1.0" + (f" (mailto:{MAILTO})" if MAILTO else "")
TIMEOUT = 30

# Words too generic to identify a paper in a citation key.
STOPWORDS = {
    "the", "a", "an", "of", "on", "in", "for", "and", "with", "to",
    "from", "by", "at", "as", "is", "are", "using", "via", "new",
    "study", "studies", "effect", "effects", "role", "into",
}


def normalise_doi(raw):
    """Strip the many prefixes a DOI gets copy-pasted with."""
    doi = raw.strip()
    for prefix in ("https://doi.org/", "http://doi.org/",
                   "https://dx.doi.org/", "doi:", "DOI:"):
        if doi.lower().startswith(prefix.lower()):
            doi = doi[len(prefix):]
    return doi.strip().rstrip(".")


def fetch_bibtex(doi):
    """Ask the DOI for its own BibTeX: Crossref first, then the DOI itself.

    Crossref registers journal articles and most books.  A preprint on
    arXiv, a dataset, a Zenodo record, is registered with DataCite, which
    Crossref answers 404 for, so those had to be pasted in from a curl
    against doi.org by hand.  doi.org's content negotiation forwards to
    whichever agency holds the DOI, so it is the fallback for anything
    Crossref does not hold.
    """
    url = f"https://api.crossref.org/works/{quote(doi, safe='')}/transform/application/x-bibtex"
    r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/x-bibtex"},
                     timeout=TIMEOUT)
    if r.status_code != 404:
        r.raise_for_status()
        r.encoding = "utf-8"
        return r.text.strip()
    r = requests.get(f"https://doi.org/{quote(doi, safe='/')}",
                     headers={"User-Agent": UA, "Accept": "application/x-bibtex"},
                     timeout=TIMEOUT, allow_redirects=True)
    if r.status_code == 404:
        raise LookupError(f"DOI not found in Crossref or at doi.org: {doi}")
    r.raise_for_status()
    r.encoding = "utf-8"
    return r.text.strip()


def fetch_metadata(doi):
    """The JSON record, used for building a readable citation key.

    Crossref's shape where Crossref has it; otherwise the CSL JSON that
    doi.org negotiates from any agency, folded into the same shape (title
    and container-title as lists), and an empty record when nothing
    answers, so the key is made from the BibTeX fields instead.
    """
    url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    if r.status_code != 404:
        r.raise_for_status()
        return r.json()["message"]
    r = requests.get(f"https://doi.org/{quote(doi, safe='/')}",
                     headers={"User-Agent": UA, "Accept": "application/vnd.citationstyles.csl+json"},
                     timeout=TIMEOUT, allow_redirects=True)
    if r.status_code == 404:
        return {}
    r.raise_for_status()
    return csl_as_crossref(r.json())


def csl_as_crossref(record):
    """CSL JSON has `title` and `container-title` as strings where Crossref
    has lists; everything the key and the checker read is otherwise the
    same, so the two fields are wrapped and the record is used as it is."""
    folded = dict(record or {})
    for field in ("title", "container-title"):
        value = folded.get(field)
        if isinstance(value, str):
            folded[field] = [value]
    return folded


def ascii_fold(text):
    """Surname to a bare ASCII word, so keys stay typable."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^A-Za-z]", "", stripped)


def make_key(meta, fields=None):
    """FirstAuthorYYYYkeyword, e.g. Schrodinger1926undulatory.

    From the record when there is one, and from the BibTeX entry's own
    fields when there is not, which is the case for a DOI only doi.org
    could answer.
    """
    fields = {k.lower(): v for k, v in (fields or {}).items()}
    authors = meta.get("author") or []
    surname = ascii_fold(authors[0].get("family", "")) if authors else ""
    if not surname and fields.get("author"):
        first = fields["author"].split(" and ")[0].strip()
        surname = ascii_fold(first.split(",")[0] if "," in first else first.split()[-1])
    if not surname:
        container = (meta.get("container-title") or [fields.get("journal", "") or "Unknown"])[0]
        surname = ascii_fold(container)[:12] or "Unknown"

    year = ""
    for field in ("published-print", "published-online", "issued", "created"):
        parts = (meta.get(field) or {}).get("date-parts") or []
        if parts and parts[0] and parts[0][0]:
            year = str(parts[0][0])
            break
    if not year:
        found = re.search(r"\d{4}", fields.get("year", "") or fields.get("date", ""))
        year = found.group() if found else ""

    titles = meta.get("title") or [fields.get("title", "")]
    words = re.findall(r"[A-Za-z]+", clean_title(titles[0]).lower())
    keyword = next((w for w in words if w not in STOPWORDS and len(w) > 3), "")

    return f"{surname}{year}{keyword}"


def clean_title(title):
    """Crossref titles arrive as HTML fragments.

    Chemistry titles depend on the markup -- the italic *o* in
    "o-nitrophenol" and the subscripts in "H2O" carry meaning -- so
    the tags that matter are translated to LaTeX rather than
    discarded, and everything else is stripped.
    """
    title = title or ""
    for tag, cmd in (("i", "textit"), ("em", "textit"),
                     ("b", "textbf"), ("strong", "textbf"),
                     ("sub", "textsubscript"), ("sup", "textsuperscript"),
                     ("scp", "textsc")):
        title = re.sub(rf"<{tag}>\s*(.*?)\s*</{tag}>",
                       rf"\\{cmd}{{\g<1>}}", title,
                       flags=re.IGNORECASE | re.DOTALL)
    title = re.sub(r"<[^>]+>", "", title)          # drop the rest
    title = html.unescape(title)
    title = re.sub(r"\s+", " ", title).strip()
    # "\textit{o} -nitrophenol" -> "\textit{o}-nitrophenol"
    title = re.sub(r"\}\s+([-\u2010-\u2015])", r"}\g<1>", title)
    title = re.sub(r"([-\u2010-\u2015])\s+\\text", r"\g<1>\\text", title)
    return title


# What pdflatex cannot set from a raw record.  Publishers' records carry
# Greek letters, accented names and bare ampersands as Unicode, and a
# style that prints titles then fails under pdflatex with "Unicode
# character not set up for use with LaTeX".  The agent cleaned nine
# entries by hand before this pass existed.
GREEK = {
    "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon",
    "ζ": "zeta", "η": "eta", "θ": "theta", "ι": "iota", "κ": "kappa",
    "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho",
    "σ": "sigma", "ς": "varsigma", "τ": "tau", "υ": "upsilon", "φ": "phi",
    "χ": "chi", "ψ": "psi", "ω": "omega",
    "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi",
    "Π": "Pi", "Σ": "Sigma", "Υ": "Upsilon", "Φ": "Phi", "Ψ": "Psi",
    "Ω": "Omega",
}
# Greek capitals that are Latin capitals in every font are set as such.
GREEK.update({"Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I",
              "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
              "Χ": "X", "ο": "o"})
ACCENTS = {
    "\u0300": "`", "\u0301": "'", "\u0302": "^", "\u0303": "~",
    "\u0308": '"', "\u0307": ".", "\u0304": "=", "\u0306": "u",
    "\u030a": "r", "\u030b": "H", "\u030c": "v", "\u0327": "c",
    "\u0328": "k",
}
LIGATURES = {"ß": "\\ss{}", "æ": "\\ae{}", "Æ": "\\AE{}", "ø": "\\o{}",
             "Ø": "\\O{}", "å": "\\aa{}", "Å": "\\AA{}", "œ": "\\oe{}",
             "Œ": "\\OE{}", "ł": "\\l{}", "Ł": "\\L{}", "ı": "\\i{}",
             "‐": "-", "‑": "-", "′": "$'$",
             "×": "$\\times$", "°": "$^\\circ$", "±": "$\\pm$",
             "≤": "$\\le$", "≥": "$\\ge$", "→": "$\\to$", "·": "$\\cdot$",
             "\u00a0": "~", "“": "``", "”": "''", "‘": "`", "’": "'"}
# The en and em dashes, by code point: neither character appears in this
# repository, by rule, and the test that keeps it so reads escapes too.
LIGATURES[chr(0x2013)] = "--"
LIGATURES[chr(0x2014)] = "---"


def latexify(text):
    """Turn what a record carries as Unicode into what pdflatex can set.

    Greek letters become maths, accented Latin letters become the accent
    commands, and a bare ampersand, percent or hash is escaped.  A run of
    text already inside braces or after a backslash is a command the
    record wrote on purpose and is left alone.
    """
    if not text:
        return text
    out = []
    i, n = 0, len(text)
    while i < n:
        char = text[i]
        if char == "\\":
            # A command: copy it whole, with its argument if braced.
            match = re.match(r"\\[A-Za-z]+\*?(?:\{[^{}]*\})?|\\.", text[i:])
            out.append(match.group(0) if match else char)
            i += len(match.group(0)) if match else 1
            continue
        if char in GREEK:
            letter = GREEK[char]
            out.append(f"${{\\{letter}}}$" if len(letter) > 1 else letter)
            i += 1
            continue
        if char in LIGATURES:
            out.append(LIGATURES[char])
            i += 1
            continue
        if char in "&%#":
            out.append("\\" + char)
            i += 1
            continue
        decomposed = unicodedata.normalize("NFD", char)
        if len(decomposed) > 1 and decomposed[1] in ACCENTS and decomposed[0].isascii():
            base = decomposed[0]
            accent = ACCENTS[decomposed[1]]
            # An accent over i or j goes on the dotless letter.
            if base in "ij" and accent not in "cku":
                base = f"\\{base}"
            out.append(f"{{\\{accent}{{{base}}}}}")
            i += 1
            continue
        out.append(char)
        i += 1
    return "".join(out)


def protect_acronyms(title):
    """Brace a run of capitals so a title-casing style keeps it: {DFT},
    {CASSCF}, {NMR}.  A word already inside braces is left alone, and a
    lone capital is a word's initial, not an acronym."""
    def brace(match):
        return "{" + match.group(0) + "}"
    protected = []
    depth = 0
    piece = []
    for char in title:
        if char == "{":
            if depth == 0 and piece:
                protected.append(re.sub(r"\b[A-Z][A-Z0-9]+[A-Z]\b|\b[A-Z]{2,}\b", brace, "".join(piece)))
                piece = []
            depth += 1
            protected.append(char)
        elif char == "}":
            depth = max(0, depth - 1)
            protected.append(char)
        elif depth == 0:
            piece.append(char)
        else:
            protected.append(char)
    if piece:
        protected.append(re.sub(r"\b[A-Z][A-Z0-9]+[A-Z]\b|\b[A-Z]{2,}\b", brace, "".join(piece)))
    return "".join(protected)


# Fields worth keeping, in the order they are written out.  Crossref
# supplies more (ISSN, url, month, abstract); they add noise without
# changing how any style renders the reference.
FIELD_ORDER = ["author", "editor", "title", "booktitle", "journal",
               "series", "volume", "number", "pages", "publisher",
               "address", "edition", "year", "doi", "eprint",
               "eprinttype", "note"]


def tidy(entry, key, meta):
    """Reformat Crossref's one-line BibTeX into a readable entry."""
    parsed = parse_bib(entry)
    if not parsed:
        return entry if entry.endswith("\n") else entry + "\n"
    kind = parsed[0]["type"]
    fields = {k.lower(): v for k, v in parsed[0]["fields"].items()}

    if "title" in fields:
        fields["title"] = protect_acronyms(latexify(clean_title(fields["title"])))
    for name in ("journal", "booktitle", "series", "publisher"):
        if name in fields:
            fields[name] = latexify(clean_title(fields[name]))
    for name in ("author", "editor"):
        if name in fields:
            fields[name] = latexify(fields[name])

    # AIP and similar publishers number articles rather than pages;
    # Crossref reports that inconsistently.  Take the article number
    # from the record when there is one, and otherwise leave `pages'
    # out -- never invent a page range.
    if not fields.get("pages", "").strip():
        article = (meta.get("article-number") or "").strip()
        if article:
            fields["pages"] = article
        else:
            fields.pop("pages", None)

    ordered = [(f, fields[f]) for f in FIELD_ORDER if fields.get(f, "").strip()]
    width = max((len(f) for f, _ in ordered), default=6)
    lines = [f"@{kind}{{{key},"]
    for i, (f, v) in enumerate(ordered):
        comma = "," if i < len(ordered) - 1 else ""
        lines.append(f"  {f.ljust(width)} = {{{v}}}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def existing_dois(bib_text):
    return {normalise_doi(d).lower()
            for d in re.findall(r"doi\s*=\s*\{([^}]*)\}", bib_text, re.I)}


def existing_keys(bib_text):
    return set(re.findall(r"^@\w+\s*\{\s*([^,\s]+)\s*,", bib_text, re.M))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("doi", nargs="*", help="one or more DOIs")
    ap.add_argument("--file", help="file with one DOI per line (# comments allowed)")
    ap.add_argument("--key", help="citation key to use (single DOI only)")
    ap.add_argument("--bib", default="references.bib", help="target .bib file")
    ap.add_argument("--dry-run", action="store_true", help="print, do not write")
    args = ap.parse_args()

    dois = [normalise_doi(d) for d in args.doi]
    if args.file:
        for line in Path(args.file).read_text().splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                dois.append(normalise_doi(line))
    if not dois:
        ap.error("give at least one DOI, or --file")
    if args.key and len(dois) != 1:
        ap.error("--key applies to a single DOI")

    bib_path = Path(args.bib)
    bib_text = bib_path.read_text(encoding="utf-8") if bib_path.exists() else ""
    seen_dois = existing_dois(bib_text)
    seen_keys = existing_keys(bib_text)

    added, failed = [], []
    for doi in dois:
        if doi.lower() in seen_dois:
            print(f"skip   {doi}  (already in {bib_path.name})")
            continue
        try:
            meta = fetch_metadata(doi)
            raw = fetch_bibtex(doi)
        except Exception as exc:
            print(f"FAIL   {doi}  {exc}", file=sys.stderr)
            failed.append(doi)
            continue

        key = args.key or make_key(meta)
        base, n = key, 1
        while key in seen_keys:          # disambiguate collisions
            n += 1
            key = f"{base}{chr(ord('a') + n - 2)}"

        entry = tidy(raw, key, meta)
        title = clean_title((meta.get("title") or [""])[0])
        journal = (meta.get("container-title") or [""])[0]
        print(f"add    {key}\n       {title}\n       {journal}\n")

        added.append(entry)
        seen_keys.add(key)
        seen_dois.add(doi.lower())
        time.sleep(0.3)                  # be polite to Crossref

    if added and not args.dry_run:
        with bib_path.open("a", encoding="utf-8") as fh:
            if bib_text and not bib_text.endswith("\n\n"):
                fh.write("\n")
            fh.write("\n".join(added))
        print(f"wrote {len(added)} entr{'y' if len(added)==1 else 'ies'} to {bib_path}")
    elif args.dry_run:
        print("".join(added))

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
