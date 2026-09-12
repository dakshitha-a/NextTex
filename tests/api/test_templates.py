"""The templates a blank project can be filled with.

R-096. `GET /api/templates` lists the directories under
`nexttex/templates`, there was one of them, and both callers of
`loadTemplate` passed no name, so the list was never fetched and the
parameter never carried anything. Every new project was an article.
"""

from server import main as server_main


def test_every_template_is_offered(client):
    answer = client.get("/api/templates")
    assert answer.status_code == 200
    names = answer.json()["templates"]
    assert names == ["basic", "beamer", "letter", "report"]


def test_a_named_template_is_the_one_that_is_written(client, opened):
    project = opened
    # The route refuses a document with anything in it, which is the whole
    # point of it: this is for the first minute of a project.
    server_main.SESSIONS[project["id"]].paths.main.write_text(
        "\\documentclass{article}\n\\begin{document}\n\\end{document}\n",
        encoding="utf-8",
    )
    answer = client.post(
        f"/api/projects/{project['id']}/template", json={"name": "report"}
    )
    assert answer.status_code == 200
    main = (server_main.SESSIONS[project["id"]].paths.main).read_text(encoding="utf-8")
    assert "\\documentclass[11pt]{report}" in main
    # A report is chapters in their own files, which is the whole reason to
    # have it as a separate template rather than a class option.
    root = server_main.SESSIONS[project["id"]].project.root
    assert (root / "chapters" / "01-introduction.tex").is_file()


def test_a_template_nobody_has_is_a_404(client, opened):
    answer = client.post(
        f"/api/projects/{opened['id']}/template", json={"name": "thesis"}
    )
    assert answer.status_code == 404


def test_every_template_names_the_bibliography_it_ships(client):
    """A template that calls `\\addbibresource` and brings no `.bib` builds
    to an error on the first run, which is the worst possible first minute.
    """
    from pathlib import Path

    root = Path(server_main.__file__).resolve().parent.parent / "nexttex" / "templates"
    for directory in sorted(p for p in root.iterdir() if p.is_dir()):
        main = (directory / "main.tex").read_text(encoding="utf-8")
        if "\\addbibresource" in main:
            assert (directory / "references.bib").is_file(), (
                f"{directory.name} cites a bibliography it does not ship"
            )
