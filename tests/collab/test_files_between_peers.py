"""A binary a collaborator adds reaches the other machine's disk.

The text path syncs documents and the history path syncs a figure's
past; nothing delivered a figure's bytes, so a joiner held
`figures/plot.png` as a manifest entry and no file, and a figure made on
one machine after the join never appeared on the other.  `FILE_WANT`,
`FILE_HAVE` and `FILE_MISS` are the missing path, and the session is
told when a file lands so the tree draws it.
"""

import asyncio

import pytest

from .conftest import Peer, join_up, until


class Recorder:
    def __init__(self):
        self.seen: list[dict] = []
        self.events = self

    async def publish(self, event):
        self.seen.append(event)


@pytest.mark.asyncio
async def test_a_figure_made_after_joining_reaches_the_other_machine(tmp_path):
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    heard = Recorder()
    bob.note_arrived = lambda relative: heard.seen.append(
        {"type": "files_changed", "paths": [relative]}
    )
    await join_up(alice, bob)

    figure = bytes(range(256)) * 40
    (alice.project.root / "figures").mkdir()
    (alice.project.root / "figures" / "plot.png").write_bytes(figure)
    # What the watcher hands the store for a binary it cannot read as
    # text: nothing to fold, and until now nothing recorded either, so a
    # figure made after the share was not in the manifest until the next
    # open.
    assert alice.store.ingest("figures/plot.png", None) is True

    assert await until(
        lambda: (bob.project.root / "figures" / "plot.png").exists(), 8.0
    ), "the figure never reached the other machine"
    assert (bob.project.root / "figures" / "plot.png").read_bytes() == figure
    assert any(
        e.get("type") == "files_changed" and "figures/plot.png" in e.get("paths", [])
        for e in heard.seen
    ), "the tree was not told"

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_file_the_sender_no_longer_has_is_answered_with_a_miss_and_asked_later(tmp_path, monkeypatch):
    from server.collab import peers as peers_module

    monkeypatch.setattr(peers_module, "WANT_AGAIN", 5.0)
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    (alice.project.root / "figures").mkdir()
    (alice.project.root / "figures" / "plot.png").write_bytes(b"first")
    alice.store.adopt()
    # Gone from Alice's disk before Bob asks, and the record still there.
    (alice.project.root / "figures" / "plot.png").unlink()

    await join_up(alice, bob)
    link = next(iter(bob.network.links.values()))
    file_id = alice.store.file_id_for("figures/plot.png")
    assert await until(lambda: file_id in link.wanted_files, 4.0)
    assert not (bob.project.root / "figures" / "plot.png").exists()

    # Back on Alice's disk.  The ask is re-made once it has aged, on the
    # next manifest sync, which the test stands in for by asking directly:
    # a standing ask is left alone, and one older than the age goes again.
    (alice.project.root / "figures" / "plot.png").write_bytes(b"second")
    await link.want_files()
    await asyncio.sleep(0.4)
    assert not (bob.project.root / "figures" / "plot.png").exists(), "asked again too soon"
    link.wanted_files[file_id] -= 10.0
    await link.want_files()
    assert await until(lambda: (bob.project.root / "figures" / "plot.png").exists(), 4.0)
    assert (bob.project.root / "figures" / "plot.png").read_bytes() == b"second"

    await alice.close()
    await bob.close()
