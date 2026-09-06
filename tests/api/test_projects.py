"""The project list, and what happens to it under abuse."""

import json


def test_a_project_can_be_registered_and_listed(client, project_dir):
    added = client.post("/api/projects", json={"path": str(project_dir)}).json()
    assert added["name"] == project_dir.name
    listed = client.get("/api/projects").json()["projects"]
    assert [p["path"] for p in listed] == [str(project_dir)]


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
    assert body["main"] == "main.tex"
    assert body["tree"]["children"]
    assert body["transcript"] == []


def test_opening_is_idempotent(client, project):
    first = client.post(f"/api/projects/{project['id']}/open")
    second = client.post(f"/api/projects/{project['id']}/open")
    assert first.status_code == second.status_code == 200


def test_a_name_with_a_quote_in_it_does_not_break_the_config(client, tmp_path):
    """The name is interpolated into TOML; a quote would make it unparseable
    and the project would silently forget its own main file."""
    root = tmp_path / "quoted"
    client.post("/api/projects/create",
                json={"path": str(root), "name": 'Bob"s "Thesis"'})
    import tomllib

    tomllib.loads((root / "nexttex.toml").read_text(encoding="utf-8"))
