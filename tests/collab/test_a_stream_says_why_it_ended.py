"""The iroh stream says why its reader stopped.

A link from this host to the Windows laptop ended every few seconds while
a join ran, and the diagnostics line on each side said only "closed": the
reader in `IrohStream._messages` ended on any exception, a timeout, or the
other end finishing, without keeping which.
"""

import asyncio

import pytest

from server.collab.endpoint import Replayed
from server.collab.iroh_transport import IrohStream


class Bi:
    def __init__(self, reads):
        self._reads = list(reads)
        bi = self

        class Recv:
            async def read(self, size):
                item = bi._reads.pop(0)
                if isinstance(item, BaseException):
                    raise item
                return item

        class Send:
            async def write_all(self, data):
                pass

            async def finish(self):
                pass

        self._recv, self._send = Recv(), Send()

    def recv(self):
        return self._recv

    def send(self):
        return self._send


async def drain(stream):
    return [message async for message in stream]


def framed(payload: bytes) -> bytes:
    return len(payload).to_bytes(4, "big") + payload


@pytest.mark.asyncio
async def test_a_failed_read_is_named():
    stream = IrohStream(None, Bi([framed(b"hello"), RuntimeError("connection lost: timed out")]), "p")
    assert await drain(stream) == [b"hello"]
    assert stream.ended == "read failed: RuntimeError: connection lost: timed out"


@pytest.mark.asyncio
async def test_the_other_end_finishing_is_named():
    stream = IrohStream(None, Bi([b""]), "p")
    assert await drain(stream) == []
    assert stream.ended == "finished by the other end"


@pytest.mark.asyncio
async def test_a_replayed_stream_passes_the_reason_on():
    stream = IrohStream(None, Bi([framed(b"two"), b""]), "p")
    replayed = Replayed(stream, b"one")
    assert await drain(replayed) == [b"one", b"two"]
    assert replayed.ended == "finished by the other end"
