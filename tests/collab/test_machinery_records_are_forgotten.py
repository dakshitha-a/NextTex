"""Deleted records of files NextTex would no longer adopt are dropped.

A NextTex before 14 September 2026 hid a virtual environment only as
`.venv` or `venv`, so the NexusQC paper adopted `.venv-fig/` and kept its
records after the folder went; nothing else ever removes a record. Only
deleted ones go, since a live record is a file still on somebody's disk.
"""

import pytest
from pycrdt import Map

from .conftest import Peer, join_up, until


def put(store, file_id, path, *, trashed, kind="text"):
    with store.manifest.transaction():
        store.files[file_id] = Map({"path": path, "kind": kind, "size": 1, "trashed": trashed})


def test_deleted_machinery_goes_and_everything_else_stays(tmp_path):
    peer = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    peer.store.adopt()
    store = peer.store
    put(store, "venvmarker000001", ".venv-fig/pyvenv.cfg", trashed=True)
    put(store, "venvpython000001", ".venv-fig/bin/python", trashed=True, kind="blob")
    put(store, "nodemodules00001", "site/node_modules/x/index.js", trashed=True)
    put(store, "dsstore000000001", "figures/.DS_Store", trashed=True, kind="blob")
    put(store, "realwork00000001", "refs/repo/evaluation.yaml", trashed=True)
    put(store, "livecache0000001", "scripts/__pycache__/fig.pyc", trashed=False, kind="blob")

    assert store.forget_machinery() == 4

    left = {r["path"] for r in store.files.values()}
    assert "main.tex" in left
    assert "refs/repo/evaluation.yaml" in left, "real work that was deleted is not machinery"
    assert "scripts/__pycache__/fig.pyc" in left, "a live record is not this method's to drop"
    assert not any(p.startswith(".venv-fig/") or "node_modules" in p or p.endswith(".DS_Store")
                   for p in left)
    assert store.forget_machinery() == 0


@pytest.mark.asyncio
async def test_a_peer_loses_the_dropped_records_and_keeps_the_rest(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    alice.store.adopt()
    put(alice.store, "venvmarker000001", ".venv-fig/pyvenv.cfg", trashed=True)
    put(alice.store, "realwork00000001", "refs/old.tex", trashed=True)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: "venvmarker000001" in bob.store.files)

    assert alice.store.forget_machinery() == 1

    assert await until(lambda: "venvmarker000001" not in bob.store.files)
    assert "realwork00000001" in bob.store.files
    await bob.close()
    await alice.close()
