"""The `.bib` repair route: one row's repair, through the ordinary save."""

import pytest

BIB = (
    "@article{lee2019,\n  author = {Lee, A},\n  title = {One},\n  year = {2019},\n"
    "  doi = {10.2/y}\n}\n\n"
    "@article{lee2019b,\n  author = {Lee, A},\n  title = {One},\n  journal = {J},\n"
    "  year = {2019},\n  doi = {10.2/Y}\n}\n"
)


def seed(project_dir):
    (project_dir / "references.bib").write_text(BIB, encoding="utf-8")
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n\\cite{lee2019,lee2019b}\n"
        "\\bibliography{references}\n\\end{document}\n",
        encoding="utf-8",
    )


def test_a_merge_rewrites_the_bib_and_the_citations_with_a_version_each(client, project_dir, opened):
    seed(project_dir)
    project_id = opened["id"]
    rows = client.get(f"/api/projects/{project_id}/lint", params={"path": "references.bib"}).json()
    fix = next(row["fix"] for row in rows["diagnostics"] if row["kind"] == "duplicate-doi")
    answer = client.post(
        f"/api/projects/{project_id}/bib/fix",
        json={"path": "references.bib", "kind": fix["kind"], "key": fix["key"]},
    )
    assert answer.status_code == 200, answer.text
    assert sorted(answer.json()["paths"]) == ["main.tex", "references.bib"]
    assert "@article{lee2019," not in (project_dir / "references.bib").read_text(encoding="utf-8")
    assert "\\cite{lee2019b}" in (project_dir / "main.tex").read_text(encoding="utf-8")
    for path in ("main.tex", "references.bib"):
        versions = client.get(
            f"/api/projects/{project_id}/history", params={"path": path}
        ).json()["versions"]
        assert versions and versions[-1]["op"] in ("edit", "create")
    # Pressed again, from a window that had not heard: it no longer applies.
    again = client.post(
        f"/api/projects/{project_id}/bib/fix",
        json={"path": "references.bib", "kind": "duplicate-doi", "key": "lee2019b"},
    )
    assert again.status_code == 409


@pytest.mark.parametrize("body", [
    {"path": "main.tex", "kind": "bulky-fields"},
    {"path": "references.bib", "kind": "rm -rf"},
])
def test_a_repair_that_is_not_one_is_refused(client, project_dir, opened, body):
    seed(project_dir)
    answer = client.post(f"/api/projects/{opened['id']}/bib/fix", json=body)
    assert answer.status_code == 400


@pytest.mark.parametrize("path", ["../outside.bib", "chapters/../../outside.bib", "/etc/x.bib"])
def test_a_repair_outside_the_project_is_refused(client, opened, path):
    answer = client.post(
        f"/api/projects/{opened['id']}/bib/fix", json={"path": path, "kind": "bulky-fields"},
    )
    assert answer.status_code in (400, 403, 404)
