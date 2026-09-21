"""Sharing a project, from the outside.

The peer machinery itself is tested in `tests/collab/test_two_peers.py`, on
two networks in one process.  What is here is the seam the interface uses:
that a project starts private, that sharing is something you do on purpose,
that an invite is minted rather than guessable, and that joining refuses to
merge itself into a folder that already has something in it.
"""

import json

import pytest

from server import main as server_main

from conftest import close_all_sessions, close_main_thread_sessions


def test_a_project_starts_private(client, opened):
    state = client.get(f"/api/projects/{opened['id']}/collab").json()
    assert state["shared"] is False
    assert state["members"] == []


def test_sharing_is_something_you_do_on_purpose(client, opened):
    project_id = opened["id"]
    state = client.post(f"/api/projects/{project_id}/collab/share",
                        json={"name": "Dakshitha"}).json()
    assert state["shared"] is True
    assert state["shareId"]
    assert [member["name"] for member in state["members"]] == ["Dakshitha"]


def test_sharing_twice_keeps_the_same_share(client, opened):
    project_id = opened["id"]
    first = client.post(f"/api/projects/{project_id}/collab/share",
                        json={"name": "A"}).json()["shareId"]
    second = client.post(f"/api/projects/{project_id}/collab/share",
                         json={"name": "A"}).json()["shareId"]
    assert first == second


def test_an_invite_carries_what_a_joiner_needs(client, opened):
    from server.collab.peers import INVITE_PREFIX, _unwrap

    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    invite = client.post(f"/api/projects/{project_id}/collab/invite").json()["invite"]

    # One opaque token. It is pasted into a chat window, where the JSON it
    # wraps was mangled by anything that reflows text -- and where a secret
    # printed beside the word "secret" invites reading over a shoulder.
    assert invite.startswith(INVITE_PREFIX)
    assert "{" not in invite and " " not in invite

    payload = _unwrap(invite)
    assert payload["share"]
    assert payload["secret"]
    assert "address" in payload


def test_an_invite_survives_being_pasted_badly(client, opened):
    """Wrapped by an email client, or copied with a space on the end."""
    from server.collab.peers import _unwrap

    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    invite = client.post(f"/api/projects/{project_id}/collab/invite").json()["invite"]

    middle = len(invite) // 2
    mangled = f"  {invite[:middle]}\n{invite[middle:]}  \n"
    assert _unwrap(mangled) == _unwrap(invite)


def test_two_invites_are_different(client, opened):
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    first = client.post(f"/api/projects/{project_id}/collab/invite").json()["invite"]
    second = client.post(f"/api/projects/{project_id}/collab/invite").json()["invite"]
    from server.collab.peers import _unwrap

    assert _unwrap(first)["secret"] != _unwrap(second)["secret"]


def test_only_the_hash_of_an_invite_is_kept(client, opened):
    """So somebody who reads the state directory cannot use one out of it."""
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    from server.collab.peers import _unwrap

    invite = client.post(f"/api/projects/{project_id}/collab/invite").json()["invite"]
    secret = _unwrap(invite)["secret"]

    share = server_main.SESSIONS[project_id].peers.share
    stored = share.path.read_text(encoding="utf-8")
    assert secret not in stored
    assert share.invites


def test_sharing_from_the_list_needs_no_open_editor(client, project):
    """The projects screen shares a project from its row without opening
    it: the routes open a session on demand, and the registry's last-opened
    time is untouched, so the list does not reorder."""
    from server.collab.peers import INVITE_PREFIX

    project_id = project["id"]
    before = client.get("/api/projects").json()["projects"]
    opened_at = next(p for p in before if p["id"] == project_id)["lastOpened"]
    assert next(p for p in before if p["id"] == project_id)["people"] == 0

    invite = client.post(f"/api/projects/{project_id}/collab/invite").json()["invite"]
    assert invite.startswith(INVITE_PREFIX)
    state = client.get(f"/api/projects/{project_id}/collab").json()
    assert state["shared"] is True

    after = client.get("/api/projects").json()["projects"]
    row = next(p for p in after if p["id"] == project_id)
    assert row["shared"] is True
    assert row["removed"] is False
    # Nobody has joined yet, so the row says "shared" and no more.
    assert row["people"] == 0
    assert row["lastOpened"] == opened_at


def test_the_list_counts_the_others_in_the_share(client, opened):
    """The count on the row is the others: not this install, and not
    anyone with a tombstone."""
    project_id = opened["id"]
    state = client.post(f"/api/projects/{project_id}/collab/share",
                        json={"name": "A"}).json()
    session = server_main.SESSIONS[project_id]
    session.peers.share.members["peer-b"] = {"name": "B", "joined_at": 1.0}
    session.peers.share.members["peer-c"] = {"name": "C", "joined_at": 1.0}
    session.peers.share.members["peer-d"] = {"name": "D", "joined_at": 1.0, "removed_at": 2.0}
    session.peers.share.save()
    assert state["me"] in session.peers.share.members

    row = next(p for p in client.get("/api/projects").json()["projects"]
               if p["id"] == project_id)
    assert row["people"] == 2


def test_inviting_shares_the_project_if_it_was_not_already(client, opened):
    """The one-step path: a person who wants to invite somebody has already
    decided to share, and being made to press two buttons for one intention
    is a way to be told off by an interface."""
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/invite")
    assert client.get(f"/api/projects/{project_id}/collab").json()["shared"] is True


def test_a_join_into_a_folder_with_files_leaves_them_alone_when_it_fails(client, tmp_path):
    """A join may now land in a folder that already has files, which are
    reconciled against the shared project on accept.  Whatever takes the
    join down must then remove only what the join made: every path that
    took a join down used to remove the whole folder."""
    occupied = tmp_path / "already-mine"
    occupied.mkdir()
    (occupied / "main.tex").write_text("my own work\n")
    (occupied / "figures").mkdir()
    (occupied / "figures" / "plot.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    response = client.post("/api/collab/join",
                           json={"invite": "not an invite", "path": str(occupied)})
    assert response.status_code == 400
    assert (occupied / "main.tex").read_text() == "my own work\n"
    assert (occupied / "figures" / "plot.png").read_bytes() == b"\x89PNG\r\n\x1a\n"
    assert not (occupied / ".nexttex").exists(), "the join left its state behind"


def test_a_join_that_fails_leaves_no_project_behind(client, opened, tmp_path):
    target = tmp_path / "never-joined"
    response = client.post("/api/collab/join",
                           json={"invite": "not an invite", "path": str(target)})
    assert response.status_code == 400
    listed = {project["path"] for project in client.get("/api/projects").json()["projects"]}
    assert str(target) not in listed


def test_sharing_is_announced_to_the_browser(client, opened):
    """The People drawer's heading offers an invite once the project is
    shared, from the store's record of the share, which only a
    `collab_peers` event refreshes; so sharing sends one."""
    import time
    project_id = opened["id"]
    session = server_main.SESSIONS[project_id]
    queue = session.events.subscribe()
    try:
        client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
        seen = []
        for _ in range(100):
            try:
                seen.append(queue.get_nowait())
            except Exception:
                time.sleep(0.01)
            if any(e.get("type") == "collab_peers" and e.get("shared") for e in seen if isinstance(e, dict)):
                break
        assert any(e.get("type") == "collab_peers" and e.get("shared") for e in seen if isinstance(e, dict)), seen
    finally:
        session.events.unsubscribe(queue)


def test_removing_a_member_marks_them_removed(client, opened):
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    peers = server_main.SESSIONS[project_id].peers
    peers.share.members["b" * 64] = {"name": "Bob", "at": 0}
    peers.share.save()

    state = client.delete(
        f"/api/projects/{project_id}/collab/member/{'b' * 64}"
    ).json()
    bob = next(m for m in state["members"] if m["peer"] == "b" * 64)
    assert bob["removed"] is True


def test_the_state_says_when_this_install_was_removed(client, opened):
    """Read from the tombstone in this install's own record, and naming
    whoever wrote it."""
    project_id = opened["id"]
    state = client.post(f"/api/projects/{project_id}/collab/share",
                        json={"name": "A"}).json()
    assert state["removed"] is False and state["removedBy"] == ""
    peers = server_main.SESSIONS[project_id].peers
    peers.share.members["b" * 64] = {"name": "Bob", "at": 0}
    peers.share.members[state["me"]]["removed_at"] = 1.0
    peers.share.members[state["me"]]["removed_by"] = "b" * 64
    peers.share.save()

    state = client.get(f"/api/projects/{project_id}/collab").json()
    assert state["removed"] is True
    assert state["removedBy"] == "Bob"


def test_the_state_says_whether_this_platform_can_do_it_at_all(client, opened):
    """An Intel Mac has no iroh wheel. The share card has to be able to say
    so rather than offering a button that fails."""
    state = client.get(f"/api/projects/{opened['id']}/collab").json()
    assert "available" in state


def test_a_shared_project_is_reopened_when_the_server_starts(client, opened):
    """The peer is the server, not the browser.

    That is what lets a collaborator's work arrive while your tab is shut --
    and it stopped being true across a restart, because a project is
    otherwise opened on demand by somebody looking at it. So a shared project
    went quiet until it was clicked, which is exactly the moment nobody is
    watching.
    """
    import asyncio

    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    assert server_main.SESSIONS[project_id].peers.share.shared

    # A restart, as a new process sees it: no sessions at all, and the
    # registry and `.nexttex/collab/share.json` still on disk. A document
    # belongs to the thread that made it, and the route built this one on
    # the app's loop, so it is closed there through the portal rather than
    # dropped: a store dropped by the garbage collector on whatever thread
    # runs next was the pycrdt warning the full suite carried for a while.
    close_all_sessions(client)

    asyncio.run(server_main._rejoin_shared_projects())
    assert project_id in server_main.SESSIONS
    assert server_main.SESSIONS[project_id].peers.share.shared
    # And this one was built here, on the main thread, so it is closed
    # here, before the fixture's teardown reaches for it from the app's.
    close_main_thread_sessions()


def test_a_private_project_is_left_alone_at_startup(client, project):
    """It contacts nothing and costs nothing, which is the whole point of
    the feature being off until you ask for it."""
    import asyncio

    close_all_sessions(client)
    asyncio.run(server_main._rejoin_shared_projects())
    assert project["id"] not in server_main.SESSIONS


# --- accepting an invite, in two steps --------------------------------------
#
# Accepting an invite is downloading somebody else's files, and it used to
# write all of them and register the project before anybody could look at any
# of it. The join now stops with the documents in memory and the manifest in
# hand, and the answer decides whether a byte is written.


def test_what_a_peer_offers_is_described_before_it_is_written(tmp_path):
    """The manifest a joiner is shown, built from what arrived."""
    from pycrdt import Map

    from nexttex.project import Project
    from server.collab.store import CollabStore

    root = tmp_path / "offered"
    root.mkdir()
    (root / "main.tex").write_text("x", encoding="utf-8")
    project = Project.open(root)
    store = CollabStore(project)
    for file_id, path, kind, size, trashed in [
        ("aaaaaaaaaaaaaaa1", "chapters/02.tex", "text", 2048, False),
        ("aaaaaaaaaaaaaaa2", "main.tex", "text", 4096, False),
        ("aaaaaaaaaaaaaaa3", "latexmkrc", "text", 12, False),
        ("aaaaaaaaaaaaaaa4", "gone.tex", "text", 1, True),
    ]:
        store.files[file_id] = Map({
            "path": path, "kind": kind, "size": size, "trashed": trashed,
        })

    offered = server_main._offered_files(store, project)
    store.close()

    # Sorted, so the list does not reorder itself between two people looking
    # at the same share.
    assert [f["path"] for f in offered] == [
        "chapters/02.tex", "latexmkrc", "main.tex",
    ]
    # A file already in the trash is not being offered.
    assert all(f["path"] != "gone.tex" for f in offered)
    # And what will not be written says so rather than being left out: what
    # was offered is the more interesting fact of the two.
    refused = {f["path"] for f in offered if f["refused"]}
    assert refused == {"latexmkrc"}


def test_answering_an_invite_that_is_no_longer_waiting(client):
    for route in ("/api/collab/join/accept", "/api/collab/join/discard"):
        answer = client.post(route, json={"token": "not-a-real-token"})
        assert answer.status_code == 404
        assert "no longer waiting" in answer.json()["detail"]


def test_an_invite_nobody_answers_does_not_hold_a_connection_open(client, tmp_path):
    """Each unanswered join holds a peer connection and a set of documents
    open, so it is bounded by the same reaper as everything else here."""
    import asyncio

    target = tmp_path / "never-answered"
    target.mkdir()
    (target / "arrived.tex").write_text("from somebody else", encoding="utf-8")

    closed: list[str] = []

    class Stub:
        def close(self):
            closed.append("store")

        async def close_async(self):
            closed.append("network")

    class Network:
        async def close(self):
            closed.append("network")

    pending = server_main.PendingJoin(
        token="t0", target=target, project=object(), store=Stub(),
        network=Network(),
        at=__import__("time").monotonic() - server_main.JOIN_DECISION_TIMEOUT - 1,
    )
    server_main.PENDING_JOINS["t0"] = pending

    client.portal.call(server_main._reap_once)

    assert "t0" not in server_main.PENDING_JOINS
    assert sorted(closed) == ["network", "store"]
    # And the folder it was going to be written into is gone, rather than
    # left for somebody to find and wonder about.
    assert not target.exists()


def test_leaving_makes_the_project_private_and_keeps_it(client, opened, project_dir):
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    answer = client.post(f"/api/projects/{project_id}/collab/leave", json={}).json()
    assert answer["deleted"] is False and answer["shared"] is False
    assert project_dir.is_dir() and (project_dir / "main.tex").is_file()
    assert client.get(f"/api/projects/{project_id}/collab").json()["shared"] is False
    listed = client.get("/api/projects").json()["projects"]
    row = next(p for p in listed if p["id"] == project_id)
    assert row["shared"] is False and row["missing"] is False


def test_leaving_with_delete_removes_the_copy(client, opened, project_dir):
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    answer = client.post(f"/api/projects/{project_id}/collab/leave",
                         json={"delete": True}).json()
    assert answer == {"ok": True, "deleted": True}
    assert not project_dir.exists()
    assert project_id not in server_main.SESSIONS
    assert all(p["id"] != project_id
               for p in client.get("/api/projects").json()["projects"])


def test_delete_refuses_a_folder_nexttex_has_not_worked_in(client, opened, project_dir):
    """The registry can hold any directory somebody pointed it at."""
    import shutil

    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    # Take the marker away: what is left is a folder of somebody's files.
    shutil.rmtree(project_dir / ".nexttex")
    response = client.post(f"/api/projects/{project_id}/collab/leave",
                           json={"delete": True})
    assert response.status_code == 400
    assert project_dir.is_dir() and (project_dir / "main.tex").is_file()
    # Refused before anything was left: still shared.
    assert client.get(f"/api/projects/{project_id}/collab").json()["shared"] is True


def test_leaving_an_unshared_project_is_harmless(client, opened, project_dir):
    answer = client.post(f"/api/projects/{opened['id']}/collab/leave", json={}).json()
    assert answer["deleted"] is False and answer["shared"] is False
    assert project_dir.is_dir()
