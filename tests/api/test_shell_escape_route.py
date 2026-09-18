"""The route that answers a project's request for shell escape.

The project asks in `nexttex.toml`; the machine answers here, per project
id, in its own settings.  A project that has not asked gets no question
and no flag whatever the machine says.
"""

import shutil
import time

import pytest

import server.main as server_main


def asks(project_dir) -> None:
    (project_dir / "nexttex.toml").write_text(
        '[project]\nname = "T"\nshell_escape = true\n', encoding="utf-8"
    )


def test_a_project_that_does_not_ask_is_off(client, opened):
    body = client.post(f"/api/projects/{opened['id']}/open").json()
    assert body["shellEscape"] == "off"
    assert body["shellEscapeAsked"] is False


def test_a_project_that_asks_is_a_question_until_this_machine_answers(
    client, project_dir, project,
):
    asks(project_dir)
    project_id = project["id"]
    body = client.post(f"/api/projects/{project_id}/open").json()
    assert body["shellEscape"] == "asked"
    assert body["shellEscapeAsked"] is True

    answered = client.post(f"/api/projects/{project_id}/shell-escape", json={"allow": True})
    assert answered.status_code == 200, answered.text
    assert answered.json()["shellEscape"] == "on"
    # Kept on the machine, not in the project: the toml is unchanged and
    # the settings file names the project.
    assert "allowed" not in (project_dir / "nexttex.toml").read_text(encoding="utf-8")
    assert project_id in server_main.SETTINGS.shell_escape_allowed
    assert client.post(f"/api/projects/{project_id}/open").json()["shellEscape"] == "on"

    revoked = client.post(f"/api/projects/{project_id}/shell-escape", json={"allow": False})
    assert revoked.json()["shellEscape"] == "asked"
    assert project_id not in server_main.SETTINGS.shell_escape_allowed


def test_allowing_a_project_that_never_asked_changes_nothing_it_can_see(client, opened):
    """The list may name it, harmlessly; the build still never gets the
    flag, because the project's own request is the other half."""
    project_id = opened["id"]
    body = client.post(f"/api/projects/{project_id}/shell-escape", json={"allow": True}).json()
    assert body["shellEscape"] == "off"
    client.post(f"/api/projects/{project_id}/shell-escape", json={"allow": False})


def test_the_answer_is_a_project_id_this_server_knows(client, opened):
    assert client.post("/api/projects/nope/shell-escape", json={"allow": True}).status_code == 404
    assert client.post(
        "/api/projects/..%2F..%2Fetc/shell-escape", json={"allow": True}
    ).status_code in (404, 405, 422)


@pytest.mark.parametrize("body", [{}, {"allow": "maybe"}, {"allow": None}])
def test_the_answer_has_to_be_a_boolean(client, opened, body):
    response = client.post(f"/api/projects/{opened['id']}/shell-escape", json=body)
    assert response.status_code == 422, response.text


def test_a_toml_saved_in_the_editor_is_read_without_a_restart(client, opened):
    """The config was read once when the project opened, so a request
    typed into `nexttex.toml` did nothing until the next restart.  Saving
    the file now re-reads it and publishes `project_changed`, the same
    event the settings sheet's own writes publish."""
    project_id = opened["id"]
    assert client.post(f"/api/projects/{project_id}/open").json()["shellEscape"] == "off"
    response = client.put(
        f"/api/projects/{project_id}/file",
        json={
            "path": "nexttex.toml",
            "text": '[project]\nname = "T"\nshell_escape = true\nengine = "lualatex"\n',
            "compile": False, "create": True,
        },
    )
    assert response.status_code == 200, response.text
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        body = client.post(f"/api/projects/{project_id}/open").json()
        if body["shellEscape"] == "asked":
            break
        time.sleep(0.05)
    assert body["shellEscape"] == "asked"
    assert body["engine"] == "lualatex"


@pytest.mark.skipif(shutil.which("pdflatex") is None, reason="pdflatex is needed")
def test_allowing_runs_the_program_the_document_names(client, project_dir, project):
    """The whole path with a real engine: restricted shell escape refuses
    `touch`, the flag allows it, and the marker file is the proof."""
    asks(project_dir)
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n"
        "\\immediate\\write18{touch escaped.txt}\nHello.\n\\end{document}\n",
        encoding="utf-8",
    )
    project_id = project["id"]
    client.post(f"/api/projects/{project_id}/open")
    result = client.post(f"/api/projects/{project_id}/compile", json={"full": True}).json()
    assert result["shellEscape"] == "asked"
    assert not (project_dir / "escaped.txt").exists()

    client.post(f"/api/projects/{project_id}/shell-escape", json={"allow": True})
    result = client.post(f"/api/projects/{project_id}/compile", json={"full": True}).json()
    assert result["shellEscape"] == "on", result
    assert (project_dir / "escaped.txt").exists()
    client.post(f"/api/projects/{project_id}/shell-escape", json={"allow": False})


def test_the_build_result_carries_the_state(client, project_dir, project):
    asks(project_dir)
    project_id = project["id"]
    client.post(f"/api/projects/{project_id}/open")
    result = client.post(f"/api/projects/{project_id}/compile", json={}).json()
    assert result["shellEscape"] == "asked"
