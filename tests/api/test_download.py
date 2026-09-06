"""Taking a copy away.

The rule this defends: a download is the same bytes the project holds, and
nothing regenerable travels with it.  It also has to work from the project
list, where nothing is open -- that is the moment somebody most wants one.
"""

import io
import zipfile


def test_one_file_comes_back_as_itself(client, opened):
    response = client.get(
        f"/api/projects/{opened['id']}/download", params={"path": "main.tex"}
    )
    assert response.status_code == 200
    assert "documentclass" in response.text


def test_the_whole_project_comes_back_as_a_zip(client, opened, project_dir):
    (project_dir / "build").mkdir(exist_ok=True)
    (project_dir / "build" / "main.pdf").write_bytes(b"%PDF regenerable")
    (project_dir / "figures" / "plot.png").write_bytes(b"\x89PNG")

    response = client.get(f"/api/projects/{opened['id']}/download")
    assert response.status_code == 200
    assert response.headers["content-disposition"].endswith('.zip"')

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
    assert "main.tex" in names
    assert "figures/plot.png" in names
    assert not [n for n in names if n.startswith("build/")]
    assert not [n for n in names if ".nexttex" in n]


def test_a_project_that_is_not_open_can_still_be_downloaded(client, project):
    response = client.get(f"/api/projects/{project['id']}/download")
    assert response.status_code == 200


def test_a_path_outside_the_project_is_refused(client, opened):
    response = client.get(
        f"/api/projects/{opened['id']}/download", params={"path": "../../etc/passwd"}
    )
    assert response.status_code == 403


def test_a_nul_byte_in_the_path_is_a_bad_request_not_a_crash(client, opened):
    response = client.get(
        f"/api/projects/{opened['id']}/download", params={"path": "a\x00b"}
    )
    assert response.status_code == 400


def test_nothing_is_left_behind_in_the_temporary_directory(client, opened):
    import tempfile
    from pathlib import Path

    before = set(Path(tempfile.gettempdir()).glob("nexttex-download-*"))
    client.get(f"/api/projects/{opened['id']}/download")
    after = set(Path(tempfile.gettempdir()).glob("nexttex-download-*"))
    assert after <= before
