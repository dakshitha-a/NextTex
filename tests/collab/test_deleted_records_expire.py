"""A deleted record expires only once every member has seen the deletion.

A tombstone is what tells a member who was away that a file went. Dropped
before they saw it, their NextTex would find the file on their disk with
no record and adopt it again. So a record goes only after every other
member's manifest state has covered the deletion, and a grace period
after that; see `server/collab/forgetting.py`.
"""

import pytest

from server.collab import transport
from server.collab.forgetting import GRACE, decide

from .conftest import Peer, join_up, settle, until

DAY = 24 * 3600.0


def test_nothing_expires_until_every_member_has_acknowledged():
    drop, seen, cleared = decide({"f"}, {"bob", "carol"}, {}, {}, {"bob": 5.0}, now=10.0)
    assert drop == [] and seen == {"f": 10.0} and cleared == {}
    # Bob acknowledged after the deletion was seen; Carol never has.
    drop, seen, cleared = decide({"f"}, {"bob", "carol"}, seen, cleared, {"bob": 11.0}, now=10.0 + 90 * DAY)
    assert drop == [] and cleared == {}


def test_the_grace_period_runs_from_the_last_acknowledgment():
    drop, seen, cleared = decide({"f"}, {"bob"}, {"f": 10.0}, {}, {"bob": 20.0}, now=30.0)
    assert drop == [] and cleared == {"f": 30.0}
    drop, seen, cleared = decide({"f"}, {"bob"}, seen, cleared, {"bob": 20.0}, now=30.0 + GRACE - 1)
    assert drop == []
    drop, seen, cleared = decide({"f"}, {"bob"}, seen, cleared, {"bob": 20.0}, now=30.0 + GRACE)
    assert drop == ["f"] and seen == {} and cleared == {}


def test_an_acknowledgment_from_before_the_deletion_does_not_count():
    drop, seen, cleared = decide({"f"}, {"bob"}, {"f": 50.0}, {}, {"bob": 40.0}, now=60.0 + GRACE)
    assert drop == [] and cleared == {}


def test_a_restored_record_loses_its_clock():
    drop, seen, cleared = decide(set(), {"bob"}, {"f": 1.0}, {"f": 2.0}, {"bob": 3.0}, now=4.0)
    assert drop == [] and seen == {} and cleared == {}


def test_a_project_nobody_else_holds_needs_no_acknowledgment():
    drop, seen, cleared = decide({"f"}, set(), {}, {}, {}, now=0.0)
    assert cleared == {"f": 0.0}
    drop, *_ = decide({"f"}, set(), seen, cleared, {}, now=GRACE)
    assert drop == ["f"]


async def acknowledge(*peers: Peer) -> None:
    """Each peer offers its manifest state, as a link does every ACK_EVERY."""
    for peer in peers:
        peer.network._offer_manifest_state()
    await settle()


def members_of(peer: Peer) -> set[str]:
    return {p for p in peer.network.share.members if p != peer.network.peer_id}


@pytest.mark.asyncio
async def test_a_member_away_keeps_the_record_until_they_have_seen_it_go(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "Kept.\n", "draft.tex": "Going.\n"}).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: (bob.project.root / "draft.tex").exists())
    draft = alice.store.file_id_for("draft.tex")

    await transport.HUB.sever()
    (alice.project.root / "draft.tex").unlink()
    assert alice.store.note_gone("draft.tex")
    # Seen now, and Bob, away, has not acknowledged anything since.
    assert alice.store.expire_deleted(members_of(alice)) == 0
    assert alice.store.expire_deleted(members_of(alice), now=10**12, grace=0) == 0
    assert draft in alice.store.files
    assert (bob.project.root / "draft.tex").exists(), "Bob still holds it while away"

    await transport.HUB.heal()
    for _ in range(3):
        alice.store.flush()
        bob.store.flush()
        await settle(0.3)
    assert not (bob.project.root / "draft.tex").exists(), "the deletion reached Bob's disk"
    await acknowledge(bob)
    assert alice.store.expire_deleted(members_of(alice), grace=0) == 1

    assert await until(lambda: draft not in bob.store.files)
    bob.store.adopt()
    bob.store.flush()
    await settle()
    assert not (bob.project.root / "draft.tex").exists()
    assert bob.store.file_id_for("draft.tex") is None, "nothing came back"
    assert (bob.project.root / "main.tex").read_text() == "Kept.\n"
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_a_file_restored_offline_after_acknowledging_survives_the_expiry(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "Kept.\n", "draft.tex": "Going.\n"}).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: (bob.project.root / "draft.tex").exists())
    draft = alice.store.file_id_for("draft.tex")
    (alice.project.root / "draft.tex").unlink()
    assert alice.store.note_gone("draft.tex")
    alice.store.expire_deleted(members_of(alice))
    assert await until(lambda: bob.store.files.get(draft, {}).get("trashed"))
    bob.store.flush()
    await settle()
    await acknowledge(bob)

    await transport.HUB.sever()
    (bob.project.root / "draft.tex").write_text("Bob wanted it back.\n")
    bob.store.untrash("draft.tex", "draft.tex", "Bob wanted it back.\n", draft)
    assert alice.store.expire_deleted(members_of(alice), grace=0) == 1

    await transport.HUB.heal()
    for _ in range(4):
        alice.store.flush()
        bob.store.adopt()
        bob.store.flush()
        await settle(0.3)
    assert (bob.project.root / "draft.tex").read_text() == "Bob wanted it back.\n"
    assert bob.store.file_id_for("draft.tex") is not None
    assert await until(lambda: alice.store.file_id_for("draft.tex") is not None), (
        "Bob's restored file never reached Alice"
    )
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_one_member_who_never_acknowledges_holds_the_record(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "Kept.\n", "draft.tex": "Going.\n"}).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    draft = alice.store.file_id_for("draft.tex")
    alice.network.share.members["c" * 64] = {"name": "Carol", "added_by": alice.network.peer_id}
    (alice.project.root / "draft.tex").unlink()
    assert alice.store.note_gone("draft.tex")
    alice.store.expire_deleted(members_of(alice))
    assert await until(lambda: bob.store.files.get(draft, {}).get("trashed"))
    await acknowledge(bob)

    assert alice.store.expire_deleted(members_of(alice), now=10**12, grace=0) == 0
    assert draft in alice.store.files
    await bob.close()
    await alice.close()
