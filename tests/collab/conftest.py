"""The pieces every two-peer test needs, in one place.

Five modules under here each set the transport environment variable before
their collab imports, each declared an identical fixture clearing the hub, and
each defined their own `Peer`.  A sixth copy was the wrong answer.

The environment variable has to be set before anything under `server.collab`
is imported, because `transport.wanted()` is read when a `PeerNetwork` builds
its transport and `server/main.py` builds its settings at import time.  A
`conftest.py` is imported before the test modules beside it, so this is the
earliest place it can live.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from nexttex.history import History                              # noqa: E402
from nexttex.trash import Trash                                  # noqa: E402
from nexttex.project import Project                              # noqa: E402
from server.collab import transport                              # noqa: E402
from server.collab.peers import PeerNetwork                      # noqa: E402
from server.collab.store import CollabStore                      # noqa: E402


@pytest.fixture(autouse=True)
def _clean_hub():
    transport.HUB.clear()
    yield
    transport.HUB.clear()


class Peer:
    """One install: its project, its documents, its history, its network.

    Stands in for a `ProjectSession`, which is what `PeerNetwork` reaches
    through for the history, so it is passed as its own session.
    """

    def __init__(self, root: Path, files: dict[str, str] | None = None):
        root.mkdir(parents=True, exist_ok=True)
        for name, text in (files or {"main.tex": "The chapter.\n"}).items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        self.project = Project.open(root)
        self.name = root.name.title()
        self.history = History(self.project.state_dir / "history")
        self.trash = Trash(
            self.project.state_dir / "trash", self.history, self.project.root,
        )
        # The session goes to the store as well as to the network.  Every
        # two-peer test in this directory built the store without one, so
        # `_write` found no session, skipped all four of the things every
        # write in this app does, and the path by which a collaborator's
        # typing reaches a disk was never once exercised -- which is why the
        # version it recorded there could be wrong for as long as it was.
        self.store = CollabStore(self.project, self)
        self.network = PeerNetwork(self.store, session=self)
        self.store.adopt()

    def be(self, identity: str) -> "Peer":
        """Take an identity, the way a real install takes one from its key."""
        self.network._me = identity
        self.history.me = identity
        return self

    @property
    def me(self) -> str:
        return self.network.peer_id

    def open_documents(self) -> None:
        """Bring every text file's document into being.

        A document is built lazily, and only a document that exists is
        offered, so a test that never opens one shares nothing.
        """
        for file_id, record in self.store.files.items():
            if record.get("kind") == "text":
                self.store.body(file_id)

    def versions(self, relative: str) -> list:
        return self.history.versions(relative)

    # -- what `CollabStore` reaches through a session for ------------------
    #
    # Without these the projection raises on its first hook, the write is
    # marked failed, and every two-peer test in this directory silently
    # never exercised the path by which a collaborator's typing reaches a
    # disk -- which is exactly where authorship was going wrong.

    def mark_written(self, path) -> None:
        pass

    def note_edit(self, *args) -> None:
        pass

    def schedule_compile(self) -> None:
        pass

    def record_version(
        self, path, text, *, previous=None, by: str = "you",
        why: str = "", op: str = "edit", source: str = "",
    ) -> None:
        relative = self.project.relative(path)
        if previous is not None and not self.history.versions(relative):
            self.history.record(
                relative, previous, by="you", op="create",
                why="as it was when NextTex first saw it",
            )
        shared = self.network.share.shared
        self.history.record(
            relative, text, by=by, why=why, op=op, source=source,
            peer=self.network.peer_id if shared else "",
            who=self.name if shared else "",
        )

    async def close(self) -> None:
        await self.network.close()
        self.store.close()


async def settle(seconds: float = 0.6) -> None:
    """Let the queues drain. Everything here is local, so this is short."""
    await asyncio.sleep(seconds)


async def until(predicate, seconds: float = 8.0) -> bool:
    """Wait for something to become true, rather than for a fixed time.

    Reconnection is on a backoff of its own, so a test that waits a flat two
    seconds for it is a test that fails on a loaded machine and passes on a
    quiet one.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    while loop.time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.1)
    return predicate()


async def join_up(host: Peer, guest: Peer, *, host_name: str = "Alice",
                  guest_name: str = "Bob") -> None:
    """Share a project from one peer and join it from the other."""
    host.network.begin_sharing(host_name)
    await host.network.start()
    host.open_documents()
    refused = await guest.network.join(host.network.invite(), guest_name)
    assert refused == "", refused
    await settle()
