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


def test_the_bytes_reach_the_disk_before_the_rename(tmp_path, monkeypatch):
    """Renaming over a target is atomic against this process dying, which is
    what this module was about, and it says nothing about the machine losing
    power. Without the flush the rename can be on disk while the bytes it
    points at are still in the page cache, and the file comes back existing,
    the right length, and full of zeroes."""
    import os

    from nexttex import atomic

    order: list[str] = []
    real_fsync, real_replace = os.fsync, os.replace
    monkeypatch.setattr(os, "fsync", lambda fd: (order.append("fsync"), real_fsync(fd))[1])
    monkeypatch.setattr(
        os, "replace", lambda a, b: (order.append("replace"), real_replace(a, b))[1]
    )

    atomic.write_atomically(tmp_path / "chapter.tex", "one line\n")

    # The file, then the rename, then the directory holding it.
    assert order == ["fsync", "replace", "fsync"]
    assert (tmp_path / "chapter.tex").read_text(encoding="utf-8") == "one line\n"


def test_bytes_are_flushed_too(tmp_path, monkeypatch):
    """A figure goes down the other branch of the same function."""
    import os

    from nexttex import atomic

    synced: list[int] = []
    real = os.fsync
    monkeypatch.setattr(os, "fsync", lambda fd: (synced.append(fd), real(fd))[1])

    atomic.write_atomically(tmp_path / "plot.png", b"\x89PNG\r\n\x1a\n")

    assert len(synced) == 2
    assert (tmp_path / "plot.png").read_bytes() == b"\x89PNG\r\n\x1a\n"


def test_a_directory_that_cannot_be_flushed_is_not_an_error(tmp_path, monkeypatch):
    """It fails quietly on purpose. Failing means the target comes back as it
    was before the write, which is safe rather than corrupt, and a directory
    cannot be opened for reading on Windows at all."""
    import os

    from nexttex import atomic

    real_open = os.open

    def refuse(path, flags, *rest):
        if flags & getattr(os, "O_DIRECTORY", 0):
            raise OSError("no directory handles here")
        return real_open(path, flags, *rest)

    monkeypatch.setattr(os, "open", refuse)
    atomic.write_atomically(tmp_path / "notes.tex", "still written\n")
    assert (tmp_path / "notes.tex").read_text(encoding="utf-8") == "still written\n"
