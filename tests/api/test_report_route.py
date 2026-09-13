"""`POST /api/report`: the bug report the footer asks for.

This route takes no path and opens no file the caller names, which is why
it has no path-escape assertion, unlike every other file in this directory.
What it can leak is what it quotes, so that is what is asserted.
"""

import json

from starlette.testclient import TestClient

from nexttex import updates
from nexttex.paths import state_home
from server import main as server_main
from tests.api.test_security_headers import missing


def test_the_report_carries_no_credential(client):
    state = state_home()
    state.mkdir(parents=True, exist_ok=True)
    token = server_main.SETTINGS.token
    (state / "server.log").write_text(f"http://127.0.0.1:1234/?token={token}\n")
    server_main.SETTINGS.openai_key = "sk-PLANTEDKEY0123456789abcdef"
    server_main.SETTINGS.save()
    try:
        body = client.post("/api/report").json()
    finally:
        server_main.SETTINGS.openai_key = ""
        server_main.SETTINGS.save()
        (state / "server.log").unlink()

    assert token not in body["text"]
    assert "PLANTEDKEY" not in body["text"]
    assert "?token=[redacted]" in body["text"]
    assert "by the projects screen" in body["text"]


def test_without_a_credential_it_is_refused():
    with TestClient(server_main.app) as anonymous:
        assert anonymous.post("/api/report").status_code == 401


def test_what_the_browser_saw_is_quoted_and_redacted(client):
    token = server_main.SETTINGS.token
    body = client.post("/api/report", json={
        "browser": "Browser/9",
        "errors": [{"at": "10:00:00", "kind": "rejection",
                    "message": f"failed at http://x/?token={token}",
                    "stack": "one\ntwo"}],
    }).json()
    assert "browser  Browser/9" in body["text"]
    assert "10:00:00  rejection" in body["text"]
    assert token not in body["text"]
    assert "    one" in body["text"]


def test_client_errors_are_bounded(client):
    response = client.post("/api/report", json={"errors": [{}] * 1000})
    assert response.status_code == 422
    assert "errors" in response.json()["error"]

    response = client.post("/api/report", json={"errors": [{"message": "m" * 5000}]})
    assert response.status_code == 422
    assert "message" in response.json()["error"]


def test_the_new_issue_url_names_the_form(client, monkeypatch, tmp_path):
    body = client.post("/api/report").json()
    assert "/issues/new?template=bug.yml" in body["newIssue"]
    assert "where=" in body["newIssue"] and "commit=" in body["newIssue"]
    assert "labels=" not in body["newIssue"]
    assert body["slug"] in body["newIssue"]


def test_a_checkout_that_is_not_from_github_still_names_the_repository(client, monkeypatch, tmp_path):
    monkeypatch.setattr(server_main, "INSTALL_ROOT", tmp_path)
    body = client.post("/api/report").json()
    assert body["slug"] == updates.CANONICAL_SLUG
    assert "unknown (not a git checkout)" in body["text"]


def test_the_security_headers_are_on_it(client):
    assert not missing(client.post("/api/report"))
