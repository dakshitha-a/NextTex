"""The reference pipeline, offline.

The rule these defend is the one that matters most in a dissertation: a
citation is never composed, only fetched.  The network-touching half is not
tested here -- it is tested by using it -- but the parts that decide what
counts as a real record are.
"""

from pathlib import Path

import pytest

from nexttex import references


def test_supplementary_material_dois_are_not_offered_as_papers(monkeypatch):
    """Publishers register supplementary files under their own DOIs; citing
    one cites a spreadsheet rather than the paper."""

    def fake_search(query, author, years, rows):
        return [
            {"title": "Real paper", "doi": "10.1021/acs.jpclett.4c02154"},
            {"title": "SI", "doi": "10.1021/acs.jpclett.4c02154.s001"},
            {"title": "A component", "doi": "10.1/x", "type": "component"},
        ]

    module = references._load("lit_search")
    monkeypatch.setattr(module, "search_crossref", fake_search)
    found = references.search("anything")
    assert [item["title"] for item in found] == ["Real paper"]


def test_a_duplicate_doi_is_not_added_twice(tmp_path):
    bib = tmp_path / "references.bib"
    bib.write_text(
        "@article{a2020,\n  doi = {10.1063/5.0146399},\n}\n", encoding="utf-8"
    )
    result = references.add("10.1063/5.0146399", bib)
    assert result["added"] is False
    assert "already" in result["reason"]


def test_verifying_a_missing_bibliography_is_not_an_error(tmp_path):
    result = references.verify(tmp_path / "nothing.bib")
    assert result["checked"] == 0
    assert result["problems"] == []
