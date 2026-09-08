"""The socket a browser keeps open onto one shared document.

Two things travel here and they are kept apart on purpose.

**Sync messages** are the document itself.  They are handled: applied to the
server's copy, and the resulting change is passed on to everybody else who has
that document open.

**Awareness messages** -- who is where, and what their selection is -- are
relayed, *and* kept, in an `Awareness` of the server's own.

Relaying them unread was the first design and it had a ghost in it.  When a
browser goes away, the people still here have to be told; y-protocols only
drops a silent peer after thirty seconds, and `outdatedTimeout` is a module
constant, so it cannot be shortened.  A collaborator who shut their laptop
therefore sat in the margin, caret and all, for half a minute -- which is
worse than not showing them, because a caret means somebody is there.

A server that has applied the updates knows which client ids belong to which
socket, so when the socket closes it can say so at once.  The objection to
parsing -- that it would mean a second implementation of somebody else's wire
format -- does not apply, because `pycrdt` already implements it and this
uses that.

`pycrdt` ships a `Provider` that would do most of the sync half.  It is not
used because it sends every document change back down the channel it came
from: correct, since Yjs updates are idempotent, and a wasted round trip on
every keystroke of every collaborator.  The loop below is about forty lines
and skips the sender.

**Authentication happens here, in the handler.**  Starlette's HTTP middleware
does not run for the websocket scope, so the check that guards the other
ninety routes does not guard this one.  A sync route that forgets it is a
route that hands every document to anyone who can reach the port, and nothing
in a screenshot would show it.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from pycrdt import (
    Awareness,
    YMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)

# A queue this deep is already a connection that is not keeping up.  Same
# reasoning as the event stream's: dropping is worse than closing, because a
# tab that quietly stops receiving updates looks like a tab that is up to
# date.
BACKLOG = 512


class Connection:
    """One browser, on one document."""

    __slots__ = ("id", "doc_id", "queue", "alive", "clients")

    def __init__(self, connection_id: str, doc_id: str) -> None:
        self.id = connection_id
        self.doc_id = doc_id
        self.queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=BACKLOG)
        self.alive = True
        #: The Yjs client ids this socket has spoken for, so its cursors can
        #: be taken down the moment it goes away.
        self.clients: set[int] = set()

    def send(self, message: bytes) -> None:
        """Hand a message to this connection, or close it if it is not
        draining. Never blocks the caller, which may be inside a document
        transaction."""
        if not self.alive:
            return
        try:
            self.queue.put_nowait(message)
        except asyncio.QueueFull:
            self.close()

    def close(self) -> None:
        self.alive = False
        try:
            self.queue.put_nowait(None)
        except asyncio.QueueFull:
            pass


class SyncHub:
    """Every browser connection onto one project's documents."""

    def __init__(self, store) -> None:
        self.store = store
        self.rooms: dict[str, list[Connection]] = {}
        # One per document. Holds every cursor in the room, so a tab that
        # joins late is told about them at once, and so a tab that leaves can
        # have its own taken down at once.
        self.awareness: dict[str, Awareness] = {}
        self._next = 0
        # Set while a message from one connection is being applied, so the
        # document's observer knows not to send the change back to them.
        # Safe as a plain attribute because applying an update fires
        # observers synchronously, on this one event loop.
        self.applying: Connection | None = None
        #: Told when a browser's cursor moves, so it can be passed to the
        #: other installs. Set by the peer network; None while a project is
        #: not shared, which is most of them.
        self.on_awareness: Callable[[str, bytes], None] | None = None
        self.closed = False
        store.listeners.append(self._document_changed)

    # --- fan-out ----------------------------------------------------------

    def _document_changed(self, doc_id: str, update: bytes) -> None:
        """A document moved -- because of a browser, a peer, or the disk.

        Called from inside the transaction that made the change, so it must
        not read the document and must not block.  It only enqueues.
        """
        message = create_update_message(update)
        source = self.applying
        for connection in self.rooms.get(doc_id, ()):
            if connection is source:
                continue
            connection.send(message)

    def _join(self, doc_id: str) -> Connection:
        self._next += 1
        connection = Connection(f"c{self._next}", doc_id)
        self.rooms.setdefault(doc_id, []).append(connection)
        return connection

    def _awareness_for(self, doc_id: str) -> Awareness | None:
        found = self.awareness.get(doc_id)
        if found is not None:
            return found
        doc = self.store.document(doc_id)
        if doc is None:
            return None
        self.awareness[doc_id] = found = Awareness(doc)
        # The server is not a participant. Its own entry would be a cursor
        # in the margin belonging to nobody.
        found.set_local_state(None)
        return found

    def from_peer(self, doc_id: str, message: bytes) -> None:
        """A cursor that arrived from another install.

        Passed to this machine's browsers and applied to the room's own
        awareness, so a tab opening later is told about it too -- exactly as
        a local one is, because from here they are the same thing.
        """
        awareness = self._awareness_for(doc_id)
        if awareness is not None:
            try:
                awareness.apply_awareness_update(read_message(message[1:]), "peer")
            except Exception:
                return
        for connection in self.rooms.get(doc_id, ()):
            connection.send(message)

    def _leave(self, connection: Connection) -> None:
        room = self.rooms.get(connection.doc_id)
        if room and connection in room:
            room.remove(connection)
        if not room:
            self.rooms.pop(connection.doc_id, None)

        # Its cursor goes with it, and everyone else is told so now rather
        # than in thirty seconds' time. A caret left behind by a closed tab
        # is worse than no caret: it says somebody is there.
        awareness = self.awareness.get(connection.doc_id)
        if awareness is not None and connection.clients:
            gone = sorted(connection.clients)
            try:
                awareness.remove_awareness_states(gone, "left")
                notice = create_awareness_message(
                    awareness.encode_awareness_update(gone)
                )
            except Exception:
                notice = None
            if notice:
                for other in self.rooms.get(connection.doc_id, ()):
                    other.send(notice)
        if not self.rooms.get(connection.doc_id):
            self.awareness.pop(connection.doc_id, None)
        connection.close()

    # --- one connection ---------------------------------------------------

    async def serve(self, websocket: Any, doc_id: str) -> None:
        """Run one browser's connection until it goes away."""
        if self.closed:
            await websocket.close(code=1001)
            return
        doc = self.store.document(doc_id)
        if doc is None:
            await websocket.close(code=1003)
            return

        await websocket.accept()
        connection = self._join(doc_id)
        pump = asyncio.create_task(self._pump(websocket, connection))
        try:
            # The server opens the conversation: here is what I have, tell
            # me what you have that I do not.
            connection.send(create_sync_message(doc))
            # Every cursor already in the room, in one message, so a tab that
            # arrives late does not sit in an apparently empty document until
            # somebody happens to move.
            awareness = self._awareness_for(doc_id)
            if awareness is not None:
                known = [cid for cid, state in awareness.states.items() if state]
                if known:
                    connection.send(create_awareness_message(
                        awareness.encode_awareness_update(known)
                    ))

            while True:
                message = await websocket.receive_bytes()
                if not message:
                    continue
                if self.closed:
                    # The project is being closed. Applying an update to a
                    # document whose observers have already been dropped
                    # would persist nothing and project nothing -- the
                    # keystroke would simply not exist.
                    break
                if message[0] == YMessageType.SYNC:
                    self.applying = connection
                    try:
                        reply = handle_sync_message(message[1:], doc)
                    finally:
                        self.applying = None
                    if reply is not None:
                        connection.send(reply)
                elif message[0] == YMessageType.AWARENESS:
                    # Outward first, so a collaborator on another machine
                    # sees the caret move at the same time as a second tab
                    # here does.
                    if self.on_awareness:
                        self.on_awareness(doc_id, message)
                    awareness = self._awareness_for(doc_id)
                    if awareness is not None:
                        update = read_message(message[1:])
                        before = set(awareness.states)
                        awareness.apply_awareness_update(update, connection)
                        # Whatever ids this socket just spoke for are its to
                        # take away when it goes.
                        # Whatever ids appeared because of this socket are
                        # its to take away when it goes. A later frame from
                        # the same socket is a cursor moving, which adds no
                        # id and needs no bookkeeping.
                        connection.clients |= set(awareness.states) - before
                    for other in self.rooms.get(doc_id, ()):
                        if other is not connection:
                            other.send(message)
        except Exception:
            # A closed socket is the ordinary way out of this loop, not an
            # event worth reporting.
            pass
        finally:
            self._leave(connection)
            pump.cancel()

    async def _pump(self, websocket: Any, connection: Connection) -> None:
        """Everything queued for this connection, in order."""
        try:
            while True:
                message = await connection.queue.get()
                if message is None:
                    break
                await websocket.send_bytes(message)
        except (asyncio.CancelledError, Exception):
            pass

    def close(self) -> None:
        self.closed = True
        for room in list(self.rooms.values()):
            for connection in list(room):
                connection.close()
        self.rooms.clear()
        self.awareness.clear()
        if self._document_changed in self.store.listeners:
            self.store.listeners.remove(self._document_changed)
