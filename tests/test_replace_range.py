"""Replacing exactly the lines the writer selected.

`Edit` matches on a string the model reconstructed from what it was shown,
which fails on a paragraph carrying a stray `%` or an unusual macro and can
match the wrong occurrence in a chapter that repeats a phrase.  This
project's own writing rule makes that likelier rather than less, because one
paragraph is one line however long, so the string is often hundreds of
characters the model has to reproduce exactly.  A line range is what the
writer actually gestured at.
"""

import asyncio

import pytest

from nexttex.agent import ProjectAgent

DOCUMENT = "\n".join([
    r"\documentclass{article}",
    r"\begin{document}",
    "The first paragraph, which says one thing.",
    "The second paragraph, which says another.",
    r"\end{document}",
    "",
])


def agent(tmp_path):
    project = tmp_path / "project"
    (project / ".nexttex").mkdir(parents=True)
    (project / "main.tex").write_text(DOCUMENT, encoding="utf-8")
    subject = ProjectAgent(project, project / ".nexttex")
    written: dict = {}

    def apply_edit(path, text):
        path.write_text(text, encoding="utf-8")
        written["path"], written["text"] = path, text

    subject.apply_edit = apply_edit
    return subject, written


def run(subject, **args):
    return asyncio.run(subject.replace_range_tool(args))


def said(result) -> str:
    return result["content"][0]["text"]


def test_it_replaces_exactly_the_lines_it_was_given(tmp_path):
    subject, written = agent(tmp_path)
    result = run(
        subject, path="main.tex", from_line=4, to_line=4,
        text="The second paragraph, reworded.",
        expected="The second paragraph, which says another.",
    )
    assert "Replaced 1 line" in said(result)
    assert "reworded" in written["text"]
    assert "which says one thing" in written["text"]
    assert written["text"].count(r"\end{document}") == 1


def test_a_multi_line_range_becomes_one_paragraph(tmp_path):
    subject, written = agent(tmp_path)
    run(
        subject, path="main.tex", from_line=3, to_line=4,
        text="One paragraph where there were two.",
        expected="",
    )
    assert "One paragraph where there were two." in written["text"]
    assert "which says another" not in written["text"]


def test_it_refuses_when_the_writer_has_typed_there_since(tmp_path):
    """The one failure this feature could introduce.

    A turn can spend half a minute thinking while the writer keeps typing,
    and an edit that silently overwrote what they typed in that window would
    be worse than the tax of asking again.
    """
    subject, written = agent(tmp_path)
    result = run(
        subject, path="main.tex", from_line=4, to_line=4,
        text="Something else.",
        expected="A paragraph that is not there any more.",
    )
    assert "not what you were shown" in said(result)
    assert not written
    assert (subject.root / "main.tex").read_text(encoding="utf-8") == DOCUMENT


def test_a_range_past_the_end_of_the_document_is_refused(tmp_path):
    """Text after `\\end{document}` is typeset by nothing, so an edit there
    appears to work, shows a diff, and changes no page."""
    subject, written = agent(tmp_path)
    result = run(
        subject, path="main.tex", from_line=5, to_line=6, text="x", expected="",
    )
    assert "end{document}" in said(result)
    assert not written


@pytest.mark.parametrize("first, last", [(0, 1), (3, 2), (1, 99), (-1, 1)])
def test_a_range_that_is_not_one_is_refused(tmp_path, first, last):
    subject, written = agent(tmp_path)
    result = run(
        subject, path="main.tex", from_line=first, to_line=last,
        text="x", expected="",
    )
    assert "not a range" in said(result)
    assert not written


def test_a_path_outside_the_project_is_refused(tmp_path):
    subject, written = agent(tmp_path)
    outside = tmp_path / "elsewhere.tex"
    outside.write_text("x", encoding="utf-8")
    result = run(
        subject, path=str(outside), from_line=1, to_line=1,
        text="x", expected="",
    )
    assert "outside this project" in said(result)
    assert not written


def test_a_control_file_is_refused(tmp_path):
    """This tool is waved past the fence by construction, so it has to keep
    the promise that earns it that: the machinery the build runs is not the
    writing."""
    subject, written = agent(tmp_path)
    (subject.root / "latexmkrc").write_text("# perl\n", encoding="utf-8")
    result = run(
        subject, path="latexmkrc", from_line=1, to_line=1,
        text="system('rm -rf ~')", expected="",
    )
    assert "machinery" in said(result)
    assert not written


def test_an_edit_that_changes_nothing_says_so(tmp_path):
    subject, written = agent(tmp_path)
    result = run(
        subject, path="main.tex", from_line=3, to_line=3,
        text="The first paragraph, which says one thing.", expected="",
    )
    assert "would not change anything" in said(result)
    assert not written


def test_it_produces_an_edit_record_so_the_chip_and_undo_work(tmp_path):
    subject, _ = agent(tmp_path)
    run(
        subject, path="main.tex", from_line=4, to_line=4,
        text="Reworded.", expected="",
    )
    edits = subject.drain_edits()
    assert [edit.path for edit in edits] == ["main.tex"]
    assert edits[0].before == DOCUMENT
    assert "Reworded." in edits[0].after
