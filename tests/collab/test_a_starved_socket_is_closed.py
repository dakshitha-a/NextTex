"""A connection the hub stops feeding is closed, so the browser finds out.

`_pump` ended when the queue overflowed or a send failed, and left the
websocket open: the receive loop went on applying what the browser sent,
the browser went on reading live, and nothing reached it again until the
page was reloaded.  An overflow also never woke the pump, since `close`
could not fit its `None` into the full queue.  Closing the socket is what
makes the browser reconnect and ask for everything it missed.
"""

import asyncio

import pytest

from nexttex.project import Project
from server.collab.store import CollabStore
from server.collab.sync import BACKLOG, SyncHub


class FakeSocket:
    def __init__(self, fail=False):
        self.fail = fail
        self.sent = []
        self.closed_with = None
        self.drain = asyncio.Event()

    async def send_bytes(self, message):
        if self.fail:
            raise RuntimeError("the peer went away mid-send")
        await self.drain.wait()
        self.sent.append(message)

    async def close(self, code=1000):
        self.closed_with = code


def a_hub(tmp_path):
    (tmp_path / "main.tex").write_text("hello\n")
    store = CollabStore(Project.open(tmp_path))
    store.adopt()
    return SyncHub(store)


async def until(predicate, seconds=2.0):
    for _ in range(int(seconds / 0.01)):
        if predicate():
            return True
        await asyncio.sleep(0.01)
    return predicate()


@pytest.mark.asyncio
async def test_a_connection_that_overflows_is_closed_once_it_drains(tmp_path):
    hub = a_hub(tmp_path)
    connection = hub._join("manifest")
    socket = FakeSocket()
    pump = asyncio.create_task(hub._pump(socket, connection))
    for n in range(BACKLOG + 10):
        connection.send(b"\x00update %d" % n)
    assert not connection.alive
    socket.drain.set()
    assert await until(lambda: socket.closed_with is not None)
    await pump


@pytest.mark.asyncio
async def test_a_connection_whose_send_fails_is_closed(tmp_path):
    hub = a_hub(tmp_path)
    connection = hub._join("manifest")
    socket = FakeSocket(fail=True)
    pump = asyncio.create_task(hub._pump(socket, connection))
    connection.send(b"\x00update")
    assert await until(lambda: socket.closed_with is not None)
    assert not connection.alive
    await pump


@pytest.mark.asyncio
async def test_a_pump_cancelled_by_the_connection_ending_does_not_close_again(tmp_path):
    hub = a_hub(tmp_path)
    connection = hub._join("manifest")
    socket = FakeSocket()
    pump = asyncio.create_task(hub._pump(socket, connection))
    await asyncio.sleep(0)
    pump.cancel()
    try:
        await pump
    except asyncio.CancelledError:
        pass
    assert socket.closed_with is None
