"""What a peer sends over a real sync, rather than straight into a map.

`test_hostile_peers.py` covers paths, control files, forged share ids,
provenance and frame size. The probe (Q-010) found none of it sent comments
or file records through the sync path, removed a peer while a file was in
flight, or raced a rename on one side with an edit on the other. These do,
over the loopback transport, between a sharer and a joiner.
"""

import pytest
from pycrdt import Array, Map

from server.collab import transport
from server.collab.comments import Comments

from .conftest import Peer, join_up, settle, until


async def pair(tmp_path, files=None):
    alice = Peer(tmp_path / "alice", files).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    return alice, bob


@pytest.mark.asyncio
async def test_a_malformed_thread_from_a_peer_does_not_break_the_other_drawer(tmp_path):
    alice, bob = await pair(tmp_path)
    file_id = alice.store.file_id_for("main.tex")
    with alice.store.manifest.transaction():
        alice.store.comments["c0000000000aa"] = Map({
            "file_id": file_id, "start": "", "end": "", "quote": "q" * 9000,
            "line": "two", "created": "yesterday",
            "messages": Array([Map({"body": "x" * 40_000, "peer": 7})]),
        })
    assert await until(lambda: "c0000000000aa" in bob.store.comments.keys())
    listing = Comments(bob.store, lambda: {"name": "Bob", "peer": "b" * 64}).listing()
    assert [t["id"] for t in listing] == ["c0000000000aa"]
    assert listing[0]["detached"] and listing[0]["line"] == 1
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_file_record_from_a_peer_is_fenced_when_it_arrives(tmp_path):
    """A record naming a place outside the project, sent the way a sync
    sends one, writes nothing outside the project on the other side."""
    alice, bob = await pair(tmp_path)
    with alice.store.manifest.transaction():
        alice.store.files["deadbeefdeadbeef"] = Map({
            "path": "../escaped.tex", "kind": "text", "size": 5.0, "trashed": False,
        })
    assert await until(lambda: "deadbeefdeadbeef" in bob.store.files.keys())
    bob.store.flush()
    await settle()
    assert not (tmp_path / "escaped.tex").exists()
    assert not (bob.project.root.parent / "escaped.tex").exists()
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_rename_on_one_side_and_an_edit_on_the_other_both_land(tmp_path):
    alice, bob = await pair(tmp_path, {"main.tex": "The chapter.\n"})
    bob.open_documents()
    await settle()
    await transport.HUB.sever()
    (alice.project.root / "main.tex").rename(alice.project.root / "intro.tex")
    alice.store.rename("main.tex", "intro.tex")
    bob_id = bob.store.file_id_for("main.tex")
    text = bob.store.body(bob_id)
    text.insert(len(str(text)), "Bob's line.\n")
    await settle()
    await transport.HUB.heal()
    await settle(0.8)
    for _ in range(3):
        alice.store.flush()
        bob.store.flush()
        await settle(0.3)
    for peer in (alice, bob):
        assert not (peer.project.root / "main.tex").exists(), peer.name
        assert (peer.project.root / "intro.tex").read_text() == "The chapter.\nBob's line.\n", peer.name
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_removing_a_peer_while_a_file_is_on_its_way_leaves_no_half_file(tmp_path):
    alice, bob = await pair(tmp_path)
    figure = alice.project.root / "figures" / "plot.png"
    figure.parent.mkdir()
    figure.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 200_000)
    alice.store.adopt()
    alice.network.remove("b" * 64)
    await settle(0.8)
    arrived = bob.project.root / "figures" / "plot.png"
    # Either it came whole before the removal landed, or not at all.
    assert not arrived.exists() or arrived.read_bytes() == figure.read_bytes()
    await alice.close()
    await bob.close()
