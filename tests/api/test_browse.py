"""The folder picker's route.

`/api/browse` lists folders on the machine running NextTex, for the papers
chooser and for the projects screen's Browse button.  It takes a path and
is deliberately not fenced to a project: a project is already an absolute
path typed into a box on that screen, so the route reaches what the box
reaches.  What guards it instead is that it is read-only, answers folder
names and PDF counts and never contents, does not follow symlinks, and no
tool the agent can call reaches it.  These are the tests that hold that
shape, which the route had none of before the Browse button arrived.
"""

import os
from pathlib import Path


def test_a_folder_lists_its_folders_and_its_parent(client, tmp_path):
    (tmp_path / "b").mkdir()
    (tmp_path / "a").mkdir()
    (tmp_path / ".hidden").mkdir()
    (tmp_path / "a" / "paper.pdf").write_bytes(b"%PDF-1.4")
    (tmp_path / "here.pdf").write_bytes(b"%PDF-1.4")
    response = client.get("/api/browse", params={"path": str(tmp_path)})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["path"] == str(tmp_path.resolve())
    assert body["parent"] == str(tmp_path.resolve().parent)
    # Sorted by name, hidden folders left out, PDFs counted per folder.
    assert [f["name"] for f in body["folders"]] == ["a", "b"]
    assert [f["pdfs"] for f in body["folders"]] == [1, 0]
    assert body["pdfsHere"] == 1
    assert body["deep"] is None


def test_pdfs_off_counts_nothing(client, tmp_path):
    """The projects picker asks with `pdfs=0`: every count is 0 and no
    child folder is opened, which on home is the difference between a
    listing and a wait."""
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "paper.pdf").write_bytes(b"%PDF-1.4")
    (tmp_path / "here.pdf").write_bytes(b"%PDF-1.4")
    # A child that cannot be read: with counting on it is 0 by the
    # except; with counting off it is never opened at all.
    locked = tmp_path / "locked"
    locked.mkdir()
    (locked / "paper.pdf").write_bytes(b"%PDF-1.4")
    os.chmod(locked, 0o000)
    try:
        response = client.get(
            "/api/browse", params={"path": str(tmp_path), "pdfs": "0"}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert [f["name"] for f in body["folders"]] == ["a", "locked"]
        assert all(f["pdfs"] == 0 for f in body["folders"])
        assert body["pdfsHere"] == 0
    finally:
        os.chmod(locked, 0o700)


def test_a_file_and_a_missing_path_are_refused(client, tmp_path):
    (tmp_path / "notes.tex").write_text("x")
    response = client.get("/api/browse", params={"path": str(tmp_path / "notes.tex")})
    assert response.status_code == 400
    assert "file" in response.json()["detail"]
    response = client.get("/api/browse", params={"path": str(tmp_path / "nowhere")})
    assert response.status_code == 400
    assert "no folder" in response.json()["detail"]


def test_a_symlinked_folder_is_not_listed_as_a_folder(client, tmp_path):
    """Read-only and unfollowed: a link to somewhere else is not a way of
    walking into it, which is the one place a listing route could reach
    further than its caller meant."""
    real = tmp_path / "real"
    real.mkdir()
    (tmp_path / "link").symlink_to(real, target_is_directory=True)
    response = client.get("/api/browse", params={"path": str(tmp_path)})
    assert response.status_code == 200, response.text
    assert [f["name"] for f in response.json()["folders"]] == ["real"]


def test_no_path_is_home(client):
    response = client.get("/api/browse")
    assert response.status_code == 200, response.text
    assert response.json()["path"] == str(Path.home().resolve())
