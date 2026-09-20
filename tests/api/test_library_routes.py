"""Adding a reference by DOI, and checking a bibliography, from the app.

R-084. The README calls working without an agent "a real option, not a
degraded one", and then describes two things that were agent tools and
nothing else. `references.entry_for`, `appended` and `verify` are written
and tested; the only route that reached the first needed an unidentified
PDF from a folder scan to hang the DOI on, so a writer who simply had a DOI
could not use it, and nothing in the interface reached the second at all.

The network is never touched here: `entry_for` and `verify` are the parts
that talk to a publisher and both are stubbed.
"""

import pytest

from nexttex import references
from server import main as server_main


ENTRY = (
    "@article{LeCun2015deep,\n"
    "  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},\n"
    "  title = {Deep learning},\n"
    "  year = {2015},\n"
    "}"
)


@pytest.fixture
def bib(opened):
    """The seeded project's bibliography, and the session holding it."""
    session = server_main.SESSIONS[opened["id"]]
    return opened, session.project.root / "references.bib"


def test_a_doi_on_its_own_is_enough(client, bib, monkeypatch):
    opened, path = bib
    monkeypatch.setattr(
        references,
        "entry_for",
        lambda doi, existing: {
            "added": True, "key": "LeCun2015deep", "entry": ENTRY,
            "title": "Deep learning",
        },
    )
    answer = client.post(
        f"/api/projects/{opened['id']}/library/add",
        json={"doi": "10.1038/nature14539"},
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["key"] == "LeCun2015deep"
    assert "LeCun2015deep" in path.read_text(encoding="utf-8")
    # The entry that was already there is still there: this appends.
    assert "knuth1984" in path.read_text(encoding="utf-8")


def test_a_doi_nobody_has_is_reported_rather_than_invented(client, bib, monkeypatch):
    opened, path = bib
    before = path.read_text(encoding="utf-8")

    def missing(doi, existing):
        raise LookupError(f"no record for {doi}")

    monkeypatch.setattr(references, "entry_for", missing)
    answer = client.post(
        f"/api/projects/{opened['id']}/library/add", json={"doi": "10.9999/nope"}
    )
    assert answer.status_code == 200
    body = answer.json()
    assert body["added"] is False
    assert "10.9999/nope" in body["reason"]
    assert path.read_text(encoding="utf-8") == before


def test_a_bibliography_can_be_checked_against_the_publishers(client, bib, monkeypatch):
    opened, _ = bib
    monkeypatch.setattr(
        references,
        "verify",
        lambda path: {
            "checked": 1,
            "problems": [{"key": "knuth1984", "issues": ["year is 1986, not 1984"]}],
            "report": "one problem",
        },
    )
    answer = client.post(f"/api/projects/{opened['id']}/library/verify")
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["checked"] == 1
    assert body["problems"][0]["key"] == "knuth1984"


def test_the_library_state_counts_the_bibliography_s_own_entries(client, bib):
    """The drawer says "nothing in the bibliography yet" only when that is
    true of the file, not only of what NextTex added to it."""
    opened, path = bib
    state = client.get(f"/api/projects/{opened['id']}/library").json()
    assert state["entries"] == 1 and state["count"] == 0
    path.write_text(path.read_text(encoding="utf-8") + "\n\n" + ENTRY + "\n", encoding="utf-8")
    assert client.get(f"/api/projects/{opened['id']}/library").json()["entries"] == 2
    path.unlink()
    assert client.get(f"/api/projects/{opened['id']}/library").json()["entries"] == 0


def test_neither_route_works_without_a_bibliography(client, opened, monkeypatch):
    session = server_main.SESSIONS[opened["id"]]
    (session.project.root / "references.bib").unlink()
    for route, payload in (
        ("library/add", {"doi": "10.1038/nature14539"}),
        ("library/verify", None),
    ):
        answer = client.post(f"/api/projects/{opened['id']}/{route}", json=payload)
        assert answer.status_code == 400, f"{route}: {answer.text}"
        assert "bib" in answer.json()["detail"]


def test_the_search_box_asks_a_publisher_and_hands_back_rows_with_dois(client, opened, monkeypatch):
    """The agent has had this search since its literature tool landed;
    the writer without an agent did not.  The publisher is stubbed: a
    route test must not reach one."""
    asked = {}

    def fake_search(query, *, source="crossref", author="", years="", limit=10):
        asked.update(query=query, source=source, limit=limit)
        return [
            {"doi": "10.1038/nature14539", "title": "Deep learning", "first": "LeCun",
             "n_authors": 3, "year": 2015, "journal": "Nature", "cites": 60000},
            {"doi": "", "title": "No DOI here", "first": "Nobody", "n_authors": 1,
             "year": None, "journal": "", "cites": None},
        ]

    monkeypatch.setattr(references, "search", fake_search)
    answer = client.get(
        f"/api/projects/{opened['id']}/library/search",
        params={"q": "deep learning", "source": "openalex"},
    )
    assert answer.status_code == 200, answer.text
    assert asked == {"query": "deep learning", "source": "openalex", "limit": 10}
    body = answer.json()
    assert body["source"] == "openalex"
    assert body["results"][0] == {
        "doi": "10.1038/nature14539", "title": "Deep learning", "first": "LeCun",
        "authors": 3, "year": "2015", "journal": "Nature", "names": [], "abstract": "",
    }
    assert body["results"][1]["doi"] == "" and body["results"][1]["year"] == ""


@pytest.mark.parametrize("params", [
    {"q": ""},
    {"q": "   "},
    {"q": "x" * 201},
    {"q": "fine", "source": "google"},
])
def test_a_search_that_cannot_be_asked_is_refused(client, opened, monkeypatch, params):
    monkeypatch.setattr(references, "search", lambda *a, **k: pytest.fail("asked anyway"))
    assert client.get(
        f"/api/projects/{opened['id']}/library/search", params=params
    ).status_code == 400


def test_a_doi_in_the_search_box_resolves_to_one_row(client, opened, monkeypatch):
    """One box for a query or a DOI: a string that is a DOI goes to the
    resolver and comes back as one row the drawer draws like any other."""
    asked = {}

    def fake_record(doi):
        asked["doi"] = doi
        return {"doi": doi, "title": "Deep learning", "first": "LeCun", "n_authors": 3,
                "year": 2015, "journal": "Nature", "cites": 60000,
                "authors": ["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
                "abstract": "Deep learning allows computational models..."}

    monkeypatch.setattr(references, "record_for", fake_record)
    monkeypatch.setattr(references, "search", lambda *a, **k: pytest.fail("searched a DOI"))
    for pasted in ["10.1038/nature14539", "https://doi.org/10.1038/nature14539", "  10.1038/nature14539 "]:
        answer = client.get(
            f"/api/projects/{opened['id']}/library/search", params={"q": pasted}
        )
        assert answer.status_code == 200, answer.text
        body = answer.json()
        assert body["source"] == "doi"
        assert asked["doi"] == "10.1038/nature14539"
        assert len(body["results"]) == 1
        row = body["results"][0]
        assert row["doi"] == "10.1038/nature14539"
        assert row["names"] == ["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"]
        assert row["abstract"].startswith("Deep learning allows")


def test_a_doi_nobody_has_is_no_rows_rather_than_an_invented_one(client, opened, monkeypatch):
    monkeypatch.setattr(references, "record_for", lambda doi: {})
    answer = client.get(
        f"/api/projects/{opened['id']}/library/search", params={"q": "10.9999/nothing.here"}
    )
    assert answer.status_code == 200
    assert answer.json() == {"source": "doi", "results": []}


def test_a_search_row_carries_its_authors_and_abstract_when_the_record_has_them(
    client, opened, monkeypatch,
):
    def fake_search(query, *, source="crossref", author="", years="", limit=10):
        return [
            {"doi": "10.1/a", "title": "A", "first": "One", "n_authors": 2, "year": 2020,
             "journal": "J", "cites": 1, "authors": ["A. One", "B. Two"], "abstract": "Says a thing."},
            {"doi": "10.1/b", "title": "B", "first": "Two", "n_authors": 1, "year": 2021,
             "journal": "K", "cites": 0},
        ]

    monkeypatch.setattr(references, "search", fake_search)
    body = client.get(
        f"/api/projects/{opened['id']}/library/search", params={"q": "a thing"}
    ).json()
    assert body["results"][0]["names"] == ["A. One", "B. Two"]
    assert body["results"][0]["abstract"] == "Says a thing."
    # A record without them is still a row, with nothing to hover for.
    assert body["results"][1]["names"] == []
    assert body["results"][1]["abstract"] == ""


def test_a_publisher_that_will_not_answer_is_a_502_with_its_words(client, opened, monkeypatch):
    def down(*args, **kwargs):
        raise RuntimeError("503 Service Unavailable")

    monkeypatch.setattr(references, "search", down)
    answer = client.get(
        f"/api/projects/{opened['id']}/library/search", params={"q": "anything"}
    )
    assert answer.status_code == 502
    assert "503" in answer.json()["detail"]
