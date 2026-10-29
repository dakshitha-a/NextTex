"""A project can be renamed from the projects screen and from inside it.

The name is the one in the project's `nexttex.toml`; the folder keeps its
own, so nothing outside NextTex moves."""

import shutil

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib  # type: ignore


def listed(client, project_id):
    answer = client.get("/api/projects").json()
    rows = answer["projects"] if isinstance(answer, dict) else answer
    return next(row for row in rows if row["id"] == project_id)


def test_a_rename_writes_the_name_and_leaves_the_folder(client, opened, project_dir):
    answer = client.post(f"/api/projects/{opened['id']}/name", json={"name": "  Grant renewal,\n final  "})
    assert answer.status_code == 200, answer.text
    assert answer.json()["name"] == "Grant renewal, final"
    assert project_dir.is_dir()
    written = tomllib.loads((project_dir / "nexttex.toml").read_text(encoding="utf-8"))
    assert written["project"]["name"] == "Grant renewal, final"
    assert listed(client, opened["id"])["name"] == "Grant renewal, final"
    # The open window's settings carry it, so its title follows.
    reopened = client.post(f"/api/projects/{opened['id']}/open").json()
    assert reopened["name"] == "Grant renewal, final"


def test_a_rename_keeps_the_other_settings(client, opened, project_dir):
    client.post(f"/api/projects/{opened['id']}/settings", json={"autocompile": False})
    client.post(f"/api/projects/{opened['id']}/name", json={"name": "Thesis"})
    written = tomllib.loads((project_dir / "nexttex.toml").read_text(encoding="utf-8"))
    assert written["project"]["autocompile"] is False


def test_an_empty_or_overlong_name_is_refused(client, opened, project_dir):
    before = listed(client, opened["id"])["name"]
    assert client.post(f"/api/projects/{opened['id']}/name", json={"name": " \n "}).status_code == 400
    assert client.post(f"/api/projects/{opened['id']}/name", json={"name": "x" * 81}).status_code == 400
    assert listed(client, opened["id"])["name"] == before


def test_an_unknown_project_is_not_renamed(client):
    assert client.post("/api/projects/nothing-here/name", json={"name": "A"}).status_code == 404


def test_a_project_whose_folder_is_missing_is_not_renamed(client, opened, project_dir, tmp_path):
    away = tmp_path / "moved-away"
    shutil.move(str(project_dir), away)
    try:
        answer = client.post(f"/api/projects/{opened['id']}/name", json={"name": "Elsewhere"})
        assert answer.status_code == 409
        assert not (project_dir / "nexttex.toml").exists()
    finally:
        shutil.move(str(away), project_dir)


def test_a_name_edited_in_the_file_by_hand_reaches_the_list(client, opened, project_dir):
    """The open window learned it at once through `reload_config`; the
    projects screen, which reads the registry, only once the project was
    opened again."""
    from server import main as server_main

    # As the rename route writes it, then changed in an editor.
    client.post(f"/api/projects/{opened['id']}/name", json={"name": "Before"})
    config = project_dir / "nexttex.toml"
    text = config.read_text(encoding="utf-8")
    assert 'name = "Before"' in text
    config.write_text(text.replace('name = "Before"', 'name = "Edited by hand"'), encoding="utf-8")
    client.portal.call(server_main.SESSIONS[opened["id"]].reload_config)
    listed = {p["id"]: p["name"] for p in client.get("/api/projects").json()["projects"]}
    assert listed[opened["id"]] == "Edited by hand"
