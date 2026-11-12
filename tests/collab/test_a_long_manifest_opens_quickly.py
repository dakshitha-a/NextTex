"""A manifest with thousands of records behind it opens in one read of them.

A send opens every text record the manifest names, trashed ones included,
and opening one asked `_held_by_another` whether some other live record
named the same path, by scanning every record across the FFI boundary into
Rust. A paper with 188 files and 3057 records behind them, 2869 of them
trashed, spent 50 seconds there on a loaded machine. Every join of it gave
up at 30, and the Windows laptop was told the connection had gone quiet.
"""

from nexttex.project import Project
from pycrdt import Map
from server.collab.store import CollabStore


def a_store(tmp_path, live: int, trashed: int) -> CollabStore:
    root = tmp_path / "paper"
    root.mkdir()
    for n in range(live):
        (root / f"note{n}.txt").write_text(f"note {n}\n")
    store = CollabStore(Project.open(root))
    store.adopt()
    for n in range(trashed):
        store.files[f"gone{n}"] = Map({
            "path": f"old/gone{n}.txt", "kind": "text", "size": 5, "trashed": True,
        })
    return store


def test_opening_every_document_reads_the_manifest_once(tmp_path, monkeypatch):
    store = a_store(tmp_path, live=20, trashed=300)
    reads = []
    real = type(store.files).items

    def counted(self):
        reads.append(1)
        return real(self)

    monkeypatch.setattr(type(store.files), "items", counted)
    for file_id in list(store.files.keys()):
        store.body(file_id)

    assert len(reads) <= 2, (
        f"opening {len(store.files)} documents read the whole manifest "
        f"{len(reads)} times"
    )
    store.close()


def test_the_answer_follows_the_manifest(tmp_path):
    """The index is dropped whenever the manifest moves, so the answer
    is the one the scan gave, before and after a record changes."""
    store = a_store(tmp_path, live=2, trashed=1)
    one = store.file_id_for("note0.txt")
    two = store.file_id_for("note1.txt")

    assert not store._held_by_another(one, "note0.txt")

    # A second live record at the same path: each is held by the other.
    store.files[two]["path"] = "note0.txt"
    assert store._held_by_another(one, "note0.txt")
    assert store._held_by_another(two, "note0.txt")

    # A trashed one does not count.
    store.files[two]["trashed"] = True
    assert not store._held_by_another(one, "note0.txt")

    # Nor does the trashed record that was there from the start.
    assert not store._held_by_another(one, "old/gone0.txt")
    store.close()
