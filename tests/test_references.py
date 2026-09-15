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


def test_verifying_reads_the_checkers_verdict_not_its_shape(tmp_path, monkeypatch):
    """`verify_bib.check` answers `(status, messages)`.  The caller read that
    pair as a list of issues, so every entry was a problem, including one
    marked ok, and the agent's join over `("ok", [...])` raised "sequence
    item 1: expected str instance, list found": the one tool that would
    have caught a wrong DOI in a shared bibliography could not run."""
    bib = tmp_path / "references.bib"
    bib.write_text(
        "@article{good2020,\n  doi = {10.1/good},\n}\n"
        "@article{bad2021,\n  doi = {10.1/bad},\n}\n"
        "@book{hand2019,\n  verified = {manual},\n}\n",
        encoding="utf-8",
    )
    checker = references._load("verify_bib")

    def fake_check(entry):
        key = entry["key"]
        if key == "good2020":
            return "ok", []
        if key == "hand2019":
            return "ok", ["marked manually verified"]
        return "FAIL", ["DOI resolves to a different title", "year differs"]

    monkeypatch.setattr(checker, "check", fake_check)
    result = references.verify(bib)
    assert result["checked"] == 3
    assert result["problems"] == [
        {
            "key": "bad2021",
            "status": "FAIL",
            "issues": ["DOI resolves to a different title", "year differs"],
        }
    ]
    # And the text the agent builds from it joins strings, which is the
    # line that raised.
    assert "; ".join(result["problems"][0]["issues"]).startswith("DOI resolves")


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


def test_a_doi_crossref_does_not_hold_is_asked_of_doi_org(monkeypatch):
    """arXiv, Zenodo and datasets are registered with DataCite, which
    Crossref answers 404 for; the agent had to paste those entries in
    from a curl by hand.  doi.org's content negotiation reaches whichever
    agency holds the DOI."""
    fetch = references._load("bib_from_doi")
    asked: list[tuple[str, str]] = []

    class Answer:
        def __init__(self, status, text="", payload=None):
            self.status_code, self.text, self._payload = status, text, payload
            self.encoding = "utf-8"

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(self.status_code)

        def json(self):
            return self._payload

    def fake_get(url, headers=None, timeout=None, allow_redirects=False):
        asked.append((url, headers.get("Accept", "")))
        if "api.crossref.org" in url:
            return Answer(404)
        if headers.get("Accept") == "application/x-bibtex":
            return Answer(200, "@misc{x, title={A preprint}, author={Doe, Jane}, year={2024}, doi={10.48550/arXiv.2401.00001}}")
        return Answer(200, payload={
            "title": "A preprint", "author": [{"family": "Doe", "given": "Jane"}],
            "issued": {"date-parts": [[2024]]}, "container-title": "arXiv",
        })

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    result = references.entry_for("10.48550/arXiv.2401.00001", "")
    assert result["added"] is True
    assert result["key"] == "Doe2024preprint"
    assert "A preprint" in result["entry"]
    hosts = [url.split("/")[2] for url, _ in asked]
    assert hosts == ["api.crossref.org", "doi.org", "api.crossref.org", "doi.org"]


def test_a_doi_nobody_holds_is_refused(monkeypatch):
    fetch = references._load("bib_from_doi")

    class Missing:
        status_code = 404
        text = ""

    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: Missing())
    with pytest.raises(LookupError):
        references.entry_for("10.1/nothing", "")


def test_the_key_comes_from_the_entry_when_there_is_no_record():
    fetch = references._load("bib_from_doi")
    fields = {"author": "Müller, Anna and Smith, Bob", "year": "2021",
              "title": "A study of hydrogen bonding"}
    assert fetch.make_key({}, fields) == "Muller2021hydrogen"
    assert fetch.make_key({}, {"author": "Anna Müller", "date": "2021-05"}) == "Muller2021"


@pytest.mark.parametrize("raw, expected", [
    ("Σ-electron π bonding", "${\\Sigma}$-electron ${\\pi}$ bonding"),
    ("Schrödinger", "Schr{\\\"{o}}dinger"),
    ("Müller & Co", "M{\\\"{u}}ller \\& Co"),
    ("naïve", "na{\\\"{\\i}}ve"),
    ("Ångström", "\\AA{}ngstr{\\\"{o}}m"),
    ("5 × 10", "5 $\\times$ 10"),
    ("already \\textit{o}-nitro", "already \\textit{o}-nitro"),
    ("plain ASCII stays", "plain ASCII stays"),
])
def test_what_a_record_carries_as_unicode_is_set_as_latex(raw, expected):
    """A style that prints titles fails under pdflatex on a raw Greek
    letter or accent, and the agent cleaned nine entries by hand."""
    fetch = references._load("bib_from_doi")
    assert fetch.latexify(raw) == expected


def test_acronyms_in_a_title_are_braced_once():
    fetch = references._load("bib_from_doi")
    assert fetch.protect_acronyms("CASSCF and DFT for H2O in {NMR} spectra of Na") == (
        "{CASSCF} and {DFT} for {H2O} in {NMR} spectra of Na"
    )


def test_an_unmatched_small_caps_tag_is_stripped_and_a_matched_one_kept():
    fetch = references._load("bib_from_doi")
    assert fetch.clean_title("The <scp>dft</scp> study") == "The \\textsc{dft} study"
    assert fetch.clean_title("The <scp>dft study") == "The dft study"


def test_a_tidied_entry_is_latex_safe_in_every_field():
    fetch = references._load("bib_from_doi")
    raw = ("@article{x, title={Σ bonding in H2O}, author={Müller, Anna}, "
           "journal={Ångström Letters}, year={2020}, doi={10.1/x}}")
    entry = fetch.tidy(raw, "Muller2020bonding", {})
    assert "${\\Sigma}$ bonding in {H2O}" in entry
    assert "M{\\\"{u}}ller" in entry
    assert "\\AA{}ngstr{\\\"{o}}m Letters" in entry
