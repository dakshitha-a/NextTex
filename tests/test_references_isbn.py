"""Books by ISBN, and sources with nothing to look up.

A book is added and checked by its ISBN the way a paper is by its DOI,
against Open Library and then Google Books. Catalogues drop co-authors and
lower-case titles, so a book added this way always says to check it against
the title page. A source with no DOI, ISBN or arXiv ID, an old thesis or a
program, is checked by hand and marked `verified = {manual}`; that mark
counts only where there is nothing to look up. The catalogue answers are
faked: the suite never leaves the machine.
"""

import pytest

from nexttex import references

#: Open Library's record for Szabo and Ostlund: one author, lower case.
SZABO = {"ISBN:9780486691862": {
    "title": "modern quantum chemistry",
    "subtitle": "introduction to advanced electronic structure theory",
    "authors": [{"name": "Attila Szabo"}],
    "publish_date": "1996",
    "publishers": [{"name": "Dover Publications"}],
    "publish_places": [{"name": "Mineola, N.Y."}],
}}

GOOGLE = {"items": [{"volumeInfo": {
    "title": "Modern Quantum Mechanics", "authors": ["J. J. Sakurai", "Jim Napolitano"],
    "publishedDate": "2017-09-21", "publisher": "Cambridge University Press",
}}]}


class Answer:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


@pytest.fixture
def catalogue(monkeypatch):
    """Open Library knows Szabo; Google Books knows Sakurai; both are asked
    in that order, and every request is kept."""
    checker = references._load("verify_bib")
    asked: list[tuple[str, dict]] = []

    class Fake:
        def get(self, url, params=None, headers=None, timeout=None, **_):
            asked.append((url, dict(params or {})))
            if "openlibrary.org/api/books" in url:
                return Answer(SZABO if params["bibkeys"] in SZABO else {})
            if "openlibrary.org/search.json" in url:
                return Answer({"docs": [{"isbn": ["0486691861"]}]})
            if "googleapis.com" in url:
                return Answer(GOOGLE if params["q"] == "isbn:9781108422413" else {})
            raise AssertionError(url)

    monkeypatch.setattr(checker, "HTTP", Fake())
    return asked


def test_an_isbn_is_read_with_hyphens_and_as_ten_digits():
    checker = references._load("verify_bib")
    assert checker.normalise_isbn("0-486-69186-1") == "9780486691862"
    assert checker.normalise_isbn("978-0-486-69186-2") == "9780486691862"
    assert checker.normalise_isbn("12345") is None
    assert references.isbn_in("ISBN 0486691861") == "9780486691862"
    # A DOI, or a query that merely holds a number, is not an ISBN.
    assert references.isbn_in("10.1063/1.4812345") == ""
    assert references.isbn_in("conical intersections 2020") == ""


def test_a_book_added_by_isbn_is_flagged_and_built_from_the_record(catalogue):
    found = references.entry_for("0-486-69186-1", "")
    assert found["added"] and found["key"] == "Szabo1996modern"
    assert "title page" in found["check"]
    entry = found["entry"]
    assert entry.startswith("% From the Open Library record for ISBN 9780486691862")
    assert "@book{Szabo1996modern," in entry
    # Title-cased, subtitle joined; the catalogue's one author kept as is,
    # which is why the flag exists.
    assert "Modern Quantum Chemistry: Introduction to Advanced Electronic Structure Theory" in entry
    assert "author    = {Szabo, Attila}" in entry
    assert "isbn      = {9780486691862}" in entry
    again = references.entry_for("9780486691862", entry)
    assert not again["added"] and "already" in again["reason"]


def test_google_books_answers_when_open_library_does_not(catalogue):
    record = references.book_for("9781108422413")
    assert record["isbn"] == "9781108422413" and record["year"] == 2017
    assert record["authors"] == ["J. J. Sakurai", "Jim Napolitano"]
    assert [url.split("/")[2] for url, _ in catalogue] == ["openlibrary.org", "www.googleapis.com"]


def entry(fields: dict, kind: str = "book", key: str = "k") -> dict:
    return {"type": kind, "key": key, "fields": fields}


def test_a_book_is_checked_against_its_isbn(catalogue):
    checker = references._load("verify_bib")
    good = entry({"title": "Modern Quantum Chemistry: Introduction to Advanced "
                           "Electronic Structure Theory",
                  "author": "Szabo, Attila and Ostlund, Neil S.", "year": "1996",
                  "publisher": "Dover", "isbn": "9780486691862"})
    assert checker.check(good) == ("ok", [])
    # The publisher is the least reliable field a catalogue has: a warning.
    status, said = checker.check({**good, "fields": {**good["fields"], "publisher": "Wiley"}})
    assert status == "WARN" and "publisher differs" in said[0]
    # The first author and the year are failures.
    status, _ = checker.check({**good, "fields": {**good["fields"], "author": "Ostlund, Neil"}})
    assert status == "FAIL"
    status, _ = checker.check({**good, "fields": {**good["fields"], "year": "1982"}})
    assert status == "FAIL"


def test_checked_by_hand_counts_only_where_there_is_nothing_to_look_up(catalogue):
    checker = references._load("verify_bib")
    thesis = entry({"title": "A thesis", "author": "Allison, T.", "year": "2010",
                    "verified": "manual"}, kind="phdthesis")
    assert checker.check(thesis)[0] == "hand"
    # Marked by hand but carrying an ISBN: checked against the ISBN.
    wrong = entry({"title": "Something else entirely", "author": "Szabo, Attila",
                   "year": "1996", "isbn": "9780486691862", "verified": "manual"})
    assert checker.check(wrong)[0] == "FAIL"
    status, said = checker.check(entry({"title": "A thesis"}, kind="phdthesis"))
    assert status == "FAIL" and "ISBN" in said[0] and "verified = {manual}" in said[0]


def test_the_report_keeps_hand_checked_entries_apart_and_offers_an_isbn(catalogue, tmp_path):
    bib = tmp_path / "references.bib"
    bib.write_text(
        "@phdthesis{allison2010,\n  title = {Femtosecond},\n  author = {Allison, T.},\n"
        "  year = {2010},\n  verified = {manual}\n}\n"
        "@book{kinetics,\n  title = {Modern Quantum Chemistry},\n  author = {Szabo, Attila},\n"
        "  year = {1996}\n}\n", encoding="utf-8")
    result = references.verify(bib)
    assert result["by_hand"] == ["allison2010"]
    [problem] = result["problems"]
    assert problem["key"] == "kinetics" and problem["unidentified"]
    assert problem["isbn"] == "9780486691862"
    words = references.said(result)
    assert "checked by hand (allison2010)" in words
    assert "Open Library has ISBN 9780486691862" in words
    # Offered, never written.
    assert "isbn" not in bib.read_text(encoding="utf-8").lower()


def test_marking_by_hand_adds_one_line_and_refuses_an_entry_with_an_identifier():
    text = ("@misc{g16,\n  title = {Gaussian 16},\n  year = {2016}\n}\n"
            "@article{a,\n  doi = {10.1/x},\n  title = {A}\n}\n")
    marked = references.checked_by_hand(text, "g16")
    assert marked == text.replace("@misc{g16,", "@misc{g16,\n  verified = {manual},")
    assert references.checked_by_hand(marked, "g16") == marked
    assert references.checked_by_hand(text, "a") is None
    assert references.checked_by_hand(text, "nobody") is None


def test_the_scripts_share_one_copy_of_each_other():
    """`bib_from_doi` imports `verify_bib` by its plain name. With a second
    copy behind it, the fixture above stubbed one HTTP client and the ISBN
    lookup reached Open Library through the other; it timed out in a full
    run on 29 October 2026."""
    fetch = references._load("bib_from_doi")
    checker = references._load("verify_bib")
    assert fetch.isbn_record.__globals__ is checker.__dict__
