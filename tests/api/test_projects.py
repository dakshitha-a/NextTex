"""The project list, and what happens to it under abuse."""

import json
import shutil
from pathlib import Path


def test_a_project_can_be_registered_and_listed(client, project_dir):
    added = client.post("/api/projects", json={"path": str(project_dir)}).json()
    assert added["name"] == project_dir.name
    listed = client.get("/api/projects").json()["projects"]
    assert [p["path"] for p in listed] == [str(project_dir)]


def test_the_list_says_where_home_is(client):
    # The rows fold the home directory to `~`, and only the server knows
    # where that is: the page may be open on another machine entirely.
    home = client.get("/api/projects").json()["home"]
    assert home == str(Path.home())
    assert Path(home).is_absolute()


def test_registering_a_directory_that_is_not_there(client, tmp_path):
    response = client.post("/api/projects", json={"path": str(tmp_path / "nope")})
    assert response.status_code == 400
    assert "no such directory" in response.json()["detail"]


def test_a_project_can_be_removed_without_being_opened(client, project):
    assert client.delete(f"/api/projects/{project['id']}").status_code == 200
    assert client.get("/api/projects").json()["projects"] == []


def test_removing_something_that_is_not_there(client):
    assert client.delete("/api/projects/deadbeef1234").status_code == 404


def test_a_new_project_starts_blank(client, tmp_path):
    root = tmp_path / "fresh"
    created = client.post(
        "/api/projects/create", json={"path": str(root), "name": "Fresh"}
    ).json()
    assert created["name"] == "Fresh"
    body = (root / "main.tex").read_text(encoding="utf-8")
    assert "\\begin{document}" in body
    assert body.split("\\begin{document}")[1].split("\\end{document}")[0].strip() == ""


def test_creating_over_something_refuses(client, project_dir):
    response = client.post("/api/projects/create", json={"path": str(project_dir)})
    assert response.status_code == 400
    assert "already has files" in response.json()["detail"]


def test_a_registry_from_a_newer_version_does_not_take_the_app_down(client, project_dir):
    """A field this version has never heard of must not 500 the project list.

    Forward compatibility is not a nicety here: the registry is the first
    thing every screen reads, so an unknown key would mean a blank app with
    no way back."""
    from server import main as server_main

    server_main.REGISTRY.path.write_text(
        json.dumps([
            {"path": str(project_dir), "name": "Fine", "last_opened": 0.0},
            {"path": str(project_dir), "name": "Newer", "last_opened": 0.0,
             "pinned": True, "colour": "violet"},
        ]),
        encoding="utf-8",
    )
    response = client.get("/api/projects")
    assert response.status_code == 200
    assert len(response.json()["projects"]) == 2


def test_a_corrupt_registry_is_survivable(client):
    from server import main as server_main

    server_main.REGISTRY.path.write_text("{not json", encoding="utf-8")
    assert client.get("/api/projects").json()["projects"] == []


def test_opening_a_project_returns_what_the_app_needs(client, project):
    body = client.post(f"/api/projects/{project['id']}/open").json()
    assert "main" not in body
    assert body["previews"] == ["main.tex"]
    assert body["visible"] == "main.tex"
    assert body["tree"]["children"]
    assert body["transcript"] == []


def test_opening_is_idempotent(client, project):
    first = client.post(f"/api/projects/{project['id']}/open")
    second = client.post(f"/api/projects/{project['id']}/open")
    assert first.status_code == second.status_code == 200


def test_a_name_with_a_quote_in_it_does_not_break_the_config(client, tmp_path):
    """The name is interpolated into TOML; a quote would make it unparseable
    and the project would silently forget its own name and build directory."""
    root = tmp_path / "quoted"
    client.post("/api/projects/create",
                json={"path": str(root), "name": 'Bob"s "Thesis"'})
    from nexttex.project import tomllib   # tomli on 3.10, the way the app has it

    tomllib.loads((root / "nexttex.toml").read_text(encoding="utf-8"))


def test_a_project_whose_folder_has_gone_says_so_but_keeps_its_identity(
    client, project_dir
):
    """A dead entry is still an entry.

    Its id used to be null, which left the one action that still makes
    sense on it -- taking it off the list -- with nothing to address it by.
    """
    import shutil

    client.post("/api/projects", json={"path": str(project_dir)})
    shutil.rmtree(project_dir)
    listed = client.get("/api/projects").json()["projects"]
    assert len(listed) == 1
    assert listed[0]["missing"] is True
    assert listed[0]["id"]


def test_a_project_whose_folder_has_gone_can_still_be_removed(client, project_dir):
    import shutil

    added = client.post("/api/projects", json={"path": str(project_dir)}).json()
    shutil.rmtree(project_dir)
    listed = client.get("/api/projects").json()["projects"]
    response = client.delete(f"/api/projects/{listed[0]['id']}")
    assert response.status_code == 200, response.text
    assert client.get("/api/projects").json()["projects"] == []
    # The id is the same one it had while the folder was there.
    assert listed[0]["id"] == added["id"]


def test_a_moved_project_can_be_pointed_at_its_new_home(client, project_dir, tmp_path):
    """Moving a folder outside NextTex should not mean losing the entry."""
    import shutil

    added = client.post("/api/projects", json={"path": str(project_dir)}).json()
    moved = tmp_path / "elsewhere"
    shutil.move(str(project_dir), str(moved))

    listed = client.get("/api/projects").json()["projects"]
    assert listed[0]["missing"] is True

    response = client.post(
        f"/api/projects/{listed[0]['id']}/relocate", json={"path": str(moved)}
    )
    assert response.status_code == 200, response.text
    now = client.get("/api/projects").json()["projects"]
    assert len(now) == 1
    assert now[0]["path"] == str(moved)
    assert now[0]["missing"] is False
    # A project is identified by where it is, so the id follows the folder.
    assert now[0]["id"] != added["id"]
    assert client.post(f"/api/projects/{now[0]['id']}/open").status_code == 200


def test_pointing_a_project_at_nothing_says_so_and_changes_nothing(
    client, project_dir, tmp_path
):
    listed = client.post(
        "/api/projects", json={"path": str(project_dir)}
    ).json()
    response = client.post(
        f"/api/projects/{listed['id']}/relocate",
        json={"path": str(tmp_path / "nowhere")},
    )
    assert response.status_code == 400
    still = client.get("/api/projects").json()["projects"]
    assert [p["path"] for p in still] == [str(project_dir)]


def test_two_projects_cannot_be_pointed_at_one_folder(client, project_dir, tmp_path):
    """Two entries at one path would share an id, and one would shadow the other."""
    other = tmp_path / "second"
    other.mkdir()
    (other / "main.tex").write_text("\\documentclass{article}", encoding="utf-8")
    first = client.post("/api/projects", json={"path": str(project_dir)}).json()
    client.post("/api/projects", json={"path": str(other)})

    response = client.post(
        f"/api/projects/{first['id']}/relocate", json={"path": str(other)}
    )
    assert response.status_code == 409
    assert len(client.get("/api/projects").json()["projects"]) == 2


def test_relocating_something_that_is_not_registered(client, project_dir):
    response = client.post(
        "/api/projects/deadbeef1234/relocate", json={"path": str(project_dir)}
    )
    assert response.status_code == 404


def test_a_relocated_project_keeps_its_place_in_the_list(client, project_dir, tmp_path):
    """The folder moved; the project did not become a new one."""
    import shutil

    newer = tmp_path / "newer"
    newer.mkdir()
    (newer / "main.tex").write_text("\\documentclass{article}", encoding="utf-8")

    old = client.post("/api/projects", json={"path": str(project_dir)}).json()
    client.post("/api/projects", json={"path": str(newer)})   # opened later
    moved = tmp_path / "elsewhere"
    shutil.move(str(project_dir), str(moved))

    client.post(f"/api/projects/{old['id']}/relocate", json={"path": str(moved)})
    listed = client.get("/api/projects").json()["projects"]
    # Still second: the list is ordered by when each was last worked on, and
    # being moved on disk is not working on it.
    assert [p["path"] for p in listed] == [str(newer), str(moved)]


def test_relocating_a_shared_project_reopens_it(client, opened, project_dir, tmp_path):
    """So its peers reconnect to it at its new home now, rather than at
    the next open or the next server start."""
    import shutil

    from server import main as server_main

    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/collab/share", json={"name": "A"})
    session = server_main.SESSIONS[project_id]
    client.portal.call(server_main._close_session, project_id, session)

    moved = tmp_path / "moved-here"
    shutil.move(str(project_dir), str(moved))
    answer = client.post(f"/api/projects/{project_id}/relocate", json={"path": str(moved)})
    assert answer.status_code == 200, answer.text
    new_id = answer.json()["id"]
    assert new_id in server_main.SESSIONS
    state = client.get(f"/api/projects/{new_id}/collab").json()
    assert state["shared"] is True and state["member"] is True


def test_relocating_a_private_project_leaves_it_closed(client, project, project_dir, tmp_path):
    import shutil

    from server import main as server_main

    moved = tmp_path / "moved-here"
    shutil.move(str(project_dir), str(moved))
    answer = client.post(f"/api/projects/{project['id']}/relocate", json={"path": str(moved)})
    assert answer.status_code == 200
    assert answer.json()["id"] not in server_main.SESSIONS


def test_the_list_says_which_projects_a_browser_is_holding_open(client, opened):
    """`open` names every project with a session, and a session outlives
    the window that opened it by up to the idle timeout, so it is nearly
    always the project just left with Back. `watched` is the ids a browser
    is holding the event stream of right now, which is what a row means by
    "open in another window"."""
    from server import main as server_main

    session = server_main.SESSIONS[opened["id"]]
    listed = client.get("/api/projects").json()
    assert opened["id"] in listed["open"]
    assert opened["id"] not in listed["watched"]

    queue = session.events.subscribe()
    try:
        assert opened["id"] in client.get("/api/projects").json()["watched"]
    finally:
        session.events.unsubscribe(queue)
    assert opened["id"] not in client.get("/api/projects").json()["watched"]


# ---------------------------------------------------------------------------
# Archived and trashed: two reversible states in front of "remove".


def row_of(client, project_id):
    return next(p for p in client.get("/api/projects").json()["projects"]
                if p["id"] == project_id)


def test_the_three_states_round_trip_through_the_list(client, project):
    """A registered project is active, archived or trashed, and the list
    says which; a state is set through one route and nothing on disk but
    the registry moves."""
    from server import main as server_main

    project_id = project["id"]
    assert row_of(client, project_id)["state"] == "active"
    assert row_of(client, project_id)["stateAt"] == 0.0

    for state in ("archived", "trashed", "active"):
        answer = client.post(f"/api/projects/{project_id}/state", json={"state": state})
        assert answer.status_code == 200, answer.text
        assert answer.json() == {"ok": True, "state": state}
        row = row_of(client, project_id)
        assert row["state"] == state
        assert row["stateAt"] > 0
    # The folder was never touched, and the entry is still one entry.
    assert (server_main.REGISTRY.path_for(project_id) / "main.tex").is_file()
    assert len(client.get("/api/projects").json()["projects"]) == 1


def test_a_state_that_is_not_one_of_the_three_is_refused(client, project):
    answer = client.post(f"/api/projects/{project['id']}/state", json={"state": "pinned"})
    assert answer.status_code == 400
    assert row_of(client, project["id"])["state"] == "active"


def test_a_state_for_an_unknown_project_is_a_404(client):
    answer = client.post("/api/projects/nope/state", json={"state": "archived"})
    assert answer.status_code == 404


def test_a_registry_written_before_the_states_reads_as_active(client, project_dir):
    from server import main as server_main

    server_main.REGISTRY.path.write_text(
        json.dumps([{"path": str(project_dir), "name": "Old", "last_opened": 0.0}]),
        encoding="utf-8",
    )
    rows = client.get("/api/projects").json()["projects"]
    assert [row["state"] for row in rows] == ["active"]
    assert rows[0]["stateAt"] == 0.0


def test_opening_an_archived_project_makes_it_active(client, project):
    """Opening is the one rule and the way back: an archived project that
    turns out to be live is active again the moment it is opened."""
    project_id = project["id"]
    client.post(f"/api/projects/{project_id}/state", json={"state": "archived"})
    assert row_of(client, project_id)["state"] == "archived"
    assert client.post(f"/api/projects/{project_id}/open").status_code == 200
    assert row_of(client, project_id)["state"] == "active"


def test_trashing_closes_a_live_session(client, opened):
    from server import main as server_main

    project_id = opened["id"]
    assert project_id in server_main.SESSIONS
    answer = client.post(f"/api/projects/{project_id}/state", json={"state": "trashed"})
    assert answer.status_code == 200
    assert project_id not in server_main.SESSIONS
    assert project_id not in client.get("/api/projects").json()["open"]
    # Archiving does not: a window may still be holding it.
    client.post(f"/api/projects/{project_id}/open")
    client.post(f"/api/projects/{project_id}/state", json={"state": "archived"})
    assert project_id in server_main.SESSIONS


def test_deleting_a_trashed_project_forgets_it_and_leaves_the_folder(client, project, project_dir):
    """"Delete" in the trash is what "Remove" was: the entry goes, the files
    stay where they are."""
    project_id = project["id"]
    client.post(f"/api/projects/{project_id}/state", json={"state": "trashed"})
    assert client.delete(f"/api/projects/{project_id}").status_code == 200
    assert client.get("/api/projects").json()["projects"] == []
    assert (project_dir / "main.tex").is_file()


def test_a_relocated_project_keeps_its_state(client, project_dir, tmp_path):
    """The folder moved; the project did not leave the archive."""
    project_id = client.post("/api/projects", json={"path": str(project_dir)}).json()["id"]
    client.post(f"/api/projects/{project_id}/state", json={"state": "archived"})
    moved = tmp_path / "moved"
    shutil.move(str(project_dir), str(moved))
    answer = client.post(f"/api/projects/{project_id}/relocate", json={"path": str(moved)})
    assert answer.status_code == 200, answer.text
    rows = client.get("/api/projects").json()["projects"]
    assert [row["state"] for row in rows] == ["archived"]
