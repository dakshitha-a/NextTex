#!/usr/bin/env python3
"""Search the literature and print candidates with their real DOIs.

This is the front half of the reference workflow.  It finds papers;
tools/bib_from_doi.py then fetches the chosen ones from the publisher
record, and tools/verify_bib.py checks them again.  Nothing here writes
to references.bib -- the DOI you pick is the only thing that carries
forward, which is what keeps an invented reference from ever entering
the bibliography.

    tools/lit_search.py "trajectory surface hopping decoherence"
    tools/lit_search.py --author Feynman --year 2020- "quantum dynamics"
    tools/lit_search.py --source openalex "FOMO-CASCI"
    tools/lit_search.py --cited-by 10.1063/5.0274633

Then:

    tools/bib_from_doi.py 10.1063/5.0274633

Sources: Crossref (default, best metadata), OpenAlex (best relevance
ranking and citation counts), Semantic Scholar (good for preprints and
for finding what cites a paper).  None needs an API key.
"""

import argparse
import html
import re
import os
import sys
import textwrap
from urllib.parse import quote, urlencode

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
UA = f"nexttex-litsearch/1.0" + (f" (mailto:{MAILTO})" if MAILTO else "")
TIMEOUT = 30


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text or ""))).strip()


def year_filter(spec):
    """Accept 2020, 2020-, -2020 or 2018-2022."""
    if not spec:
        return None, None
    m = re.fullmatch(r"(\d{4})?\s*-\s*(\d{4})?", spec)
    if m:
        return m.group(1), m.group(2)
    if re.fullmatch(r"\d{4}", spec):
        return spec, spec
    raise ValueError(f"cannot read year range {spec!r}")


def search_crossref(query, author, years, rows):
    params = {"rows": rows, "select":
              "DOI,title,author,issued,container-title,is-referenced-by-count,type"}
    if query:
        params["query.bibliographic"] = query
    if author:
        params["query.author"] = author
    lo, hi = years
    filters = []
    if lo:
        filters.append(f"from-pub-date:{lo}-01-01")
    if hi:
        filters.append(f"until-pub-date:{hi}-12-31")
    if filters:
        params["filter"] = ",".join(filters)

    r = requests.get("https://api.crossref.org/works?" + urlencode(params),
                     headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for w in r.json()["message"]["items"]:
        authors = w.get("author") or []
        parts = (w.get("issued", {}).get("date-parts") or [[None]])[0]
        out.append({
            "doi": w.get("DOI", ""),
            "title": clean((w.get("title") or [""])[0]),
            "first": authors[0].get("family", "") if authors else "",
            "n_authors": len(authors),
            "year": parts[0] if parts else None,
            "journal": clean((w.get("container-title") or [""])[0]),
            "cites": w.get("is-referenced-by-count"),
        })
    return out


def search_openalex(query, author, years, rows):
    params = {"search": query, "per-page": rows}
    filters = []
    lo, hi = years
    if lo:
        filters.append(f"from_publication_date:{lo}-01-01")
    if hi:
        filters.append(f"to_publication_date:{hi}-12-31")
    if author:
        filters.append(f"raw_author_name.search:{author}")
    if filters:
        params["filter"] = ",".join(filters)
    params["mailto"] = MAILTO

    r = requests.get("https://api.openalex.org/works?" + urlencode(params),
                     headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for w in r.json().get("results", []):
        auths = w.get("authorships") or []
        first = auths[0]["author"]["display_name"].split()[-1] if auths else ""
        source = ((w.get("primary_location") or {}).get("source") or {})
        out.append({
            "doi": (w.get("doi") or "").replace("https://doi.org/", ""),
            "title": clean(w.get("title")),
            "first": first,
            "n_authors": len(auths),
            "year": w.get("publication_year"),
            "journal": clean(source.get("display_name")),
            "cites": w.get("cited_by_count"),
        })
    return out


def search_semanticscholar(query, author, years, rows):
    params = {"query": " ".join(filter(None, [query, author])),
              "limit": rows,
              "fields": "title,year,authors,venue,externalIds,citationCount"}
    lo, hi = years
    if lo or hi:
        params["year"] = f"{lo or ''}-{hi or ''}"
    r = requests.get("https://api.semanticscholar.org/graph/v1/paper/search?"
                     + urlencode(params), headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for w in r.json().get("data", []):
        ids = w.get("externalIds") or {}
        auths = w.get("authors") or []
        out.append({
            "doi": ids.get("DOI", ""),
            "arxiv": ids.get("ArXiv", ""),
            "title": clean(w.get("title")),
            "first": auths[0]["name"].split()[-1] if auths else "",
            "n_authors": len(auths),
            "year": w.get("year"),
            "journal": clean(w.get("venue")),
            "cites": w.get("citationCount"),
        })
    return out


def cited_by(doi, rows):
    """Papers that cite a given DOI -- how a literature review grows."""
    r = requests.get(
        f"https://api.semanticscholar.org/graph/v1/paper/DOI:{quote(doi)}/citations?"
        + urlencode({"limit": rows,
                     "fields": "title,year,authors,venue,externalIds,citationCount"}),
        headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for entry in r.json().get("data", []):
        w = entry.get("citingPaper") or {}
        ids = w.get("externalIds") or {}
        auths = w.get("authors") or []
        out.append({
            "doi": ids.get("DOI", ""),
            "arxiv": ids.get("ArXiv", ""),
            "title": clean(w.get("title")),
            "first": auths[0]["name"].split()[-1] if auths else "",
            "n_authors": len(auths),
            "year": w.get("year"),
            "journal": clean(w.get("venue")),
            "cites": w.get("citationCount"),
        })
    return out


def show(results):
    if not results:
        print("no results")
        return
    for n, w in enumerate(results, 1):
        authors = w["first"] or "?"
        if w.get("n_authors", 0) > 1:
            authors += " et al."
        cites = f"  {w['cites']} citations" if w.get("cites") is not None else ""
        ident = w["doi"] or (f"arXiv:{w['arxiv']}" if w.get("arxiv") else "")
        print(f"\n{n:>2}. {authors}, {w['year'] or '?'}"
              f"  {w['journal'] or '(no journal)'}{cites}")
        for line in textwrap.wrap(w["title"] or "(no title)", 74):
            print(f"    {line}")
        print(f"    {ident or 'NO DOI -- cannot be verified, do not cite'}")
    print("\nAdd one with:  tools/bib_from_doi.py <DOI>")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("query", nargs="*", help="search terms")
    ap.add_argument("--author", help="restrict to an author's surname")
    ap.add_argument("--year", help="2020, 2020-, -2020 or 2018-2022")
    ap.add_argument("--source", default="crossref",
                    choices=["crossref", "openalex", "semanticscholar"])
    ap.add_argument("--rows", type=int, default=10, help="how many results")
    ap.add_argument("--cited-by", metavar="DOI",
                    help="list papers citing this DOI instead of searching")
    args = ap.parse_args()

    try:
        years = year_filter(args.year)
    except ValueError as exc:
        ap.error(str(exc))

    query = " ".join(args.query)
    if not query and not args.author and not args.cited_by:
        ap.error("give search terms, --author, or --cited-by")

    try:
        if args.cited_by:
            results = cited_by(args.cited_by.strip(), args.rows)
        elif args.source == "openalex":
            results = search_openalex(query, args.author, years, args.rows)
        elif args.source == "semanticscholar":
            results = search_semanticscholar(query, args.author, years, args.rows)
        else:
            results = search_crossref(query, args.author, years, args.rows)
    except requests.HTTPError as exc:
        print(f"search failed: {exc}", file=sys.stderr)
        return 1

    show(results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
