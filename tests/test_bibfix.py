"""The `.bib` rows' repairs: each rewrites only what it names."""

import pytest

from nexttex import bibcheck, bibfix

BIB = """% kept as written
@article{Paper_on_bert,
  author = {Devlin, Jacob and Chang, Ming-Wei},
  title = {BERT: Pre-training of {Deep} Transformers for NLP and \\LaTeX{} in 2D},
  journal = {NAACL},
  year = {2019},
  doi = {10.1/x},
  url = {https://example.org/bert},
  abstract = {A long abstract.}
}

@article{lee2019,
  author = {Lee, Ada},
  title = {One},
  year = {2019},
  doi = {https://doi.org/10.2/y}
}

@article{lee2019b,
  author = {Lee, Ada},
  title = {One},
  journal = {J},
  year = {2019},
  doi = {10.2/Y}
}

@online{web2020,
  title = {A page},
  url = {https://example.org},
  year = {2020}
}
"""


def rows_of(text):
    return {(row["kind"], row.get("fix", {}).get("key")): row for row in bibcheck.check(text, "r.bib")}


def test_the_rows_that_can_be_repaired_say_how():
    rows = rows_of(BIB)
    assert rows[("title-caps", "Paper_on_bert")]["fix"]["verb"] == "Protect capitals"
    assert rows[("title-caps", "Paper_on_bert")]["message"].startswith("Paper_on_bert's title has BERT, NLP and more")
    assert rows[("bulky-fields", "")]["message"] == "1 entry carries an abstract, or a url beside its DOI"
    assert rows[("key-style", "Paper_on_bert")]["fix"]["verb"] == "Rename to devlin2019"
    assert rows[("duplicate-doi", "lee2019b")]["fix"]["verb"] == "Merge"
    # An online page's url is its point, and it has no DOI beside it.
    assert ("key-style", "web2020") not in rows


def test_protecting_capitals_braces_those_words_and_nothing_else():
    out = bibfix.repair({"r.bib": BIB}, "r.bib", "title-caps", "Paper_on_bert")["r.bib"]
    assert "title = {{BERT}: Pre-training of {Deep} Transformers for {NLP} and \\LaTeX{} in {2D}}," in out
    assert out.replace("{BERT}", "BERT").replace("{NLP}", "NLP").replace("{2D}", "2D") == BIB
    with pytest.raises(bibfix.NotApplicable):
        bibfix.repair({"r.bib": out}, "r.bib", "title-caps", "Paper_on_bert")


def test_dropping_bulky_fields_takes_their_lines_and_keeps_an_online_url():
    out = bibfix.repair({"r.bib": BIB}, "r.bib", "bulky-fields")["r.bib"]
    assert "abstract" not in out and "https://example.org/bert" not in out
    assert "url = {https://example.org}," in out
    assert out.count("\n") == BIB.count("\n") - 2
    assert not any(row["kind"] == "bulky-fields" for row in bibcheck.check(out, "r.bib"))


def test_a_key_in_the_file_s_style_and_its_citations_follow():
    texts = {"r.bib": BIB, "main.tex": "As in \\cite{Paper_on_bert}.\n"}
    out = bibfix.repair(texts, "r.bib", "key-style", "Paper_on_bert")
    assert "@article{devlin2019," in out["r.bib"]
    assert out["main.tex"] == "As in \\cite{devlin2019}.\n"


def test_a_key_style_is_not_raised_where_the_file_has_its_own_convention():
    own = "@article{a_one,\n  author = {X, Y},\n  year = {2001}\n}\n@article{b_two,\n  author = {Z, W},\n  year = {2002}\n}\n"
    assert not any(row["kind"] == "key-style" for row in bibcheck.check(own, "r.bib"))


def test_capitalised_keys_are_made_capitalised_and_a_taken_one_gets_a_letter():
    bib = (
        "@article{Lee2019,\n  author = {Lee, A},\n  year = {2019}\n}\n"
        "@article{Kim2018,\n  author = {Kim, B},\n  year = {2018}\n}\n"
        "@article{odd,\n  author = {Lee, C},\n  year = {2019}\n}\n"
    )
    out = bibfix.repair({"r.bib": bib}, "r.bib", "key-style", "odd")["r.bib"]
    assert "@article{Lee2019a," in out


def test_a_merge_keeps_the_fuller_entry_and_rewrites_every_citation_once():
    texts = {
        "r.bib": BIB,
        "main.tex": "See \\cite{lee2019,lee2019b} and \\citep[p.~2]{lee2019}.\n",
        "other.bib": "@misc{lee2019,\n  note = {another file's}\n}\n",
    }
    out = bibfix.repair(texts, "r.bib", "duplicate-doi", "lee2019b")
    # lee2019b has a journal, so it is the fuller; lee2019 goes.
    assert "@article{lee2019," not in out["r.bib"] and "@article{lee2019b," in out["r.bib"]
    assert out["main.tex"] == "See \\cite{lee2019b} and \\citep[p.~2]{lee2019b}.\n"
    # Another bibliography is not this repair's business.
    assert "other.bib" not in out
    assert not any(row["kind"] == "duplicate-doi" for row in bibcheck.check(out["r.bib"], "r.bib"))


def test_a_tie_keeps_the_first_in_the_file():
    bib = (
        "@article{first,\n  title = {T},\n  doi = {10.9/z}\n}\n\n"
        "@article{second,\n  title = {T},\n  doi = {10.9/Z}\n}\n"
    )
    out = bibfix.repair({"r.bib": bib, "a.tex": "\\cite{second}"}, "r.bib", "duplicate-doi", "second")
    assert out["r.bib"] == "@article{first,\n  title = {T},\n  doi = {10.9/z}\n}\n\n"
    assert out["a.tex"] == "\\cite{first}"


def test_a_repair_that_no_longer_applies_says_so():
    with pytest.raises(bibfix.NotApplicable):
        bibfix.repair({"r.bib": BIB}, "r.bib", "duplicate-doi", "lee2019")
    with pytest.raises(bibfix.NotApplicable):
        bibfix.repair({"r.bib": BIB}, "r.bib", "key-style", "gone")
    with pytest.raises(bibfix.NotApplicable):
        bibfix.repair({}, "r.bib", "bulky-fields")
