"""A subscriber the server has given up on must find out.

Dropping a full queue from the set was only half the fix, and the comment
that used to sit beside it claimed it was the whole one.  The SSE generator
is still reading that queue: it serves the 512 events already in it and then
keepalives for ever on a queue nothing writes to.  `EventSource` sees no
error, so it never reconnects, and the tab shows a frozen project for as
long as it stays open -- exactly the failure the drop was meant to prevent.
"""

from __future__ import annotations

import asyncio

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
