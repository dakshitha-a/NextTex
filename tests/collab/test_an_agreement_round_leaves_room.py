"""An agreement round never fills a link's outbox.

Every few seconds a link sends a sync step for each document that moved,
so the two ends can note what they agree on. The round queued them all at
once, and a join of the NX-TeraChem paper, with 2568 document logs, queued
more than the outbox holds: the link was closed as a peer not keeping up,
both ends dialled again and sent the whole project again, and the Windows
laptop went round that for ten minutes without the join finishing. The
round now stops at `AGREE_ROOM` and leaves the rest for the next one.
"""

import pytest

from server.collab import peers as peers_module

from .conftest import Peer, join_up, settle, until


@pytest.mark.asyncio
async def test_a_project_with_more_documents_than_the_outbox_keeps_its_link(tmp_path, monkeypatch):
    monkeypatch.setattr(peers_module, "OUTBOX", 64)
    monkeypatch.setattr(peers_module, "AGREE_ROOM", 32)
    monkeypatch.setattr(peers_module, "AGREE_EVERY", 0.1)
    files = {f"chapters/part{n:03}.tex": f"Part {n}.\n" for n in range(150)}
    alice = Peer(tmp_path / "alice", files).be("a" * 64)
    alice.store.adopt()
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: all(
        str(bob.store.body(bob.store.file_id_for(path)) or "") == text
        for path, text in files.items()
        if bob.store.file_id_for(path)
    ) and len([r for r in bob.store.files.values() if r.get("kind") == "text"]) == 150)
    first = alice.network.links.get(bob.network.peer_id)
    assert first is not None
    # Several agreement rounds, each with every document to agree on.
    await settle(1.5)
    now = alice.network.links.get(bob.network.peer_id)
    assert now is first and now.alive, f"the link was dropped: {now and now.dropped_why}"
    assert first.dropped_why == ""
    # And the rounds got through: both ends noted a checkpoint for every
    # document, a few rounds at a time.
    assert await until(lambda: len(alice.network.agreed.index.get(bob.network.peer_id, {})) >= 150,
                       seconds=10)
    await bob.close()
    await alice.close()
