"""A file that leaves a watched project and returns is not a deletion.

Moving a file out of a directory and back is not exotic. A sync client
does it, a `git` checkout does it, and an editor that saves by writing a
temporary file and renaming it over the target does it on every save. The
writer does nothing wrong and the file is theirs throughout.

NextTex moved such a file into its own trash, recorded the deletion as the
writer's own doing, and swallowed anything later written to that path,
while the same bytes under another name survived. Found on 23 September
2026 on a real Windows install, by moving a figure out and back with
ordinary shell moves.

Four pieces made it, and each has a test here.

* `ingest` is reached with `after=None, gone=False` for a figure that is
  present, because `read_text` cannot decode it. That is the "nothing to
  say" branch, and it said nothing about the file having come back.
* `_settle_gone` is right on its own terms and trashes only what is still
  missing when the debounce expires, but nothing cleared `_gone_pending`
  or the flag when the file returned first.
* `file_id_for` skips trashed records, so a file at a trashed path is
  invisible to the lookup and the walk gives it a *second* record.
* `settle_paths` then finds the first record still trashed, with its
  `_named` baseline pointing at the path, and `_trash_locally` moves
  whatever is there into the trash. That is the swallow.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from .conftest import Peer

# Big enough that one missing file is not half the project: `_settle_gone`
# holds a batch that names half or more for one more debounce, because a
# folder being removed arrives file by file. A four-file project made the
# first attempt at these tests pass for the wrong reason.
FILES = {
    "main.tex": "The chapter.\n",
    "one.tex": "One.\n",
    "two.tex": "Two.\n",
    "three.tex": "Three.\n",
    "four.tex": "Four.\n",
    "five.tex": "Five.\n",
}

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 4096


@pytest.fixture
def peer(tmp_path: Path) -> Peer:
    made = Peer(tmp_path / "paper", dict(FILES))
    figures = made.project.root / "figures"
    figures.mkdir()
    (figures / "plot.png").write_bytes(PNG)
    made.store.adopt()
    return made


def tick(peer: Peer, relative: str) -> None:
    """One watcher tick for one path, as `_fold_tick` in server/main.py.

    A figure that is present reads as `None` because it cannot be decoded,
    and `gone` is what tells that apart from a file that is not there.
    """
    path = peer.project.resolve(relative)
    peer.store.ingest(relative, None, gone=not path.exists())


def settle(peer: Peer, times: int = 4) -> None:
    for _ in range(times):
        peer.store.flush()


def records_for(peer: Peer, relative: str) -> list[dict]:
    return [
        record for record in peer.store.files.values()
        if record.get("path") == relative
    ]


def trash_entries(peer: Peer) -> list:
    return peer.trash.entries() if hasattr(peer.trash, "entries") else []


def test_a_figure_that_comes_back_before_the_flush_is_not_deleted(peer: Peer):
    """The common case: a sync client's move is over in milliseconds."""
    plot = peer.project.root / "figures" / "plot.png"
    away = peer.project.root.parent / "plot.png"

    plot.rename(away)
    tick(peer, "figures/plot.png")
    away.rename(plot)
    tick(peer, "figures/plot.png")
    settle(peer)

    assert plot.exists(), "the file was taken off the disk"
    kept = records_for(peer, "figures/plot.png")
    assert len(kept) == 1, f"one record, not {len(kept)}"
    assert not kept[0].get("trashed"), "a file that is on the disk is marked deleted"


def test_a_figure_that_comes_back_after_the_flush_is_brought_back(peer: Peer):
    """The slower case: the deletion settled before the file returned.

    This is the one the Windows install showed. The record is trashed by
    the time the file is back, and what must not happen is that the file
    is then moved into the trash to match the record.
    """
    plot = peer.project.root / "figures" / "plot.png"
    away = peer.project.root.parent / "plot.png"

    plot.rename(away)
    tick(peer, "figures/plot.png")
    settle(peer)
    assert records_for(peer, "figures/plot.png")[0].get("trashed"), (
        "the deletion should have settled while the file really was gone"
    )

    away.rename(plot)
    tick(peer, "figures/plot.png")
    settle(peer)

    assert plot.exists(), "the file that came back was moved into the trash"
    kept = records_for(peer, "figures/plot.png")
    assert len(kept) == 1, f"one record, not {len(kept)}"
    assert not kept[0].get("trashed"), "the record stayed deleted with the file present"


def test_a_new_file_at_a_deleted_path_is_not_swallowed(peer: Peer):
    """The black hole: the path, not the file, was cursed.

    On the install this was found on, the same bytes under another name
    survived in the same directory at the same moment. Only the path that
    had been trashed swallowed what was written to it.
    """
    plot = peer.project.root / "figures" / "plot.png"
    plot.unlink()
    tick(peer, "figures/plot.png")
    settle(peer)

    # A fresh file, nothing to do with the one that went.
    plot.write_bytes(PNG + b"new")
    tick(peer, "figures/plot.png")
    settle(peer)

    assert plot.exists(), "a newly written file was taken off the disk"
    kept = records_for(peer, "figures/plot.png")
    assert len(kept) == 1, f"one record, not {len(kept)}"
    assert not kept[0].get("trashed")


def test_a_chapter_that_comes_back_is_not_deleted_either(peer: Peer):
    """Not only figures. A `.tex` goes down the folding path instead, and
    reaches the same trashed record through the same blind lookup."""
    chapter = peer.project.root / "one.tex"
    away = peer.project.root.parent / "one.tex"

    chapter.rename(away)
    peer.store.ingest("one.tex", None, gone=True)
    settle(peer)

    away.rename(chapter)
    peer.store.ingest("one.tex", chapter.read_text(encoding="utf-8"), gone=False)
    settle(peer)

    assert chapter.exists(), "the chapter was moved into the trash"
    kept = records_for(peer, "one.tex")
    assert len(kept) == 1, f"one record, not {len(kept)}"
    assert not kept[0].get("trashed")
    assert chapter.read_text(encoding="utf-8") == "One.\n"


def test_a_file_that_is_really_gone_is_still_deleted(peer: Peer):
    """The guard rail on all of the above: none of this may teach the
    watcher to ignore a deletion the writer actually made."""
    plot = peer.project.root / "figures" / "plot.png"
    plot.unlink()
    tick(peer, "figures/plot.png")
    settle(peer)

    kept = records_for(peer, "figures/plot.png")
    assert len(kept) == 1
    assert kept[0].get("trashed"), "a deletion stopped being noticed"


def test_a_new_file_taking_a_deliberately_deleted_name_is_its_own_file(peer: Peer):
    """The line the revive must not cross.

    A deletion the writer asked for is not a sighting to be withdrawn. If
    they delete a chapter and then make a new one with the same name, that
    new file is its own: reviving the old record would hand it the deleted
    file's identity, and with it a history that belongs to somebody else's
    work. Only a deletion this machine's own watcher inferred from the
    disk may be undone by the file coming back.
    """
    chapter = peer.project.root / "two.tex"
    file_id = peer.store.file_id_for("two.tex")
    assert file_id is not None

    # A deliberate deletion, as the trash route makes it: the record is
    # flagged without the watcher ever having inferred anything.
    peer.store.files[file_id]["trashed"] = True
    chapter.unlink()
    settle(peer)

    chapter.write_text("A different file.\n", encoding="utf-8")
    peer.store.ingest("two.tex", "A different file.\n", gone=False)
    settle(peer)

    assert chapter.exists(), "the new file was taken off the disk"
    live = peer.store.file_id_for("two.tex")
    assert live is not None, "the new file never got a record"
    assert live != file_id, "the new file was given the deleted file's identity"
    assert peer.store.files[file_id].get("trashed"), (
        "a deletion the writer made was undone by a new file of the same name"
    )


def test_a_file_deleted_outside_schedules_a_build(peer: Peer, monkeypatch):
    """A chapter removed in another terminal used to stay on the page until
    the next keystroke, when the build then failed on the missing input:
    the watcher's tick tells the compiler about every write it sees, but a
    file it saw go is only known to be deleted at the flush, and nothing
    there scheduled a build. The honest build fails, and says why."""
    builds: list[int] = []
    monkeypatch.setattr(peer, "schedule_compile", lambda: builds.append(1))
    chapter = peer.project.root / "one.tex"
    chapter.unlink()
    tick_text(peer, "one.tex")
    settle(peer)

    assert records_for(peer, "one.tex")[0].get("trashed")
    assert builds, "a deletion outside NextTex scheduled no build"


def test_a_file_that_comes_back_schedules_no_build_of_its_own(peer: Peer, monkeypatch):
    builds: list[int] = []
    monkeypatch.setattr(peer, "schedule_compile", lambda: builds.append(1))
    chapter = peer.project.root / "one.tex"
    held = chapter.read_text()
    chapter.unlink()
    tick_text(peer, "one.tex")
    chapter.write_text(held)
    settle(peer)

    assert not records_for(peer, "one.tex")[0].get("trashed")
    assert not builds


def tick_text(peer: Peer, relative: str) -> None:
    """A watcher tick for a text file, which reads its text when it is
    there and reports it gone when it is not."""
    path = peer.project.resolve(relative)
    here = path.exists()
    peer.store.ingest(relative, path.read_text() if here else None, gone=not here)
