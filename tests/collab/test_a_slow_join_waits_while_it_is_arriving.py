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


@pytest.mark.asyncio
async def test_a_join_says_in_the_diagnostics_log_where_its_time_went(tmp_path):
    """A join on a machine nobody here can watch reports, for every frame
    kind its links handled, how many, how long in all and the longest."""
    import json
    import logging

    from nexttex import diag

    path = diag.install(tmp_path / "state", secrets=[], home="/home/someone")
    try:
        store = SlowStore()
        store.frames_in = {4: [1830, 12.5, 0.4], 8: [2764, 3.0, 0.01]}
        reason = await server_main._wait_for_the_project(store, seconds=0.2, ceiling=5)
        for handler in logging.getLogger("nexttex.diag").handlers:
            handler.flush()
        [line] = [json.loads(row) for row in path.read_text().splitlines()
                  if row and json.loads(row)["kind"] == "join"]
    finally:
        diag.uninstall()
    assert reason
    assert line["arrived"] is False and line["waiting"] == 1 and line["texts"] == 1
    assert line["frames"] == {"4": [1830, 12.5, 0.4], "8": [2764, 3.0, 0.01]}


@pytest.mark.asyncio
async def test_a_peer_link_tallies_the_frames_it_handled(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    alice.store.adopt()
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    count, total, longest = bob.store.frames_in[4]
    assert count >= 1 and total >= longest >= 0
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_a_link_says_why_it_ended(tmp_path):
    import json
    import logging

    from nexttex import diag

    path = diag.install(tmp_path / "state", secrets=[], home="/home/someone")
    try:
        alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
        alice.store.adopt()
        bob = Peer(tmp_path / "bob", {}).be("b" * 64)
        await join_up(alice, bob)
        await bob.close()
        await alice.close()
        # Closing cancels the links' tasks; their `finally` runs next.
        await asyncio.sleep(0.2)
        for handler in logging.getLogger("nexttex.diag").handlers:
            handler.flush()
        lines = [json.loads(row) for row in path.read_text().splitlines()
                 if row and json.loads(row)["kind"] == "peer-link"]
    finally:
        diag.uninstall()
    assert lines, "no link wrote why it ended"
    assert all(line["ended"] and "seconds" in line for line in lines)
