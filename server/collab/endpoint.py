"""One network presence per install, shared by every shared project.

Each shared project used to bind a transport of its own under the install's
one key. Two projects meant two endpoints claiming one identity, and a
peer that dialled the key reached whichever of them had spoken for it
last: an invite to the first project, accepted while the second was
listening, was answered "that is not this project", and a collaborator
reached only through a relay could be sent to the wrong project for as
long as both were open. In the loopback the second project's listener
simply replaced the first's.

So there is one endpoint per identity, started by the first project that
needs it and closed with the last. Every connection it accepts is read
for its first frame, and a HELLO goes to the project whose share it
names; one naming no project here is refused the way a project refused
it before. What a project holds is an `Attached`, which speaks the
`Transport` protocol, so nothing above this file changed shape.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import AsyncIterator, Awaitable, Callable

from . import wire

#: How long a connection may take to say its first frame, the same
#: deadline a link waits a frame under.
FIRST_FRAME = 60.0

Handler = Callable[[object], Awaitable[None]]


class Replayed:
    """A stream whose first frame has been read, handed on whole.

    One iterator underneath, so a reader that asks for it twice, as a
    project's accept and then its link do, reads on rather than again."""

    def __init__(self, stream, first: bytes) -> None:
        self._stream = stream
        self._first: bytes | None = first
        self._messages = aiter(stream)
        self.peer_id = getattr(stream, "peer_id", "")

    async def send(self, message: bytes) -> None:
        await self._stream.send(message)

    async def close(self) -> None:
        await self._stream.close()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        if self._first is not None:
            first, self._first = self._first, None
            return first
        return await anext(self._messages)

    def __getattr__(self, name):
        return getattr(self._stream, name)


class Endpoint:
    """This install's one presence on the network."""

    def __init__(self, peer_id: str, make: Callable[[], object]) -> None:
        self.peer_id = peer_id
        self._make = make
        self.transport = None
        #: Share id to the project that answers for it.
        self.handlers: dict[str, Handler] = {}
        #: Who answers a connection that opens with HOST_KEEP: this
        #: install's host service, while host mode is on.
        self.host: Handler | None = None
        self._lock = asyncio.Lock()

    async def attach(self, share_id: str, on_stream: Handler) -> None:
        async with self._lock:
            if self.transport is None:
                made = self._make()
                await made.start(self._dispatch)
                self.transport = made
            self.handlers[share_id] = on_stream

    async def detach(self, share_id: str, on_stream: Handler) -> None:
        async with self._lock:
            if self.handlers.get(share_id) == on_stream:
                del self.handlers[share_id]
            if self.handlers or self.host is not None or self.transport is None:
                return
            # Kept in ENDPOINTS with no transport, so the next project to
            # attach starts this one again rather than a second beside it.
            made, self.transport = self.transport, None
        with contextlib.suppress(Exception):
            await made.close()

    async def serve_host(self, handler: Handler | None) -> None:
        """Answer HOST_KEEP with `handler`, or stop with None; the endpoint
        runs while a host needs it even with no project attached."""
        async with self._lock:
            self.host = handler
            if handler is not None and self.transport is None:
                made = self._make()
                await made.start(self._dispatch)
                self.transport = made
            if handler is not None or self.handlers or self.transport is None:
                return
            made, self.transport = self.transport, None
        with contextlib.suppress(Exception):
            await made.close()

    async def dial(self, address: str):
        """A connection out that belongs to no project: a writer asking its
        host. The endpoint is started for it if nothing else has."""
        async with self._lock:
            if self.transport is None:
                made = self._make()
                await made.start(self._dispatch)
                self.transport = made
        return await self.transport.connect(address)

    async def _dispatch(self, stream) -> None:
        try:
            first = await asyncio.wait_for(anext(aiter(stream)), FIRST_FRAME)
            frame = wire.Frame.decode(first)
        except Exception:
            with contextlib.suppress(Exception):
                await stream.close()
            return
        share_id = str(frame.header.get("share", "")) if frame.kind == wire.HELLO else ""
        handler = self.handlers.get(share_id) if frame.kind == wire.HELLO else None
        if frame.kind == wire.HOST_KEEP:
            handler = self.host
            if handler is None:
                with contextlib.suppress(Exception):
                    await stream.send(wire.host_kept(False, "This install is not a host."))
                    await stream.close()
                return
        if handler is None:
            with contextlib.suppress(Exception):
                if frame.kind == wire.HELLO:
                    await stream.send(wire.denied("that is not this project"))
                else:
                    await stream.send(wire.denied("say hello first"))
                await stream.close()
            return
        await handler(Replayed(stream, first))


#: One endpoint per identity in this process: one in an install, one per
#: stand-in install in a test.
ENDPOINTS: dict[str, Endpoint] = {}


class Attached:
    """One project's view of the install's endpoint, as a `Transport`."""

    def __init__(self, peer_id: str, share_id: str, make: Callable[[], object]) -> None:
        self.peer_id = peer_id
        self.share_id = share_id
        self.endpoint = endpoint_for(peer_id, make)
        self._on: Handler | None = None

    async def start(self, on_stream: Handler) -> None:
        self._on = on_stream
        await self.endpoint.attach(self.share_id, on_stream)

    async def connect(self, address: str):
        if self.endpoint.transport is None:
            raise ConnectionError("not started")
        return await self.endpoint.transport.connect(address)

    def address(self) -> str:
        made = self.endpoint.transport
        return made.address() if made is not None else ""

    async def close(self) -> None:
        if self._on is not None:
            on, self._on = self._on, None
            await self.endpoint.detach(self.share_id, on)


def endpoint_for(peer_id: str, make: Callable[[], object]) -> Endpoint:
    endpoint = ENDPOINTS.get(peer_id)
    if endpoint is None:
        endpoint = ENDPOINTS[peer_id] = Endpoint(peer_id, make)
    return endpoint
