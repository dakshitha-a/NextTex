"""The Typeset list's route: every heading the document reaches, across
its files, before a build, and the paths it will not read."""


def test_the_headings_of_the_document_and_its_inputs_are_listed(client, project_dir, opened):
    (project_dir / "chapters").mkdir()
    (project_dir / "chapters" / "two.tex").write_text("\\section{Two}\n\\subsection{Two a}\n", encoding="utf-8")
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n"
        "\\section{One}\n\\input{chapters/two}\n\\end{document}\n",
        encoding="utf-8",
    )
    answer = client.get(f"/api/projects/{opened['id']}/headings")
    assert answer.status_code == 200, answer.text
    entries = answer.json()["entries"]
    assert [(e["title"], e["file"], e["line"], e["page"]) for e in entries] == [
        ("One", "main.tex", 3, None),
        ("Two", "chapters/two.tex", 1, None),
        ("Two a", "chapters/two.tex", 2, None),
    ]


def test_a_document_that_is_not_one_is_refused(client, opened):
    for name in ("../outside.tex", "/etc/passwd", "nope.tex"):
        answer = client.get(f"/api/projects/{opened['id']}/headings", params={"document": name})
        assert answer.status_code == 404
