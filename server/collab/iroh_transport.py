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

from .transport import Handing

ALPN = b"nexttex/sync/1"

# A message is length-prefixed because a QUIC stream is a stream: it
# preserves order and gives no boundaries back.
LENGTH = 4
MAX_MESSAGE = 64 * 1024 * 1024

#: How long a stream may say nothing at all before it is treated as gone,
#: a backstop behind the link's own rule.  `PeerLink` pings after twenty
#: seconds of sending nothing and drops a link silent for sixty, at the
#: layer the loopback shares, so this is longer than that on purpose:
#: with two timers on one link the link's is the one authority and this
#: one is for a transport whose reader has wedged.  At sixty it tore down
#: every healthy idle link once a minute and redialled.
READ_TIMEOUT = 90.0

#: How much a stream gathers to send before `send` waits for the writer.
WRITE_GATHER = 1024 * 1024

#: How much one read asks noq for.
READ_CHUNK = 1024 * 1024

#: How much arrived and unparsed data the reader holds before it pauses,
#: two of the largest messages so one can always be completed.
READ_AHEAD = 2 * MAX_MESSAGE

#: How long `close` lets the writer finish what was handed to it.
FLUSH_TIMEOUT = 2.0


class IrohStream:
    """One bidirectional stream to one authenticated peer.

    Writes are gathered and reads run ahead, both because of one rule in
    noq, iroh's QUIC: a stream whose receive buffer holds more than 1024
    separate pieces closes its whole connection, "too many gaps in stream
    buffer", and every frame that arrived in a packet of its own is a piece
    until the reader takes it. A join is hundreds of thousands of frames
    of a few hundred bytes. Written one at a time, each left as a packet of
    its own, and a joiner busy applying them, as the Windows laptop was at
    90% CPU, fell 1024 behind within a second: every link of a large
    paper's join broke, for hours, and on one fast machine never. So `send`
    adds to a buffer that one writer task sends as one write, which leaves
    as full packets, and one reader task takes whatever noq has as soon as
    the loop is free, whatever the link is doing with the last message.
    """

    def __init__(self, connection, bi, peer_id: str) -> None:
        self.connection = connection
        self._bi = bi
        # Captured once. Calling bi.send() twice hands back two objects and
        # the second write goes nowhere anybody is reading.
        self._send = bi.send()
        self._recv = bi.recv()
        self.peer_id = peer_id
        self._closed = False
        #: Why the stream ended, for the link's diagnostics line: it used
        #: to end without a word whatever the cause, and a link to the
        #: Windows laptop that ended every few seconds said only "closed".
        self.ended = ""
        self._outgoing = bytearray()
        self._has_data = asyncio.Event()
        self._room = asyncio.Event()
        self._room.set()
        self._writer: asyncio.Task | None = None
        self._write_failed = False
        self._incoming = bytearray()
        self._arrived = asyncio.Event()
        self._read_room = asyncio.Event()
        self._read_room.set()
        self._reader: asyncio.Task | None = None
        self._done_reading = False
        # Reading starts with the stream, not with its first reader: a
        # connection's first frame waits on `Endpoint._dispatch`, and a
        # joiner's link on its HELLO, while the sharer is already sending.
        try:
            self._reader = asyncio.get_running_loop().create_task(self._read())
        except RuntimeError:
            pass

    async def send(self, message: bytes) -> None:
        if self._closed or self._write_failed or self._done_reading:
            raise ConnectionError(self.ended or "closed")
        self._outgoing += struct.pack(">I", len(message))
        self._outgoing += message
        if self._writer is None:
            self._writer = asyncio.create_task(self._write())
        self._has_data.set()
        while len(self._outgoing) >= WRITE_GATHER and not self._write_failed:
            self._room.clear()
            await self._room.wait()
        if self._write_failed:
            raise ConnectionError(self.ended or "closed")

    async def _write(self) -> None:
        while True:
            await self._has_data.wait()
            self._has_data.clear()
            if self._outgoing:
                data = bytes(self._outgoing)
                self._outgoing.clear()
                self._room.set()
                try:
                    await self._send.write_all(data)
                except Exception as error:
                    self._write_failed = True
                    if not self.ended:
                        self.ended = f"write failed: {type(error).__name__}: {said(error)}"[:300]
                    self._room.set()
                    return
            if (self._closed or self._done_reading) and not self._outgoing:
                return

    async def _read(self) -> None:
        try:
            while not self._closed:
                if len(self._incoming) >= READ_AHEAD:
                    self._read_room.clear()
                    await self._read_room.wait()
                    continue
                try:
                    chunk = await asyncio.wait_for(
                        self._recv.read(READ_CHUNK), timeout=READ_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    # A peer that declares a length and never sends the
                    # bytes held its buffer open for ever, because nothing
                    # else would close the stream. A minute and a half of
                    # complete silence from a peer that is supposed to be
                    # syncing is a dead connection; a live one is pinged.
                    self.ended = self.ended or "read timed out"
                    return
                except Exception as error:
                    self.ended = self.ended or (
                        f"read failed: {type(error).__name__}: {said(error)}"[:300])
                    return
                if not chunk:
                    self.ended = self.ended or "finished by the other end"
                    return
                self._incoming += chunk
                self._arrived.set()
        finally:
            self._done_reading = True
            self._arrived.set()
            # The writer has nothing more to do for a stream nobody reads.
            self._has_data.set()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self._messages()

    async def _messages(self) -> AsyncIterator[bytes]:
        if self._reader is None:
            self._reader = asyncio.create_task(self._read())
        while not self._closed:
            while len(self._incoming) >= LENGTH:
                (size,) = struct.unpack_from(">I", self._incoming, 0)
                if size > MAX_MESSAGE:
                    self.ended = f"a message of {size} bytes"
                    return
                if len(self._incoming) < LENGTH + size:
                    break
                message = bytes(self._incoming[LENGTH:LENGTH + size])
                del self._incoming[:LENGTH + size]
                self._read_room.set()
                yield message
                if self._closed:
                    return
            if self._done_reading:
                return
            self._arrived.clear()
            await self._arrived.wait()

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        writer = self._writer
        if writer is not None and not writer.done():
            # What was handed to `send` before the close still goes, as it
            # did when `send` returned only once noq had it: a removal's
            # tombstone is the last thing its peer hears.
            self._has_data.set()
            try:
                await asyncio.wait_for(asyncio.shield(writer), FLUSH_TIMEOUT)
            except Exception:
                writer.cancel()
        try:
            await self._send.finish()
        except Exception:
            pass
        if self._reader is not None:
            self._reader.cancel()
        self._arrived.set()


class IrohTransport:
    """This install, reachable by its public key."""

    def __init__(self, secret: bytes) -> None:
        self._secret = secret
        self._endpoint = None
        self._accepting: asyncio.Task | None = None
        #: The task handing each accepted stream to its project, held until
        #: it ends. asyncio keeps only a weak reference to a task, so one
        #: nothing else held could be collected while it waited on a peer's
        #: first frame, and the stream and its connection with it.
        self._handing = Handing()
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
                self._handing.add(asyncio.create_task(on_stream(stream)))
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


def said(error: BaseException) -> str:
    """What an error says. iroh's `IrohError` stringifies to nothing: its
    text is behind `message()`, so a link to the Windows laptop that broke
    every second logged "IrohError: " and nothing about why."""
    text = str(error)
    if text:
        return text
    message = getattr(error, "message", None)
    if callable(message):
        try:
            return str(message())
        except Exception:
            pass
    return ""


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
