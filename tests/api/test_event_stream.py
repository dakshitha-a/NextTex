"""A subscriber the server has given up on must find out, and what it is told first.

Dropping a full queue from the set was only half the fix, and the comment
that used to sit beside it claimed it was the whole one.  The SSE generator
is still reading that queue: it serves the 512 events already in it and then
keepalives for ever on a queue nothing writes to.  `EventSource` sees no
error, so it never reconnects, and the tab shows a frozen project for as
long as it stays open -- exactly the failure the drop was meant to prevent.
"""

from __future__ import annotations

import asyncio

from server import main as server_main
from server.session import CLOSED, Broadcaster


def test_a_subscriber_that_stops_reading_is_told_to_go_away():
    async def run():
        events = Broadcaster()
        queue = events.subscribe()

        # More than the queue holds, without anything draining it.
        for index in range(600):
            await events.publish({"type": "noise", "n": index})

        assert queue not in events._subscribers, "it should have been dropped"

        # And the queue it is still reading ends, rather than going quiet.
        # This is the half that was missing: the generator returns on the
        # sentinel, the response ends, and the browser reconnects and
        # re-reads state.
        drained = []
        while True:
            item = queue.get_nowait()
            drained.append(item)
            if item is CLOSED:
                break
        assert drained[-1] is CLOSED
        assert queue.empty(), "nothing should be left behind the sentinel"

    asyncio.run(run())


def test_a_subscriber_that_keeps_up_is_left_alone():
    async def run():
        events = Broadcaster()
        queue = events.subscribe()
        for index in range(600):
            await events.publish({"type": "noise", "n": index})
            queue.get_nowait()
        assert queue in events._subscribers
        assert queue.empty()

    asyncio.run(run())


def test_the_share_snapshot_says_a_quiet_project_is_not_shared(client, opened):
    """The flag a browser can only be told about, readable on connection.

    `collab_peers` is published when sharing begins and when a peer comes
    or goes, and the interface keeps it in one place with no way to ask.
    So a tab whose EventSource was not yet connected when `begin_sharing`
    published, and every tab that reloaded a project that was already
    shared, believed the project was not shared: the People drawer offered
    no invite on a project with members in it. It is the same fault
    `compile_state` is the stream's first frame for, one flag along, and
    the stream sends this one second.
    """
    session = server_main.SESSIONS[opened["id"]]
    snapshot = session.peers_snapshot()
    assert snapshot["type"] == "collab_peers"
    assert snapshot["shared"] is False


def test_the_share_snapshot_says_so_on_a_shared_project(client, opened):
    response = client.post(f"/api/projects/{opened['id']}/collab/share")
    assert response.status_code == 200, response.text

    snapshot = server_main.SESSIONS[opened["id"]].peers_snapshot()
    assert snapshot["shared"] is True
    assert snapshot["shareId"], "a shared project with no share id"


def test_the_snapshot_is_the_frame_the_announcement_publishes(client, opened):
    """One shape, so the store needs no second case for it.

    The browser's handler for `collab_peers` is written against what
    `_announce_peers` publishes; a frame that differed in one key would
    leave the handler holding half a state.
    """
    session = server_main.SESSIONS[opened["id"]]
    assert session.peers_snapshot() == {
        "type": "collab_peers", **session.peers.state(),
    }


def test_a_session_without_a_network_has_no_share_frame():
    """The guard `_announce_peers` has, for the same reason: a stand-in.

    The stream sends nothing rather than a frame with no fields in it,
    which the browser would read as a project that is not shared.
    """
    from server.session import ProjectSession

    class NotASession:
        peers_snapshot = ProjectSession.peers_snapshot

    assert NotASession().peers_snapshot() == {}
