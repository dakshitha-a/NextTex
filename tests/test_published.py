"""The publishers' records about a document's citations, from fixtures.

The fixtures are Crossref's own answers, trimmed to the fields read, for a
retracted paper, a preprint with a journal version and an ordinary paper.
Nothing here reaches the network: the fetcher is a stand-in.
"""

import json
from pathlib import Path

import pytest

from nexttex import published

FIXTURES = Path(__file__).parent / "fixtures"


def record(name: str) -> dict:
    return json.loads((FIXTURES / f"crossref-{name}.json").read_text(encoding="utf-8"))["message"]


@pytest.fixture(autouse=True)
def fresh():
    published.forget()
    yield
    published.forget()


def fake(table: dict):
    asked = []

    def fetch(doi: str):
        asked.append(doi)
        value = table.get(doi, "missing")
        if value == "missing":
            return None
        if isinstance(value, Exception):
            raise value
        return value

    fetch.asked = asked
    return fetch


ENTRIES = [
    {"key": "wakefield1998", "doi": "https://doi.org/10.1016/S0140-6736(97)11096-0", "file": "r.bib", "line": 3},
    {"key": "comb2025", "doi": "10.1364/opticaopen.29459153.v1", "file": "r.bib", "line": 12},
    {"key": "tully1990", "doi": "10.1063/1.459170", "file": "r.bib", "line": 20},
    {"key": "arxiv", "doi": "10.48550/arXiv.2101.00001", "file": "r.bib", "line": 30},
]
TABLE = {
    "10.1016/s0140-6736(97)11096-0": record("retracted"),
    "10.1364/opticaopen.29459153.v1": record("preprint"),
    "10.1063/1.459170": record("plain"),
}


def test_a_retraction_and_a_journal_version_are_rows_and_the_rest_is_quiet():
    answer = published.ask(ENTRIES, fake(TABLE), now=0)
    assert (answer["asked"], answer["unknown"], answer["failed"]) == (4, 1, 0)
    rows = [(row["kind"], row["severity"], row["message"], row["line"]) for row in answer["findings"]]
    assert rows == [
        ("retracted", "error", "wakefield1998 has been retracted", 3),
        ("published", "warning", "comb2025 is a preprint; its journal version is 10.1364/OE.572415", 12),
    ]
    assert answer["findings"][0]["explain"]["title"] == "Retracted"


def test_an_answer_is_kept_a_day_and_a_failure_is_not_kept():
    fetch = fake({**TABLE, "10.1063/1.459170": OSError("offline")})
    first = published.ask(ENTRIES, fetch, now=0)
    assert first["failed"] == 1
    again = published.ask(ENTRIES, fetch, now=3600)
    # Only the one that failed, and the one Crossref does not hold, which
    # was an answer and is kept.
    assert sorted(fetch.asked) == sorted([*TABLE, "10.48550/arxiv.2101.00001", "10.1063/1.459170"])
    assert again["failed"] == 1
    published.ask(ENTRIES, fetch, now=2 * 86400)
    assert len(fetch.asked) == 4 + 1 + 4


def test_a_value_that_is_not_a_doi_is_not_asked_about():
    fetch = fake(TABLE)
    answer = published.ask([{"key": "x", "doi": "see the paper", "file": "r.bib", "line": 1}], fetch, now=0)
    assert answer["asked"] == 0 and fetch.asked == []
