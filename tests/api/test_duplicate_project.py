"""A project can be duplicated, to start the next one from it (Q-047)."""

import shutil
from pathlib import Path

import pytest


def test_a_duplicate_is_the_writing_and_not_the_machinery(client, opened, project_dir):
    (project_dir / "build").mkdir(exist_ok=True)
    (project_dir / "build" / "main.pdf").write_bytes(b"%PDF-1.4")
    (project_dir / ".git").mkdir(exist_ok=True)
    (project_dir / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
    (project_dir / "letter.tex").write_text("Dear committee,\n")
    answer = client.post(f"/api/projects/{opened['id']}/duplicate")
    assert answer.status_code == 200, answer.text
    copy = answer.json()
    root = Path(copy["root"])
    # "<name> copy", or "<name> copy (2)" if a copy is already there.
    assert root.parent == project_dir.parent
    assert root.name.startswith(f"{project_dir.name} copy")
    assert (root / "letter.tex").read_text() == "Dear committee,\n"
    assert (root / "main.tex").is_file()
    assert not (root / "build").exists()
    assert not (root / ".git").exists()
    assert not (root / ".nexttex").exists()
    answer = client.get("/api/projects").json()
    rows = answer["projects"] if isinstance(answer, dict) else answer
    listed = [p["id"] for p in rows]
    assert copy["id"] in listed

    again = Path(client.post(f"/api/projects/{opened['id']}/duplicate").json()["root"])
    assert again != root and again.name.endswith(")")
    for made in (root, again):
        shutil.rmtree(made, ignore_errors=True)


def test_an_unknown_project_is_not_duplicated(client):
    assert client.post("/api/projects/nothing-here/duplicate").status_code == 404


@pytest.mark.parametrize("name", [
    "..%2F..%2Fmain.tex", "main.tex", "main-since-abcdefg.tex", "a b-since-abcdefg.pdf",
    "main-since-ABCDEFG.pdf",
])
def test_the_changes_pdf_route_serves_only_its_own_names(client, opened, name):
    """The marked-up PDF's route (Q-048) takes a name: only one of the
    shape it builds is served, and nothing that climbs."""
    answer = client.get(f"/api/projects/{opened['id']}/git/changes/{name}")
    assert answer.status_code == 404


def test_a_changes_pdf_for_a_commit_that_is_not_one_is_refused(client, opened):
    answer = client.post(f"/api/projects/{opened['id']}/git/changes/--output", json={"document": ""})
    assert answer.status_code == 400
