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
    complain, and starting at the bottom of the list fixes noise."""
    found = summarise([
        {"severity": "error", "message": "! Emergency stop.",
         "file": "main.tex", "line": 300},
        {"severity": "error", "message": "! Too many }'s.",
         "file": "main.tex", "line": 40},
        {"severity": "warning", "message": "Overfull \\hbox",
         "file": "main.tex", "line": 4},
    ])
    assert found["line"] == 40
    assert found["headline"] == "Unbalanced braces"
    assert found["others"] == 1
    assert "fix this one and rebuild" in found["note"]


def test_the_summary_orders_by_file_then_line():
    found = summarise([
        {"severity": "error", "message": "! Too many }'s.",
         "file": "chapters/02.tex", "line": 5},
        {"severity": "error", "message": "! Missing $ inserted.",
         "file": "chapters/01.tex", "line": 90},
    ])
    assert found["file"] == "chapters/01.tex"


def test_a_build_with_no_errors_has_nothing_to_summarise():
    assert summarise([{"severity": "warning", "message": "Overfull \\hbox"}]) is None
    assert summarise([]) is None


def test_one_error_alone_does_not_claim_others_followed():
    found = summarise([
        {"severity": "error", "message": "! Missing $ inserted.",
         "file": "main.tex", "line": 12},
    ])
    assert found["others"] == 0 and found["note"] == ""
