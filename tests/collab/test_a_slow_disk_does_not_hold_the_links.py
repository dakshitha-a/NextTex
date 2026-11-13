"""Looking for missing figures on a slow disk does not stop the links.

On the Windows laptop on 13 November 2026, with the thesis in OneDrive,
the pass that asks a peer for every figure the manifest names and the
disk lacks held the event loop for 82 s at one moment and 111 s at
another. Every link went silent and was dropped, which is also why the
laptop took two minutes to follow a deletion. Each look at the disk is a
path resolved and a file statted; they are made in a thread now, one
pass per link at a time, and the loop keeps turning while they run.
"""

import asyncio
import threading

import pytest

from .conftest import Peer, join_up, until


@pytest.mark.asyncio
async def test_the_missing_file_pass_leaves_the_loop_turning(tmp_path, monkeypatch):
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    (alice.project.root / "figures").mkdir()
    (alice.project.root / "figures" / "plot.png").write_bytes(bytes(range(256)) * 8)
    alice.store.adopt()
    await join_up(alice, bob)
    file_id = alice.store.file_id_for("figures/plot.png")
    assert await until(lambda: (bob.project.root / "figures" / "plot.png").exists(), 8.0)
    link = next(iter(bob.network.links.values()))

    loop_thread = threading.get_ident()
    looked_from: list[int] = []
    release = threading.Event()
    real = type(bob.project).resolve_for_write

    def slow(self, relative):
        looked_from.append(threading.get_ident())
        release.wait(5.0)
        return real(self, relative)

    monkeypatch.setattr(type(bob.project), "resolve_for_write", slow)
    link.wanted_files.pop(file_id, None)
    (bob.project.root / "figures" / "plot.png").unlink()

    link._ask_for_files()
    assert await until(lambda: bool(looked_from), 5.0), "the pass never looked at the disk"
    first = link._file_pass
    # Two asks while the first pass is held: no second pass starts beside
    # it, and one more is queued behind it.
    link._ask_for_files()
    link._ask_for_files()
    assert link._file_pass is first
    assert link._file_pass_again, "the asks made meanwhile were not kept"
    turns = 0
    for _ in range(20):
        await asyncio.sleep(0.01)
        turns += 1
    assert turns == 20
    assert loop_thread not in looked_from, "the disk was asked on the loop"
    assert len(looked_from) == 1, "a second pass ran beside the first"
    release.set()
    await asyncio.wait_for(link._file_pass, 10.0)
    assert file_id in link.wanted_files
    assert await until(lambda: (bob.project.root / "figures" / "plot.png").exists(), 8.0)

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_link_that_closes_mid_pass_asks_for_nothing(tmp_path, monkeypatch):
    from server.collab import wire

    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    (alice.project.root / "figures").mkdir()
    (alice.project.root / "figures" / "plot.png").write_bytes(bytes(range(256)) * 8)
    alice.store.adopt()
    await join_up(alice, bob)
    file_id = alice.store.file_id_for("figures/plot.png")
    assert await until(lambda: (bob.project.root / "figures" / "plot.png").exists(), 8.0)
    link = next(iter(bob.network.links.values()))

    entered = threading.Event()
    release = threading.Event()
    real = type(bob.project).resolve_for_write

    def slow(self, relative):
        entered.set()
        release.wait(5.0)
        return real(self, relative)

    monkeypatch.setattr(type(bob.project), "resolve_for_write", slow)
    link.wanted_files.pop(file_id, None)
    (bob.project.root / "figures" / "plot.png").unlink()
    asked = []
    send = link.send

    async def counting(data):
        if data[0] == wire.FILE_WANT:
            asked.append(data)
        await send(data)

    link.send = counting
    pass_ = asyncio.create_task(link.want_files())
    assert await until(entered.is_set, 5.0)
    link.alive = False
    release.set()
    await asyncio.wait_for(pass_, 10.0)
    assert asked == [], "a closed link asked for a file"

    await alice.close()
    await bob.close()
