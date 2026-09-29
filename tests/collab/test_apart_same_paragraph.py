"""Two installs that wrote one paragraph apart keep both versions.

Driven the way it happens: shared over the loopback transport, the link
dropped and kept down while each side edits, then let back up so the
dialling loop rebuilds it and the opening sync carries what each wrote.
"""

import pytest

from server.collab import peers as peers_module
from server.collab import transport
from server.collab.paragraphs import TAG

from .conftest import Peer, join_up, settle, until

TEXT = "Intro.\n\nThe cat sat on the mat.\n\nEnd.\n"


@pytest.fixture(autouse=True)
def _quick(monkeypatch):
    monkeypatch.setattr(peers_module, "AGREE_EVERY", 0.2)
    monkeypatch.setattr(peers_module, "BACKOFF", [0.2])


def text_of(peer: Peer) -> str:
    return str(peer.store.body(peer.store.file_id_for("main.tex")))


def disk(peer: Peer) -> str:
    return (peer.project.root / "main.tex").read_text()


def edit(peer: Peer, old: str, new: str) -> None:
    file_id = peer.store.file_id_for("main.tex")
    current = text_of(peer)
    assert old in current, current
    peer.store.rewrite(file_id, current.replace(old, new))


async def together(tmp_path, *names):
    first = Peer(tmp_path / names[0], {"main.tex": TEXT}).be("a" * 64)
    others = [Peer(tmp_path / name, {}).be(letter * 64) for name, letter in zip(names[1:], "bcd")]
    for index, other in enumerate(others):
        if index == 0:
            await join_up(first, other)
        else:
            refused = await other.network.join(first.network.invite(), names[index + 1].title())
            assert refused == ""
            await settle()
        other.open_documents()
    everyone = [first, *others]
    assert await until(lambda: all(text_of(p) == TEXT for p in everyone))
    # Long enough for each pair to note a state they agree on.
    assert await until(lambda: all(
        p.network.agreed.index.get(q.me) for p in everyone for q in everyone if p is not q
    ), 6.0), "no pair ever noted what it agreed on"
    return everyone


async def apart():
    """Drop every link and keep them down."""
    listeners = dict(transport.HUB.listeners)
    transport.HUB.listeners.clear()
    await transport.HUB.cut()
    await settle(0.3)
    return listeners


async def back(listeners, *everyone):
    transport.HUB.listeners.update(listeners)
    assert await until(lambda: all(
        len([l for l in p.network.links.values() if l.alive]) == len(everyone) - 1
        for p in everyone
    ), 8.0), "the links never came back"
    await settle(1.0)
    for _ in range(3):
        for peer in everyone:
            peer.store.flush()
        await settle(0.3)


def tags(text: str) -> list:
    return [TAG.search(line).group(2) for line in text.splitlines() if TAG.search(line)]


@pytest.mark.asyncio
async def test_one_paragraph_edited_on_both_sides_apart_keeps_two_versions(tmp_path):
    alice, bob = await together(tmp_path, "alice", "bob")
    down = await apart()
    edit(alice, "The cat sat on the mat.", "The cat sat quietly on the mat.")
    edit(bob, "The cat sat on the mat.", "A dog lay on the rug.")
    await settle(0.3)
    await back(down, alice, bob)

    for peer in (alice, bob):
        text = text_of(peer)
        assert tags(text) == [None, "1", "2", "end"], (peer.name, text)
        assert text.count("The cat sat quietly on the mat.") == 1
        assert text.count("A dog lay on the rug.") == 1
        assert disk(peer) == text, peer.name
        assert any(line.startswith("merged main.tex 1") for line in peer.notices), peer.notices
    # What each side held before the merge is a version it can go back to.
    held = {
        alice: TEXT.replace("The cat sat on the mat.", "The cat sat quietly on the mat."),
        bob: TEXT.replace("The cat sat on the mat.", "A dog lay on the rug."),
    }
    for peer, before in held.items():
        kept = {peer.history.content("main.tex", v.sha) for v in peer.versions("main.tex")}
        assert before in kept, peer.name
    assert text_of(alice) == text_of(bob)
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_no_mixed_paragraph_reaches_either_disk(tmp_path):
    alice, bob = await together(tmp_path, "alice", "bob")
    down = await apart()
    edit(alice, "The cat sat on the mat.", "The cat sat quietly on the mat.")
    edit(bob, "The cat sat on the mat.", "A dog lay on the rug.")
    for peer in (alice, bob):
        peer.store.flush()
    seen: dict[str, list[str]] = {"alice": [], "bob": []}
    for peer, key in ((alice, "alice"), (bob, "bob")):
        original = peer.store._write

        def watching(file_id, peer=peer, key=key, original=original):
            original(file_id)
            seen[key].append(disk(peer))

        peer.store._write = watching
    await back(down, alice, bob)
    for key, texts in seen.items():
        for text in texts:
            # Every text written is one side's own or the two-version merge;
            # never the two edits spliced into one paragraph.
            spliced = "quietly" in text and "dog" in text and "nexttex-conflict" not in text
            assert not spliced, (key, text)
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_different_paragraphs_edited_apart_merge_without_markers(tmp_path):
    alice, bob = await together(tmp_path, "alice", "bob")
    down = await apart()
    edit(alice, "Intro.", "Introduction.")
    edit(bob, "End.", "The end.")
    await back(down, alice, bob)
    for peer in (alice, bob):
        assert text_of(peer) == "Introduction.\n\nThe cat sat on the mat.\n\nThe end.\n"
        assert not any(n.startswith("merged") for n in peer.notices)
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_typing_that_arrived_after_the_checkpoint_is_not_counted_twice(tmp_path):
    alice, bob = await together(tmp_path, "alice", "bob")
    # Stop noting agreement, so what Bob types next arrives at Alice after
    # the last checkpoint, the way typing just before a drop does.
    peers_module.AGREE_EVERY = 3600
    await settle(0.4)
    edit(bob, "End.", "The end.")
    assert await until(lambda: "The end." in text_of(alice))
    down = await apart()
    edit(alice, "The cat sat on the mat.", "The cat sat quietly on the mat.")
    edit(bob, "The cat sat on the mat.", "A dog lay on the rug.")
    await back(down, alice, bob)
    for peer in (alice, bob):
        text = text_of(peer)
        assert text.count("The end.") == 1, text
        assert tags(text) == [None, "1", "2", "end"], text
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_an_install_without_the_merge_is_never_the_one_to_write_it(tmp_path, monkeypatch):
    alice, bob = await together(tmp_path, "alice", "bob")
    down = await apart()
    edit(alice, "The cat sat on the mat.", "The cat sat quietly on the mat.")
    edit(bob, "The cat sat on the mat.", "A dog lay on the rug.")
    # Alice's install is older: it says nothing about the merge and does
    # not hold or resolve. Bob, the higher id, writes it all the same.
    monkeypatch.setattr(peers_module.wire, "CAN", [])
    monkeypatch.setattr(alice.network, "after_reconnect", lambda *a, **k: None)
    monkeypatch.setattr(alice.network, "note_their_state", lambda *a, **k: None)
    await back(down, alice, bob)
    for peer in (alice, bob):
        text = text_of(peer)
        assert tags(text) == [None, "1", "2", "end"], (peer.name, text)
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_three_installs_make_one_repair(tmp_path):
    alice, bob, carol = await together(tmp_path, "alice", "bob", "carol")
    down = await apart()
    edit(alice, "The cat sat on the mat.", "The cat sat quietly on the mat.")
    edit(carol, "The cat sat on the mat.", "A dog lay on the rug.")
    await back(down, alice, bob, carol)
    texts = [text_of(p) for p in (alice, bob, carol)]
    assert texts[0] == texts[1] == texts[2]
    assert tags(texts[0]) == [None, "1", "2", "end"], texts[0]
    for peer in (alice, bob, carol):
        await peer.close()


@pytest.mark.asyncio
async def test_coming_back_again_after_a_merge_does_not_merge_it_twice(tmp_path):
    alice, bob = await together(tmp_path, "alice", "bob")
    down = await apart()
    edit(alice, "The cat sat on the mat.", "The cat sat quietly on the mat.")
    edit(bob, "The cat sat on the mat.", "A dog lay on the rug.")
    await back(down, alice, bob)
    merged = text_of(alice)
    # Apart again, with nothing written, and back: the same exchange runs
    # against whatever each side noted, and must find nothing to do.
    down = await apart()
    await back(down, alice, bob)
    assert text_of(alice) == text_of(bob) == merged
    assert tags(merged) == [None, "1", "2", "end"]
    await alice.close()
    await bob.close()
