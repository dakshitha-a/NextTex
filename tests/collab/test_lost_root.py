"""A project folder that is gone from one disk is gone from that disk only.

`rm -rf` of a shared project, moving it, or a drive going to sleep, all
reach the store the same way: the watcher reports every file missing.  The
store used to call each of them deleted, publish that, and every
collaborator's copy went into their trash.  A folder that is not there is
not a list of deletions; it is the end of this install's part in the
project until somebody says where the folder went.
"""

from __future__ import annotations

import os
import shutil

import pytest

from server.collab.store import CollabStore

from .conftest import Peer, join_up, settle, until

FILES = {
    "main.tex": "\\documentclass{article}\\begin{document}Hi\\end{document}\n",
    "chapters/one.tex": "The first chapter.\n",
    "chapters/two.tex": "The second chapter.\n",
    "notes.tex": "Notes.\n",
}


def _report_missing(peer: Peer) -> None:
    """What the watcher hands the store after the whole folder went."""
    for path in FILES:
        peer.store.ingest(path, None, gone=True)


class _Lost:
    """A stand-in session that only wants to know the folder went."""

    def __init__(self, inner: Peer) -> None:
        self.inner = inner
        self.told = 0

    def note_root_lost(self) -> None:
        self.told += 1

    def __getattr__(self, name):
        return getattr(self.inner, name)


@pytest.mark.asyncio
async def test_a_removed_folder_deletes_nothing_anywhere(tmp_path):
    host = Peer(tmp_path / "alice", FILES).be("alice")
    guest = Peer(tmp_path / "bob", {}).be("bob")
    await join_up(host, guest)
    assert await until(lambda: len(guest.store.files) == len(FILES))
    guest.open_documents()
    await settle()

    shutil.rmtree(guest.project.root)
    _report_missing(guest)
    guest.store.flush()
    guest.store.flush()
    await settle()

    assert guest.store.root_lost is True
    assert not any(r.get("trashed") for r in guest.store.files.values())
    assert not any(r.get("trashed") for r in host.store.files.values())
    for path, text in FILES.items():
        assert (host.project.root / path).read_text() == text
    # And the folder was not brought back by the flush either.
    assert not guest.project.root.exists()

    await guest.close()
    await host.close()


@pytest.mark.asyncio
async def test_a_moved_folder_is_not_rebuilt_at_its_old_path(tmp_path):
    """A peer's edit used to make `.nexttex/collab/docs` reappear.

    `persist.append` creates the directories it needs, and the first
    thing to touch the disk after an edit arrives is the log.
    """
    host = Peer(tmp_path / "alice", FILES).be("alice")
    guest = Peer(tmp_path / "bob", {}).be("bob")
    await join_up(host, guest)
    assert await until(lambda: len(guest.store.files) == len(FILES))
    guest.open_documents()
    await settle()

    old = guest.project.root
    os.rename(old, tmp_path / "bob-elsewhere")
    assert not old.exists()

    text = host.store.body(host.store.file_id_for("notes.tex"))
    text += "More.\n"
    host.store.flush()
    await settle()
    guest.store.flush()

    assert not old.exists()
    assert guest.store.root_lost is True
    assert (host.project.root / "notes.tex").read_text() == "Notes.\nMore.\n"

    await guest.close()
    await host.close()


def test_a_deletion_that_arrives_in_two_batches_is_not_half_published(tmp_path):
    """The folder exists until its last file goes.

    A slow disk reports the first few files missing while the root is
    still there.  A batch naming half the project or more is held for one
    more flush, and the root is looked at again before any of it is
    called deleted.
    """
    root = tmp_path / "carol"
    peer = Peer(root, FILES)
    session = _Lost(peer)
    store = CollabStore(peer.project, session)
    store.adopt()

    first = ["main.tex", "chapters/one.tex"]
    for path in first:
        (root / path).unlink()
        store.ingest(path, None, gone=True)
    store.flush()
    assert not any(r.get("trashed") for r in store.files.values())

    shutil.rmtree(root)
    for path in FILES:
        if path not in first:
            store.ingest(path, None, gone=True)
    store.flush()
    assert not any(r.get("trashed") for r in store.files.values())
    assert store.root_lost is True
    assert session.told == 1
    # Said once, however many flushes follow.
    store.flush()
    store.close()
    assert session.told == 1


def test_clearing_out_a_folder_that_stays_is_still_a_deletion(tmp_path):
    root = tmp_path / "dave"
    peer = Peer(root, FILES)
    store = peer.store
    for path in FILES:
        (root / path).unlink()
        store.ingest(path, None, gone=True)
    store.flush()
    assert not any(r.get("trashed") for r in store.files.values())
    store.flush()
    assert all(r.get("trashed") for r in store.files.values())
    assert store.root_lost is False
    store.close()
