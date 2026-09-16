"""What being removed is like from the removed install's side.

The remover's side was tested: their gate refuses the key and their link
is gone.  The removed install was never looked at, and it had never been
told.  The tombstone was queued to its link and the link marked dead
before the queue drained, so it learned by dialling and being refused,
every two seconds, for as long as its server ran.
"""

from __future__ import annotations

import pytest

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
    assert await until(lambda: C in bob.network.links and B in carol.network.links)
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
    assert await until(lambda: not carol.network.share.allows(B))
    # Bob hears through Carol's copy of the same manifest.
    assert await until(lambda: bob.network.removed)
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

    assert await until(lambda: bob.network.last_error == "not a member of this project")
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


