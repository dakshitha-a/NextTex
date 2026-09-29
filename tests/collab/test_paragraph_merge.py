"""The paragraph merge: one side's change taken, both sides' kept apart."""

import shutil
import subprocess

import pytest

from server.collab.paragraphs import TAG, blocks, merge

BASE = "Intro.\n\nThe cat sat on the mat.\n\nEnd.\n"


def _swap(old: str, new: str, text: str = BASE) -> str:
    assert old in text
    return text.replace(old, new)


def test_a_paragraph_changed_on_one_side_takes_that_side():
    theirs = _swap("The cat sat on the mat.", "A dog lay on the rug.")
    assert merge(BASE, BASE, theirs, "A", "B", "a.tex").text == theirs
    assert merge(BASE, theirs, BASE, "A", "B", "a.tex").text == theirs


def test_different_paragraphs_changed_on_each_side_both_land_without_markers():
    ours = _swap("Intro.", "Introduction.")
    theirs = _swap("End.", "The end.")
    result = merge(BASE, ours, theirs, "A", "B", "a.tex")
    assert result.text == "Introduction.\n\nThe cat sat on the mat.\n\nThe end.\n"
    assert result.conflicts == 0 and "nexttex-conflict" not in result.text


def test_one_paragraph_changed_on_both_sides_keeps_both_versions_named():
    ours = _swap("The cat sat on the mat.", "The cat sat quietly on the mat.")
    theirs = _swap("The cat sat on the mat.", "A dog lay on the rug.")
    result = merge(BASE, ours, theirs, "Alice", "Bob", "a.tex")
    assert result.conflicts == 1
    lines = result.text.splitlines()
    assert lines[0] == "Intro." and lines[-1] == "End."
    tagged = [line for line in lines if TAG.search(line)]
    assert [TAG.search(line).group(2) for line in tagged] == [None, "1", "2", "end"]
    assert all(line.startswith("% ") for line in tagged)
    assert "Version from Alice" in tagged[1] and "Version from Bob" in tagged[2]
    assert "The cat sat quietly on the mat." in result.text
    assert "A dog lay on the rug." in result.text
    # Nothing is mixed: neither version is spliced into the other.
    assert result.text.count("mat.") == 1 and result.text.count("rug.") == 1


def test_the_same_change_on_both_sides_is_taken_once():
    same = _swap("The cat sat on the mat.", "The cat slept.")
    result = merge(BASE, same, same, "A", "B", "a.tex")
    assert result.text == same and result.conflicts == 0


def test_the_same_change_inside_a_larger_clash_is_not_repeated():
    base = "One.\n\nTwo.\n\nThree.\n"
    ours = "One!\n\nTwo, mine.\n\nThree.\n"
    theirs = "One!\n\nTwo, theirs.\n\nThree.\n"
    result = merge(base, ours, theirs, "A", "B", "a.tex")
    assert result.text.count("One!") == 1 and result.conflicts == 1


def test_an_edit_against_a_delete_keeps_the_edit_marked():
    ours = _swap("The cat sat on the mat.\n\n", "")
    theirs = _swap("The cat sat on the mat.", "A dog lay on the rug.")
    result = merge(BASE, ours, theirs, "Alice", "Bob", "a.tex")
    assert result.conflicts == 1
    assert "this paragraph was deleted in one version and changed in the other" in result.text
    assert "Deleted in the version from Alice {nexttex-conflict" in result.text
    assert "A dog lay on the rug." in result.text


def test_a_paragraph_deleted_on_both_sides_is_gone():
    gone = _swap("The cat sat on the mat.\n\n", "")
    assert merge(BASE, gone, gone, "A", "B", "a.tex").text == gone


def test_new_paragraphs_at_one_place_are_both_kept_without_markers():
    ours = _swap("End.", "Mine.\n\nEnd.")
    theirs = _swap("End.", "Theirs.\n\nEnd.")
    result = merge(BASE, ours, theirs, "A", "B", "a.tex")
    assert result.conflicts == 0
    assert "Mine." in result.text and "Theirs." in result.text
    assert result.text.endswith("End.\n")


def test_an_environment_with_blank_lines_inside_is_one_paragraph():
    text = "Before.\n\n\\begin{proof}\nStep one.\n\nStep two.\n\\end{proof}\n\nAfter.\n"
    assert blocks(text, "a.tex") == [
        "Before.\n\n",
        "\\begin{proof}\nStep one.\n\nStep two.\n\\end{proof}\n\n",
        "After.\n",
    ]
    # A commented \begin does not open anything.
    assert len(blocks("% \\begin{x}\nA.\n\nB.\n", "a.tex")) == 2
    # A missing \end does not swallow the rest of an unrelated environment.
    assert len(blocks("\\begin{a}\n\\begin{b}\n\\end{a}\n\nNext.\n", "a.tex")) == 2


def test_a_fenced_block_in_markdown_is_one_paragraph():
    text = "Text.\n\n```\ncode\n\nmore\n```\n\nAfter.\n"
    assert len(blocks(text, "notes.md")) == 3


def test_blocks_join_back_to_the_text_exactly():
    for text in ("", "a", "a\n", "\n\n\na\n\n\nb", BASE, "x\r\n\r\ny\r\n"):
        assert "".join(blocks(text, "a.tex")) == text


@pytest.mark.parametrize("path,opening,closing", [
    ("refs.bib", "% ", ""),
    ("plot.py", "# ", ""),
    ("notes.md", "<!-- ", " -->"),
])
def test_each_file_type_gets_its_own_comment_form(path, opening, closing):
    ours = _swap("The cat sat on the mat.", "Ours.")
    theirs = _swap("The cat sat on the mat.", "Theirs.")
    result = merge(BASE, ours, theirs, "A", "B", path)
    tagged = [line for line in result.text.splitlines() if TAG.search(line)]
    assert len(tagged) == 4
    assert all(line.startswith(opening) and line.endswith(closing) for line in tagged)


def test_a_file_type_with_no_comments_takes_ours_and_says_so():
    ours = _swap("The cat sat on the mat.", "Ours.")
    theirs = _swap("The cat sat on the mat.", "Theirs.")
    result = merge(BASE, ours, theirs, "A", "B", "data.csv")
    assert result.commentless and result.conflicts == 1
    assert result.text == ours


def test_a_version_at_the_end_of_a_file_without_a_newline_stays_its_own_paragraph():
    base = "A.\n\nB."
    result = merge(base, "A.\n\nB mine.", "A.\n\nB theirs.", "X", "Y", "a.tex")
    assert "B mine.\n\n% Version from Y" in result.text


def test_the_marker_id_is_the_same_for_the_same_clash():
    ours = _swap("The cat sat on the mat.", "Ours.")
    theirs = _swap("The cat sat on the mat.", "Theirs.")
    assert merge(BASE, ours, theirs, "A", "B", "a.tex").ids == merge(BASE, ours, theirs, "A", "B", "a.tex").ids


@pytest.mark.skipif(shutil.which("pdflatex") is None, reason="pdflatex is needed")
def test_a_document_with_two_versions_still_compiles(tmp_path):
    base = "\\documentclass{article}\n\\begin{document}\n\nThe cat sat on the mat.\n\n\\end{document}\n"
    ours = base.replace("The cat sat on the mat.", "The cat sat quietly on the mat.")
    theirs = base.replace("The cat sat on the mat.", "A dog lay on the rug.")
    result = merge(base, ours, theirs, "Alice", "Bob", "main.tex")
    assert result.conflicts == 1
    (tmp_path / "main.tex").write_text(result.text)
    done = subprocess.run(
        ["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "main.tex"],
        cwd=tmp_path, capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stdout[-2000:]
    assert (tmp_path / "main.pdf").is_file()
