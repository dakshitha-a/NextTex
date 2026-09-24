"""The prompts routes, and a `/` in the composer reaching the model."""

from server import main as server_main

from conftest import wait_idle


def test_the_list_carries_the_built_ins_and_the_project_overrides(client, opened, project_dir):
    listed = client.get(f"/api/projects/{opened['id']}/prompts").json()["prompts"]
    assert [p["name"] for p in listed] == ["missing-citations", "review-critical", "review-friendly"]
    assert all(p["source"] == "builtin" and p["hint"] and p["said"] for p in listed)
    (project_dir / "prompts").mkdir()
    (project_dir / "prompts" / "review-friendly.md").write_text("Ours.\n", encoding="utf-8")
    listed = client.get(f"/api/projects/{opened['id']}/prompts").json()["prompts"]
    friendly = next(p for p in listed if p["name"] == "review-friendly")
    assert friendly["source"] == "project" and friendly["text"] == "Ours."


def test_a_slash_command_is_expanded_ahead_of_the_prompt_the_model_sees(client, opened):
    project_id = opened["id"]
    answer = client.post(
        f"/api/projects/{project_id}/agent/ask",
        json={"prompt": "/review critical\nSection 3 especially."},
    )
    assert answer.status_code == 200, answer.text
    wait_idle(project_id)
    agent = server_main.SESSIONS[project_id].agent
    # The transcript's line is what was typed; the context is the file.
    assert agent.asked[-1] == "/review critical\nSection 3 especially."
    assert "second reviewer" in agent.contexts[-1]
    assert agent.contexts[-1].endswith("The writer adds: Section 3 especially.")


def test_a_slash_that_names_nothing_goes_through_as_typed(client, opened):
    project_id = opened["id"]
    client.post(f"/api/projects/{project_id}/agent/ask", json={"prompt": "/frobnicate this"})
    wait_idle(project_id)
    agent = server_main.SESSIONS[project_id].agent
    assert agent.asked[-1] == "/frobnicate this" and agent.contexts[-1] == ""


def test_copying_a_built_in_puts_it_in_the_project_and_the_copy_wins(client, opened, project_dir):
    project_id = opened["id"]
    answer = client.post(f"/api/projects/{project_id}/prompts/copy", json={"name": "review-friendly"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["path"] == "prompts/review-friendly.md"
    written = (project_dir / "prompts" / "review-friendly.md").read_text(encoding="utf-8")
    assert "mentor" in written
    # A second copy is refused rather than overwriting an edited one.
    again = client.post(f"/api/projects/{project_id}/prompts/copy", json={"name": "review-friendly"})
    assert again.status_code == 409
    listed = client.get(f"/api/projects/{project_id}/prompts").json()["prompts"]
    assert next(p for p in listed if p["name"] == "review-friendly")["source"] == "project"
    # And the copy has a version, like any file saved through the app.
    history = client.get(f"/api/projects/{project_id}/history", params={"path": "prompts/review-friendly.md"})
    assert history.status_code == 200 and history.json()["versions"]


def test_a_hostile_name_is_refused(client, opened):
    for hostile in ("../x", "a/b", ".hidden", "", "x" * 80):
        answer = client.post(f"/api/projects/{opened['id']}/prompts/copy", json={"name": hostile})
        assert answer.status_code in (400, 404, 422), hostile
    answer = client.post(f"/api/projects/{opened['id']}/prompts/copy", json={"name": "nothere"})
    assert answer.status_code == 404
