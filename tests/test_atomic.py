"""Writing a file without ever leaving it half-written."""

import pytest

from nexttex.atomic import NotAFile, read_text, write_atomically


def test_a_write_replaces_the_file(tmp_path):
    target = tmp_path / "chapter.tex"
    target.write_text("old", encoding="utf-8")
    write_atomically(target, "new")
    assert target.read_text(encoding="utf-8") == "new"


def test_writing_to_a_folder_raises_rather_than_crashing(tmp_path):
    folder = tmp_path / "figures"
    folder.mkdir()
    with pytest.raises(NotAFile):
        write_atomically(folder, "x")


def test_a_failed_write_leaves_no_scratch_file(tmp_path):
    """The tree would show it, and the next save would trip over it."""
    folder = tmp_path / "figures"
    folder.mkdir()
    with pytest.raises(NotAFile):
        write_atomically(folder, "x")
    assert list(tmp_path.glob("**/*.nexttex-tmp")) == []


def test_parents_are_created(tmp_path):
    target = tmp_path / "chapters" / "two" / "text.tex"
    write_atomically(target, "prose")
    assert target.read_text(encoding="utf-8") == "prose"


def test_bytes_go_through_unchanged(tmp_path):
    target = tmp_path / "figure.png"
    write_atomically(target, b"\x89PNG\x00\xff")
    assert target.read_bytes() == b"\x89PNG\x00\xff"


def test_reading_a_binary_file_as_text_gives_nothing(tmp_path):
    target = tmp_path / "figure.png"
    target.write_bytes(b"\x89PNG\x00\xff\xfe")
    assert read_text(target) is None
