"""The real network, which is iroh.

An endpoint is an ed25519 keypair.  Dialling is by public key rather than by
address: iroh finds a route -- directly if it can hole-punch one, through a
relay if it cannot -- and the connection is QUIC over TLS *to that key*.  Two
consequences shape everything above this file.

The first is that authentication is free and certain.  `conn.remote_id()` is
the key the handshake proved, not a claim in a message, so authorisation is
membership and nothing else.  There is no handshake of ours, no certificate
to manage and no shared secret to distribute.

The second is that a relay carrying traffic between two peers who cannot
reach each other directly sees ciphertext, endpoint ids and timing.  It
cannot read a document.  That is a real thing leaving the machine and it
belongs in the README's list, described honestly.

Two details of the bindings cost an hour each and are worth writing down.
`bi.send()` and `bi.recv()` must be *captured once* rather than called per
use, and the accepting side has to hold the connection open -- letting it
fall out of scope resets the stream under a reader that is still going.

`uniffi_set_event_loop` binds the bindings to one asyncio loop and must be
called from inside that loop.  NextTex has exactly one: `server/run.py`
awaits `server.serve()` inside `asyncio.run()`, so `uvicorn.Server.run()` --
the only thing that would install uvloop -- never runs.  Calling it at import
time would bind whichever loop happened to be current, which under
Starlette's `TestClient` is a portal thread's and not the application's.
"""

from __future__ import annotations

import asyncio
import struct
from typing import AsyncIterator

ALPN = b"nexttex/sync/1"

# A message is length-prefixed because a QUIC stream is a stream: it
# preserves order and gives no boundaries back.
LENGTH = 4
MAX_MESSAGE = 64 * 1024 * 1024

#: How long a stream may say nothing at all before it is treated as gone.
#: The QUIC connection under this has its own keepalives, so silence for a
#: whole minute is not a slow network.
READ_TIMEOUT = 60.0


class IrohStream:
    """One bidirectional stream to one authenticated peer."""

    def __init__(self, connection, bi, peer_id: str) -> None:
        self.connection = connection
        self._bi = bi
        # Captured once. Calling bi.send() twice hands back two objects and
        # the second write goes nowhere anybody is reading.
        self._send = bi.send()
        self._recv = bi.recv()
        self.peer_id = peer_id
        self._buffer = bytearray()
        self._closed = False
        self._lock = asyncio.Lock()

    async def send(self, message: bytes) -> None:
        if self._closed:
            raise ConnectionError("closed")
        async with self._lock:
            await self._send.write_all(struct.pack(">I", len(message)) + message)

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self._messages()

    async def _messages(self) -> AsyncIterator[bytes]:
        while not self._closed:
            try:
                chunk = await asyncio.wait_for(
                    self._recv.read(64 * 1024), timeout=READ_TIMEOUT
                )
            except (Exception, asyncio.TimeoutError):
                # A peer that declares a length and never sends the bytes
                # held its buffer open for ever, because there was no
                # timeout anywhere in this loop and nothing else would
                # close the stream. A minute of complete silence from a
                # peer that is supposed to be syncing is a dead
                # connection; a live one has keepalives under it.
                return
            if not chunk:
                return
            self._buffer.extend(chunk)
            while len(self._buffer) >= LENGTH:
                (size,) = struct.unpack_from(">I", self._buffer, 0)
                if size > MAX_MESSAGE:
                    return
                if len(self._buffer) < LENGTH + size:
                    break
                message = bytes(self._buffer[LENGTH:LENGTH + size])
                del self._buffer[:LENGTH + size]
                yield message

    async def close(self) -> None:
        self._closed = True
        try:
            await self._send.finish()
        except Exception:
            pass


class IrohTransport:
    """This install, reachable by its public key."""

    def __init__(self, secret: bytes) -> None:
        self._secret = secret
        self._endpoint = None
        self._accepting: asyncio.Task | None = None
        self.peer_id = ""

    async def start(self, on_stream) -> None:
        import iroh

        # Inside the running loop, never at import time. See the note above.
        iroh.iroh_ffi.uniffi_set_event_loop(asyncio.get_running_loop())

        self._endpoint = await iroh.Endpoint.bind(iroh.EndpointOptions(
            preset=iroh.preset_n0(),
            alpns=[ALPN],
            secret_key=self._secret,
        ))
        self.peer_id = str(self._endpoint.id())
        self._accepting = asyncio.create_task(self._accept_loop(on_stream))

    async def _accept_loop(self, on_stream) -> None:
        while True:
            try:
                incoming = await self._endpoint.accept_next()
                if incoming is None:
                    return
                accepting = await incoming.accept()
                connection = await accepting.connect()
                bi = await connection.accept_bi()
                stream = IrohStream(connection, bi, str(connection.remote_id()))
                asyncio.create_task(on_stream(stream))
            except asyncio.CancelledError:
                return
            except Exception:
                # One refused connection must not stop us accepting the next.
                await asyncio.sleep(0.5)

    async def connect(self, address: str):
        import iroh

        addr = _address_from(address)
        connection = await self._endpoint.connect(addr, ALPN)
        bi = await connection.open_bi()
        return IrohStream(connection, bi, str(connection.remote_id()))

    def address(self) -> str:
        if self._endpoint is None:
            return ""
        return str(iroh_ticket(self._endpoint))

    async def close(self) -> None:
        if self._accepting is not None:
            self._accepting.cancel()
            self._accepting = None
        if self._endpoint is not None:
            try:
                await self._endpoint.close()
            except Exception:
                pass
            self._endpoint = None


def iroh_ticket(endpoint):
    import iroh

    return iroh.EndpointTicket.from_addr(endpoint.addr())


def _address_from(address: str):
    """An `EndpointAddr` from either a ticket or a bare public key.

    A ticket is what an invite carries: it names the peer *and* the routes it
    was reachable on when it was written, which is what makes the very first
    connection fast.  A bare key is what the membership list holds
    afterwards, because addresses go stale and a key does not -- iroh's
    discovery finds the peer again wherever it has moved to.
    """
    import iroh

    address = address.strip()
    if address.startswith("endpoint"):
        return iroh.EndpointTicket.from_string(address).endpoint_addr()
    return iroh.EndpointAddr(iroh.EndpointId.from_string(address), None, [])
