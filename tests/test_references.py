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
            "unidentified": False,
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
    # A dataset's DOI, at a DataCite prefix NextTex does not know.
    result = references.entry_for("10.17632/abcd1234.1", "")
    assert result["added"] is True
    assert result["key"] == "Doe2024preprint"
    assert "A preprint" in result["entry"]
    hosts = [url.split("/")[2] for url, _ in asked]
    assert hosts == ["api.crossref.org", "doi.org", "api.crossref.org", "doi.org"]

    # An arXiv DOI is never Crossref's, so Crossref is not asked
    # (the thesis, 19 November 2026).
    asked.clear()
    assert references.entry_for("10.48550/arXiv.2401.00001", "")["added"] is True
    assert [url.split("/")[2] for url, _ in asked] == ["doi.org", "doi.org"]


def test_an_arxiv_doi_is_checked_at_doi_org_without_asking_crossref(monkeypatch):
    checker = references._load("verify_bib")
    asked: list[str] = []

    class Answer:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"title": "Attention Is All You Need",
                    "author": [{"family": "Vaswani"}], "issued": {"date-parts": [[2017]]}}

    class Session:
        def get(self, url, **_):
            asked.append(url)
            return Answer()

    monkeypatch.setattr(checker, "HTTP", Session())
    status, messages = checker.check({"key": "v", "fields": {
        "doi": "10.48550/arXiv.1706.03762", "title": "Attention is all you need",
        "author": "Vaswani, Ashish and others", "year": "2017"}})
    assert (status, messages) == ("ok", [])
    assert [url.split("/")[2] for url in asked] == ["doi.org"]


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


def test_verifying_looks_up_four_entries_at_once_and_keeps_their_order(tmp_path, monkeypatch):
    """Each entry is a request or two to the publisher's record, and one
    at a time a hundred entries waited on a hundred round trips in a row,
    each on a fresh connection. Four go at once now, over one pool, and
    the problems still come back in the bibliography's order."""
    import threading
    import time

    bib = tmp_path / "references.bib"
    bib.write_text(
        "".join(f"@article{{k{i:02d},\n  doi = {{10.1/{i}}},\n}}\n" for i in range(12)),
        encoding="utf-8",
    )
    checker = references._load("verify_bib")
    assert checker.HTTP is not None
    lock = threading.Lock()
    running, most = [0], [0]

    def slow_check(entry):
        with lock:
            running[0] += 1
            most[0] = max(most[0], running[0])
        time.sleep(0.05)
        with lock:
            running[0] -= 1
        return "FAIL", [entry["key"]]

    monkeypatch.setattr(checker, "check", slow_check)
    started = time.perf_counter()
    result = references.verify(bib)
    took = time.perf_counter() - started
    assert most[0] == references.CHECKED_AT_ONCE
    assert [p["key"] for p in result["problems"]] == [f"k{i:02d}" for i in range(12)]
    assert took < 12 * 0.05


@pytest.mark.parametrize("bib, record", [
    (r"Cach{\'o}n, A.", "Cachón"),
    (r"Cach\'{o}n, A.", "Cachón"),
    (r"Cach\'on, A.", "Cachón"),
    (r"{\v S}ponar, J.", "Šponar"),
    (r"\v{C}ech, E.", "Čech"),
    (r"M{\"u}ller, K.", "Müller"),
    (r"Erd\H{o}s, P.", "Erdős"),
    (r"Pe{\~n}a, R.", "Peña"),
    (r"Ba\c cik, Z.", "Baçik"),
    (r"{\O}rsted, H.", "Ørsted"),
    (r"{\L}ojasiewicz, S.", "Łojasiewicz"),
    (r"Gau{\ss}, C. F.", "Gauß"),
    ("Cachón, A.", "Cachón"),
])
def test_an_accented_surname_matches_its_record_however_it_is_written(bib, record):
    """`Cach{\\'o}n` folded to "cach on" and failed the first-author match
    against Crossref's "Cachón": the braces and backslash were stripped and
    the accent became a space (the thesis, 19 November 2026)."""
    checker = references._load("verify_bib")
    assert checker.first_surname(bib) == checker.fold(record)
    assert " " not in checker.first_surname(bib)


def test_a_title_with_latex_accents_matches_its_unicode_record():
    checker = references._load("verify_bib")
    assert checker.squash(r"Sch{\"o}dinger's {\'e}tude of Erd\H{o}s") == \
        checker.squash("Schödinger's étude of Erdős")


class _Refused:
    def __init__(self, status=429, retry_after="1"):
        self.status_code = status
        self.headers = {"Retry-After": retry_after}

    def raise_for_status(self):
        raise AssertionError("a refusal is never read as an answer")


class _Record:
    status_code = 200
    headers: dict = {}

    def __init__(self, title="A real paper", family="Cachón"):
        self._message = {"title": [title], "author": [{"family": family}],
                         "issued": {"date-parts": [[2020]]}}

    def raise_for_status(self):
        pass

    def json(self):
        return {"message": self._message}


def test_a_refused_lookup_is_tried_again_after_the_wait_it_asked_for(monkeypatch):
    checker = references._load("verify_bib")
    answers = [_Refused(retry_after="2"), _Refused(retry_after="2"), _Record()]
    slept: list[float] = []

    class Session:
        def get(self, url, **_):
            return answers.pop(0)

    monkeypatch.setattr(checker, "HTTP", Session())
    monkeypatch.setattr(checker, "PACING", True)
    monkeypatch.setattr(checker.time, "sleep", slept.append)
    meta = checker.crossref("10.1/x")
    assert meta["title"] == ["A real paper"]
    assert [round(s) for s in slept if s >= 1] == [2, 2]


def test_a_host_that_keeps_refusing_is_reported_as_refusing_not_as_a_bad_entry(monkeypatch):
    checker = references._load("verify_bib")

    class Session:
        def get(self, url, **_):
            return _Refused(retry_after="120")

    monkeypatch.setattr(checker, "HTTP", Session())
    status, messages = checker.check(
        {"key": "a", "fields": {"doi": "10.1/x", "title": "A real paper"}})
    assert status == "unchecked"
    assert "rate limited" in messages[0] and "2 min" in messages[0]


def test_a_rate_limited_check_stops_asking_and_says_when_to_try_again(tmp_path, monkeypatch):
    """Crossref answered 429 to nearly all of the thesis's 258 entries and
    the check reported "236 of 258 entries have problems", every one FAIL
    (19 November 2026). A refusal is "not checked" now, the check stops
    asking after five in a row, and it says when to try again."""
    checker = references._load("verify_bib")
    asked: list[str] = []

    class Session:
        def get(self, url, **_):
            asked.append(url)
            return _Refused(retry_after="90")

    monkeypatch.setattr(checker, "HTTP", Session())
    monkeypatch.setattr(references, "CHECKED_AT_ONCE", 1)
    bib = tmp_path / "references.bib"
    bib.write_text(
        "".join(f"@article{{k{i:02d},\n  doi = {{10.1/{i}}},\n  title = {{T}},\n}}\n"
                for i in range(40))
        + "@misc{old,\n  title = {A thesis},\n  verified = {manual},\n}\n",
        encoding="utf-8",
    )
    result = references.verify(bib)
    assert result["problems"] == []
    assert len(result["unchecked"]) == 40
    assert result["by_hand"] == ["old"]
    # The first refusal asked for 90 s, longer than is worth waiting, so
    # nothing asked Crossref again, and five entries in a row unchecked
    # stopped the rest from being tried at all.
    assert len(asked) == 1, "a host still refusing is not asked again"
    assert 85 <= result["retry_after"] <= 90
    assert result["refusing"] == ["Crossref"]
    said = references.said(result)
    assert said.startswith("40 could not be checked, because Crossref is rate-limiting")
    assert "not failures" in said and "about 2 minutes" in said
    assert "problems" not in said


def test_lookups_to_one_host_keep_its_pace(monkeypatch):
    """Crossref's public pool takes one request at a time; four threads
    asking at once had it refusing nearly everything."""
    import threading
    import time

    checker = references._load("verify_bib")
    monkeypatch.setattr(checker, "MAILTO", None)
    monkeypatch.setattr(checker, "PACING", True)
    monkeypatch.setitem(checker.PACE, "api.crossref.org", (0.05, 1, 3))
    lock = threading.Lock()
    running, most, starts = [0], [0], []

    class Session:
        def get(self, url, **_):
            with lock:
                running[0] += 1
                most[0] = max(most[0], running[0])
                starts.append(time.monotonic())
            time.sleep(0.01)
            with lock:
                running[0] -= 1
            return _Record()

    monkeypatch.setattr(checker, "HTTP", Session())
    threads = [threading.Thread(target=checker.crossref, args=(f"10.1/{i}",)) for i in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert most[0] == 1
    gaps = [b - a for a, b in zip(sorted(starts), sorted(starts)[1:])]
    assert min(gaps) >= 0.045


def test_a_recheck_asks_only_for_what_it_has_not_seen_and_still_compares(tmp_path, monkeypatch):
    """A re-run of the check asked Crossref for every entry again. The
    records it found are kept by identifier now, never the verdicts: an
    entry whose title changed since is compared with the kept record and
    fails, without a request."""
    checker = references._load("verify_bib")
    asked: list[str] = []

    class Session:
        def get(self, url, **_):
            asked.append(url)
            return _Record(title="A real paper", family="Cachón")

    monkeypatch.setattr(checker, "HTTP", Session())
    monkeypatch.setattr(references, "CACHE_RECORDS", True)
    monkeypatch.setattr(references, "RECORDS_FILE", tmp_path / "records.json")
    bib = tmp_path / "references.bib"
    entry = "@article{{a,\n  doi = {{10.1/A}},\n  title = {{{title}}},\n  author = {{Cach{{\\'o}}n, A.}},\n}}\n"
    bib.write_text(entry.format(title="A real paper"), encoding="utf-8")

    assert references.verify(bib)["problems"] == []
    assert len(asked) == 1
    kept = (tmp_path / "records.json").read_text(encoding="utf-8")
    assert "doi:10.1/a" in kept and "reference" not in kept

    references._CACHES.clear()      # as a restart would
    assert references.verify(bib)["problems"] == []
    assert len(asked) == 1, "the kept record answered"

    bib.write_text(entry.format(title="Something else entirely"), encoding="utf-8")
    problems = references.verify(bib)["problems"]
    assert [p["key"] for p in problems] == ["a"] and "title mismatch" in problems[0]["issues"][0]
    assert len(asked) == 1


def test_a_lookup_that_got_no_answer_is_not_kept(tmp_path, monkeypatch):
    checker = references._load("verify_bib")

    class Session:
        def get(self, url, **_):
            return _Refused(503, "1")

    monkeypatch.setattr(checker, "HTTP", Session())
    monkeypatch.setattr(references, "CACHE_RECORDS", True)
    monkeypatch.setattr(references, "RECORDS_FILE", tmp_path / "records.json")
    bib = tmp_path / "references.bib"
    bib.write_text("@article{a,\n  doi = {10.1/A},\n  title = {T},\n}\n", encoding="utf-8")
    assert references.verify(bib)["unchecked"] == ["a"]
    assert not (tmp_path / "records.json").exists()


def test_a_search_moves_to_the_next_source_when_one_is_refusing(monkeypatch):
    """Crossref, then OpenAlex, then Semantic Scholar answered 429 within a
    few calls for the thesis session, and `find_papers` returned the first
    refusal as an error (19 November 2026)."""
    lit = references._load("lit_search")
    checker = references._load("verify_bib")

    def refusing(query, author, years, rows):
        raise checker.RateLimited("api.crossref.org", 60)

    monkeypatch.setattr(lit, "search_crossref", refusing)
    monkeypatch.setattr(lit, "search_openalex",
                        lambda q, a, y, r: [{"title": "From OpenAlex", "doi": "10.1/oa"}])
    found, answered, refused = references.search_any("conical intersections")
    assert answered == "openalex"
    assert [(item["title"], item["source"]) for item in found] == [("From OpenAlex", "openalex")]
    assert len(refused) == 1 and refused[0].startswith("Crossref did not answer")
    assert references.search("conical intersections")[0]["source"] == "openalex"

    # Every source refusing is still an error, the last refusal.
    monkeypatch.setattr(lit, "search_openalex", refusing)
    monkeypatch.setattr(lit, "search_semanticscholar", refusing)
    with pytest.raises(checker.RateLimited):
        references.search_any("conical intersections")


def test_a_search_that_fails_for_another_reason_does_not_fall_back(monkeypatch):
    lit = references._load("lit_search")
    asked: list[str] = []

    def broken(query, author, years, rows):
        raise KeyError("message")

    monkeypatch.setattr(lit, "search_crossref", broken)
    monkeypatch.setattr(lit, "search_openalex",
                        lambda *a: asked.append("openalex") or [])
    with pytest.raises(KeyError):
        references.search_any("anything")
    assert asked == []


def test_openalex_is_sent_a_contact_address_only_when_there_is_one(monkeypatch):
    """With none set, the request went out with `mailto=None`."""
    lit = references._load("lit_search")
    urls: list[str] = []

    class Answer:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"results": []}

    def fake_get(url, **_):
        urls.append(url)
        return Answer()

    monkeypatch.setattr(lit.requests, "get", fake_get)
    monkeypatch.setattr(lit, "MAILTO", None)
    lit.search_openalex("x", None, (None, None), 5)
    monkeypatch.setattr(lit, "MAILTO", "writer@example.org")
    lit.search_openalex("x", None, (None, None), 5)
    assert "mailto" not in urls[0]
    assert "mailto=writer%40example.org" in urls[1]


def test_the_contact_goes_only_to_crossref_and_openalex(monkeypatch):
    """The setting says "Sent to them only", and the address rode in the
    User-Agent every script sends to every host (19 November 2026)."""
    checker = references._load("verify_bib")
    references.set_contact("a.writer@uni.ac.uk")
    sent: dict[str, str] = {}

    class Answer:
        status_code = 200

    def get(url, **kwargs):
        host = url.split("/")[2]
        sent[host] = (kwargs.get("headers") or {}).get("User-Agent", "")
        return Answer()

    for host in [name for name in checker.PACE if name]:
        checker.polite_get(f"https://{host}/x", get=get, headers={"User-Agent": checker.UA})
    assert set(sent) == {name for name in checker.PACE if name}
    for host, agent in sent.items():
        if host in ("api.crossref.org", "api.openalex.org"):
            assert agent.endswith("(mailto:a.writer@uni.ac.uk)"), host
        else:
            assert "a.writer" not in agent and agent.startswith("nexttex-"), host
    references.set_contact("")


def test_a_contact_reaches_a_script_loaded_under_its_plain_name(monkeypatch):
    import sys

    references._load("lit_search")
    plain = sys.modules["verify_bib"]
    references.set_contact("a.writer@uni.ac.uk")
    assert plain.MAILTO == "a.writer@uni.ac.uk"
    references.set_contact("")
    assert plain.MAILTO is None

