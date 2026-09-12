"""The patch behind "See what changed"."""

import subprocess


def a_repository(root):
    for arguments in (
        ("init", "-b", "main"),
        ("config", "user.email", "test@example.invalid"),
        ("config", "user.name", "A Test"),
        ("add", "-A"),
        ("commit", "-m", "first"),
    ):
        subprocess.run(["git", *arguments], cwd=root, check=True,
                       capture_output=True)


def test_the_patch_for_an_edited_file_is_returned(client, opened, project_dir):
    a_repository(project_dir)
    main = project_dir / "main.tex"
    main.write_text(main.read_text(encoding="utf-8") + "\nA new last line.\n",
                    encoding="utf-8")
    answer = client.get(
        f"/api/projects/{opened['id']}/git/diff", params={"path": "main.tex"}
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["path"] == "main.tex"
    assert "@@" in body["patch"] and "+A new last line." in body["patch"]


def test_a_path_outside_the_project_is_refused(client, opened, project_dir):
    a_repository(project_dir)
    answer = client.get(
        f"/api/projects/{opened['id']}/git/diff", params={"path": "../outside.tex"}
    )
    assert answer.status_code == 403


def test_no_repository_is_an_empty_patch_not_an_error(client, opened):
    answer = client.get(
        f"/api/projects/{opened['id']}/git/diff", params={"path": "main.tex"}
    )
    assert answer.status_code == 200
    assert answer.json()["patch"] == ""
