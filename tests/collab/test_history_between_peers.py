"""A file's past, between machines.

What is shared is *what exists*; how much of its past each machine keeps is
its own business, because retention is a decision about a disk and disks are
local.  That principle is right and is not being changed.  What was wrong is
everything built on top of it.

A peer used to ask "what have you recorded after position N in your list", and
the list is one that thinning takes entries out of, from the middle, on every
save.  So the number and the list slid apart, silently, and the records that
fell into the gap were never sent -- while the records on either side of them
arrived normally, which is what made it invisible.

It asks "what have you recorded after this moment" now, per author, which is a
question no amount of local thinning can change the answer to.
"""

import pytest

from .conftest import Peer, join_up, settle, until
from server.collab import transport, wire
from server.collab.peers import HISTORY_NUDGE_SECONDS


def texts(peer: Peer, relative: str = "main.tex") -> set[str]:
    """What a peer can actually name of a file's past."""
    return {version.sha for version in peer.versions(relative)}


@pytest.mark.asyncio
async def test_thinning_does_not_strand_what_comes_after_it(tmp_path):
    """The one this whole phase exists for.

    A hundred versions, synced.  Then thinning takes forty out of the middle
    of the author's own list, which is what the retention schedule does to
    every shared file older than a day.  Five more versions after that must
    still arrive.
    """
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)

    for index in range(100):
        alice.history.record("main.tex", f"draft {index}\n", op="create")

    await join_up(alice, bob)
    assert await until(lambda: len(bob.versions("main.tex")) >= 100), (
        f"the first hundred never arrived: {len(bob.versions('main.tex'))}"
    )

    # What thinning does, done at once: forty gone from the middle.  The
    # author's own list is now shorter than the number the other machine was
    # holding, and everything after it used to fall into that gap.
    kept = alice.versions("main.tex")
    alice.history._write_log("main.tex", kept[:20] + kept[60:])

    for index in range(5):
        alice.history.record("main.tex", f"after the thinning {index}\n", op="create")
    wanted = {v.sha for v in alice.versions("main.tex")[-5:]}

    await transport.HUB.cut()
    assert await until(lambda: wanted <= texts(bob), 12.0), (
        f"stranded: {len(wanted - texts(bob))} of 5 never arrived"
    )

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_burst_that_coalesces_still_reaches_the_peer(tmp_path):
    """The same defect wearing different clothes.

    An editing burst is one version: `record` drops the previous line and
    puts the new one in its place.  Under the old scheme the replacement took
    the same position as the record the peer already had, so the peer kept
    the intermediate save for ever -- and the intermediate's contents are
    exactly what the author's next sweep collects.
    """
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)

    alice.history.record("main.tex", "half of a sentence\n")
    await join_up(alice, bob)
    assert await until(lambda: len(bob.versions("main.tex")) >= 1)

    alice.history.record("main.tex", "half of a sentence, and the rest\n")
    finished = alice.versions("main.tex")[-1].sha

    await transport.HUB.cut()
    assert await until(lambda: finished in texts(bob), 12.0), (
        "the burst's finished state never arrived"
    )

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_history_keeps_arriving_on_a_connection_that_stays_up(tmp_path):
    """It used to be asked for once and never again.

    So two people working together for a week watched each other type
    continuously and saw one another's versions only when somebody's laptop
    closed and the link was rebuilt.
    """
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)

    await join_up(alice, bob)
    await settle()

    alice.history.record("main.tex", "written long after we connected\n", op="create")
    wanted = alice.versions("main.tex")[-1].sha

    assert await until(lambda: wanted in texts(bob), 10.0), (
        "nothing arrived without the link being rebuilt"
    )

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_peer_who_was_never_online_with_the_author_gets_their_past(tmp_path):
    """Relaying, and why it is worth having.

    Collaborators in different time zones are rarely at their desks at the
    same moment.  Offering only our own records means two of them who each
    only ever meet a third never exchange a single version, however long the
    project runs.
    """
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)

    alice.history.record("main.tex", "Alice wrote this.\n", op="create", who="Alice")
    wanted = alice.versions("main.tex")[0].sha

    await join_up(alice, bob)
    assert await until(lambda: wanted in texts(bob))

    # Alice shuts her laptop before Carol ever opens hers.
    await alice.close()

    carol = Peer(tmp_path / "carol", {"main.tex": ""}).be("c" * 64)
    assert await carol.network.join(bob.network.invite(), "Carol") == ""

    assert await until(lambda: wanted in texts(carol), 10.0), (
        "Alice's version never reached Carol through Bob"
    )
    relayed = next(v for v in carol.versions("main.tex") if v.sha == wanted)
    # Attributed to whoever wrote it, not to whoever passed it on.  Stamping
    # a relayed line with the relay's own id is the one mistake that would
    # key the whole scheme on the wrong author.
    assert relayed.peer == "a" * 64
    assert relayed.who == "Alice"

    await bob.close()
    await carol.close()


@pytest.mark.asyncio
async def test_a_figures_past_reaches_the_other_machine(tmp_path):
    """History used to be asked for only on text files.

    Invisible until figures were given a viewer, version viewing and a
    clear-history button of their own, all of which assume it travels.
    """
    alice = Peer(tmp_path / "alice", {
        "main.tex": "The chapter.\n", "figures/plot.png": "PNG-ish bytes",
    }).be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)

    alice.history.record("figures/plot.png", b"the first export", op="create")
    alice.history.record("figures/plot.png", b"the second export", op="replace")
    wanted = {v.sha for v in alice.versions("figures/plot.png")}
    assert len(wanted) == 2

    await join_up(alice, bob)
    assert await until(lambda: wanted <= texts(bob, "figures/plot.png"), 10.0), (
        "a figure's past did not travel"
    )

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_remote_projection_writes_no_version_of_its_own(tmp_path):
    """The one that fabricated history rather than losing it.

    Every install projects the merged document to its own disk, and that
    write recorded a version stamped with *this* install.  So a
    collaborator's paragraph entered your history under your name, and was
    then offered back to them as your work -- and nothing deduplicated it,
    because both the moment and the author differed.
    """
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)

    await join_up(alice, bob)

    file_id = alice.store.file_id_for("main.tex")
    alice.store.body(file_id).__iadd__("\nA paragraph Alice typed.\n")
    await settle(1.5)

    landed = (bob.project.root / "main.tex").read_text(encoding="utf-8")
    assert "A paragraph Alice typed." in landed, "the typing never reached Bob's disk"
    mine = [v for v in bob.versions("main.tex") if v.peer == "b" * 64]
    assert mine == [], f"Bob recorded {len(mine)} versions of Alice's typing as his own"

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_what_this_machine_types_is_still_its_own(tmp_path):
    """The other half of it: the skip must not swallow real work."""
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)

    await join_up(alice, bob)

    file_id = alice.store.file_id_for("main.tex")
    alice.store.body(file_id).__iadd__("\nAlice's own paragraph.\n")
    await settle(1.5)

    assert [v for v in alice.versions("main.tex") if v.peer == "a" * 64], (
        "Alice did not record her own typing"
    )

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_rename_reaches_the_other_machine(tmp_path):
    """A path is a property of a file, so a rename is one field changing.

    That is what keeps everybody's editor pointed at the same document.  What
    it does not do is move the file, and nothing used to: the other machine
    kept the old name with the old contents, the new name appeared only when
    somebody happened to type into that document, and then it had both.
    """
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    alice.history.record("main.tex", "the chapter as it was\n", op="create")

    await join_up(alice, bob)
    assert await until(
        lambda: (bob.project.root / "main.tex").read_text() == "The chapter.\n"
    ), "the file never reached Bob"
    assert await until(lambda: bool(bob.versions("main.tex")))

    (alice.project.root / "main.tex").rename(alice.project.root / "chapter-one.tex")
    alice.history.note_move("main.tex", "chapter-one.tex")
    alice.store.rename("main.tex", "chapter-one.tex")

    assert await until(
        lambda: (bob.project.root / "chapter-one.tex").exists(), 8.0
    ), "Bob's copy kept the old name"
    assert not (bob.project.root / "main.tex").exists(), "Bob ended up with both"
    # And the past came with it, rather than staying filed under a name
    # nothing would ever look up again.
    assert bob.versions("chapter-one.tex"), "the history stayed behind"
    assert bob.versions("main.tex") == []

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_deletion_reaches_the_other_machines_trash(tmp_path):
    """Otherwise the file is a ghost on that disk.

    In the tree, written by nothing, with no trash entry and so no way for
    the person sitting at it to put the file back.
    """
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)

    await join_up(alice, bob)
    assert await until(
        lambda: (bob.project.root / "main.tex").read_text() == "The chapter.\n"
    )

    (alice.project.root / "main.tex").unlink()
    alice.store.ingest("main.tex", None, gone=True)   # what the watcher does

    assert await until(
        lambda: not (bob.project.root / "main.tex").exists(), 8.0
    ), "Bob's copy was left sitting there, written by nothing"
    assert [e.path for e in bob.trash.entries()] == ["main.tex"], (
        "Bob has no way to put it back"
    )

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_three_of_them_in_a_ring_do_not_talk_forever(tmp_path):
    """Relaying has to stop.

    Everybody tells everybody when a file gains a past, and everybody passes
    on what they absorb, so three machines all linked to each other is the
    shape where an announcement could go round and round: Bob absorbs
    Alice's line, says so to Carol, Carol absorbs it and says so to Bob, and
    on for ever.

    Two things stop it, and this is the test that they do.  Nobody offers a
    peer that peer's own records, and a mark only ever moves forward, so the
    second time Carol asks Bob about Alice there is nothing at or below the
    moment Carol already reached.  What must be true afterwards is that each
    of them holds the line exactly once and that the frames stop coming.
    """
    alice = Peer(tmp_path / "alice").be("a" * 64)
    bob = Peer(tmp_path / "bob", {"main.tex": ""}).be("b" * 64)
    carol = Peer(tmp_path / "carol", {"main.tex": ""}).be("c" * 64)

    await join_up(alice, bob)
    assert await carol.network.join(alice.network.invite(), "Carol") == ""
    assert await carol.network.join(bob.network.invite(), "Carol") == ""
    await settle()

    announcements = []
    made = wire.hist_new

    def counted(file_id: str) -> bytes:
        announcements.append(file_id)
        return made(file_id)

    wire.hist_new = counted
    try:
        alice.history.record("main.tex", "Alice wrote this once.\n", op="create",
                             who="Alice")
        wanted = alice.versions("main.tex")[-1].sha

        assert await until(lambda: wanted in texts(bob) and wanted in texts(carol), 10.0), (
            "the line did not reach both of the others"
        )
        # Long enough for another round of the debounced nudge to have run,
        # had there been one to run.
        await settle(HISTORY_NUDGE_SECONDS * 2)
        settled = len(announcements)
        assert settled, "nothing was announced at all, so this proves nothing"
        await settle(HISTORY_NUDGE_SECONDS * 2)
        assert len(announcements) == settled, (
            f"still announcing: {len(announcements) - settled} more frames"
        )
    finally:
        wire.hist_new = made

    for peer in (alice, bob, carol):
        held = [v for v in peer.versions("main.tex") if v.sha == wanted]
        assert len(held) == 1, f"{peer.name} holds {len(held)} copies"
        assert held[0].peer in ("", "a" * 64), f"{peer.name} credits {held[0].peer}"

    await alice.close()
    await bob.close()
    await carol.close()
