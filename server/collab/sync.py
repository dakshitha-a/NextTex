"""The socket a browser keeps open onto one shared document.

Two things travel here and they are kept apart on purpose.

**Sync messages** are the document itself.  They are handled: applied to the
server's copy, and the resulting change is passed on to everybody else who has
that document open.

**Awareness messages** -- who is where, and what their selection is -- are
*relayed unread*.  The server keeps the last frame each connection sent so a
tab arriving late sees the cursors already in the room, and otherwise passes
the bytes along without looking inside them.  That is deliberate: awareness is
a JS-side encoding, and a server that parsed it would be a second
implementation of somebody else's wire format, to be kept in step forever, in
exchange for nothing.  What the agent needs to know about where the writer is
looking already arrives by another route.

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
from typing import Any

from pycrdt import (
    YMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)

# A queue this deep is already a connection that is not keeping up.  Same
# reasoning as the event stream's: dropping is worse than closing, because a
# tab that quietly stops receiving updates looks like a tab that is up to
# date.
BACKLOG = 512


class Connection:
    """One browser, on one document."""

    __slots__ = ("id", "doc_id", "queue", "alive")

    def __init__(self, connection_id: str, doc_id: str) -> None:
        self.id = connection_id
        self.doc_id = doc_id
        self.queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=BACKLOG)
        self.alive = True

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
        # The last awareness frame from each connection, so a tab that joins
        # late is told about the cursors already there rather than seeing an
        # empty room until somebody moves.
        self.awareness: dict[str, dict[str, bytes]] = {}
        self._next = 0
        # Set while a message from one connection is being applied, so the
        # document's observer knows not to send the change back to them.
        # Safe as a plain attribute because applying an update fires
        # observers synchronously, on this one event loop.
        self.applying: Connection | None = None
        store.on_update = self._document_changed

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

    def _leave(self, connection: Connection) -> None:
        room = self.rooms.get(connection.doc_id)
        if room and connection in room:
            room.remove(connection)
        if not room:
            self.rooms.pop(connection.doc_id, None)

        # Its cursor goes with it. A caret left behind by a closed tab is
        # worse than no caret: it says somebody is there.
        frames = self.awareness.get(connection.doc_id)
        if frames:
            frames.pop(connection.id, None)
        connection.close()

    # --- one connection ---------------------------------------------------

    async def serve(self, websocket: Any, doc_id: str) -> None:
        """Run one browser's connection until it goes away."""
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
            for frame in list(self.awareness.get(doc_id, {}).values()):
                connection.send(frame)

            while True:
                message = await websocket.receive_bytes()
                if not message:
                    continue
                if message[0] == YMessageType.SYNC:
                    self.applying = connection
                    try:
                        reply = handle_sync_message(message[1:], doc)
                    finally:
                        self.applying = None
                    if reply is not None:
                        connection.send(reply)
                elif message[0] == YMessageType.AWARENESS:
                    self.awareness.setdefault(doc_id, {})[connection.id] = message
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
        for room in list(self.rooms.values()):
            for connection in list(room):
                connection.close()
        self.rooms.clear()
        self.awareness.clear()
        self.store.on_update = None
