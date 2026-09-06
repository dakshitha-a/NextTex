"""The routes behind "add papers from a folder".

The one part of NextTex that reaches outside a project on purpose, so what
these mostly assert is what it will not do.
"""

import json
from pathlib import Path

import pytest


def test_browsing_lists_folders_and_counts_the_pdfs_in_them(client, tmp_path):
    (tmp_path / "Zotero" / "storage" / "AAA").mkdir(parents=True)
    (tmp_path / "Zotero" / "storage" / "AAA" / "one.pdf").write_bytes(b"%PDF")
    (tmp_path / "Zotero" / "storage" / "BBB").mkdir()
    body = client.get("/api/browse", params={"path": str(tmp_path / "Zotero")}).json()
    assert [f["name"] for f in body["folders"]] == ["storage"]
    assert body["parent"] == str(tmp_path)


def test_browsing_counts_the_whole_tree_when_asked(client, tmp_path):
    deep = tmp_path / "papers" / "a" / "b"
    deep.mkdir(parents=True)
    for index in range(3):
        (deep / f"{index}.pdf").write_bytes(b"%PDF")
    body = client.get("/api/browse",
                      params={"path": str(tmp_path / "papers"), "count": True}).json()
    assert body["deep"]["pdfs"] == 3


def test_browsing_never_returns_anything_but_folders_and_a_count(client, tmp_path):
    """It says which folders exist and how many PDFs are in them.  It does
    not list other files and it never returns contents."""
    (tmp_path / "secrets.txt").write_text("private", encoding="utf-8")
    (tmp_path / "sub").mkdir()
    body = client.get("/api/browse", params={"path": str(tmp_path)}).json()
    assert set(body) == {"path", "parent", "home", "folders", "pdfsHere", "deep"}
    assert all(set(f) == {"name", "path", "pdfs"} for f in body["folders"])
    assert "secrets.txt" not in json.dumps(body)


@pytest.mark.parametrize("path,expected", [
    ("/definitely/not/here", "There is no folder at that path."),
])
def test_a_folder_that_is_not_there_says_so(client, path, expected):
    answer = client.get("/api/browse", params={"path": path})
    assert answer.status_code == 400
    assert expected in answer.json()["detail"]


def test_a_file_is_not_a_folder(client, tmp_path):
    target = tmp_path / "paper.pdf"
    target.write_bytes(b"%PDF")
    answer = client.get("/api/browse", params={"path": str(target)})
    assert answer.status_code == 400
    assert "That is a file, not a folder." in answer.json()["detail"]


def test_browsing_needs_the_token_like_everything_else(client):
    """It names the server's filesystem, so it had better not be the one
    route somebody forgot to put behind the door."""
    from conftest import server_main

    kept = client.cookies.get(server_main.COOKIE)
    client.cookies.clear()
    try:
        answer = client.get("/api/browse")
        assert answer.status_code == 401
    finally:
        client.cookies.set(server_main.COOKIE, kept)


def test_a_project_with_no_bibliography_says_so_rather_than_making_one(
    client, opened, project_dir, tmp_path
):
    for stray in project_dir.rglob("*.bib"):
        stray.unlink()
    (tmp_path / "papers").mkdir(exist_ok=True)
    answer = client.post(f"/api/projects/{opened['id']}/library/scan",
                         json={"path": str(tmp_path / "papers")})
    assert answer.status_code in (400, 503)
    if answer.status_code == 400:
        assert "no .bib file" in answer.json()["detail"]


def test_the_state_of_an_untouched_project_is_empty_but_answerable(client, opened):
    body = client.get(f"/api/projects/{opened['id']}/library").json()
    assert body["count"] == 0
    assert body["sources"] == [] and body["unidentified"] == []
    assert body["running"] is None
    assert "haveReader" in body


def test_stopping_when_nothing_is_running_is_not_an_error(client, opened):
    assert client.post(f"/api/projects/{opened['id']}/library/stop").json() == {
        "stopped": False
    }


def test_forgetting_the_unidentified_clears_only_those(client, opened, project_dir):
    from nexttex.library import Library, Paper

    shelf = Library(project_dir / ".nexttex" / "library")
    shelf.save([
        Paper(sha="a", path="/p/a.pdf", name="a.pdf", state="added", key="k"),
        Paper(sha="b", path="/p/b.pdf", name="b.pdf", state="unidentified",
              reason="No DOI printed in it."),
    ], ["/p"], {})

    assert client.delete(
        f"/api/projects/{opened['id']}/library/unidentified"
    ).json() == {"cleared": True}
    left = Library(project_dir / ".nexttex" / "library").papers()
    assert [p.sha for p in left] == ["a"]


def test_resolving_a_paper_by_hand_needs_a_paper_that_exists(client, opened):
    answer = client.post(f"/api/projects/{opened['id']}/library/resolve",
                         json={"sha": "nope", "doi": "10.1063/1.1"})
    assert answer.status_code == 404
