"""The Claude session behind a project, through its routes.

The scripted stand-in plays what the real agent reads off the CLI: how full
the conversation is, the plan's limits, a compaction and a refused call.
The real agent's own reading of the CLI is in `tests/test_agent_session.py`.
"""

from conftest import use_script, wait_idle

from server import main as server_main


def transcript(client, project_id):
    return client.post(f"/api/projects/{project_id}/open").json()["transcript"]


def session(client, project_id):
    response = client.get(f"/api/projects/{project_id}/agent/session")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_session_is_named_after_its_folder_until_it_is_renamed(client, opened):
    view = session(client, opened["id"])
    assert view["available"] is True
    assert view["name"] == ""
    assert view["sessionName"] == view["folderName"]
    response = client.post(f"/api/projects/{opened['id']}/agent/session",
                           json={"name": "  thesis   ch3 "})
    assert response.status_code == 200
    assert response.json()["name"] == "thesis ch3"
    assert session(client, opened["id"])["name"] == "thesis ch3"
    assert session(client, opened["id"])["sessionName"] == f"{view['folderName']}: thesis ch3"


def test_remote_control_is_kept_with_the_project_on_this_computer(client, opened):
    response = client.post(f"/api/projects/{opened['id']}/agent/session",
                           json={"remote": True})
    assert response.json()["remote"]["enabled"] is True
    assert response.json()["remote"]["state"] == "connected"
    state_dir = server_main.SESSIONS[opened["id"]].project.state_dir
    saved = (state_dir / "session-settings.json").read_text()
    assert '"remote": true' in saved
    # Never in the file that travels with the project.
    toml = server_main.SESSIONS[opened["id"]].project.root / "nexttex.toml"
    assert not toml.exists() or "remote" not in toml.read_text()
    off = client.post(f"/api/projects/{opened['id']}/agent/session", json={"remote": False})
    assert off.json()["remote"] == {"enabled": False, "state": "off", "url": ""}


def test_a_name_too_long_is_refused(client, opened):
    response = client.post(f"/api/projects/{opened['id']}/agent/session",
                           json={"name": "x" * 300})
    assert response.status_code == 400


def test_the_compaction_point_is_an_install_setting_in_range(client):
    assert client.post("/api/agent/compact", json={"percent": 50}).json() == {"compactPercent": 50}
    assert server_main.SETTINGS.compact_percent == 50
    for bad in (5, 99, True):
        assert client.post("/api/agent/compact", json={"percent": bad}).status_code in (400, 422)
    client.post("/api/agent/compact", json={"percent": 60})


def test_a_turn_reports_context_limits_and_a_compaction(client, opened):
    use_script(opened["id"], "session")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "Fits, please."})
    wait_idle(opened["id"])
    view = session(client, opened["id"])
    assert view["context"]["percentage"] == 14
    assert [entry["type"] for entry in view["limits"]] == ["five_hour", "seven_day"]
    items = transcript(client, opened["id"])
    compacted = [item for item in items if item.get("kind") == "compacted"]
    assert len(compacted) == 1
    assert compacted[0]["beforePercent"] == 61
    assert compacted[0]["afterPercent"] == 14


def test_a_refused_call_is_kept_in_the_transcript(client, opened):
    use_script(opened["id"], "session-remote")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "Edit it."})
    wait_idle(opened["id"])
    refused = [item for item in transcript(client, opened["id"]) if item.get("kind") == "refused"]
    assert refused and refused[0]["headline"] == "Run a shell command"
