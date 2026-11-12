"""A join waits while the project is still arriving, not a fixed thirty seconds.

Two papers whose manifests hold nearly three thousand records, most of them
deleted files, never joined on the Windows laptop: the sharer sends a sync
step and a history ask for every record before the answers that fill the
text, the laptop was still working through them when thirty seconds ran
out, and every attempt was abandoned with nothing answered. The deadline is
now thirty seconds of quiet, measured from the last frame a peer link
handled, under a ceiling.
"""

import asyncio

import pytest

from server import main as server_main

from .conftest import Peer, join_up


class SlowStore:
    """A joiner whose one text document fills only after the quiet limit,
    while frames keep arriving."""

    def __init__(self):
        self.files = {"x": {"path": "chapters/one.tex", "kind": "text", "size": 9}}
        self.answered: set = set()
        self.heard = 0.0
        self.text = ""

    def body(self, file_id):
        return self.text


async def _deliver(store, every, fill_after):
    loop = asyncio.get_running_loop()
    began = loop.time()
    while True:
        store.heard = loop.time()
        if loop.time() - began >= fill_after:
            store.text = "The chapter.\n"
        await asyncio.sleep(every)


@pytest.mark.asyncio
async def test_a_link_still_delivering_is_waited_for():
    store = SlowStore()
    feed = asyncio.create_task(_deliver(store, every=0.05, fill_after=0.8))
    try:
        reason = await server_main._wait_for_the_project(store, seconds=0.3, ceiling=5)
    finally:
        feed.cancel()
    assert reason == "", reason


@pytest.mark.asyncio
async def test_a_link_that_never_finishes_meets_the_ceiling():
    store = SlowStore()
    feed = asyncio.create_task(_deliver(store, every=0.05, fill_after=60))
    loop = asyncio.get_running_loop()
    began = loop.time()
    try:
        reason = await server_main._wait_for_the_project(store, seconds=0.3, ceiling=0.8)
    finally:
        feed.cancel()
    assert "chapters/one.tex" in reason, reason
    assert loop.time() - began < 2


@pytest.mark.asyncio
async def test_a_quiet_link_still_gives_up_after_the_quiet_limit():
    store = SlowStore()
    loop = asyncio.get_running_loop()
    began = loop.time()
    reason = await server_main._wait_for_the_project(store, seconds=0.3, ceiling=5)
    assert "chapters/one.tex" in reason, reason
    assert loop.time() - began < 1


@pytest.mark.asyncio
async def test_a_peer_link_records_when_it_last_heard(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    alice.store.adopt()
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    assert bob.store.heard == 0.0
    await join_up(alice, bob)
    assert bob.store.heard > 0.0
    await bob.close()
    await alice.close()
