"""Two installs dialling each other at once end with one link, not none.

Every member has a dialling loop at both ends, so after a drop the two
loops cross.  Each end used to keep its own newest link, which was its own
dial, and close the other's, and on a slow machine that undid itself every
two seconds for as long as the loops ran.  Both ends now keep the link
dialled by the lower peer id.
"""

from __future__ import annotations

import pytest

from server.collab import transport
from server.collab.peers import PeerLink

from .conftest import Peer, join_up, settle, until

A, B = "a" * 64, "b" * 64


def _one_live_link_each(alice: Peer, bob: Peer) -> bool:
    return (
        list(alice.network.links) == [B] and alice.network.links[B].alive
        and list(bob.network.links) == [A] and bob.network.links[A].alive
    )


@pytest.mark.asyncio
async def test_crossed_dials_settle_on_the_lower_ids_connection(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    assert await until(lambda: _one_live_link_each(alice, bob))

    # Everything drops at once; both loops notice within two seconds and
    # both dial.
    await transport.HUB.cut()
    assert await until(lambda: not _one_live_link_each(alice, bob))
    assert await until(lambda: _one_live_link_each(alice, bob), 15.0)
    # And it stays that way: no link is replaced once both have one.
    made = len(transport.HUB.links)
    await settle(5.0)
    assert _one_live_link_each(alice, bob)
    assert len(transport.HUB.links) == made
    # Whichever dial came first, both ends hold the same connection.
    assert alice.network.links[B].outbound is not bob.network.links[A].outbound

    await alice.close()
    await bob.close()


class _Stream:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def _link(network, peer: str, outbound: bool) -> PeerLink:
    return PeerLink(network, _Stream(), peer, outbound=outbound)


@pytest.mark.asyncio
async def test_two_live_links_keep_the_one_the_lower_id_dialled(tmp_path):
    """The decision, made the same way at both ends."""
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)

    # At Alice, the lower id: her own dial to Bob beats Bob's dial to her.
    mine = _link(alice.network, B, outbound=True)
    assert alice.network.adopt_link(mine) is True
    theirs = _link(alice.network, B, outbound=False)
    assert alice.network.adopt_link(theirs) is False
    assert alice.network.links[B] is mine and mine.alive
    # And the other way round: theirs arrives first, hers replaces it.
    alice.network.links.clear()
    theirs = _link(alice.network, B, outbound=False)
    assert alice.network.adopt_link(theirs) is True
    mine = _link(alice.network, B, outbound=True)
    assert alice.network.adopt_link(mine) is True
    assert alice.network.links[B] is mine
    assert theirs.alive is False

    # At Bob, the higher id: Alice's dial to him beats his own dial to her.
    his = _link(bob.network, A, outbound=True)
    assert bob.network.adopt_link(his) is True
    hers = _link(bob.network, A, outbound=False)
    assert bob.network.adopt_link(hers) is True
    assert bob.network.links[A] is hers and his.alive is False
    his = _link(bob.network, A, outbound=True)
    assert bob.network.adopt_link(his) is False
    assert bob.network.links[A] is hers

    # A dead link gives way whoever dialled the new one.
    hers.alive = False
    his = _link(bob.network, A, outbound=True)
    assert bob.network.adopt_link(his) is True

    # A join has nothing to keep and takes its link regardless.
    forced = _link(bob.network, A, outbound=True)
    assert bob.network.adopt_link(forced, force=True) is True

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_dead_link_is_replaced_from_either_end(tmp_path):
    """The rule is only for two *live* links; a dead one gives way."""
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    assert await until(lambda: _one_live_link_each(alice, bob))

    # Bob's side dies quietly; Bob redials, and although Alice is the
    # lower id her link to Bob is the dead one, so Bob's dial is taken.
    link = bob.network.links[A]
    link.alive = False
    await link.stream.close()
    assert await until(lambda: _one_live_link_each(alice, bob), 15.0)
    await settle(3.0)
    assert _one_live_link_each(alice, bob)

    await alice.close()
    await bob.close()
