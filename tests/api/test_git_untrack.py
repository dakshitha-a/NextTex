"""Stop tracking, for the preview stand-in a project committed by mistake.

The thesis tracked `.nexttex-preview-main.tex`, so its git panel always
showed it changed, and its `.gitignore` named `.nexttex-preview.tex`, the
single file an older NextTex wrote.
"""

import subprocess

from test_git_diff import a_repository


def tracked(root) -> list[str]:
    return subprocess.run(["git", "ls-files"], cwd=root, check=True,
                          capture_output=True, text=True).stdout.split()


def test_the_preview_file_leaves_the_repository_and_stays_on_disk(client, opened, project_dir):
    (project_dir / ".nexttex-preview-main.tex").write_text("stand-in\n", encoding="utf-8")
    (project_dir / ".gitignore").write_text("build/\n.nexttex-preview.tex\n", encoding="utf-8")
    subprocess.run(["git", "init", "-b", "main"], cwd=project_dir, check=True, capture_output=True)
    subprocess.run(["git", "add", "-f", ".nexttex-preview-main.tex"], cwd=project_dir, check=True)
    a_repository(project_dir)
    assert ".nexttex-preview-main.tex" in tracked(project_dir)

    answer = client.post(f"/api/projects/{opened['id']}/git/untrack",
                         json={"path": ".nexttex-preview-main.tex"})
    assert answer.status_code == 200, answer.text
    assert ".nexttex-preview-main.tex" not in tracked(project_dir)
    assert (project_dir / ".nexttex-preview-main.tex").is_file()
    ignore = (project_dir / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert ".nexttex-preview*" in ignore and ".nexttex-preview.tex" not in ignore
    assert "build/" in ignore


def test_only_nexttexs_own_files_can_be_untracked(client, opened, project_dir):
    a_repository(project_dir)
    answer = client.post(f"/api/projects/{opened['id']}/git/untrack", json={"path": "main.tex"})
    assert answer.status_code == 400
    assert "main.tex" in tracked(project_dir)


def test_a_path_outside_the_project_is_refused(client, opened, project_dir, tmp_path):
    a_repository(project_dir)
    outside = tmp_path / ".nexttex-preview-x.tex"
    outside.write_text("x", encoding="utf-8")
    for path in ("../.nexttex-preview-x.tex", str(outside)):
        answer = client.post(f"/api/projects/{opened['id']}/git/untrack", json={"path": path})
        assert answer.status_code in (400, 403), (path, answer.status_code)
