"""What a browser tab finds after the server has been restarted.

The rule this defends: "open" is something the user does to a window, not a
precondition the server keeps.  While it was one, restarting NextTex made
every route a tab was using 404 -- including its event stream, which then
retried a 404 every two seconds forever with nothing on screen saying so.
"""

from conftest import server_main


def restart(project_id: str) -> None:
    """What survives a restart is the registry on disk, and nothing else."""
    session = server_main.SESSIONS.pop(project_id, None)
    if session is not None:
        session.events._subscribers.clear()


def test_the_tree_still_answers_after_a_restart(client, opened):
    restart(opened["id"])
    response = client.get(f"/api/projects/{opened['id']}/tree")
    assert response.status_code == 200
    assert response.json()["name"]


def test_reading_a_file_still_answers_after_a_restart(client, opened):
    restart(opened["id"])
    response = client.get(
        f"/api/projects/{opened['id']}/file", params={"path": "main.tex"}
    )
    assert response.status_code == 200


def test_a_session_route_puts_the_project_back_in_service(client, opened):
    """This is what killed the tab: the event stream calls `session_for`, so
    while that 404'd for a closed project the EventSource retried a 404
    every two seconds forever with nothing on screen saying so."""
    restart(opened["id"])
    assert server_main.SESSIONS.get(opened["id"]) is None
    assert client.get(f"/api/projects/{opened['id']}/tree").status_code == 200
    assert server_main.SESSIONS.get(opened["id"]) is not None


def test_the_event_stream_opens_a_project_like_every_other_route():
    """It is one line away from being the exception again."""
    import inspect

    source = inspect.getsource(server_main.events)
    assert "session_for(" in source


def test_the_history_of_a_file_survives_a_restart(client, opened, project_dir):
    client.put(f"/api/projects/{opened['id']}/file",
               json={"path": "main.tex", "text": "before the restart",
                     "compile": False})
    restart(opened["id"])
    versions = client.get(f"/api/projects/{opened['id']}/history",
                          params={"path": "main.tex"}).json()["versions"]
    assert versions


def test_an_unknown_project_is_still_a_404(client):
    assert client.get("/api/projects/deadbeefcafe/tree").status_code == 404


def test_opening_on_demand_does_not_count_as_opening_it(client, project):
    """Only the user opening a project moves it to the top of the list."""
    before = [p for p in client.get("/api/projects").json()["projects"]
              if p["id"] == project["id"]][0]["lastOpened"]
    client.get(f"/api/projects/{project['id']}/tree")
    after = [p for p in client.get("/api/projects").json()["projects"]
             if p["id"] == project["id"]][0]["lastOpened"]
    assert after == before
