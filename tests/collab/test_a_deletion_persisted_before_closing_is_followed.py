"""A deletion agreed before a machine closed is followed when it opens.

A record already deleted when the manifest opens was left out of the
baseline `settle_paths` follows from, so its file, still on this disk, was
never moved into the trash, and `adopt` gave the file a fresh record that
brought it back for everybody. Found while fixing the thesis's returning
figures on 13 November 2026. The file is the deleted one when its bytes
are exactly what this install last wrote or sent for that record; anything
else under the deleted name is a new file, and is adopted.
"""

import hashlib

from nexttex.project import Project
from server.collab.store import CollabStore

from .conftest import Peer

PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 4


def opened_and_deleted(tmp_path, *, binary_sent=True):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "main.tex").write_text("\\input{ch}\n", encoding="utf-8")
    (root / "ch.tex").write_text("The chapter.\n", encoding="utf-8")
    (root / "plot.png").write_bytes(PNG)
    store = CollabStore(Project.open(root))
    store.adopt()
    chapter = store.file_id_for("ch.tex")
    plot = store.file_id_for("plot.png")
    # Opened here, so this install knows what it last had on disk; and
    # the binary sent to a peer, which is when its digest is kept.
    assert str(store.body(chapter)) == "The chapter.\n"
    if binary_sent:
        store.note_blob(plot, hashlib.sha256(PNG).hexdigest())
    store.flush()
    # A peer's deletion lands and is persisted, and this machine stops
    # before a flush follows it: no close, which would flush.
    store.holding = True
    store.files[chapter]["trashed"] = True
    store.files[plot]["trashed"] = True
    store._save_projected()
    store._save_blob_shas()
    store._closed = True
    return root, chapter, plot


def reopened(root):
    """The install opening again, with a session and a trash, adopting."""
    peer = Peer(root, {})
    peer.history.bind(peer.store.key_for, peer.store.records())
    return peer


def live_paths(store):
    return sorted(r.get("path") for r in store.files.values() if not r.get("trashed"))


def test_the_stale_copies_go_to_the_trash_and_are_not_adopted(tmp_path):
    root, chapter, plot = opened_and_deleted(tmp_path)
    peer = reopened(root)
    store = peer.store
    assert store.files[chapter]["trashed"] and store.files[plot]["trashed"]
    for _ in range(2):
        store.flush()
    assert not (root / "ch.tex").exists()
    assert not (root / "plot.png").exists()
    # In this machine's trash, where a restore can find them.
    assert {e.path for e in peer.trash.entries()} >= {"ch.tex", "plot.png"}
    store.adopt()
    assert live_paths(store) == ["main.tex"]
    store.close()


def test_a_new_file_under_a_deleted_name_is_adopted(tmp_path):
    root, chapter, plot = opened_and_deleted(tmp_path)
    (root / "ch.tex").write_text("A different chapter, written since.\n", encoding="utf-8")
    (root / "plot.png").write_bytes(PNG + b"redrawn")
    store = reopened(root).store
    for _ in range(2):
        store.flush()
    assert (root / "ch.tex").read_text(encoding="utf-8").startswith("A different")
    assert (root / "plot.png").is_file()
    assert live_paths(store) == ["ch.tex", "main.tex", "plot.png"]
    assert store.file_id_for("ch.tex") != chapter
    store.close()


def test_a_binary_with_no_digest_is_adopted_as_before(tmp_path):
    # From before the digests were kept: nothing says it is the deleted
    # one, and a size is not enough to put a file in the trash.
    root, chapter, plot = opened_and_deleted(tmp_path, binary_sent=False)
    store = reopened(root).store
    for _ in range(2):
        store.flush()
    assert not (root / "ch.tex").exists()
    assert (root / "plot.png").is_file()
    assert live_paths(store) == ["main.tex", "plot.png"]
    store.close()


def test_an_empty_file_is_never_taken_for_a_deleted_one(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "main.tex").write_text("x\n", encoding="utf-8")
    (root / "empty.tex").write_text("", encoding="utf-8")
    store = CollabStore(Project.open(root))
    store.adopt()
    empty = store.file_id_for("empty.tex")
    store.body(empty)
    store.flush()
    store.holding = True
    store.files[empty]["trashed"] = True
    store._save_projected()
    store._closed = True

    again = reopened(root).store
    again.flush()
    assert (root / "empty.tex").is_file()
    again.close()
