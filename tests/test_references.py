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


def test_a_fetched_entry_is_appended_without_reading_the_file_first(tmp_path):
    """`entry_for` writes nothing.  Splitting the network half from the write
    is what lets the caller re-read the .bib after the lookup returns -- the
    old code read it before, and a DOI lookup takes seconds, so anything
    typed into the bibliography meanwhile was overwritten."""
    existing = "@article{earlier2020,\n  title = {Something}\n}\n"
    assert references.appended(existing, "@book{new2024,\n}") == (
        existing + "\n@book{new2024,\n}\n"
    )
    assert references.appended("", "@book{new2024,\n}") == "@book{new2024,\n}\n"


def test_the_bibliography_write_goes_through_the_editor(tmp_path, monkeypatch):
    """It used to happen inside a worker thread, so the .bib got no version,
    no undo chip, and no note that the next build needs biber."""
    import asyncio

    from nexttex.agent import ProjectAgent

    project = tmp_path / "project"
    (project / ".nexttex").mkdir(parents=True)
    (project / "references.bib").write_text("", encoding="utf-8")
    written = []
    agent = ProjectAgent(
        project, project / ".nexttex",
        apply_edit=lambda path, text: written.append((path, text)),
    )

    monkeypatch.setattr(
        references, "entry_for",
        lambda doi, existing: {
            "added": True, "key": "smith2024", "doi": doi,
            "title": "A paper", "entry": "@article{smith2024,\n}",
        },
    )
    asyncio.run(
        agent.add_reference_tool({"doi": "10.1/x", "bib_file": "references.bib"})
    )

    assert len(written) == 1
    path, text = written[0]
    assert path.name == "references.bib"
    assert "smith2024" in text
    # And it is an edit like any other, so the chip and its undo exist.
    assert [record.tool for record in agent.drain_edits()] == ["add_reference"]


def test_the_importer_never_folds_the_bibliography_from_a_worker_thread():
    """`scan.run` is handed to `asyncio.to_thread`, so everything its
    callbacks do happens on a worker. One of them, `write_bib`, called
    `collab.ingest`, which applies a transaction to a pycrdt document, and
    the constraint recorded in `docs/architecture.md` is that a document
    belongs to the thread that built it. Every reference the importer added
    was folded in from the wrong thread.

    `announce`, ten lines above it in the same function, already hopped
    back with `run_coroutine_threadsafe`. This is a reading of the source
    rather than a run, because staging a two-thread race reliably costs
    more than the claim is worth: what matters is that this closure does
    not touch the document directly, and that is visible.
    """
    import inspect

    from server import main as server_main

    source = inspect.getsource(server_main.library_scan)
    body = source[source.index("def write_bib"):]
    body = body[:body.index("\n    scan = Scan(")]

    assert "run_coroutine_threadsafe" in body, (
        "write_bib touches the shared document from the worker thread"
    )
    assert "session.collab.ingest(" not in body, (
        "write_bib calls ingest directly, from inside to_thread(scan.run)"
    )
