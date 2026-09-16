"""Getting back into a share from the card, with no invite.

For the install whose project folder is gone: the card in the state
directory says which share it was and whom to dial, and every member's
gate admits a member's key on its own.  The other member lives on the
server's own loop here, under a different identity, the way the collab
tests build a second peer.
"""

import json
import shutil

import pytest

from nexttex.paths import shares_home
from server import main as server_main
from server.collab import identity

THEM = "f" * 64


@pytest.fixture
def them(client, tmp_path):
    """Somebody else's copy of a shared project, with us as a member."""
    from nexttex.project import Project
    from server.collab.peers import PeerNetwork
    from server.collab.store import CollabStore

    root = tmp_path / "theirs"
    root.mkdir()
    (root / "main.tex").write_text("\\documentclass{article}\n\\begin{document}\nTheirs.\n\\end{document}\n")
    (root / "notes.tex").write_text("Notes.\n")
    me = identity.peer_id()

    async def start():
        store = CollabStore(Project.open(root))
        store.adopt()
        network = PeerNetwork(store)
        network._me = THEM
        # Their card would be this install's card too, since the tests share
        # one state directory; keep theirs out of it.
        network.share.card_dir = None
        network.begin_sharing("Them")
        network.share.members[me] = {"name": "Me", "added_by": THEM, "at": 1.0}
        network.share.save()
        network._write_member(me, "Me")
        await network.start()
        for file_id, record in store.files.items():
            if record.get("kind") == "text":
                store.body(file_id)
        return store, network

    store, network = client.portal.call(start)

    async def stop():
        await network.close()
        store.close()

    yield {"root": root, "store": store, "network": network, "me": me,
           "share": network.share.share_id}
    client.portal.call(stop)


def _write_card(share: str, members: dict, path: str) -> None:
    home = shares_home()
    home.mkdir(parents=True, exist_ok=True)
    (home / f"{share}.json").write_text(json.dumps({
        "share_id": share, "members": members, "joined_at": 1.0, "path": path,
    }))


def test_a_rejoin_brings_the_project_and_needs_no_invite(client, them, tmp_path):
    old = tmp_path / "mine-that-went"
    _write_card(them["share"], them["network"].share.members, str(old))
    mine = tmp_path / "mine-again"

    offer = client.post("/api/collab/rejoin",
                        json={"share": them["share"], "path": str(mine)})
    assert offer.status_code == 200, offer.text
    body = offer.json()
    assert sorted(f["path"] for f in body["files"]) == ["main.tex", "notes.tex"]
    # Held, not written.
    assert not (mine / "main.tex").exists()

    accepted = client.post("/api/collab/join/accept", json={"token": body["token"]}).json()
    assert accepted["ok"] is True
    assert (mine / "main.tex").read_text().endswith("Theirs.\n\\end{document}\n")
    assert (mine / "notes.tex").read_text() == "Notes.\n"
    # A project of ours again, in the share, and the card now points here.
    project_id = accepted["project"]["id"]
    state = client.get(f"/api/projects/{project_id}/collab").json()
    assert state["shared"] is True and state["member"] is True
    assert state["shareId"] == them["share"]
    card = json.loads((shares_home() / f"{them['share']}.json").read_text())
    assert card["path"] == str(mine.resolve())


def test_a_rejoin_takes_the_missing_entrys_place(client, them, tmp_path):
    old = tmp_path / "mine-that-went"
    old.mkdir()
    (old / "main.tex").write_text("x")
    listed = client.post("/api/projects", json={"path": str(old)}).json()
    shutil.rmtree(old)
    _write_card(them["share"], them["network"].share.members, str(old.resolve()))
    mine = tmp_path / "mine-again"

    body = client.post("/api/collab/rejoin",
                       json={"share": them["share"], "path": str(mine)}).json()
    client.post("/api/collab/join/accept", json={"token": body["token"]})

    rows = client.get("/api/projects").json()["projects"]
    assert all(row["id"] != listed["id"] for row in rows), "the dead entry stayed"
    ours = [row for row in rows if row["path"] == str(mine.resolve())]
    assert len(ours) == 1 and ours[0]["missing"] is False and ours[0]["shared"] is True


def test_discarding_a_rejoin_leaves_the_card_as_it_was(client, them, tmp_path):
    old = tmp_path / "mine-that-went"
    _write_card(them["share"], them["network"].share.members, str(old))
    mine = tmp_path / "mine-again"
    body = client.post("/api/collab/rejoin",
                       json={"share": them["share"], "path": str(mine)}).json()
    client.post("/api/collab/join/discard", json={"token": body["token"]})
    assert not mine.exists()
    card = json.loads((shares_home() / f"{them['share']}.json").read_text())
    assert card["path"] == str(old)


def test_a_share_this_install_does_not_know_is_refused(client, tmp_path):
    for share in ("ab" * 16, "../peer.key", "not-a-share", ""):
        answer = client.post("/api/collab/rejoin",
                             json={"share": share, "path": str(tmp_path / "x")})
        assert answer.status_code == 404, share
        assert not (tmp_path / "x").exists()


def test_a_removed_install_is_told_to_ask_for_an_invite(client, them, tmp_path):
    members = dict(them["network"].share.members)
    members[them["me"]] = {**members[them["me"]], "removed_at": 2.0, "removed_by": THEM}
    _write_card(them["share"], members, str(tmp_path / "gone"))
    answer = client.post("/api/collab/rejoin",
                         json={"share": them["share"], "path": str(tmp_path / "x")})
    assert answer.status_code == 400
    assert "new invite" in answer.json()["detail"]
    assert not (tmp_path / "x").exists()


def test_a_rejoin_needs_an_empty_folder_too(client, them, tmp_path):
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))
    full = tmp_path / "full"
    full.mkdir()
    (full / "main.tex").write_text("mine")
    answer = client.post("/api/collab/rejoin",
                         json={"share": them["share"], "path": str(full)})
    assert answer.status_code == 400
    assert (full / "main.tex").read_text() == "mine"
