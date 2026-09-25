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


# A pattern whose backtracking is exponential in the line it is run over.
# `(a+)+$` was the probe's example, and `re` needs about two to the
# thirty-fourth steps for it on this line; `(a|aa)+$` is catastrophic in
# every backtracking engine, including the one that now does the work.
RUNAWAY = "a" * 34 + "!"


def _in_a_child(code: str, limit: float = 20.0) -> str:
    """Run `code` in a fresh interpreter and give back what it printed.

    A child rather than a thread, because the fault under test is a match
    that holds the interpreter lock: in this process it would stop the
    test's own timer along with everything else, and the suite would hang
    instead of failing.
    """
    import subprocess
    import sys
    done = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True,
        timeout=limit, cwd=str(__import__("pathlib").Path(__file__).parents[1]),
    )
    assert done.returncode == 0, done.stderr
    return done.stdout


@pytest.mark.parametrize("query", ["(a+)+$", "(a|aa)+$"])
def test_a_runaway_pattern_ends_within_the_time_limit(query):
    out = _in_a_child(f"""
import time
from nexttex import search
pattern = search.compile_pattern({query!r}, regex=True)
start = time.monotonic()
try:
    search.find({{"evil.tex": {RUNAWAY!r}}}, pattern)
    print("finished", time.monotonic() - start)
except search.SearchError as error:
    print("refused", time.monotonic() - start, error)
""")
    verdict, seconds, *rest = out.split(" ", 2)
    assert float(seconds) <= search.TIME_LIMIT + 1.0
    if verdict == "refused":
        assert "too long" in rest[0]


def test_a_runaway_pattern_leaves_other_threads_running():
    """The limit is only half of it: while the match runs, the rest of
    the server has to keep answering, so the match must not hold the lock."""
    out = _in_a_child(f"""
import threading, time
from nexttex import search
ticks = []
stop = threading.Event()
def tick():
    while not stop.is_set():
        ticks.append(time.monotonic())
        time.sleep(0.01)
thread = threading.Thread(target=tick)
thread.start()
try:
    search.find({{"evil.tex": {RUNAWAY!r}}},
                search.compile_pattern("(a|aa)+$", regex=True))
except search.SearchError:
    pass
stop.set()
thread.join()
gaps = [b - a for a, b in zip(ticks, ticks[1:])]
print(max(gaps))
""")
    assert float(out) < 0.5


def test_a_runaway_replacement_ends_within_the_time_limit():
    out = _in_a_child(f"""
import time
from nexttex import search
pattern = search.compile_pattern("(a|aa)+$", regex=True)
start = time.monotonic()
try:
    search.replace({RUNAWAY!r}, pattern, "x", regex=True)
    print("finished", time.monotonic() - start)
except search.SearchError as error:
    print("refused", time.monotonic() - start)
""")
    verdict, seconds = out.split()
    assert verdict == "refused"
    assert float(seconds) <= search.TIME_LIMIT + 1.0
