"""The lint route's `.bib` case: the bibliography check through the
route, with what the documents cite."""

BIB = """@article{knuth84,
  author = {Donald E. Knuth}, title = {Literate programming},
  journal = {The Computer Journal}, year = {1984}
}
@book{orphan,
  title = {Nobody cites this}, publisher = {P}, year = {soon}
}
"""


def test_a_bib_file_gets_rows_and_the_documents_say_what_is_cited(client, opened, project_dir):
    (project_dir / "references.bib").write_text(BIB, encoding="utf-8")
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}\\cite{knuth84}\\end{document}\n", encoding="utf-8",
    )
    answer = client.get(f"/api/projects/{opened['id']}/lint", params={"path": "references.bib"})
    assert answer.status_code == 200, answer.text
    rows = answer.json()["diagnostics"]
    assert all(row["source"] == "bib" and row["file"] == "references.bib" for row in rows)
    kinds = sorted((row["kind"], row["line"]) for row in rows)
    assert kinds == [("missing-field", 5), ("uncited", 5), ("year", 5)]


def test_nocite_star_means_nothing_is_uncited(client, opened, project_dir):
    (project_dir / "references.bib").write_text(BIB, encoding="utf-8")
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}\\nocite{*}\\end{document}\n", encoding="utf-8",
    )
    rows = client.get(f"/api/projects/{opened['id']}/lint", params={"path": "references.bib"}).json()["diagnostics"]
    assert not any(row["kind"] == "uncited" for row in rows)


def test_a_path_outside_the_project_is_refused(client, opened):
    for hostile in ("../x.bib", "/etc/passwd.bib", "a\x00.bib"):
        answer = client.get(f"/api/projects/{opened['id']}/lint", params={"path": hostile})
        assert answer.status_code in (400, 403, 404), (hostile, answer.status_code)


def test_a_bib_that_is_not_there_is_an_empty_answer(client, opened):
    answer = client.get(f"/api/projects/{opened['id']}/lint", params={"path": "missing.bib"})
    assert answer.status_code in (200, 404)
    if answer.status_code == 200:
        assert answer.json() == {"diagnostics": []}


def test_the_symbols_carry_the_installed_styles(client, opened):
    answer = client.get(f"/api/projects/{opened['id']}/symbols").json()
    assert isinstance(answer["styles"], list) and "plain" in answer["styles"]
