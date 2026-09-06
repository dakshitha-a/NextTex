"""Things a writer will do that nothing was written for.

None of these is an attack.  They are a figure with a per cent sign in its
name, a chapter pasted from Word, a project of two thousand files, a
directory that went read-only because Dropbox is syncing it.  Each one used
to be, or could have been, a 500.
"""

import stat

import pytest


def test_a_file_that_is_not_text_says_so_rather_than_failing(client, opened,
                                                            project_dir):
    (project_dir / "figure.tex").write_bytes(b"\xff\xfe\x00\x01 not utf-8")
    response = client.get(f"/api/projects/{opened['id']}/file",
                          params={"path": "figure.tex"})
    assert response.status_code == 415
    assert "text" in response.json()["detail"]


def test_the_symbol_scan_survives_a_file_that_is_not_text(client, opened,
                                                          project_dir):
    (project_dir / "broken.tex").write_bytes(b"\\label{ok}\xff\xfe binary")
    assert client.get(f"/api/projects/{opened['id']}/symbols").status_code == 200


@pytest.mark.parametrize("name", [
    "a file with spaces.tex",
    "100% of the results.tex",
    "chapter#3.tex",
    "results & discussion.tex",
    "naïve-café.tex",
    "σχέδιο.tex",
    "a" * 200 + ".tex",
    ".hidden.tex",
    "-dash-first.tex",
])
def test_a_file_can_be_called_almost_anything(client, opened, project_dir, name):
    """`%` and `#` matter more than they look: they are LaTeX-special, and
    the name goes into an \\input."""
    created = client.post(f"/api/projects/{opened['id']}/file/new",
                          json={"path": name})
    assert created.status_code == 200, created.text
    written = client.put(f"/api/projects/{opened['id']}/file",
                         json={"path": name, "text": "prose", "compile": False})
    assert written.status_code == 200
    read = client.get(f"/api/projects/{opened['id']}/file", params={"path": name})
    assert read.json()["text"] == "prose"

    tree = client.get(f"/api/projects/{opened['id']}/tree").json()
    assert name in _names(tree)


def _names(node) -> set:
    found = {node.get("name", "")}
    for child in node.get("children") or []:
        found |= _names(child)
    return found


def test_a_file_that_vanishes_between_the_listing_and_the_read(client, opened,
                                                               project_dir):
    (project_dir / "gone.tex").write_text("here for now", encoding="utf-8")
    client.get(f"/api/projects/{opened['id']}/tree")
    (project_dir / "gone.tex").unlink()
    assert client.get(f"/api/projects/{opened['id']}/file",
                      params={"path": "gone.tex"}).status_code == 404


def test_a_save_into_a_read_only_directory_leaves_the_original_alone(
    client, opened, project_dir
):
    """Which is the whole promise of writing through a temporary file."""
    folder = project_dir / "locked"
    folder.mkdir()
    target = folder / "chapter.tex"
    target.write_text("the original", encoding="utf-8")
    folder.chmod(stat.S_IRUSR | stat.S_IXUSR)
    try:
        response = client.put(
            f"/api/projects/{opened['id']}/file",
            json={"path": "locked/chapter.tex", "text": "the replacement",
                  "compile": False},
        )
        assert response.status_code >= 400
        assert target.read_text(encoding="utf-8") == "the original"
        # And nothing was left lying around where the file tree would show it.
        folder.chmod(stat.S_IRWXU)
        assert [p.name for p in folder.iterdir()] == ["chapter.tex"]
    finally:
        folder.chmod(stat.S_IRWXU)


def test_a_disk_that_runs_out_does_not_take_the_file_with_it(
    client, opened, project_dir, monkeypatch
):
    from nexttex import atomic

    original = atomic.Path.write_text

    def full(self, *args, **kwargs):
        if self.name.endswith(atomic.SUFFIX):
            raise OSError(28, "No space left on device")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(atomic.Path, "write_text", full)
    before = (project_dir / "main.tex").read_text(encoding="utf-8")
    response = client.put(
        f"/api/projects/{opened['id']}/file",
        json={"path": "main.tex", "text": "the replacement", "compile": False},
    )
    assert response.status_code >= 400
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == before


def test_a_project_of_two_thousand_files_still_lists(client, opened, project_dir):
    for index in range(2000):
        (project_dir / f"note{index:04d}.tex").write_text("x", encoding="utf-8")
    response = client.get(f"/api/projects/{opened['id']}/tree")
    assert response.status_code == 200
    assert len(_names(response.json())) > 2000


def test_a_project_directory_that_has_gone_is_reported_not_dropped(client, project,
                                                                   project_dir):
    import shutil

    shutil.rmtree(project_dir)
    listed = client.get("/api/projects").json()["projects"]
    mine = [p for p in listed if p["path"] == str(project_dir)]
    assert mine and mine[0]["missing"] is True and mine[0]["id"] is None


def test_a_config_nobody_can_parse_opens_anyway(client, project_dir):
    (project_dir / "nexttex.toml").write_text('name = "unclosed', encoding="utf-8")
    from nexttex.project import Project

    opened = Project.open(project_dir)
    assert opened.config.main.endswith(".tex")


def test_a_registry_from_a_later_version_does_not_take_the_list_down(client,
                                                                     project_dir):
    """A key nothing here has heard of used to raise out of the dataclass,
    and the project list is the first thing every screen reads."""
    from conftest import server_main

    server_main.REGISTRY.path.write_text(
        '[{"path": "%s", "name": "p", "colour": "green", "pinned": true}]'
        % project_dir,
        encoding="utf-8",
    )
    assert client.get("/api/projects").status_code == 200


def test_a_symlink_loop_does_not_hang_the_file_tree(client, opened, project_dir):
    (project_dir / "loop").symlink_to(project_dir)
    response = client.get(f"/api/projects/{opened['id']}/tree")
    assert response.status_code == 200


def test_asking_twice_while_a_turn_is_running_is_refused_not_queued(client, opened):
    from conftest import use_script

    use_script(opened["id"], "slow")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "one"})
    assert client.post(f"/api/projects/{opened['id']}/agent/ask",
                       json={"prompt": "two"}).status_code == 409
    client.post(f"/api/projects/{opened['id']}/agent/interrupt")
