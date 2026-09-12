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
