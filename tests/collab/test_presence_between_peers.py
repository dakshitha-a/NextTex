"""Seeing where the other person is, when they are on another machine.

This is the half of presence that had no test and did not work.  Two browser
tabs on one install shared cursors perfectly -- the sync hub relays awareness
between its own connections -- and `wire.aware` was never called by anything,
so between two *installs* the strip stayed empty and every caret was
invisible.  It failed as "nobody else is here", which is exactly what it
looks like when nobody else is here.
"""

import asyncio
import os

import pytest

os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from pycrdt import Awareness, Doc, create_awareness_message  # noqa: E402

from nexttex.project import Project                          # noqa: E402
from server.collab import transport                          # noqa: E402
from server.collab.peers import PeerNetwork                  # noqa: E402
from server.collab.store import CollabStore                  # noqa: E402
from server.collab.sync import SyncHub                       # noqa: E402


@pytest.fixture(autouse=True)
def _clean_hub():
    transport.HUB.clear()
    yield
    transport.HUB.clear()


class FakeBrowser:
    """One connection into a hub, standing in for a tab."""

    def __init__(self, hub, doc_id):
        self.doc_id = doc_id
        self.connection = hub._join(doc_id)
        hub._awareness_for(doc_id)

    def seen(self):
        messages = []
        while not self.connection.queue.empty():
            message = self.connection.queue.get_nowait()
            if message:
                messages.append(message)
        return messages


def install(root, text):
    root.mkdir()
    (root / "main.tex").write_text(text)
    store = CollabStore(Project.open(root))
    store.adopt()
    hub = SyncHub(store)
    network = PeerNetwork(store, hub)
    return store, hub, network


def a_cursor(name):
    doc = Doc()
    awareness = Awareness(doc)
    awareness.set_local_state({"user": {"name": name}})
    return create_awareness_message(
        awareness.encode_awareness_update([doc.client_id])
    )


def names_in(messages):
    from pycrdt import read_message

    reader = Awareness(Doc())
    for message in messages:
        try:
            reader.apply_awareness_update(read_message(message[1:]), "test")
        except Exception:
            continue
    return {
        (state or {}).get("user", {}).get("name")
        for state in reader.states.values()
        if state
    }


@pytest.mark.asyncio
async def test_a_cursor_crosses_between_two_installs(tmp_path):
    alice_store, alice_hub, alice_net = install(tmp_path / "alice", "The chapter.\n")
    bob_store, bob_hub, bob_net = install(tmp_path / "bob", "")
    alice_net._me, bob_net._me = "a" * 64, "b" * 64

    alice_net.begin_sharing("Alice")
    await alice_net.start()
    file_id = alice_store.file_id_for("main.tex")
    alice_store.body(file_id)
    assert await bob_net.join(alice_net.invite(), "Bob") == ""
    await asyncio.sleep(0.8)

    doc_id = f"text/{file_id}"
    watching = FakeBrowser(alice_hub, doc_id)
    watching.seen()                     # the opening sync, which is not this

    # Bob's browser moves its caret.
    typing = FakeBrowser(bob_hub, doc_id)
    typing.seen()
    frame = a_cursor("Bob")
    bob_hub.on_awareness(doc_id, frame)
    await asyncio.sleep(0.6)

    assert "Bob" in names_in(watching.seen())

    await alice_net.close()
    await bob_net.close()
    alice_store.close()
    bob_store.close()


@pytest.mark.asyncio
async def test_a_tab_opening_later_is_told_about_the_other_installs_cursors(tmp_path):
    """A cursor from a peer has to go into the room's own awareness, not
    only past it, or a tab opening a moment later sees an empty document."""
    alice_store, alice_hub, alice_net = install(tmp_path / "alice", "The chapter.\n")
    bob_store, bob_hub, bob_net = install(tmp_path / "bob", "")
    alice_net._me, bob_net._me = "a" * 64, "b" * 64

    alice_net.begin_sharing("Alice")
    await alice_net.start()
    file_id = alice_store.file_id_for("main.tex")
    alice_store.body(file_id)
    await bob_net.join(alice_net.invite(), "Bob")
    await asyncio.sleep(0.8)

    doc_id = f"text/{file_id}"
    FakeBrowser(bob_hub, doc_id)
    bob_hub.on_awareness(doc_id, a_cursor("Bob"))
    await asyncio.sleep(0.6)

    # Only now does anybody open the file on Alice's machine.
    late = FakeBrowser(alice_hub, doc_id)
    alice_hub.rooms[doc_id].remove(late.connection)
    alice_hub.rooms.setdefault(doc_id, []).append(late.connection)
    awareness = alice_hub._awareness_for(doc_id)
    assert "Bob" in {
        (state or {}).get("user", {}).get("name")
        for state in awareness.states.values() if state
    }

    await alice_net.close()
    await bob_net.close()
    alice_store.close()
    bob_store.close()


@pytest.mark.asyncio
async def test_a_peer_going_away_is_announced_and_not_only_polled(tmp_path):
    """A peer arriving and a peer leaving are transitions, not samples.

    `state()` has always answered `connected` per member, and one sheet
    polled it every four seconds. Everywhere else the answer was thrown
    away, so the tab strip drew nothing for "nobody is here", nothing for
    "somebody is here who is not being rendered", and nothing for "they
    have gone for good". The Windows laptop sampled its own screen once a
    second across the window in which the share it had joined was shut
    down, and every sample was identical.
    """
    from .conftest import Peer, join_up, settle, until

    class Announcing:
        """A session that only does the one thing under test."""

        def __init__(self, peer):
            self.peer = peer
            self.said: list[dict] = []
            self.events = self

        async def publish(self, event):
            self.said.append(event)

    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    heard = Announcing(alice)
    alice.network.session = heard

    await join_up(alice, bob)
    await settle()

    arrivals = [e for e in heard.said if e.get("type") == "collab_peers"]
    assert arrivals, "nothing was said when a peer arrived"
    assert any(
        member["connected"] for event in arrivals for member in event["members"]
    ), "the arrival was announced with nobody connected in it"

    heard.said.clear()
    await bob.network.close()
    assert await until(
        lambda: any(e.get("type") == "collab_peers" for e in heard.said)
    ), "nothing was said when the peer went away"

    last = [e for e in heard.said if e.get("type") == "collab_peers"][-1]
    assert not any(
        member["connected"] for member in last["members"]
        if member["peer"] != alice.me
    ), "the peer that left is still reported as connected"
