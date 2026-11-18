"""A project's list of what it does not share.

The writer's answers of 17 November 2026: a per-project list in
`nexttex.toml`, so every member agrees on it, with TeX's leftovers and build
folders left out by default; a path that goes on the list stops syncing and
every member keeps their own copy, including when the defaults reach an
existing share at update. A member on an older NextTex, which knows no
list, adopts such a path again; a newer member keeps that record and never
writes, sends or asks for its file, and does not drop it again.
"""

import pytest
from pycrdt import Map

from nexttex.project import ProjectConfig

from .conftest import Peer, join_up, settle, until


def live(peer: Peer, path: str) -> list[str]:
    return [
        file_id for file_id, record in peer.store.files.items()
        if record.get("path") == path and not record.get("trashed")
    ]


def list_it(peer: Peer, patterns: list[str]) -> None:
    config = peer.project.config
    config.not_shared = patterns
    config.save(peer.project.root)


@pytest.mark.asyncio
async def test_a_folder_put_on_the_list_stops_syncing_and_both_keep_it(tmp_path):
    alice = Peer(tmp_path / "alice", {
        "main.tex": "The chapter.\n", "scratch/a.txt": "Alice's scratch.\n",
    }).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    theirs = bob.project.root / "scratch" / "a.txt"
    assert await until(lambda: theirs.exists() and theirs.read_text() == "Alice's scratch.\n")

    list_it(alice, ["scratch/"])
    alice.store.adopt()
    alice.store.flush()
    assert live(alice, "scratch/a.txt") == []
    assert await until(lambda: live(bob, "scratch/a.txt") == [], 10.0)
    for _ in range(3):
        bob.store.flush()
        await settle()
    # No tombstone: Bob's copy stays, and is Bob's.
    assert theirs.read_text() == "Alice's scratch.\n"
    assert [e.path for e in bob.trash.entries()] == []
    (alice.project.root / "scratch" / "a.txt").write_text("Alice's, changed.\n")
    alice.store.ingest("scratch/a.txt", "Alice's, changed.\n")
    alice.store.flush()
    await settle()
    assert theirs.read_text() == "Alice's scratch.\n"
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_an_older_member_adopting_a_listed_path_changes_nothing_here(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    list_it(alice, ["scratch/"])
    (alice.project.root / "scratch").mkdir()
    mine = alice.project.root / "scratch" / "a.txt"
    mine.write_text("Alice's own.\n")
    alice.store.adopt()
    assert live(alice, "scratch/a.txt") == []
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: (bob.project.root / "main.tex").exists())

    # Bob on an older NextTex: no list, so he adopts his own scratch file
    # and types into it.
    bob.store.files["ef" * 16] = Map({
        "path": "scratch/a.txt", "kind": "text", "size": 11, "trashed": False,
    })
    text = bob.store.body("ef" * 16)
    with text.doc.transaction():
        text += "Bob's own.\n"
    assert await until(lambda: live(alice, "scratch/a.txt") == ["ef" * 16], 10.0)
    for _ in range(3):
        alice.store.flush()
        alice.store.adopt()
        await settle()
    # Kept, not dropped again, and inert: Alice's file is hers.
    assert live(alice, "scratch/a.txt") == ["ef" * 16]
    assert mine.read_text() == "Alice's own.\n"
    await bob.close()
    await alice.close()


def test_the_defaults_leave_out_tex_leftovers_and_keep_a_calculations_log(tmp_path):
    peer = Peer(tmp_path / "alice", {
        "main.tex": "The chapter.\n",
        "main.log": "This is pdfTeX.\n",
        "main.aux": "\\relax\n",
        "main.bbl": "\\begin{thebibliography}{1}\n",
        "calc/regen.log": "step 1\n",
        "paper/build/main.pdf": "%PDF\n",
    })
    for path in ("main.tex", "main.bbl", "calc/regen.log"):
        assert live(peer, path), path
    for path in ("main.log", "main.aux", "paper/build/main.pdf"):
        assert live(peer, path) == [], path
    # Switched off, they are shared like anything else.
    peer.project.config.not_shared_defaults = False
    peer.store.adopt()
    assert live(peer, "main.log")


def test_the_defaults_reach_an_existing_share_once(tmp_path):
    peer = Peer(tmp_path / "alice", {"main.tex": "x\n"})
    # A record from before the defaults, for a leftover.
    peer.store.files["12" * 16] = Map({
        "path": "main.aux", "kind": "text", "size": 7, "trashed": False,
    })
    (peer.project.root / "main.aux").write_text("\\relax\n")
    (peer.store.root / "not-shared-applied.json").unlink()
    peer.store.adopt()
    assert live(peer, "main.aux") == []
    assert (peer.project.root / "main.aux").read_text() == "\\relax\n"
    # And once only: a record that comes back is kept.
    peer.store.files["34" * 16] = Map({
        "path": "main.aux", "kind": "text", "size": 7, "trashed": False,
    })
    peer.store.adopt()
    assert live(peer, "main.aux") == ["34" * 16]


def test_a_list_that_leaves_the_project_is_not_read():
    config = ProjectConfig(name="x")
    assert config.not_shared == []
    from nexttex.project import clean_not_shared
    assert clean_not_shared(["../elsewhere"]) is None
    assert clean_not_shared(["/etc/"]) is None
    assert clean_not_shared(["scratch/", "*.dat", "refs/**/old.txt"]) == [
        "scratch/", "*.dat", "refs/**/old.txt"]
