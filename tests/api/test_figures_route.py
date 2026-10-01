"""The Figures list's route: the source's figures, before and after a build."""


def test_the_figures_of_the_document_are_listed_before_any_build(client, project_dir, opened):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n"
        "\\begin{figure}\\caption{One}\\label{fig:one}\\end{figure}\n"
        "See~\\ref{fig:one}.\n\\end{document}\n",
        encoding="utf-8",
    )
    answer = client.get(f"/api/projects/{opened['id']}/figures")
    assert answer.status_code == 200, answer.text
    entries = answer.json()["entries"]
    assert [(e["kind"], e["caption"], e["refs"], e["number"]) for e in entries] == [
        ("figure", "One", 1, None),
    ]


def test_a_document_that_is_not_one_is_refused(client, opened):
    for name in ("../outside.tex", "/etc/passwd", "nope.tex"):
        answer = client.get(f"/api/projects/{opened['id']}/figures", params={"document": name})
        assert answer.status_code == 404
