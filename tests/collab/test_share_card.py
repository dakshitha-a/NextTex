"""The share card: what the install keeps about a share, outside the project.

`share.json` lives inside the project, and so did everything the install
knew about whom it was sharing with.  Once the folder was gone, so was the
share id and every address, and the only way back in was a fresh invite
from somebody else.  The card is the same record, minus the invites, kept
in the install's own state directory by share id.
"""

from __future__ import annotations

import json

import pytest

from nexttex.paths import shares_home
from server.collab.peers import Share, _wrap

from .conftest import Peer, join_up, until

A, B = "a" * 64, "b" * 64


def _card(share_id: str) -> dict:
    return json.loads((shares_home() / f"{share_id}.json").read_text(encoding="utf-8"))


@pytest.mark.asyncio
async def test_sharing_writes_a_card_outside_the_project(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    alice.network.begin_sharing("Alice")
    share_id = alice.network.share.share_id

    card = _card(share_id)
    assert card["share_id"] == share_id
    assert card["path"] == str(alice.project.root)
    assert card["members"][A]["name"] == "Alice"
    assert "invites" not in card
    # And an invite, which writes the share record, still keeps its hash
    # out of the card.
    alice.network.invite()
    assert alice.network.share.invites
    assert "invites" not in _card(share_id)
    await alice.close()


@pytest.mark.asyncio
async def test_a_joiner_gets_a_card_too_and_a_removal_reaches_it(tmp_path):
    alice = Peer(tmp_path / "alice").be(A)
    bob = Peer(tmp_path / "bob", {}).be(B)
    await join_up(alice, bob)
    share_id = alice.network.share.share_id
    assert await until(lambda: B in _card(share_id)["members"])
    bob_card = shares_home() / f"{share_id}.json"
    assert bob_card.is_file()
    # One install, one card per share: Alice's and Bob's are the same file
    # in these tests, so the last save wins, and either way it names both.
    assert set(_card(share_id)["members"]) >= {A, B}

    alice.network.remove(B)
    assert await until(lambda: bob.network.removed)
    assert _card(share_id)["members"][B].get("removed_at")
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_an_invite_naming_a_share_that_is_not_one_is_refused(tmp_path):
    """The share id names a file in the state directory from here on."""
    bob = Peer(tmp_path / "bob", {}).be(B)
    for share_id in ("../../peer.key", "x" * 40, "", "ABCDEF0123456789"):
        invite = _wrap({
            "v": 1, "share": share_id, "address": A, "secret": "s",
        })
        refused = await bob.network.join(invite, "Bob")
        assert refused == "That does not look like an invite.", share_id
    assert not list(shares_home().glob("*peer.key*"))
    assert bob.network.share.share_id == ""
    await bob.close()


def test_a_share_without_a_card_directory_writes_none(tmp_path):
    share = Share(tmp_path / "collab")
    share.share_id = "ab" * 16
    share.save()
    assert share.card_path is None
    assert (tmp_path / "collab" / "share.json").is_file()


def test_a_card_is_dropped_on_request(tmp_path):
    share = Share(tmp_path / "collab", card_dir=tmp_path / "cards",
                  project_root=tmp_path / "paper")
    share.share_id = "cd" * 16
    share.save()
    assert share.card_path is not None and share.card_path.is_file()
    share.drop_card()
    assert not share.card_path.exists()
