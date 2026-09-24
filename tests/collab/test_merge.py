"""The three-way merge an outside write is folded in with."""

import pytest

from server.collab.merge import merge
from server.collab.store import edits_for

BASE = "Para one.\nPara two.\nPara three.\n"


def test_changes_in_different_places_are_both_kept():
    ours = "Para one, typed.\nPara two.\nPara three.\n"
    theirs = "Para one.\nPara two.\nPara three, from vim.\n"
    merged = merge(BASE, ours, theirs, edits_for)
    assert merged.text == "Para one, typed.\nPara two.\nPara three, from vim.\n"
    assert not merged.clashed


def test_the_same_words_changed_on_both_sides_go_to_the_disk():
    merged = merge(BASE, "Para one, mine.\n" + BASE[10:], "Para one, disk.\n" + BASE[10:], edits_for)
    assert merged.text == "Para one, disk.\n" + BASE[10:]
    assert merged.clashed


def test_insertions_at_one_point_clash_and_elsewhere_do_not():
    assert merge("ab", "aXb", "aYb", edits_for).text == "aYb"
    assert merge("abc", "aXbc", "abYc", edits_for).text == "aXbYc"


@pytest.mark.parametrize("ours,theirs,expected", [
    (BASE, BASE + "Four.\n", BASE + "Four.\n"),              # only the disk moved
    (BASE + "Typed.\n", BASE, BASE + "Typed.\n"),             # only the document moved
    (BASE + "Same.\n", BASE + "Same.\n", BASE + "Same.\n"),   # both made the same change
])
def test_one_side_or_the_same_change_is_taken_as_it_is(ours, theirs, expected):
    merged = merge(BASE, ours, theirs, edits_for)
    assert merged.text == expected and not merged.clashed


def test_accented_text_and_astral_characters_merge_by_character():
    base = "Die Häuser sind groß.\nα β 𝛼.\n"
    ours = "Die alten Häuser sind groß.\nα β 𝛼.\n"
    theirs = "Die Häuser sind groß.\nα β 𝛼 γ.\n"
    assert merge(base, ours, theirs, edits_for).text == "Die alten Häuser sind groß.\nα β 𝛼 γ.\n"


def test_a_file_emptied_on_disk_is_a_change_like_any_other():
    # The disk deleted what was there; the document added a line after it.
    # Both hold: the line typed survives the emptying.
    merged = merge("x\n", "x\ny\n", "", edits_for)
    assert merged.text == "y\n" and not merged.clashed
    # Emptied while the same line was being edited is a clash the disk wins.
    clash = merge("x\n", "xz\n", "", edits_for)
    assert clash.clashed and clash.text == ""
