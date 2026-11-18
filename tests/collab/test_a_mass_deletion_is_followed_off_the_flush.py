"""A collaborator's mass deletion is followed without holding the loop.

`settle_paths` moved every file a collaborator deleted into this
machine's trash from inside the flush, and the laptop's 104 files at
11:11 on 13 November 2026 held its loop for about 43 s, every link with
it. A batch larger than `FOLLOW_INLINE` is followed from a task, a file
a turn, with the paths kept from `adopt` until the task is done with
them, so the walk cannot give a file on its way out a fresh record.
"""

import asyncio
import time

import pytest

from .conftest import Peer, join_up, until

COUNT = 100


def live(peer: Peer, path: str) -> list[str]:
    return [
        file_id for file_id, record in peer.store.files.items()
        if record.get("path") == path and not record.get("trashed")
    ]


@pytest.mark.asyncio
async def test_a_hundred_deletions_leave_the_loop_turning(tmp_path, monkeypatch):
    files = {"main.tex": "Main.\n"}
    files.update({f"calc/run{n:03}.out": f"Run {n}.\n" for n in range(COUNT)})
    alice = Peer(tmp_path / "alice", files).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    alice.history.bind(alice.store.key_for, alice.store.records())
    bob.history.bind(bob.store.key_for, bob.store.records())
    await join_up(alice, bob)
    gone = [p for p in files if p.startswith("calc/")]
    assert await until(
        lambda: all((bob.project.root / p).exists() for p in gone), 15.0
    ), "the join never delivered the folder"
    bob.store.flush()

    # A slow disk on Bob's side: each move into the trash takes 20 ms, so
    # following all of them inside one flush would hold the loop for 2 s.
    real = type(bob.trash).delete

    def slow(self, target, **kwargs):
        time.sleep(0.02)
        return real(self, target, **kwargs)

    monkeypatch.setattr(type(bob.trash), "delete", slow)

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
    entry = alice.trash.delete(alice.project.root / "calc")
    for file in entry.files:
        alice.store.note_gone(file.path)
    alice.store.flush()
    assert await until(
        lambda: not any((bob.project.root / p).exists() for p in gone), 20.0
    ), "bob did not follow every deletion"
    done = True
    await ticker

    assert max(gaps) < 0.5, f"the loop was held for {max(gaps):.2f} s"
    for _ in range(3):
        bob.store.flush()
        bob.store.adopt()
    for path in gone:
        assert live(bob, path) == [], f"bob re-adopted {path}"
    assert len([e for e in bob.trash.entries() if e.path.startswith("calc/")]) == COUNT
    await alice.close()
    await bob.close()
