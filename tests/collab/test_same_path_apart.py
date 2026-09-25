"""Two people's new files of one name stay two files.

The September review found that two collaborators who each created
`chapters/03.tex` while apart derived the same id from the path, and their
documents merged, each ending up holding both chapters. Its fix gave a file
made here random bytes for an id, in a branch only the test reached: the
one caller in the program adopted every new file with the path-derived id,
so the fault was back and the test that guarded it still passed (Q-009).

These drive the path a file takes in the program: shared and joined over
the loopback transport, written on each disk while the link is severed,
ingested the way the watcher does, and healed.
"""

import pytest

from server.collab import transport
from server.collab.store import slug_for

from .conftest import Peer, join_up, settle, until


def made(peer: Peer, path: str, text: str) -> str:
    target = peer.project.root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
    peer.store.ingest(path, text)
    file_id = peer.store.file_id_for(path)
    peer.store.body(file_id)
    return file_id


def disk(peer: Peer, path: str) -> str | None:
    target = peer.project.root / path
    return target.read_text() if target.exists() else None


async def apart_then_together(tmp_path, alice_text, bob_text):
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    await transport.HUB.sever()
    ids = (made(alice, "chapters/03.tex", alice_text),
           made(bob, "chapters/03.tex", bob_text))
    await settle()
    await transport.HUB.heal()
    await settle(0.8)
    for _ in range(3):
        alice.store.flush()
        bob.store.flush()
        await settle(0.3)
    return alice, bob, ids


@pytest.mark.asyncio
async def test_two_new_files_of_one_name_stay_two_files(tmp_path):
    alice, bob, (a, b) = await apart_then_together(
        tmp_path, "Alice's chapter three.\n", "Bob's chapter three.\n",
    )
    assert a != b
    assert slug_for("chapters/03.tex") not in (a, b)
    for peer in (alice, bob):
        kept = {disk(peer, "chapters/03.tex"), disk(peer, "chapters/03 (2).tex")}
        assert kept == {"Alice's chapter three.\n", "Bob's chapter three.\n"}, peer.name
    # Both machines agree which one kept the name.
    assert disk(alice, "chapters/03.tex") == disk(bob, "chapters/03.tex")
    assert alice.notices and bob.notices
    assert "chapters/03 (2).tex" in alice.notices[-1]
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_the_same_new_file_made_twice_is_one_file(tmp_path):
    """Two people pulling the same commit while apart is not a clash."""
    alice, bob, _ = await apart_then_together(tmp_path, "Same.\n", "Same.\n")
    for peer in (alice, bob):
        assert disk(peer, "chapters/03.tex") == "Same.\n"
        assert disk(peer, "chapters/03 (2).tex") is None
        assert not peer.notices
    await alice.close()
    await bob.close()


def test_a_project_that_is_not_shared_keeps_the_path_derived_id(tmp_path):
    """Its version history is keyed by the same slug before it is bound."""
    solo = Peer(tmp_path / "solo")
    assert made(solo, "chapters/03.tex", "Mine.\n") == slug_for("chapters/03.tex")
