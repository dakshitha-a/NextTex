"""The real transport, opted into.

Everything else about peers runs on the loopback: two networks in one
process, dialling each other through queues.  That is the right default --
it is fast, it is deterministic, and it lets a test arrange a partition on
purpose -- but it proves nothing about iroh.

This one opens genuine endpoints.  It is skipped unless `NEXTTEX_LIVE` is
set, in the same way the paid check against a real model is, because it
binds sockets and may reach n0's discovery service to find a peer.

Run it after changing anything in `iroh_transport.py`:

    NEXTTEX_LIVE=1 .venv/bin/python -m pytest tests/collab/test_iroh_live.py
"""

import asyncio
import os
import secrets

import pytest

from nexttex.project import Project
from server.collab import identity
from server.collab.peers import PeerNetwork
from server.collab.store import CollabStore

live = pytest.mark.skipif(
    not os.environ.get("NEXTTEX_LIVE"),
    reason="opens real network endpoints; set NEXTTEX_LIVE to run",
)

PAPER = "The real chapter.\n"


def peer_with(root, text, key):
    root.mkdir()
    (root / "main.tex").write_text(text)
    store = CollabStore(Project.open(root))
    store.adopt()
    network = PeerNetwork(store)
    network._me = identity.peer_id(key)

    def transport():
        from server.collab.iroh_transport import IrohTransport

        return IrohTransport(key)

    network._make_transport = transport
    return store, network


@live
@pytest.mark.asyncio
async def test_two_real_endpoints_share_a_project(tmp_path):
    alice_key, bob_key = secrets.token_bytes(32), secrets.token_bytes(32)
    alice, alice_net = peer_with(tmp_path / "alice", PAPER, alice_key)
    bob, bob_net = peer_with(tmp_path / "bob", "", bob_key)

    try:
        alice_net.begin_sharing("Alice")
        await alice_net.start()
        alice.body(alice.file_id_for("main.tex"))

        # A ticket, which is what an invite carries: the peer's key and the
        # routes it was reachable on when the invite was written.
        assert alice_net.address().startswith("endpoint")

        assert await bob_net.join(alice_net.invite(), "Bob") == ""

        for _ in range(40):
            await asyncio.sleep(0.5)
            file_id = bob.file_id_for("main.tex")
            if file_id and str(bob.body(file_id)):
                break
        file_id = bob.file_id_for("main.tex")
        assert file_id is not None
        assert str(bob.body(file_id)) == PAPER

        # And live, in both directions, over QUIC.
        alice.body(alice.file_id_for("main.tex")).insert(0, "% from Alice\n")
        await asyncio.sleep(2)
        assert "% from Alice" in str(bob.body(file_id))

        bob.body(file_id).insert(0, "% from Bob\n")
        await asyncio.sleep(2)
        assert "% from Bob" in str(alice.body(alice.file_id_for("main.tex")))
    finally:
        await alice_net.close()
        await bob_net.close()
        alice.close()
        bob.close()


@live
def test_a_peer_id_is_the_public_half_of_its_key():
    """What the whole authorisation model rests on: the id NextTex writes
    down is the id iroh will authenticate, and not a second opinion."""
    import iroh

    key = secrets.token_bytes(32)
    assert identity.peer_id(key) == str(iroh.SecretKey.from_bytes(key).public())
