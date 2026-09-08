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


def test_inviting_shares_the_project_if_it_was_not_already(client, opened):
    """The one-step path: a person who wants to invite somebody has already
    decided to share, and being made to press two buttons for one intention
    is a way to be told off by an interface."""
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/invite")
    assert client.get(f"/api/projects/{project_id}/collab").json()["shared"] is True


def test_joining_refuses_a_folder_with_something_in_it(client, opened, tmp_path):
    """Two documents built independently from the same text merge into both
    copies -- every line twice -- and nothing raises.  So a join lands in an
    empty folder or it does not happen."""
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    invite = client.post(f"/api/projects/{project_id}/collab/invite").json()["invite"]

    occupied = tmp_path / "already-mine"
    occupied.mkdir()
    (occupied / "main.tex").write_text("my own work\n")

    response = client.post("/api/collab/join",
                           json={"invite": invite, "path": str(occupied)})
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()
    # And nothing was touched.
    assert (occupied / "main.tex").read_text() == "my own work\n"


def test_a_join_that_fails_leaves_no_project_behind(client, opened, tmp_path):
    target = tmp_path / "never-joined"
    response = client.post("/api/collab/join",
                           json={"invite": "not an invite", "path": str(target)})
    assert response.status_code == 400
    listed = {project["path"] for project in client.get("/api/projects").json()["projects"]}
    assert str(target) not in listed


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
    # registry and `.nexttex/collab/share.json` still on disk. The sessions
    # are dropped rather than closed, because a document belongs to the
    # thread that made it and this test is not on that thread.
    server_main.SESSIONS.clear()

    asyncio.run(server_main._rejoin_shared_projects())
    assert project_id in server_main.SESSIONS
    assert server_main.SESSIONS[project_id].peers.share.shared


def test_a_private_project_is_left_alone_at_startup(client, project):
    """It contacts nothing and costs nothing, which is the whole point of
    the feature being off until you ask for it."""
    import asyncio

    server_main.SESSIONS.clear()
    asyncio.run(server_main._rejoin_shared_projects())
    assert project["id"] not in server_main.SESSIONS
