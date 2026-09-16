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


def _hashes(root) -> dict:
    import hashlib

    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*")) if path.is_file()
    }


@pytest.fixture
def copy(tmp_path):
    """A copy of the shared files made some time ago: one edited here, one
    added here, one missing here, and no `.nexttex` at all."""
    root = tmp_path / "my-clone"
    root.mkdir()
    (root / "main.tex").write_text("\\documentclass{article}\n\\begin{document}\nTheirs.\n\\end{document}\n")
    (root / "extra.tex").write_text("Only here.\n")
    (root / "notes.tex").write_text("Notes.\nAnd a line of mine.\n")
    return root


def test_a_rejoin_into_a_copy_reconciles_it(client, them, copy, tmp_path):
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))

    offer = client.post("/api/collab/rejoin",
                        json={"share": them["share"], "path": str(copy)})
    assert offer.status_code == 200, offer.text
    body = offer.json()
    assert body["existing"] is True
    outcomes = {f["path"]: f["outcome"] for f in body["files"]}
    assert outcomes == {
        "main.tex": "same",
        "notes.tex": "differs",
        "extra.tex": "new here",
    }
    # Held: the copy is untouched, and only the join's state is new.
    assert (copy / "notes.tex").read_text() == "Notes.\nAnd a line of mine.\n"

    accepted = client.post("/api/collab/join/accept", json={"token": body["token"]}).json()
    project_id = accepted["project"]["id"]
    # The document wins on disk; the local text is a labelled version.
    assert (copy / "notes.tex").read_text() == "Notes.\n"
    versions = client.get(f"/api/projects/{project_id}/history",
                          params={"path": "notes.tex"}).json()
    labels = [v.get("label") for v in versions.get("versions", versions)]
    assert "Before rejoining" in labels
    # The identical file is single-lined on both sides once the new
    # session has synced, which is the doubling test.
    import time

    store = them["store"]

    def theirs() -> dict:
        extra = store.file_id_for("extra.tex")
        return {
            "main": str(store.body(store.file_id_for("main.tex"))),
            "extra": str(store.body(extra)) if extra else None,
            "trashed": any(r.get("trashed") for r in store.files.values()),
        }

    deadline = time.monotonic() + 10
    seen = client.portal.call(theirs)
    while time.monotonic() < deadline and seen["extra"] != "Only here.\n":
        time.sleep(0.1)
        seen = client.portal.call(theirs)
    assert (copy / "main.tex").read_text().count("Theirs.") == 1
    assert seen["main"].count("Theirs.") == 1
    # The file only here reached them.
    assert seen["extra"] == "Only here.\n"
    # And nothing of theirs was called deleted by a copy that lacked it.
    assert seen["trashed"] is False


def test_discarding_a_rejoin_into_a_copy_leaves_it_byte_for_byte(client, them, copy, tmp_path):
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))
    before = _hashes(copy)
    body = client.post("/api/collab/rejoin",
                       json={"share": them["share"], "path": str(copy)}).json()
    client.post("/api/collab/join/discard", json={"token": body["token"]})
    assert _hashes(copy) == before
    assert not (copy / ".nexttex").exists()


def test_a_copy_that_was_a_project_of_its_own_keeps_its_records_aside(client, them, copy, tmp_path):
    """Its own `.nexttex/collab` has ids of its own; it is moved aside
    rather than loaded, and put back if the join is discarded."""
    own = copy / ".nexttex" / "collab" / "docs"
    own.mkdir(parents=True)
    (own / "manifest.y").write_bytes(b"old")
    (copy / ".nexttex" / "history").mkdir()
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))

    body = client.post("/api/collab/rejoin",
                       json={"share": them["share"], "path": str(copy)}).json()
    assert (copy / ".nexttex" / "collab.before-rejoin" / "docs" / "manifest.y").read_bytes() == b"old"
    client.post("/api/collab/join/discard", json={"token": body["token"]})
    assert (own / "manifest.y").read_bytes() == b"old"
    assert not (copy / ".nexttex" / "collab.before-rejoin").exists()
    assert (copy / ".nexttex" / "history").is_dir()


def test_a_file_the_others_deleted_goes_to_the_trash_here(client, them, copy, tmp_path):
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))
    # They deleted notes.tex; the copy still has it.
    store = them["store"]

    def trash_theirs():
        store.files[store.file_id_for("notes.tex")]["trashed"] = True

    client.portal.call(trash_theirs)

    body = client.post("/api/collab/rejoin",
                       json={"share": them["share"], "path": str(copy)}).json()
    outcomes = {f["path"]: f["outcome"] for f in body["files"]}
    assert outcomes["notes.tex"] == "deleted elsewhere"
    accepted = client.post("/api/collab/join/accept", json={"token": body["token"]}).json()
    assert not (copy / "notes.tex").exists()
    entries = client.get(f"/api/projects/{accepted['project']['id']}/trash").json()
    listed = entries.get("entries", entries)
    assert any("notes.tex" in json.dumps(entry) for entry in listed)
    # And it was not brought back for them: still one record, still trashed.
    records = [r for r in store.files.values() if r.get("path") == "notes.tex"]
    assert len(records) == 1 and records[0].get("trashed") is True


def test_a_whole_copy_is_opened_rather_than_offered(client, them, tmp_path):
    """The `.y` logs are the sync state: a copy carrying them reconnects
    with nothing to reconcile."""
    import shutil

    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))
    whole = tmp_path / "whole"
    shutil.copytree(them["root"], whole)
    answer = client.post("/api/collab/rejoin",
                         json={"share": them["share"], "path": str(whole)}).json()
    assert answer.get("opened") is True
    project_id = answer["project"]["id"]
    assert client.get(f"/api/projects/{project_id}/collab").json()["shared"] is True


def test_a_copy_of_another_share_is_refused(client, them, tmp_path):
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))
    other = tmp_path / "other"
    (other / ".nexttex" / "collab" / "docs").mkdir(parents=True)
    (other / ".nexttex" / "collab" / "share.json").write_text(json.dumps({
        "share_id": "ab" * 16, "members": {}, "invites": {}, "joined_at": 1.0,
    }))
    (other / "main.tex").write_text("x")
    answer = client.post("/api/collab/rejoin",
                         json={"share": them["share"], "path": str(other)})
    assert answer.status_code == 409


# --- a git checkout ------------------------------------------------------------


def _checkout(copy, files: dict) -> None:
    """Make the copy a git checkout with `files` as its one commit."""
    import subprocess

    for name, text in files.items():
        (copy / name).write_text(text)
    env = {"PATH": "/usr/bin:/bin", "HOME": str(copy),
           "GIT_AUTHOR_NAME": "A Test", "GIT_AUTHOR_EMAIL": "t@example.invalid",
           "GIT_COMMITTER_NAME": "A Test", "GIT_COMMITTER_EMAIL": "t@example.invalid"}
    for arguments in (("init", "-q", "-b", "main"), ("add", "-A"), ("commit", "-q", "-m", "base")):
        subprocess.run(["git", *arguments], cwd=copy, check=True, capture_output=True, env=env)


def _their_text(client, them, path: str) -> str:
    store = them["store"]
    return client.portal.call(lambda: str(store.body(store.file_id_for(path))))


def test_a_checkout_with_an_uncommitted_edit_merges_it_in(client, them, tmp_path):
    """`notes.tex` was committed as the others still have it; the local
    edit since then applies cleanly to the shared text."""
    import time

    copy = tmp_path / "my-clone"
    copy.mkdir()
    _checkout(copy, {"main.tex": (them["root"] / "main.tex").read_text(),
                     "notes.tex": "Notes.\n"})
    (copy / "notes.tex").write_text("Notes.\nMine, since the clone.\n")
    # And the others moved on too, elsewhere in the file.
    store = them["store"]
    client.portal.call(lambda: store.body(store.file_id_for("notes.tex")).insert(0, "Theirs first.\n"))
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))

    body = client.post("/api/collab/rejoin",
                       json={"share": them["share"], "path": str(copy)}).json()
    outcomes = {f["path"]: f["outcome"] for f in body["files"]}
    assert outcomes == {"main.tex": "same", "notes.tex": "merged"}
    accepted = client.post("/api/collab/join/accept", json={"token": body["token"]}).json()
    assert (copy / "notes.tex").read_text() == "Theirs first.\nNotes.\nMine, since the clone.\n"
    # The merge reaches the others, and the local text is still a version.
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and "Mine, since" not in _their_text(client, them, "notes.tex"):
        time.sleep(0.1)
    assert _their_text(client, them, "notes.tex") == "Theirs first.\nNotes.\nMine, since the clone.\n"
    versions = client.get(f"/api/projects/{accepted['project']['id']}/history",
                          params={"path": "notes.tex"}).json()["versions"]
    assert "Before rejoining" in [v.get("label") for v in versions]


def test_a_checkout_with_a_conflicting_edit_keeps_the_shared_text(client, them, tmp_path):
    copy = tmp_path / "my-clone"
    copy.mkdir()
    _checkout(copy, {"main.tex": (them["root"] / "main.tex").read_text(),
                     "notes.tex": "Notes.\n"})
    (copy / "notes.tex").write_text("Notes, mine.\n")
    store = them["store"]
    client.portal.call(lambda: store.body(store.file_id_for("notes.tex")).insert(6, ", theirs"))
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))

    body = client.post("/api/collab/rejoin",
                       json={"share": them["share"], "path": str(copy)}).json()
    outcomes = {f["path"]: f["outcome"] for f in body["files"]}
    assert outcomes["notes.tex"] == "differs"
    accepted = client.post("/api/collab/join/accept", json={"token": body["token"]}).json()
    text = (copy / "notes.tex").read_text()
    assert text == "Notes., theirs\n" or text == "Notes, theirs.\n"
    assert "<<<<" not in text
    versions = client.get(f"/api/projects/{accepted['project']['id']}/history",
                          params={"path": "notes.tex"}).json()["versions"]
    assert "Before rejoining" in [v.get("label") for v in versions]


def test_a_clean_checkout_behind_the_others_records_nothing(client, them, tmp_path):
    copy = tmp_path / "my-clone"
    copy.mkdir()
    _checkout(copy, {"main.tex": (them["root"] / "main.tex").read_text(),
                     "notes.tex": "Notes.\n"})
    store = them["store"]
    client.portal.call(lambda: store.body(store.file_id_for("notes.tex")).insert(6, " More."))
    _write_card(them["share"], them["network"].share.members, str(tmp_path / "gone"))

    body = client.post("/api/collab/rejoin",
                       json={"share": them["share"], "path": str(copy)}).json()
    outcomes = {f["path"]: f["outcome"] for f in body["files"]}
    assert outcomes["notes.tex"] == "behind"
    accepted = client.post("/api/collab/join/accept", json={"token": body["token"]}).json()
    assert (copy / "notes.tex").read_text() == "Notes. More.\n"
    versions = client.get(f"/api/projects/{accepted['project']['id']}/history",
                          params={"path": "notes.tex"}).json()["versions"]
    assert "Before rejoining" not in [v.get("label") for v in versions]
