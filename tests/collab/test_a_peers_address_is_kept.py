"""How a peer was last reachable survives the member list being mirrored.

`note_address` writes the address a peer called from into `share.json`,
and `mirror_members` copies the manifest's member records over the same
file on every manifest sync. It replaced each record whole, so the address
was gone at the first sync, and every later dial went by key alone. Over
the real network a key alone was not always found, and two installs whose
link dropped never reached each other again (found on 29 September by a
reconnect check between two installs on one machine).
"""

import pytest

from .conftest import Peer, join_up, settle, until


@pytest.mark.asyncio
async def test_a_noted_address_outlives_a_manifest_sync(tmp_path):
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    bob.open_documents()
    alice.network.note_address(bob.me, "ticket-for-bob", "Bob")
    # A manifest change: a new file, which every peer mirrors members after.
    (alice.project.root / "notes.tex").write_text("Notes.\n")
    alice.store.ingest("notes.tex", "Notes.\n")
    assert await until(lambda: bob.store.file_id_for("notes.tex") is not None)
    await settle(0.5)
    alice.network.mirror_members()
    assert alice.network.share.members[bob.me].get("address") == "ticket-for-bob"
    # And the shared record never carries it.
    from pycrdt import Map

    record = alice.store.manifest.get("members", type=Map).get(bob.me)
    assert record.get("address") is None
    await alice.close()
    await bob.close()
