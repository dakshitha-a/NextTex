"""The contact address reference lookups give Crossref and OpenAlex.

The thesis session's check was rate-limited by Crossref within seconds,
and its own checker, which names a contact, was not (19 November 2026).
The address used to be settable only through `NEXTTEX_CONTACT`; it is a
setting now, never filled in for the writer.
"""

from nexttex import references
from server import main as server_main


def test_the_contact_is_empty_until_the_writer_gives_one(client, monkeypatch):
    monkeypatch.delenv("NEXTTEX_CONTACT", raising=False)
    monkeypatch.setattr(server_main.SETTINGS, "contact_email", "")
    references.set_contact("")
    assert client.get("/api/settings/contact").json() == {"address": "", "fromEnvironment": False}


def test_a_contact_reaches_every_script_and_clearing_it_takes_it_back(client, monkeypatch):
    monkeypatch.delenv("NEXTTEX_CONTACT", raising=False)
    saved: list[str] = []
    monkeypatch.setattr(server_main.SETTINGS, "save", lambda: saved.append("saved"))
    answer = client.post("/api/settings/contact", json={"address": " a.writer@uni.ac.uk "})
    assert answer.json() == {"address": "a.writer@uni.ac.uk", "fromEnvironment": False}
    assert server_main.SETTINGS.contact_email == "a.writer@uni.ac.uk" and saved
    for name in ("verify_bib", "lit_search", "bib_from_doi"):
        module = references._load(name)
        assert module.MAILTO == "a.writer@uni.ac.uk"
        assert module.UA.endswith(" (mailto:a.writer@uni.ac.uk)")
        assert module.UA.count("mailto") == 1

    client.post("/api/settings/contact", json={"address": ""})
    for name in ("verify_bib", "lit_search", "bib_from_doi"):
        module = references._load(name)
        assert module.MAILTO is None and "mailto" not in module.UA


def test_something_that_is_not_an_address_is_refused(client, monkeypatch):
    monkeypatch.setattr(server_main.SETTINGS, "save", lambda: None)
    for bad in ("writer", "writer@", "@uni.ac.uk", "a b@uni.ac.uk", "x@y"):
        answer = client.post("/api/settings/contact", json={"address": bad})
        assert answer.status_code == 400, bad
        assert "not an email address" in answer.json()["detail"]


def test_the_environment_wins_and_says_so(client, monkeypatch):
    monkeypatch.setenv("NEXTTEX_CONTACT", "ops@lab.example.org")
    monkeypatch.setattr(server_main.SETTINGS, "save", lambda: None)
    client.post("/api/settings/contact", json={"address": "a.writer@uni.ac.uk"})
    assert client.get("/api/settings/contact").json() == {
        "address": "ops@lab.example.org", "fromEnvironment": True}
    assert references._load("verify_bib").MAILTO == "ops@lab.example.org"
    monkeypatch.delenv("NEXTTEX_CONTACT")
    references.set_contact("")
