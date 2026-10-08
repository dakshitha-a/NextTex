"""A file's history downloaded as an audit trail.

The ZIP is the trail: every stored version, a log that names who and when,
and sums that check the versions without NextTex.  The report beside them
is for reading.
"""

import csv
import hashlib
import io
import json
import zipfile

from server import main as server_main


def save(client, project_id: str, text: str, origin: str) -> None:
    # Two windows, so two saves a moment apart are two versions rather than
    # one editing burst.
    client.put(f"/api/projects/{project_id}/file",
               json={"path": "main.tex", "text": text, "compile": False,
                     "origin": origin})


def export(client, project_id: str, path: str = "main.tex"):
    return client.get(f"/api/projects/{project_id}/history/export", params={"path": path})


def test_the_trail_holds_every_version_and_checks_itself(client, opened):
    project_id = opened["id"]
    save(client, project_id, "first line\n", "tab-a")
    save(client, project_id, "first line\nsecond line\n", "tab-b")
    stored = server_main.session_for(project_id).history.versions("main.tex")

    response = export(client, project_id)
    assert response.status_code == 200, response.text
    assert 'filename="main.tex-history.zip"' in response.headers["content-disposition"]
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()
    assert {"log.csv", "log.json", "SHA256SUMS", "report.html"} <= set(names)

    versions = sorted(name for name in names if name.startswith("versions/"))
    assert len(versions) == len(stored) >= 2
    assert versions[0].startswith("versions/0001_") and versions[0].endswith("_main.tex")

    for line in archive.read("SHA256SUMS").decode().splitlines():
        sha, member = line.split("  ", 1)
        assert hashlib.sha256(archive.read(member)).hexdigest() == sha

    rows = list(csv.DictReader(io.StringIO(archive.read("log.csv").decode())))
    assert [row["sha256"] for row in rows] == [version.sha for version in stored]
    assert all(row["here"] == "True" for row in rows)
    log = json.loads(archive.read("log.json"))
    assert log["file"] == "main.tex" and log["keep_all_versions"] is False
    assert any("thins its history" in note for note in log["retention"])

    report = archive.read("report.html").decode()
    assert "+second line" in report
    assert "you" not in {row["author"] for row in rows}


def test_the_retention_note_follows_the_setting(client, opened):
    project_id = opened["id"]
    save(client, project_id, "text\n", "tab-a")
    client.post(f"/api/projects/{project_id}/settings", json={"keepAllVersions": True})
    log = json.loads(zipfile.ZipFile(io.BytesIO(export(client, project_id).content)).read("log.json"))
    assert log["keep_all_versions"] is True
    assert any("keeps every version" in note for note in log["retention"])


def test_a_version_whose_contents_are_not_here_is_listed_as_missing(client, opened):
    """A collaborator's version whose bytes never arrived: still a row, with
    no file and no sum, rather than a failed export."""
    project_id = opened["id"]
    save(client, project_id, "kept\n", "tab-a")
    save(client, project_id, "kept\ngone\n", "tab-b")
    history = server_main.session_for(project_id).history
    gone = history.versions("main.tex")[-1].sha
    history.blobs.path_for(gone).unlink()

    archive = zipfile.ZipFile(io.BytesIO(export(client, project_id).content))
    rows = list(csv.DictReader(io.StringIO(archive.read("log.csv").decode())))
    missing = [row for row in rows if row["sha256"] == gone]
    assert missing and missing[0]["here"] == "False" and missing[0]["file"] == ""
    assert gone not in archive.read("SHA256SUMS").decode()
    assert "not on this machine" in archive.read("report.html").decode()


def test_a_figure_has_a_trail_without_a_diff(client, opened, project_dir):
    project_id = opened["id"]
    png = b"\x89PNG\r\n\x1a\n" + bytes(range(256))
    session = server_main.session_for(project_id)
    (project_dir / "fig.png").write_bytes(png)
    session.record_version(project_dir / "fig.png", png, by="you", why="added")

    archive = zipfile.ZipFile(io.BytesIO(export(client, project_id, "fig.png").content))
    member = next(name for name in archive.namelist() if name.startswith("versions/"))
    assert archive.read(member) == png
    assert "Not text" in archive.read("report.html").decode()


def test_a_path_outside_the_project_is_refused(client, opened):
    response = export(client, opened["id"], "../../../etc/passwd")
    assert response.status_code in (400, 403)
