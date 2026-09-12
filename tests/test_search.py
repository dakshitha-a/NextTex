"""The arithmetic behind project-wide find and replace."""

import pytest

from nexttex import search


def compiled(query, **kwargs):
    return search.compile_pattern(query, **kwargs)


def test_a_plain_query_is_not_a_pattern():
    # `eq.flux` must not match `eq:flux` when the writer did not ask for a
    # pattern: a full stop is the commonest character in prose.
    hits, _ = search.find({"a.tex": "see eq:flux here"}, compiled("eq.flux"))
    assert hits == []
    hits, _ = search.find({"a.tex": "see eq:flux here"}, compiled("eq:flux"))
    assert [(h.path, h.line, h.column) for h in hits] == [("a.tex", 1, 5)]


def test_case_is_ignored_unless_it_is_asked_for():
    texts = {"a.tex": "Flux and flux"}
    assert len(search.find(texts, compiled("flux"))[0]) == 2
    assert len(search.find(texts, compiled("flux", case=True))[0]) == 1


def test_every_match_on_a_line_is_its_own_hit():
    hits, _ = search.find({"a.tex": "\\cite{a} and \\cite{b}"}, compiled("\\cite"))
    assert [h.column for h in hits] == [1, 14]


def test_a_hit_says_how_much_of_the_line_matched():
    # The panel cannot work this out from the query when the query is a
    # pattern, and it is what marks the match inside the line.
    hits, _ = search.find({"a.tex": "eq:flux"}, compiled(r"eq:\w+", regex=True))
    assert hits[0].length == 7


def test_lines_are_numbered_from_one_and_paths_are_kept():
    texts = {"one.tex": "x\ny\nfound", "two.tex": "found"}
    hits, _ = search.find(texts, compiled("found"))
    assert [(h.path, h.line) for h in hits] == [("one.tex", 3), ("two.tex", 1)]


def test_a_very_long_line_is_shown_shortened():
    hits, _ = search.find({"a.tex": "q" + "x" * 5000}, compiled("q"))
    assert len(hits[0].text) == search.MAX_LINE


def test_the_hits_are_capped_and_say_so():
    texts = {"a.tex": "\n".join(["hit"] * (search.MAX_HITS + 10))}
    hits, capped = search.find(texts, compiled("hit"))
    assert capped and len(hits) == search.MAX_HITS


def test_a_pattern_that_is_not_one_is_refused():
    with pytest.raises(search.SearchError) as raised:
        compiled("(unclosed", regex=True)
    assert "not a pattern" in str(raised.value)


def test_a_pattern_longer_than_the_cap_is_refused():
    with pytest.raises(search.SearchError):
        compiled("a" * (search.MAX_PATTERN + 1))


def test_an_empty_query_is_refused():
    with pytest.raises(search.SearchError):
        compiled("")


def test_a_replacement_full_of_backslashes_is_literal():
    # The case this whole indirection exists for: `re.sub` reads the
    # replacement's escapes, and `\c` is not one it knows.
    text, count = search.replace("\\cite{a}", compiled("\\cite"), "\\citep")
    assert (text, count) == ("\\citep{a}", 1)


def test_a_group_reference_works_when_a_pattern_was_asked_for():
    pattern = compiled(r"\\cite\{(\w+)\}", regex=True)
    text, count = search.replace("\\cite{ab}", pattern, r"\\citep{\1}", regex=True)
    assert (text, count) == ("\\citep{ab}", 1)


def test_a_group_that_is_not_there_is_reported_rather_than_raised():
    pattern = compiled(r"\\cite", regex=True)
    with pytest.raises(search.SearchError):
        search.replace("\\cite{a}", pattern, r"\1", regex=True)


def test_replacing_keeps_the_lines_it_did_not_touch():
    text, count = search.replace("a\nb\na", compiled("a"), "z")
    assert (text, count) == ("z\nb\nz", 2)
