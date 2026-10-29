"""A project holding a symlink to a file outside itself.

Found in the live install's journal on 11 October 2026: a paper project
kept links under `refs/` to drafts in another repository, and every route
that reads the whole project's text (lint, headings, search) answered 500,
because naming the linked file relative to the project raised. Such a file
is one `Project.resolve` refuses to open, so the routes now pass over it:
no 500, no hit naming a file the editor cannot show, and no replace that
writes outside the project.

Every route here takes its paths from the project walk, not the caller, so
the path-escape assertion is the replace one: text outside is untouched.
"""

import pytest


@pytest.fixture
def linked(project_dir, tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    draft = outside / "draft.tex"
    draft.write_text("\\section{Borrowed}\\label{sec:borrowed}\nZEBRAWORD lives outside.\n",
                     encoding="utf-8")
    (project_dir / "refs").mkdir()
    (project_dir / "refs" / "draft.tex").symlink_to(draft)
    (project_dir / "refs" / "notes.md").symlink_to(outside / "missing.md")
    return draft


@pytest.mark.parametrize("route", ["lint?path=references.bib", "headings",
                                   "search?q=ZEBRAWORD"])
def test_reading_the_project_does_not_fail(client, linked, opened, route):
    response = client.get(f"/api/projects/{opened['id']}/{route}")
    assert response.status_code == 200, response.text
    assert "ZEBRAWORD lives" not in response.text


def test_a_replace_never_writes_outside(client, linked, opened):
    response = client.post(f"/api/projects/{opened['id']}/search/replace",
                           json={"q": "ZEBRAWORD", "with": "changed"})
    assert response.status_code == 200, response.text
    assert "ZEBRAWORD" in linked.read_text(encoding="utf-8")


def test_completion_offers_a_linked_files_labels(client, linked, opened):
    """Decided on 29 October 2026: TeX reads a linked file when it builds,
    so `\\ref{sec:borrowed}` resolves on the page, and completion offers the
    label it will resolve to. The editor and search still pass over the
    file, since writing through the link would write outside the project."""
    response = client.get(f"/api/projects/{opened['id']}/symbols")
    assert response.status_code == 200, response.text
    labels = [label["name"] for label in response.json()["labels"]]
    assert "sec:borrowed" in labels
