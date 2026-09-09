"""How one NextTex reaches another, and how a test reaches neither.

Everything above this file is bytes in, bytes out.  Nothing above it knows
that iroh exists, which is the point: iroh's Python bindings are a compiled
extension with wheels for four platforms, they hole-punch across the open
internet, and none of that belongs anywhere near a test for whether two
peers converge after a partition.

So there are two implementations of one small protocol.

`IrohTransport` is the real one.  A peer is an ed25519 public key, a
connection is QUIC over TLS *to that key*, and `conn.remote_id()` is
therefore an authenticated identity rather than a claim -- which is the whole
of the authorisation model: is this key in the membership list.  No handshake
of ours, no certificates to manage, no relay that can read anything.

`LoopbackTransport` is a pair of queues.  It is chosen by an environment
variable, in the same way this codebase already fakes the agent
(`NEXTTEX_SCRIPTED_AGENT`) and the Claude sign-in (`NEXTTEX_FAKE_CLAUDE_AUTH`),
and it can do the two things a real network does that are hard to arrange on
purpose: lose a connection, and hold messages until later.  Every test of
membership, of syncing, of history exchange and of convergence across a
partition runs on it, in one process, with no network at all.

Note that `NEXTTEX_INSTANCE` cannot serve as this seam, tempting as it looks.
`server/main.py` builds `SETTINGS` and `REGISTRY` at *import* time -- which is
why `tests/api/conftest.py` sets the environment before importing it -- so two
instances inside one pytest process is not a thing that can be arranged.  The
seam has to be lower down, and this is where.
"""

from __future__ import annotations

import asyncio
import os
from typing import AsyncIterator, Awaitable, Callable, Protocol


class PeerStream(Protocol):
    """A duplex byte-message channel to one authenticated peer."""

    #: The peer's identity: 64 hex characters of ed25519 public key.
    peer_id: str

    async def send(self, message: bytes) -> None: ...

    def __aiter__(self) -> AsyncIterator[bytes]: ...

    async def close(self) -> None: ...


class Transport(Protocol):
    """This install's presence on whatever network there is."""

    #: Our own identity.
    peer_id: str

    async def start(
        self, on_stream: Callable[[PeerStream], Awaitable[None]]
    ) -> None: ...

    async def connect(self, address: str) -> PeerStream: ...

    async def close(self) -> None: ...

    def address(self) -> str:
        """A string another peer can dial us on. An iroh ticket, in the real
        one; the peer id itself, in the loopback."""
        ...


# ---------------------------------------------------------------------------
# The loopback


class _Pipe:
    """One end of an in-process connection."""

    def __init__(self, peer_id: str, outbound: asyncio.Queue, inbound: asyncio.Queue):
        self.peer_id = peer_id
        self._out = outbound
        self._in = inbound
        self.severed = False
        self.closed = False
        #: Messages written while severed, delivered when it is healed. This
        #: is what a partition is: not a loss, a delay.
        self.held: list[bytes] = []

    async def send(self, message: bytes) -> None:
        if self.closed:
            raise ConnectionError("closed")
        if self.severed:
            self.held.append(message)
            return
        await self._out.put(message)

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self._receive()

    async def _receive(self) -> AsyncIterator[bytes]:
        while True:
            message = await self._in.get()
            if message is None:
                return
            yield message

    async def heal(self) -> None:
        """Deliver everything written while the line was down."""
        self.severed = False
        held, self.held = self.held, []
        for message in held:
            await self._out.put(message)

    async def close(self) -> None:
        self.closed = True
        await self._out.put(None)


class LoopbackHub:
    """Where in-process peers find each other.

    Module-level state, deliberately: two `ProjectSession`s in one test are
    two peers, and they have to be able to dial each other by name without
    either of them being told about the other first.
    """

    def __init__(self) -> None:
        self.listeners: dict[str, Callable[[PeerStream], Awaitable[None]]] = {}
        self.links: list[tuple[_Pipe, _Pipe]] = []

    def clear(self) -> None:
        self.listeners.clear()
        self.links.clear()

    async def dial(self, caller: str, callee: str) -> _Pipe:
        listener = self.listeners.get(callee)
        if listener is None:
            raise ConnectionError(f"no peer listening as {callee}")
        there, back = asyncio.Queue(), asyncio.Queue()
        caller_end = _Pipe(callee, there, back)
        callee_end = _Pipe(caller, back, there)
        self.links.append((caller_end, callee_end))
        asyncio.create_task(listener(callee_end))
        return caller_end

    async def sever(self) -> None:
        """Cut every link. What "Bob took his laptop on a train" looks like."""
        for first, second in self.links:
            first.severed = second.severed = True

    async def heal(self) -> None:
        """Put them all back, delivering what was written in the meantime."""
        for first, second in self.links:
            await first.heal()
            await second.heal()

    async def cut(self) -> None:
        """Drop every link the way a connection really drops.

        `sever` is a *delay*: what is written while it is down is held and
        delivered on `heal`.  That is the right model for a partition and the
        wrong one for testing what happens afterwards, because nothing ever
        falls out of `PeerLink.run`, so no link is ever rebuilt and the
        dialling loop is never exercised.  For a long time that was the only
        moment history was exchanged at all, which meant the suite could not
        reach it.
        """
        links, self.links = self.links, []
        for first, second in links:
            await first.close()
            await second.close()


HUB = LoopbackHub()


class LoopbackTransport:
    def __init__(self, peer_id: str) -> None:
        self.peer_id = peer_id

    async def start(self, on_stream) -> None:
        HUB.listeners[self.peer_id] = on_stream

    async def connect(self, address: str) -> PeerStream:
        return await HUB.dial(self.peer_id, address)

    def address(self) -> str:
        return self.peer_id

    async def close(self) -> None:
        HUB.listeners.pop(self.peer_id, None)


# ---------------------------------------------------------------------------
# Choosing one


def wanted() -> str:
    """Which transport this process should use."""
    return (os.environ.get("NEXTTEX_COLLAB_TRANSPORT") or "iroh").strip().lower()


def available() -> bool:
    """Whether peer-to-peer collaboration can run on this machine at all.

    iroh publishes wheels for linux x86_64 and aarch64, macOS on Apple
    silicon, and Windows on x64.  An Intel Mac has none, so the import fails
    and collaboration has to be *offered as unavailable* rather than taking
    the server down with it -- the rest of NextTex works perfectly well
    without it.
    """
    if wanted() == "loopback":
        # True because the tests need sharing to be offered, and the loopback
        # is only ever selected by an environment variable that nothing in
        # `scripts/` sets. An install that somehow ran this way would mint
        # invites naming a peer nothing outside the process can dial, which
        # is a confusing way to fail -- but it is not reachable without
        # deliberately setting NEXTTEX_COLLAB_TRANSPORT.
        return True
    try:
        import iroh                                            # noqa: F401
    except Exception:
        return False
    return True
