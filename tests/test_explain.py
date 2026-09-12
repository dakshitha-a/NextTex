"""Telling the writer what went wrong, without a model.

The rule this defends: NextTex is a LaTeX editor before it is an AI tool,
and somebody running it with no agent at all must still be told where the
build broke and what the message means.
"""

import pytest

from nexttex.explain import RULES, annotate, explain, summarise


@pytest.mark.parametrize("message,expected", [
    ("! Undefined control sequence.", "A command LaTeX does not know"),
    ("! Missing $ inserted.", "Maths outside maths mode"),
    ("! Double superscript.", "Two superscripts or subscripts in a row"),
    ("! Extra alignment tab has been changed to \\cr.", "Too many columns in a table row"),
    ("! Misplaced alignment tab character &.", "An & outside a table"),
    ("! LaTeX Error: File `mhchem.sty' not found.", "A package that is not installed"),
    ("! LaTeX Error: File `figures/plot.png' not found.",
     "A file the document refers to is missing"),
    ("! LaTeX Error: Environment chemfig undefined.",
     "An environment LaTeX does not know"),
    ("! Too many }'s.", "Unbalanced braces"),
    ("Runaway argument?", "A command argument that never closed"),
    ("Citation `knuth1984' on page 1 undefined", "A citation with nothing behind it"),
    ("Reference `sec:results' on page 2 undefined", "A cross-reference with no label"),
    ("There were undefined references.", "Some references have not settled yet"),
    ("LaTeX Warning: Label `eq:one' multiply defined.", "The same label twice"),
    ("! Missing number, treated as zero.", "A length or count that is not a number"),
    ("! Illegal unit of measure (pt inserted).", "A measurement without a unit"),
    ("! LaTeX Error: Something's wrong--perhaps a missing \\item.",
     "Something inside a list that is not an item"),
    ("! Package inputenc Error: Unicode character — (U+2014)",
     "A character this font cannot set"),
    ("! LaTeX Error: Command \\note already defined.", "A command defined twice"),
    ("! LaTeX Error: Missing \\begin{document}.", "Text before the document starts"),
    ("! Emergency stop.", "LaTeX gave up"),
    ("Overfull \\hbox (12.0pt too wide) in paragraph at lines 4--6",
     "A line that runs into the margin"),
    ("Underfull \\hbox (badness 10000) in paragraph at lines 9--10",
     "A line stretched to fit"),
])
def test_the_errors_that_actually_happen_are_explained(message, expected):
    found = explain(message)
    assert found and found["title"] == expected


def test_every_rule_says_what_to_do_as_well_as_what_is_wrong():
    """A message that names a problem and stops is the thing this exists to
    replace."""
    for _pattern, title, detail, fix in RULES:
        assert detail.strip() and fix.strip(), title
        assert detail.endswith(".") and fix.endswith("."), title


def test_something_unrecognised_is_left_alone_rather_than_guessed_at():
    assert explain("! Something nobody has ever seen before.") is None
    marked = annotate([{"severity": "error", "message": "nonsense here"}])
    assert "explain" not in marked[0]


def test_annotating_keeps_everything_the_editor_already_used():
    marked = annotate([
        {"severity": "error", "message": "! Undefined control sequence.",
         "file": "main.tex", "line": 12, "context": "\\usepacakge"},
    ])
    assert marked[0]["file"] == "main.tex" and marked[0]["line"] == 12
    assert marked[0]["context"] == "\\usepacakge"
    assert marked[0]["explain"]["title"] == "A command LaTeX does not know"


def test_the_summary_names_the_first_error_not_the_loudest():
    """TeX cascades: one unclosed brace makes every paragraph after it
    complain, and starting at the bottom of the list fixes noise.

    The list is in the order `parse` read the log, which is the order the
    engine met the errors in. This fixture used to be in the other order,
    which no real log produces: it was shaped that way to exercise a sort
    over `(file, line)` that has since been removed, because on more than
    one file that sort is alphabetical rather than document order.
    """
    found = summarise([
        {"severity": "error", "message": "! Too many }'s.",
         "file": "main.tex", "line": 40},
        {"severity": "error", "message": "! Emergency stop.",
         "file": "main.tex", "line": 300},
        {"severity": "warning", "message": "Overfull \\hbox",
         "file": "main.tex", "line": 4},
    ])
    assert found["line"] == 40
    assert found["headline"] == "Unbalanced braces"
    assert found["others"] == 1
    assert "fix this one and rebuild" in found["note"]


def test_the_summary_follows_the_log_and_not_the_alphabet():
    """This test used to assert the bug, and passed for a year.

    It was `test_the_summary_orders_by_file_then_line`, and it asserted
    that of an error in `chapters/02.tex` and one in `chapters/01.tex` the
    summary names the second, because `01` sorts before `02`. That is only
    the right answer when the filenames happen to sort into the order the
    document includes them in, which is true of the numbered chapters in
    this fixture and of nothing else. `main.tex` and `chapters/one.tex`
    sort the wrong way round, and the preamble is where a cascade almost
    always starts.

    The log's order is the engine's order, and the engine reads the
    document. So the answer is the first error in the list, and the
    fixture below is in the order a log would give them.
    """
    found = summarise([
        {"severity": "error", "message": "! Missing $ inserted.",
         "file": "chapters/01.tex", "line": 90},
        {"severity": "error", "message": "! Too many }'s.",
         "file": "chapters/02.tex", "line": 5},
    ])
    assert found["file"] == "chapters/01.tex"


def test_the_preamble_wins_over_a_chapter_that_sorts_before_it():
    """The case the old sort got backwards, and the one that matters.

    A broken preamble in `main.tex` makes every chapter complain. Sorted
    alphabetically, `chapters/one.tex` comes first and the writer is sent
    to fix a consequence.
    """
    found = summarise([
        {"severity": "error", "message": "! Undefined control sequence.",
         "file": "main.tex", "line": 5},
        {"severity": "error", "message": "! Undefined control sequence.",
         "file": "chapters/one.tex", "line": 2},
    ])
    assert found["file"] == "main.tex"


def test_a_build_with_no_errors_has_nothing_to_summarise():
    assert summarise([{"severity": "warning", "message": "Overfull \\hbox"}]) is None
    assert summarise([]) is None


def test_one_error_alone_does_not_claim_others_followed():
    found = summarise([
        {"severity": "error", "message": "! Missing $ inserted.",
         "file": "main.tex", "line": 12},
    ])
    assert found["others"] == 0 and found["note"] == ""


def test_the_error_to_start_from_is_the_first_one_the_engine_met():
    """Document order, which is what the docstring and the README both say.

    It was `min` over `(file, line)`, which is alphabetical by filename. A
    thesis whose preamble is broken in `main.tex` and whose chapter is
    broken as a consequence was told to start in `chapters/one.tex`,
    because `c` sorts before `m`. That is precisely backwards: the note
    beside it says the list below the first error is usually its own
    consequence.

    Nothing caught it because every test project has one file.
    """
    from nexttex.explain import summarise

    # The order `parse` produces: the engine read main.tex first.
    diagnostics = [
        {"severity": "error", "file": "main.tex", "line": 5,
         "message": "Undefined control sequence."},
        {"severity": "error", "file": "chapters/one.tex", "line": 2,
         "message": "Undefined control sequence."},
    ]

    start = summarise(diagnostics)
    assert start is not None
    assert start["file"] == "main.tex", (
        f"told to start in {start['file']}, which is alphabetical order"
    )
    assert start["line"] == 5
    assert start["others"] == 1


def test_a_warning_is_never_the_place_to_start():
    from nexttex.explain import summarise

    assert summarise([
        {"severity": "warning", "file": "a.tex", "line": 1, "message": "Overfull"},
    ]) is None
