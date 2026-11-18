"""Offering a project's documents reads their logs in a thread.

After each restart on 13 November 2026 the Windows laptop held its loop
for 3 to 10 s at a time while it re-dialled seven shared projects:
`send_documents` opened every document by reading its log and the state
last agreed with that peer, one `read_bytes` after another, on the loop.
The reading is done in a thread now, and the documents are built from
what it read, on the loop, where they belong.
"""

import asyncio
import threading
import time

import pytest

from server.collab import persist

from .conftest import Peer, join_up, until

COUNT = 40


@pytest.mark.asyncio
async def test_the_logs_are_read_off_the_loop(tmp_path, monkeypatch):
    files = {f"ch{n:02}.tex": f"Chapter {n}.\n" for n in range(COUNT)}
    files["main.tex"] = "Main.\n"
    alice = Peer(tmp_path / "alice", files).be("a" * 64)
    # Every document opened once and closed, so each has a log on disk
    # and none is open: the state of a project the server has just
    # opened again.
    for file_id in list(alice.store.files):
        alice.store.body(file_id)
    alice.store.flush()
    alice.store.close()
    alice = Peer(tmp_path / "alice", {}).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)

    loop_thread = threading.get_ident()
    read_from: list[int] = []
    real = persist.read

    def slow(path):
        read_from.append(threading.get_ident())
        time.sleep(0.02)
        return real(path)

    monkeypatch.setattr(persist, "read", slow)
    gaps: list[float] = []
    done = False

    async def beat():
        last = time.monotonic()
        while not done:
            await asyncio.sleep(0.005)
            now = time.monotonic()
            gaps.append(now - last)
            last = now

    ticker = asyncio.ensure_future(beat())
    await join_up(alice, bob)
    assert await until(
        lambda: all((bob.project.root / name).exists() for name in files), 15.0
    ), "the join never delivered the project"
    done = True
    await ticker

    assert len(read_from) >= COUNT, "the logs were not read through persist.read"
    assert loop_thread not in read_from, "a log was read on the loop"
    assert max(gaps) < 0.5, f"the loop was held for {max(gaps):.2f} s"
    assert (bob.project.root / "ch07.tex").read_text() == "Chapter 7.\n"
    await alice.close()
    await bob.close()
