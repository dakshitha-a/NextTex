"""What being removed is like from the removed install's side.

The remover's side was tested: their gate refuses the key and their link
is gone.  The removed install was never looked at, and it had never been
told.  The tombstone was queued to its link and the link marked dead
before the queue drained, so it learned by dialling and being refused,
every two seconds, for as long as its server ran.
"""

from __future__ import annotations

import pytest

from pycrdt import Map

from server.collab import transport
from server.collab.peers import BACKOFF

from .conftest import Peer, join_up, settle, until

A, B, C = "a" * 64, "b" * 64, "c" * 64


async def _three(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    carol = Peer(tmp_path / "carol", {}).be(C)
    await join_up(alice, bob)
    refused = await carol.network.join(alice.network.invite(), "Carol")
    assert refused == "", refused
    await settle()

    def linked() -> bool:
        return all(
            peer in net.links and net.links[peer].alive
            for net, peer in ((bob.network, C), (carol.network, B),
                              (bob.network, A), (carol.network, A))
        )

    # Both sides dial, so a link can be replaced once while the three
    # settle; wait for the links to be up and to stay up.
    assert await until(linked, 15.0)
    await settle(1.0)
    assert linked()
    return alice, bob, carol


@pytest.mark.asyncio
async def test_a_removed_peer_is_told_by_the_tombstone_and_stops(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    assert await until(lambda: A in bob.network.links)

    alice.network.remove(B)
    assert await until(lambda: bob.network.removed)

    state = bob.network.state()
    assert state["removed"] is True
    assert state["removedBy"] == "Alice"
    assert bob.network.links == {}
    assert bob.network.transport is None

    # And it stays put: no redial, no new link, for longer than the dial
    # loop's two-second cadence.
    dials = len(transport.HUB.links)
    await settle(2.5)
    assert len(transport.HUB.links) == dials
    assert A not in bob.network.links

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_removal_reaches_a_peer_through_a_third(tmp_path):
    """Bob's link to Alice is down when she removes him; Carol tells him."""
    alice, bob, carol = await _three(tmp_path)

    # Bob cannot hear Alice directly.
    link = bob.network.links.pop(A)
    link.alive = False
    await link.stream.close()
    await settle()

    alice.network.remove(B)
    # Carol hears through the manifest and refuses Bob from then on.
    assert await until(lambda: not carol.network.share.allows(B), 15.0)
    # Bob hears through Carol's copy of the same manifest.
    assert await until(lambda: bob.network.removed, 15.0)
    assert bob.network.state()["removedBy"] == "Alice"

    await alice.close()
    await bob.close()
    await carol.close()


@pytest.mark.asyncio
async def test_being_let_in_clears_the_last_refusal(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    bob.network.last_error = "not a member of this project"

    link = bob.network.links.pop(A)
    link.alive = False
    await link.stream.close()
    assert await until(lambda: A in bob.network.links and bob.network.links[A].alive)
    await settle()
    assert bob.network.last_error == ""

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_peer_removed_before_a_restart_does_not_dial(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    alice.network.remove(B)
    assert await until(lambda: bob.network.removed)
    await bob.close()

    again = Peer(tmp_path / "bob", {}).be(B)
    await again.network.start()
    await settle()
    assert again.network.removed is True
    assert again.network.transport is None
    assert again.network.state()["removedBy"] == "Alice"
    await again.close()
    await alice.close()
@pytest.mark.asyncio
async def test_a_refusal_at_the_door_is_not_a_removal(tmp_path):
    """A peer whose member list is behind refuses a member it has not
    heard of yet.  That peer is backed off from; nothing more."""
    alice, bob, carol = await _three(tmp_path)

    # Carol's copy of the list goes stale: she forgets Bob and refuses him
    # at the door, the way a restored backup of her project would.
    carol.network.share.members.pop(B, None)
    link = carol.network.links.pop(B, None)
    if link is not None:
        link.alive = False
        await link.stream.close()
    link = bob.network.links.pop(C, None)
    if link is not None:
        link.alive = False
        await link.stream.close()

    assert await until(
        lambda: bob.network.last_error == "not a member of this project", 15.0,
    )
    assert bob.network.removed is False
    assert bob.network.state()["removed"] is False
    assert alice.network.share.allows(B)
    # Still talking to Alice, and still typing into the same project.
    assert A in bob.network.links and bob.network.links[A].alive

    # The dial loop backed off rather than knocking every two seconds.
    dials = len(transport.HUB.links)
    await settle(BACKOFF[0] + 2.5)
    assert len(transport.HUB.links) - dials <= 2

    await alice.close()
    await bob.close()
    await carol.close()




# --- leaving -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_leaving_tells_the_others_and_keeps_the_project(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    assert await until(lambda: (bob.project.root / "main.tex").exists())
    share_id = alice.network.share.share_id

    await bob.network.leave()

    # Alice heard, and refuses the key from now on.
    assert await until(lambda: not alice.network.share.allows(B))
    assert alice.network.state()["members"][1]["removed"] is True
    # Bob's copy is a project of his own: not shared, still editable.
    assert bob.network.share.shared is False
    assert bob.store.shared is False
    assert bob.network.state()["shared"] is False
    assert not (bob.project.state_dir / "collab" / "share.json").exists()
    assert bob.network.links == {} and bob.network.transport is None
    file_id = bob.store.file_id_for("main.tex")
    text = bob.store.body(file_id)
    text += "Alone now.\n"
    bob.store.flush()
    assert (bob.project.root / "main.tex").read_text().endswith("Alone now.\n")
    # And nothing of it reached Alice.
    await settle()
    assert "Alone now." not in str(alice.store.body(alice.store.file_id_for("main.tex")))
    # Bob's dialling loops are gone: no new link appears.
    dials = len(transport.HUB.links)
    await settle(2.5)
    assert len(transport.HUB.links) == dials
    assert share_id  # the share itself is untouched for Alice
    assert alice.network.share.share_id == share_id

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_sharing_again_after_leaving_starts_a_fresh_share(tmp_path):
    """The old members do not come along as members who never connect."""
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    old = alice.network.share.share_id
    await bob.network.leave()

    bob.network.begin_sharing("Bob")
    await bob.network.start()
    assert bob.network.share.share_id and bob.network.share.share_id != old
    assert list(bob.network.share.members) == [B]
    assert bob.network.state()["members"] == [
        {"peer": B, "name": "Bob", "connected": False, "removed": False},
    ]
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_removed_install_can_leave_to_keep_its_copy(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    alice.network.remove(B)
    assert await until(lambda: bob.network.removed)

    await bob.network.leave()
    state = bob.network.state()
    assert state["shared"] is False and state["removed"] is False
    assert bob.store.shared is False
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_the_tombstone_travels_as_one_update(tmp_path):
    """`removed_at` and `removed_by` were two map operations, so they could
    reach the removed peer as two updates.  That peer acts on the first:
    `removed_at` alone makes `removed_here()` true, `note_removed_self`
    closes every link, and `removed_by` never lands.  The interface then
    said they were removed and could not say by whom.  The race showed on
    a slow CI runner and not here, so what is pinned is the property that
    makes it impossible: one transaction, one update, both keys in it.
    """
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    assert await until(lambda: A in bob.network.links)

    updates: list[bytes] = []
    alice.store.manifest.observe(lambda event: updates.append(event.update))
    alice.network.remove(B)

    assert len(updates) == 1, len(updates)
    record = alice.store.manifest.get("members", type=Map)[B]
    assert record["removed_at"] and record["removed_by"] == A

    await alice.close()
    await bob.close()
