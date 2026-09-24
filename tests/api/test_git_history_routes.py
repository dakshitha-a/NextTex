"""The routes behind the Git drawer's History and "The line you are on"."""

import subprocess


def a_repository(root):
    for arguments in (
        ("init", "-b", "main"),
        ("config", "user.email", "test@example.invalid"),
        ("config", "user.name", "A Test"),
        ("add", "-A"),
        ("commit", "-m", "first"),
    ):
        subprocess.run(["git", *arguments], cwd=root, check=True, capture_output=True)


def test_the_log_lists_commits_and_one_opens_to_its_patch(client, opened, project_dir):
    a_repository(project_dir)
    listed = client.get(f"/api/projects/{opened['id']}/git/log")
    assert listed.status_code == 200, listed.text
    commits = listed.json()["commits"]
    assert [c["subject"] for c in commits] == ["first"] and commits[0]["mine"] is True
    patch = client.get(f"/api/projects/{opened['id']}/git/log/{commits[0]['sha']}")
    assert patch.status_code == 200 and "main.tex" in patch.json()["patch"]


def test_a_commit_that_is_not_a_hash_is_refused(client, opened, project_dir):
    a_repository(project_dir)
    for sha in ["HEAD", "--output=x", "abc"]:
        assert client.get(f"/api/projects/{opened['id']}/git/log/{sha}").status_code == 400
    missing = client.get(f"/api/projects/{opened['id']}/git/log/{'0' * 40}")
    assert missing.status_code == 404


def test_no_repository_is_an_empty_history(client, opened):
    answer = client.get(f"/api/projects/{opened['id']}/git/log")
    assert answer.status_code == 200 and answer.json()["commits"] == []


def test_blame_answers_for_a_line(client, opened, project_dir):
    a_repository(project_dir)
    answer = client.get(f"/api/projects/{opened['id']}/git/blame", params={"path": "main.tex", "line": 1})
    assert answer.status_code == 200, answer.text
    assert answer.json()["blame"]["subject"] == "first"


def test_blame_of_a_path_outside_the_project_is_refused(client, opened, project_dir):
    a_repository(project_dir)
    answer = client.get(
        f"/api/projects/{opened['id']}/git/blame", params={"path": "../outside.tex", "line": 1},
    )
    assert answer.status_code == 403
