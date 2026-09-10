"""Where the agent is about to write, and where to look while it does.

The fence knows this and only the fence knows it: the tool arguments say
what the model is matching on, and the snapshot the fence has just taken is
what it will match against.  A second later the file has changed and the
question has no answer.

`first_changed_line` is a twin of `firstChangedLine` in
`frontend/src/store.ts`, which exists there for the same purpose and cannot
be reached from here.  The cases below are the cases that file's own tests
use, deliberately and in the same order, because two implementations of one
answer drift apart silently.
"""

import pytest

from nexttex.agent import first_changed_line, landing_line


@pytest.mark.parametrize("before, after, line", [
    ("a\nb\nc", "a\nb\nc", 1),          # identical text
    ("a\nb", "A\nb", 1),                 # the first line
    ("a\nb\nc", "a\nB\nc", 2),           # the middle
    ("a\nb", "a\nb\nc", 3),              # an append points at the new line
    ("a\nb\nc", "a\nc", 2),              # a deletion, where the text was
    ("", "the first sentence", 1),       # writing into an empty file
])
def test_it_agrees_with_the_browser_s_copy(before, after, line):
    assert first_changed_line(before, after) == line


BEFORE = "\\section{Theory}\nOne sentence.\nAnother.\n\\end{document}"


def test_an_edit_lands_where_its_old_string_is():
    assert landing_line("Edit", {"old_string": "Another."}, BEFORE) == 3


def test_an_edit_whose_old_string_is_not_there_gets_no_line():
    """None rather than a guess.

    A flash on the wrong paragraph is worse than no flash: it sends the
    reader to look at something that did not change, and costs them the
    trust that the highlight means anything.
    """
    assert landing_line("Edit", {"old_string": "nowhere"}, BEFORE) is None


def test_an_ambiguous_edit_gets_no_line_either():
    """Two matches is as good as none for this purpose, and `replace_all`
    makes that an ordinary case rather than a strange one."""
    twice = "One sentence.\nOne sentence.\n"
    assert landing_line("Edit", {"old_string": "One sentence."}, twice) is None


def test_a_multi_edit_lands_on_its_first_resolvable_edit():
    edits = [{"old_string": "nowhere"}, {"old_string": "Another."}]
    assert landing_line("MultiEdit", {"edits": edits}, BEFORE) == 3
    assert landing_line("MultiEdit", {"edits": []}, BEFORE) is None
    assert landing_line("MultiEdit", {"edits": "not a list"}, BEFORE) is None


def test_writing_a_new_file_lands_on_line_one():
    assert landing_line("Write", {"content": "anything"}, "") == 1


def test_writing_over_a_file_lands_where_it_diverges():
    after = BEFORE.replace("Another.", "Something else.")
    assert landing_line("Write", {"content": after}, BEFORE) == 3


def test_a_notebook_edit_gets_no_line_rather_than_an_invented_one():
    assert landing_line("NotebookEdit", {"notebook_path": "a.ipynb"}, BEFORE) is None


@pytest.mark.parametrize("data", [
    {}, {"old_string": None}, {"old_string": ""}, {"old_string": 7},
    {"content": 7},
])
def test_an_argument_the_model_made_up_is_not_fatal(data):
    """The tool input is whatever the model sent, and this runs inside the
    fence: an exception here would leave the permission decision unmade."""
    for tool in ("Edit", "MultiEdit", "Write"):
        assert landing_line(tool, data, BEFORE) is None or isinstance(
            landing_line(tool, data, BEFORE), int
        )
