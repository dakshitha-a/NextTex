"""Deleting a file, and getting it back.

The rule this defends: deleting is the one action in a writing app that undo
cannot reach, so nothing is destroyed until the writer says so twice.  A
restore must also never clobber whatever is at that path now.
"""

import json
import shutil
import time
from pathlib import Path

import pytest

from nexttex.history import History
from nexttex.trash import Trash, TrashEntry


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


# --- what a ledger entry is allowed to say ---------------------------------
#
# `entries.jsonl` is a file, parsed with a bare `json.loads`, and a restore
# takes both the destination path and the payload directory name straight out
# of it.  Peers can no longer write `.nexttex/`, which was the way in, so
# these are a second lock rather than the only one.


import json

import pytest


def _rewrite_entry(trash, **fields):
    """Edit the ledger the way something outside this process would.

    The escapes below all keep the *basename*, because that is what
    `payload_of` looks the deleted bytes up by: changing it would fail the
    restore for an uninteresting reason before reaching the check.
    """
    lines = trash.log.read_text(encoding="utf-8").splitlines()
    record = json.loads(lines[-1])
    record.update(fields)
    lines[-1] = json.dumps(record)
    trash.log.write_text("\n".join(lines) + "\n", encoding="utf-8")


@pytest.mark.parametrize("escape", [
    "../../../chapter.tex",
    "../chapter.tex",
    "/tmp/chapter.tex",
])
def test_a_restore_cannot_put_a_file_outside_the_project(tmp_path, escape):
    """The check that was here ran `relative_to` *after* the rename, and
    `relative_to` is lexical: `PurePosixPath("/p/../../x").relative_to("/p")`
    succeeds and hands back `../../x`.  So it neither ran in time nor would
    have caught it."""
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("months of work", encoding="utf-8")
    entry = trash.delete(project / "chapter.tex")

    _rewrite_entry(trash, path=escape)
    with pytest.raises(PermissionError):
        trash.restore(entry.id)

    landed = (project / escape) if not escape.startswith("/") else Path(escape)
    assert not landed.exists()


def test_a_restore_may_still_put_back_a_control_file(tmp_path):
    """Deliberately allowed, unlike the peer and upload write paths.

    Everything in the trash was in the project before it was deleted, so
    putting it back grants nothing that was not already there, and a writer
    who deletes their own `latexmkrc` and changes their mind is doing
    something completely ordinary.  A fence that stops a person undoing their
    own delete is a bug rather than a fence.
    """
    trash, project = bin(tmp_path)
    (project / "latexmkrc").write_text("$pdf_mode = 1;", encoding="utf-8")
    entry = trash.delete(project / "latexmkrc")
    trash.restore(entry.id)
    assert (project / "latexmkrc").read_text(encoding="utf-8") == "$pdf_mode = 1;"


@pytest.mark.parametrize("bad_id", [
    "../../etc", "..", "a/b", "", "NOTANID", "t" + "f" * 40,
])
def test_a_payload_id_cannot_be_a_path(tmp_path, bad_id):
    """The id is joined onto `.nexttex/trash/`, so it has to be one segment.

    The check used to sit on `payload_of`, which meant every *other* reader
    had to remember to make it -- and `purge` and `empty` did not, while
    handing what they built to `rmtree`.  So it moved to where the ledger is
    parsed: a line with an id `delete` could not have written never becomes
    an entry, and there is nothing downstream left to forget.
    """
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("months of work", encoding="utf-8")
    trash.delete(project / "chapter.tex")

    _rewrite_entry(trash, id=bad_id)
    assert [e.path for e in trash.entries()] == []
    # And the door has a second lock, for a caller holding an entry it did
    # not get from the ledger.
    forged = TrashEntry(id=bad_id, at=1.0, by="you", path="chapter.tex", kind="file")
    with pytest.raises(PermissionError):
        trash.payload_of(forged)


def test_the_ids_this_module_makes_are_all_acceptable(tmp_path):
    """The check must not refuse what `delete` itself writes."""
    trash, project = bin(tmp_path)
    for name in ("a.tex", "b.tex", "c.tex"):
        (project / name).write_text("x", encoding="utf-8")
        entry = trash.delete(project / name)
        assert trash.payload_of(entry).exists()


def test_an_ordinary_restore_still_works(tmp_path):
    """The fence must not stand in front of the thing it is guarding."""
    trash, project = bin(tmp_path)
    (project / "chapters").mkdir()
    (project / "chapters" / "one.tex").write_text("the chapter", encoding="utf-8")
    entry = trash.delete(project / "chapters" / "one.tex")
    trash.restore(entry.id)
    assert (project / "chapters" / "one.tex").read_text(encoding="utf-8") == "the chapter"


def test_a_ledger_line_with_an_impossible_id_is_ignored(tmp_path):
    """The ledger is a file, and a file is whatever is in it.

    Every reader joins an entry's id onto a path and one of them hands the
    result to `rmtree`, so a line `delete` could not have written is dropped
    where the ledger is parsed rather than at each use.
    """
    trash, project = bin(tmp_path)
    (project / "real.tex").write_text("real", encoding="utf-8")
    trash.delete(project / "real.tex")
    with trash.log.open("a", encoding="utf-8") as handle:
        for made_up in ("../../..", "..", "t00/../..", "", "NOTANID"):
            handle.write(
                json.dumps({"id": made_up, "at": 1.0, "path": "x", "kind": "dir"}) + "\n"
            )
    assert [e.path for e in trash.entries()] == ["real.tex"]


def test_emptying_cannot_reach_outside_the_trash(tmp_path):
    trash, project = bin(tmp_path)
    outside = tmp_path / "not-the-trash"
    outside.mkdir()
    (outside / "somebody-elses.tex").write_text("theirs", encoding="utf-8")
    with trash.log.open("a", encoding="utf-8") as handle:
        handle.write(
            json.dumps({"id": "../../..", "at": 1.0, "path": "x", "kind": "dir"}) + "\n"
        )
    trash.empty()
    assert (outside / "somebody-elses.tex").read_text(encoding="utf-8") == "theirs"
    assert project.is_dir()


def test_purging_cannot_reach_outside_the_trash(tmp_path):
    trash, project = bin(tmp_path)
    outside = tmp_path / "not-the-trash"
    outside.mkdir()
    (outside / "somebody-elses.tex").write_text("theirs", encoding="utf-8")
    with trash.log.open("a", encoding="utf-8") as handle:
        handle.write(
            json.dumps({"id": "../../..", "at": 1.0, "path": "x", "kind": "dir"}) + "\n"
        )
    assert trash.purge("../../..") is False
    assert (outside / "somebody-elses.tex").read_text(encoding="utf-8") == "theirs"
    assert project.is_dir()


def test_naming_a_payload_directory_is_checked_even_off_the_ledger(tmp_path):
    """The second lock on the same door, for a caller that never parsed a line."""
    trash, _ = bin(tmp_path)
    forged = TrashEntry(id="../../..", at=1.0, by="you", path="x", kind="dir")
    with pytest.raises(PermissionError):
        trash._holding(forged)
    with pytest.raises(PermissionError):
        trash.payload_of(forged)


def test_a_purge_whose_payload_is_already_gone_still_finishes(tmp_path):
    trash, project = bin(tmp_path)
    (project / "one.tex").write_text("one", encoding="utf-8")
    entry = trash.delete(project / "one.tex")
    shutil.rmtree(trash.payload_of(entry).parent)
    assert trash.purge(entry.id) is True
    assert trash.entries() == []


def test_a_restore_under_a_new_name_brings_its_past_with_it(tmp_path):
    """A restore whose old name has been taken comes back beside it.

    Its history cannot simply be renamed across, because history is keyed by
    path: the log at the old name holds this file's past *and* the past of
    whatever took the name after it went.  It is cut at the deletion, which
    is always there because a deletion is never thinned away.
    """
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("months of work", encoding="utf-8")
    trash.history.record("chapter.tex", "an early draft", op="create")
    entry = trash.delete(project / "chapter.tex")

    # Something else takes the name while it is in the trash.
    (project / "chapter.tex").write_text("a different chapter", encoding="utf-8")
    trash.history.record("chapter.tex", "a different chapter", op="create")

    result = trash.restore(entry.id)
    assert result["renamed"], "it should have come back beside, not over"

    came_back = trash.history.versions(result["renamed"])
    assert [v.op for v in came_back] == ["create", "delete", "restore"]
    # And the file that took the name keeps its own past, untouched.
    assert [v.op for v in trash.history.versions("chapter.tex")] == ["create"]


def test_an_ordinary_restore_leaves_the_history_where_it_was(tmp_path):
    """Nothing to split when the name was free."""
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("months of work", encoding="utf-8")
    trash.history.record("chapter.tex", "an early draft", op="create")
    entry = trash.delete(project / "chapter.tex")

    result = trash.restore(entry.id)
    assert result["renamed"] == ""
    assert [v.op for v in trash.history.versions("chapter.tex")] == [
        "create", "delete", "restore",
    ]


def test_a_delete_version_says_which_install_made_it(tmp_path):
    """The trash records straight onto the history rather than through the
    session, so without this it went out unstamped -- and unstamped means
    "written here" to whoever receives it."""
    history = History(tmp_path / "history")
    trash = Trash(
        tmp_path / "trash", history, tmp_path / "project",
        identity=lambda: {"peer": "a" * 64, "who": "Ada"},
    )
    (tmp_path / "project").mkdir()
    (tmp_path / "project" / "chapter.tex").write_text("gone", encoding="utf-8")
    trash.delete(tmp_path / "project" / "chapter.tex")

    last = history.versions("chapter.tex")[-1]
    assert last.op == "delete"
    assert last.peer == "a" * 64
    assert last.who == "Ada"


def test_a_project_under_a_build_directory_can_still_be_trashed(tmp_path):
    """The skip list is about paths inside the project, not about where the
    project happens to live.

    Matched against the whole absolute path, as this was, a project sitting
    anywhere under a directory called `.git` or `node_modules` had every one
    of its files skipped: no final versions, a count of zero, nothing
    restored on the way back, and nothing forgotten on a purge.
    """
    awkward = tmp_path / "node_modules" / "work"
    awkward.mkdir(parents=True)
    history = History(awkward / ".nexttex" / "history")
    trash = Trash(awkward / ".nexttex" / "trash", history, awkward)

    (awkward / "chapter.tex").write_text("months of work", encoding="utf-8")
    entry = trash.delete(awkward / "chapter.tex")

    assert [f.path for f in entry.files] == ["chapter.tex"]
    assert entry.as_dict()["bytes"] == len("months of work")
    assert history.versions("chapter.tex")[-1].op == "delete"
    assert trash.restore(entry.id)["restored"] == ["chapter.tex"]


def test_a_crash_before_the_payload_moves_leaves_something_findable(tmp_path):
    """The ledger line is written first on purpose.

    Move first and a crash in between left the payload under an id nothing
    listed: not restorable, because nothing knew it was there, and never
    reclaimed either, because emptying the trash walks the ledger.
    """
    trash, project = bin(tmp_path)
    (project / "chapter.tex").write_text("months of work", encoding="utf-8")
    entry = trash.delete(project / "chapter.tex")

    # What a crash between the two steps looks like from here.
    shutil.rmtree(trash.payload_of(entry).parent)

    assert [e.id for e in trash.entries()] == [entry.id], "nothing knew it was there"
    with pytest.raises(FileNotFoundError):
        trash.restore(entry.id)
    assert trash.empty() == 1, "and it could never be cleared away"


def test_a_scratch_file_left_by_a_crash_does_not_live_for_ever(tmp_path):
    """It was skipped by name and removed by nothing, so it stayed on disk
    and was counted in what the history costs."""
    import os

    history = History(tmp_path / "history")
    version = history.record("main.tex", "the chapter")
    shard = history.blobs.path_for(version.sha).parent
    scratch = shard / (version.sha + ".nexttex-tmp")
    scratch.write_bytes(b"half a blob")
    old = time.time() - 4 * 3600
    os.utime(scratch, (old, old))

    history.collect()
    assert not scratch.exists()
    assert history.blobs.get(version.sha) == b"the chapter"


def test_an_emptied_shard_does_not_stay_on_disk(tmp_path):
    history = History(tmp_path / "history")
    sha = history.blobs.put(b"nothing will ever refer to this")
    shard = history.blobs.path_for(sha).parent
    import os

    old = time.time() - 4 * 3600
    os.utime(history.blobs.path_for(sha), (old, old))

    assert history.collect() == 1
    assert not shard.exists()
