"""A link that goes quiet is noticed without anybody typing.

`PeerLink.alive` flipped on a send failure, a closed stream, a denial or a
removal, and on nothing else, so a path that stopped carrying packets
without closing left both ends drawn as connected until one of them
typed.  The iroh transport had a read timeout of its own, which also tore
down a healthy idle link every minute; the loopback never timed out at
all, which is why the rule lives at the link, where the loopback's sever,
a partition that never closes the stream, can prove it.
"""

import asyncio

import pytest

from server.collab import transport
from server.collab.peers import PeerLink

from .conftest import Peer, join_up, until


class Recorder:
    """A session that keeps what the network announces."""

    def __init__(self):
        self.seen: list[dict] = []
        self.events = self

    async def publish(self, event):
        self.seen.append(event)


def quick(monkeypatch):
    monkeypatch.setattr(PeerLink, "ping_every", 0.1)
    monkeypatch.setattr(PeerLink, "silence_limit", 0.5)


@pytest.mark.asyncio
async def test_a_silent_partition_drops_both_ends_and_says_so(tmp_path, monkeypatch):
    quick(monkeypatch)
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    heard_a, heard_b = Recorder(), Recorder()
    alice.network.session = heard_a
    bob.network.session = heard_b

    await join_up(alice, bob)
    a_link = alice.network.links[bob.me]
    b_link = bob.network.links[alice.me]
    assert a_link.alive and b_link.alive

    # Nothing closes; nothing arrives.  The links are the ones captured
    # above, because the dial loop rebuilds fresh ones through unsevered
    # pipes as soon as these fall.
    await transport.HUB.sever()
    assert await until(lambda: not a_link.alive and not b_link.alive, 4.0), (
        "a link that heard nothing stayed drawn as connected"
    )
    for heard, other in ((heard_a, bob.me), (heard_b, alice.me)):
        assert any(
            e.get("type") == "collab_peers"
            and any(m.get("peer") == other and not m.get("connected") for m in e["members"])
            for e in heard.seen
        ), "the departure was not announced"

    await transport.HUB.heal()
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_pings_keep_an_idle_link_alive(tmp_path, monkeypatch):
    quick(monkeypatch)
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    await join_up(alice, bob)
    a_link = alice.network.links[bob.me]
    b_link = bob.network.links[alice.me]
    # Three silence limits with nobody typing.
    await asyncio.sleep(1.5)
    assert a_link.alive and b_link.alive, "an idle link was dropped despite the heartbeat"
    await alice.close()
    await bob.close()
