"""Finding and renaming a label, a key or a macro across the project."""

import pytest


def seed(project_dir):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n"
        "\\section{A}\\label{sec:a}\nSee \\ref{sec:a} and \\ref{sec:ab}. % \\ref{sec:a}\n"
        "\\input{chapters/two}\n\\cite{knuth}\n\\end{document}\n",
        encoding="utf-8",
    )
    (project_dir / "chapters").mkdir(exist_ok=True)
    (project_dir / "chapters" / "two.tex").write_text(
        "Back to \\cref{sec:a,sec:ab}.\n", encoding="utf-8",
    )
    (project_dir / "references.bib").write_text(
        "@book{knuth,\n  title = {The TeXbook},\n}\n", encoding="utf-8",
    )


def test_references_are_listed_with_their_comments_marked(client, project_dir, opened):
    seed(project_dir)
    body = client.get(
        f"/api/projects/{opened['id']}/references", params={"kind": "label", "name": "sec:a"}
    ).json()
    # The texts arrive newest file first, so the order is the files' and
    # not the document's; what matters is the set.
    places = sorted((h["path"], h["line"], h["commented"]) for h in body["hits"])
    assert places == [
        ("chapters/two.tex", 1, False),
        ("main.tex", 3, False),
        ("main.tex", 4, False),
        ("main.tex", 4, True),
    ]
    assert body["commented"] == 1


def test_a_rename_reaches_every_file_and_records_a_version_for_each(client, project_dir, opened):
    seed(project_dir)
    project_id = opened["id"]
    answer = client.post(
        f"/api/projects/{project_id}/rename",
        json={"kind": "label", "name": "sec:a", "to": "sec:intro"},
    )
    assert answer.status_code == 200, answer.text
    assert sorted(answer.json()["paths"]) == ["chapters/two.tex", "main.tex"]
    main = (project_dir / "main.tex").read_text(encoding="utf-8")
    assert "\\label{sec:intro}" in main and "\\ref{sec:intro} and \\ref{sec:ab}" in main
    assert "% \\ref{sec:a}" in main, "the comment is left alone unless asked"
    assert (project_dir / "chapters" / "two.tex").read_text(encoding="utf-8") == (
        "Back to \\cref{sec:intro,sec:ab}.\n"
    )
    for path in ("main.tex", "chapters/two.tex"):
        versions = client.get(
            f"/api/projects/{project_id}/history", params={"path": path}
        ).json()["versions"]
        assert versions and versions[-1]["op"] in ("edit", "create")


def test_a_citation_key_is_renamed_in_the_bib_too(client, project_dir, opened):
    seed(project_dir)
    answer = client.post(
        f"/api/projects/{opened['id']}/rename",
        json={"kind": "cite", "name": "knuth", "to": "knuth1984", "comments": True},
    ).json()
    assert sorted(answer["paths"]) == ["main.tex", "references.bib"]
    assert "@book{knuth1984," in (project_dir / "references.bib").read_text(encoding="utf-8")


@pytest.mark.parametrize("bad", [
    {"kind": "label", "name": "a{b", "to": "c"},
    {"kind": "label", "name": "sec:a", "to": "a,b"},
    {"kind": "macro", "name": "vec", "to": "ve c"},
    {"kind": "thing", "name": "x", "to": "y"},
    {"kind": "label", "name": "x" * 121, "to": "x"},
])
def test_anything_that_is_not_a_name_is_refused(client, project_dir, opened, bad):
    seed(project_dir)
    assert client.post(f"/api/projects/{opened['id']}/rename", json=bad).status_code == 400


@pytest.mark.parametrize("kind,name", [("label", "a{b"), ("thing", "x"), ("macro", "vec2"), ("label", "")])
def test_references_refuse_what_is_not_a_name(client, opened, kind, name):
    assert client.get(
        f"/api/projects/{opened['id']}/references", params={"kind": kind, "name": name}
    ).status_code == 400


def test_a_rename_to_the_same_name_changes_nothing(client, project_dir, opened):
    seed(project_dir)
    body = client.post(
        f"/api/projects/{opened['id']}/rename",
        json={"kind": "label", "name": "sec:a", "to": "sec:a"},
    ).json()
    assert body == {"files": 0, "paths": []}
