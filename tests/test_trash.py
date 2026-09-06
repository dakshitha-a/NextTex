"""Deleting a file, and getting it back.

The rule this defends: deleting is the one action in a writing app that undo
cannot reach, so nothing is destroyed until the writer says so twice.  A
restore must also never clobber whatever is at that path now.
"""

from pathlib import Path

from nexttex.history import History
from nexttex.trash import Trash


def bin(tmp_path) -> tuple[Trash, Path]:
    project = tmp_path / "project"
    project.mkdir()
    history = History(project / ".nexttex" / "history")
    return Trash(project / ".nexttex" / "trash", history, project), project


def test_a_deleted_file_leaves_the_tree_but_not_the_trash(tmp_path):
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("months of work", encoding="utf-8")
    entry = trash.delete(project / "chapter.tex")
    assert not (project / "chapter.tex").exists()
    assert [e.path for e in trash.entries()] == ["chapter.tex"]
    assert entry.files[0].bytes == len("months of work")
    # Moved, not copied: instant however large the thing deleted was.
    assert trash.payload_of(entry).read_text(encoding="utf-8") == "months of work"


def test_restoring_brings_the_text_back_exactly(tmp_path):
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("months of work", encoding="utf-8")
    entry = trash.delete(project / "chapter.tex")
    trash.restore(entry.id)
    assert (project / "chapter.tex").read_text(encoding="utf-8") == "months of work"
    assert trash.entries() == []


def test_a_deleted_folder_comes_back_whole(tmp_path):
    trash, project = bin(tmp_path)
    chapter = project / "chapters" / "02_theory"
    (chapter / "figures").mkdir(parents=True)
    (chapter / "empty").mkdir()
    (chapter / "02_theory.tex").write_text("theory", encoding="utf-8")
    (chapter / "figures" / "plot.png").write_bytes(b"\x89PNG not really")
    entry = trash.delete(project / "chapters")
    assert not (project / "chapters").exists()
    assert entry.kind == "dir" and len(entry.files) == 2

    trash.restore(entry.id)
    assert (chapter / "02_theory.tex").read_text(encoding="utf-8") == "theory"
    assert (chapter / "figures" / "plot.png").read_bytes() == b"\x89PNG not really"
    # Including the ones that held nothing: a folder comes back as it was.
    assert (chapter / "empty").is_dir()


def test_a_restore_never_writes_over_what_is_there_now(tmp_path):
    trash, project = bin(tmp_path)
    (project / "notes.tex").write_text("the old notes", encoding="utf-8")
    entry = trash.delete(project / "notes.tex")
    (project / "notes.tex").write_text("something newer", encoding="utf-8")

    result = trash.restore(entry.id)
    assert (project / "notes.tex").read_text(encoding="utf-8") == "something newer"
    assert (project / "notes (restored).tex").read_text(encoding="utf-8") == "the old notes"
    assert result["renamed"] == "notes (restored).tex"


def test_deleting_records_a_final_version_in_the_files_history(tmp_path):
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("last words", encoding="utf-8")
    trash.history.record("chapter.tex", "earlier words")
    trash.delete(project / "chapter.tex")
    versions = trash.history.versions("chapter.tex")
    assert versions[-1].op == "delete"
    assert trash.history.content("chapter.tex", versions[-1].sha) == "last words"


def test_history_survives_a_delete_and_a_restore(tmp_path):
    """The writer's whole point: the past comes back with the file."""
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("v1", encoding="utf-8")
    trash.history.record("chapter.tex", "v1")
    (project / "chapter.tex").write_text("v2", encoding="utf-8")
    trash.history.record("chapter.tex", "v2", by="claude")

    entry = trash.delete(project / "chapter.tex")
    trash.restore(entry.id)

    texts = [
        trash.history.content("chapter.tex", version.sha)
        for version in trash.history.versions("chapter.tex")
    ]
    assert "v1" in texts and "v2" in texts


def test_a_purge_removes_what_was_deleted_from_disk(tmp_path):
    trash, project = bin(tmp_path)
    (project / "one.tex").write_text("one", encoding="utf-8")
    entry = trash.delete(project / "one.tex")
    payload = trash.payload_of(entry)
    assert payload.exists()
    trash.purge(entry.id)
    assert not payload.exists()


def test_emptying_the_trash_takes_the_history_with_it(tmp_path):
    trash, project = bin(tmp_path)
    (project / "one.tex").write_text("one", encoding="utf-8")
    (project / "two.tex").write_text("two", encoding="utf-8")
    trash.delete(project / "one.tex")
    trash.delete(project / "two.tex")
    assert trash.empty() == 2
    assert trash.entries() == []
    assert trash.history.versions("one.tex") == []


def test_purging_one_entry_leaves_the_others(tmp_path):
    trash, project = bin(tmp_path)
    (project / "one.tex").write_text("one", encoding="utf-8")
    (project / "two.tex").write_text("two", encoding="utf-8")
    first = trash.delete(project / "one.tex")
    trash.delete(project / "two.tex")
    assert trash.purge(first.id)
    assert [e.path for e in trash.entries()] == ["two.tex"]


def test_build_output_is_not_listed_in_an_entry(tmp_path):
    """It travels with the folder, since the folder is moved whole -- but it
    is not counted or shown, because nobody deleted a chapter meaning to
    keep its .pyc files."""
    trash, project = bin(tmp_path)
    folder = project / "chapter"
    (folder / "__pycache__").mkdir(parents=True)
    (folder / "text.tex").write_text("prose", encoding="utf-8")
    (folder / "__pycache__" / "junk.pyc").write_bytes(b"junk")
    entry = trash.delete(folder)
    assert [f.path for f in entry.files] == ["chapter/text.tex"]


def test_emptying_the_trash_spares_a_new_file_with_the_same_name(tmp_path):
    """History is keyed by path.  Deleting a chapter, writing a new one
    under that name, and then emptying the trash used to unlink the new
    file's entire history -- a week of versions, unrecoverably."""
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("the old one", encoding="utf-8")
    trash.delete(project / "chapter.tex")

    (project / "chapter.tex").write_text("a new chapter entirely", encoding="utf-8")
    trash.history.record("chapter.tex", "a new chapter entirely")

    trash.empty()
    kept = trash.history.versions("chapter.tex")
    texts = [trash.history.content("chapter.tex", version.sha) for version in kept]
    assert "a new chapter entirely" in texts


def test_purging_spares_a_new_file_with_the_same_name(tmp_path):
    trash, project = bin(tmp_path)
    (project / "one.tex").write_text("old", encoding="utf-8")
    entry = trash.delete(project / "one.tex")
    (project / "one.tex").write_text("new", encoding="utf-8")
    trash.history.record("one.tex", "new")
    trash.purge(entry.id)
    texts = [trash.history.content("one.tex", v.sha)
             for v in trash.history.versions("one.tex")]
    assert "new" in texts


def test_a_symlink_in_a_deleted_folder_does_not_break_the_restore(tmp_path):
    """It follows to a file outside the folder, so recording it as a member
    named a path that is not under the entry -- which made the restore raise
    and the entry impossible to get back."""
    trash, project = bin(tmp_path)
    (project / "elsewhere.tex").write_text("still here", encoding="utf-8")
    folder = project / "chapter"
    folder.mkdir()
    (folder / "text.tex").write_text("prose", encoding="utf-8")
    (folder / "link.tex").symlink_to(project / "elsewhere.tex")

    entry = trash.delete(folder)
    assert [f.path for f in entry.files] == ["chapter/text.tex"]
    trash.restore(entry.id)
    assert (folder / "text.tex").read_text(encoding="utf-8") == "prose"
    # And the file it pointed at was never given a deletion it did not have.
    assert trash.history.versions("elsewhere.tex") == []
