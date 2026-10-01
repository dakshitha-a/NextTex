"""The lint route's consistency rows, read over the whole project."""


def test_a_tex_file_gets_its_consistency_rows_beside_chktex_s(client, project_dir, opened):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nThe data set.\n\\input{two}\n\\end{document}\n",
        encoding="utf-8",
    )
    (project_dir / "two.tex").write_text("The dataset, and the dataset.\n", encoding="utf-8")
    rows = client.get(
        f"/api/projects/{opened['id']}/lint", params={"path": "main.tex"},
    ).json()["diagnostics"]
    style = [row for row in rows if row["source"] == "style"]
    assert [(row["kind"], row["line"]) for row in style] == [("compound", 3)]
    assert style[0]["other"] == {"file": "two.tex", "line": 1}
    assert style[0]["explain"]["title"] == "One word written two ways"
    # The other file uses its form throughout and is the convention.
    other = client.get(
        f"/api/projects/{opened['id']}/lint", params={"path": "two.tex"},
    ).json()["diagnostics"]
    assert not [row for row in other if row["source"] == "style"]
