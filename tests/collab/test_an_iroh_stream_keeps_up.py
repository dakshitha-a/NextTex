"""An iroh stream gathers its writes and reads ahead of its reader.

The Windows laptop's joins of two large papers failed for hours with
"read failed: IrohError: " and nothing after it. `IrohError` prints as
nothing; its `message()` was "too many gaps in stream buffer". noq closes
a connection once a stream's receive buffer holds more than 1024 pieces,
every frame that arrived in a packet of its own is one until it is read,
and a join wrote hundreds of thousands of small frames one at a time to a
joiner too busy to read them. The real failure needs iroh, which the
suite never opens; these hold the stream to the three things that fix it,
with stand-ins for iroh's send and receive halves.
"""

import asyncio
import struct

import pytest

from server.collab.iroh_transport import IrohStream, said


class Silent(Exception):
    """Shaped like `IrohError`: empty as a string, its text behind a method."""

    def __str__(self) -> str:
        return ""

    def message(self) -> str:
        return 'ConnectionLost(TransportError("too many gaps in stream buffer"))'


class Sent:
    def __init__(self):
        self.writes: list[bytes] = []
        self.finished = False

    async def write_all(self, data):
        await asyncio.sleep(0)
        self.writes.append(bytes(data))

    async def finish(self):
        self.finished = True


class Received:
    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.reads = 0

    async def read(self, size):
        self.reads += 1
        await asyncio.sleep(0)
        if self.chunks:
            return self.chunks.pop(0)
        await asyncio.sleep(3600)


class Bi:
    def __init__(self, chunks=()):
        self.sent = Sent()
        self.received = Received(chunks)

    def send(self):
        return self.sent

    def recv(self):
        return self.received


def framed(message: bytes) -> bytes:
    return struct.pack(">I", len(message)) + message


def test_an_error_that_prints_as_nothing_still_says_why():
    assert "too many gaps" in said(Silent())
    assert said(ValueError("plain")) == "plain"


@pytest.mark.asyncio
async def test_many_small_sends_leave_as_a_few_writes_in_order():
    bi = Bi()
    stream = IrohStream(None, bi, "b" * 64)
    messages = [bytes([i % 256]) * 180 for i in range(3000)]
    for message in messages:
        await stream.send(message)
    await stream.close()
    assert b"".join(bi.sent.writes) == b"".join(framed(m) for m in messages)
    assert len(bi.sent.writes) < 10
    assert bi.sent.finished


@pytest.mark.asyncio
async def test_the_stream_reads_before_anybody_asks_for_a_message():
    messages = [b"x" * 200 for _ in range(50)]
    bi = Bi([b"".join(framed(m) for m in messages)])
    stream = IrohStream(None, bi, "b" * 64)
    for _ in range(5):
        await asyncio.sleep(0)
    assert bi.received.reads >= 1
    got = []
    async for message in stream:
        got.append(message)
        if len(got) == len(messages):
            break
    assert got == messages
    await stream.close()


@pytest.mark.asyncio
async def test_a_message_split_across_reads_comes_out_whole():
    whole = framed(b"a" * 1000) + framed(b"b" * 10)
    bi = Bi([whole[:7], whole[7:600], whole[600:]])
    stream = IrohStream(None, bi, "b" * 64)
    got = []
    async for message in stream:
        got.append(message)
        if len(got) == 2:
            break
    assert got == [b"a" * 1000, b"b" * 10]
    await stream.close()


@pytest.mark.asyncio
async def test_a_failed_write_says_why_and_stops_the_next_send():
    class Broken(Sent):
        async def write_all(self, data):
            raise Silent()

    bi = Bi()
    bi.sent = Broken()
    stream = IrohStream(None, bi, "b" * 64)
    await stream.send(b"hello")
    for _ in range(5):
        await asyncio.sleep(0)
    assert "too many gaps" in stream.ended
    with pytest.raises(ConnectionError):
        await stream.send(b"again")
    await stream.close()
