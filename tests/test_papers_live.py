"""The publishers still answer in the shapes the stand-ins replay.

Everything in tests/test_references.py runs with the network stubbed, so
none of it can say whether Crossref and doi.org still return what the
importer, the DOI tool and the checker read.  This asks them, for one
paper and one preprint, and asserts the vocabulary rather than the
words: the fields the code reads are there and have the types it reads.

Opt-in, like the live agent check and the iroh check, because it opens
sockets to other people's servers:

    NEXTTEX_LIVE=1 .venv/bin/python -m pytest tests/test_papers_live.py -q

The backlog run of September 2026 ran the same requests by hand with
curl and found every field in place; this is that check made repeatable.
"""

import os

import pytest

from nexttex import references

pytestmark = pytest.mark.skipif(
    not os.environ.get("NEXTTEX_LIVE"),
    reason="reaches Crossref and doi.org; set NEXTTEX_LIVE=1 to run",
)

PAPER = "10.1063/5.0146399"            # a journal article Crossref holds
PREPRINT = "10.48550/arXiv.2401.00001"  # an arXiv DOI, registered with DataCite


def test_crossref_still_answers_in_the_shape_the_importer_reads():
    fetch = references._load("bib_from_doi")
    meta = fetch.fetch_metadata(PAPER)
    assert isinstance(meta.get("title"), list) and meta["title"][0]
    assert isinstance(meta.get("author"), list) and meta["author"][0].get("family")
    assert isinstance(meta.get("container-title"), list) and meta["container-title"][0]
    assert any((meta.get(f) or {}).get("date-parts")
               for f in ("published-print", "published-online", "issued", "created"))
    raw = fetch.fetch_bibtex(PAPER)
    assert raw.startswith("@") and "doi" in raw.lower()
    entry = references.entry_for(PAPER, "")
    assert entry["added"] is True
    assert entry["key"].startswith("McClung2023")
    assert "\\textit{o}-nitrophenol" in entry["entry"]


def test_a_datacite_doi_is_answered_through_doi_org():
    fetch = references._load("bib_from_doi")
    raw = fetch.fetch_bibtex(PREPRINT)
    assert raw.startswith("@misc")
    meta = fetch.fetch_metadata(PREPRINT)
    assert isinstance(meta.get("title"), list) and meta["title"][0]
    assert meta["author"][0]["family"] == "Yang"
    entry = references.entry_for(PREPRINT, "")
    assert entry["key"].startswith("Yang2024")


def test_the_checker_can_verify_both():
    checker = references._load("verify_bib")
    for doi in (PAPER, PREPRINT):
        record = checker.crossref(doi)
        assert record is not None and record["title"][0]
