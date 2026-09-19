"""The bibliography check: rows for a `.bib` file while it is typed."""

from nexttex import bibcheck

GOOD = """@article{knuth84,
  author = {Donald E. Knuth},
  title = {Literate programming},
  journal = {The Computer Journal},
  year = {1984},
  doi = {10.1093/comjnl/27.2.97}
}
"""


def kinds(rows):
    return [(row["kind"], row["line"]) for row in rows]


def test_a_complete_entry_earns_nothing():
    assert bibcheck.check(GOOD, "r.bib") == []


def test_a_missing_required_field_names_the_field():
    text = "@article{a,\n  author = {X},\n  title = {T},\n  year = {2020}\n}\n"
    rows = bibcheck.check(text, "r.bib")
    assert kinds(rows) == [("missing-field", 1)]
    assert rows[0]["message"] == "@article a has no journal"
    assert rows[0]["source"] == "bib" and rows[0]["file"] == "r.bib"
    assert rows[0]["explain"]["fix"]


def test_an_empty_field_counts_as_missing():
    text = "@article{a,\n  author = {X},\n  title = {T},\n  journal = {},\n  year = {2020}\n}\n"
    assert kinds(bibcheck.check(text, "r.bib")) == [("missing-field", 1)]


def test_a_book_takes_an_author_or_an_editor():
    editor = "@book{b,\n  editor = {E},\n  title = {T},\n  publisher = {P},\n  year = {2020}\n}\n"
    neither = "@book{b,\n  title = {T},\n  publisher = {P},\n  year = {2020}\n}\n"
    assert bibcheck.check(editor, "r.bib") == []
    rows = bibcheck.check(neither, "r.bib")
    assert rows[0]["message"] == "@book b has no author or editor"


def test_a_key_defined_twice_is_reported_at_the_second():
    text = GOOD + "\n" + GOOD.replace("comjnl/27.2.97", "other")
    rows = bibcheck.check(text, "r.bib")
    assert kinds(rows) == [("duplicate-key", 9)]
    assert "the first is at line 1" in rows[0]["message"]


def test_a_year_that_is_not_one():
    for bad in ("in press", "\\the\\year", "2020a", "20"):
        text = GOOD.replace("{1984}", "{" + bad + "}")
        rows = bibcheck.check(text, "r.bib")
        assert kinds(rows) == [("year", 1)], bad
        assert bad in rows[0]["message"]


def test_the_same_doi_under_two_keys_with_or_without_the_prefix():
    second = GOOD.replace("knuth84", "knuth84b").replace(
        "{10.1093/comjnl/27.2.97}", "{https://doi.org/10.1093/COMJNL/27.2.97}",
    )
    rows = bibcheck.check(GOOD + second, "r.bib")
    assert kinds(rows) == [("duplicate-doi", 8)]
    assert rows[0]["message"] == "knuth84b has the same DOI as knuth84"


def test_uncited_entries_only_when_the_documents_are_known():
    assert bibcheck.check(GOOD, "r.bib", cited=None) == []
    rows = bibcheck.check(GOOD, "r.bib", cited=set())
    assert kinds(rows) == [("uncited", 1)] and rows[0]["severity"] == "info"
    assert bibcheck.check(GOOD, "r.bib", cited={"knuth84"}) == []


def test_directives_and_unknown_types_are_left_alone():
    text = "@comment{x}\n@string{y = {Y}}\n@preamble{\"z\"}\n@weird{k,\n title = {T}\n}\n"
    assert bibcheck.check(text, "r.bib", cited=None) == []


def test_every_required_type_has_a_snippet_worth_of_fields():
    """The `@` completion mirrors this table in TypeScript; the two agree
    on the type names, which `bib-complete.test.ts` checks from its side."""
    assert set(bibcheck.REQUIRED) >= {
        "article", "book", "inproceedings", "incollection", "phdthesis",
        "mastersthesis", "techreport", "unpublished", "manual", "proceedings",
        "booklet", "misc",
    }
    assert set(bibcheck.OPTIONAL) <= set(bibcheck.REQUIRED)
