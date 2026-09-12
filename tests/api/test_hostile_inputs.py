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

    # The scratch file is opened rather than written through `write_text`
    # now, because flushing it to disk before the rename needs a descriptor.
    # The disk still runs out in the middle of the write, which is the point:
    # the temporary file exists and has to be cleaned up.
    original = atomic.Path.open

    def full(self, *args, **kwargs):
        handle = original(self, *args, **kwargs)
        if self.name.endswith(atomic.SUFFIX):
            def refuse(*_args, **_kwargs):
                raise OSError(28, "No space left on device")

            handle.write = refuse
        return handle

    monkeypatch.setattr(atomic.Path, "open", full)
    before = (project_dir / "main.tex").read_text(encoding="utf-8")
    response = client.put(
        f"/api/projects/{opened['id']}/file",
        json={"path": "main.tex", "text": "the replacement", "compile": False},
    )
    assert response.status_code >= 400
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == before
    assert list(project_dir.glob(f"**/*{atomic.SUFFIX}")) == []


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
    assert mine and mine[0]["missing"] is True
    # And it keeps its identity.  This used to assert the id was None, which
    # described the behaviour accurately and was the bug: the only actions
    # left on a dead entry -- removing it, or saying where the folder went --
    # both need something to address it by.
    assert mine[0]["id"]


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


def test_an_unknown_api_route_is_a_404_and_not_the_whole_interface(client):
    """The single-page catch-all is registered last and claims everything
    no route wanted, which is right for the app and wrong for the API: a
    typo in a path, or a route removed while a tab was open, answered 200
    with the interface as its body, and the browser's error path read that
    as success and tried to parse a page of HTML as JSON."""
    answer = client.get("/api/no-such-route-at-all")

    assert answer.status_code == 404
    assert "text/html" not in answer.headers.get("content-type", "")


def test_a_known_route_reached_the_wrong_way_is_not_the_interface_either(client):
    """`/api/projects/{id}/open` is a POST, and this asks for it with GET.

    It used to be what the test above asked for, which made it a test of
    the router's method handling rather than of the catch-all, and the two
    disagree across versions of the framework: one answers 405 before
    anything else can look at the path, and one falls through to the next
    route that matches, which is the catch-all. It passed here and failed
    on a runner for that reason alone.

    The claim worth holding is the one that does not depend on which of
    those happens: a request under /api/ is never answered with a page of
    HTML.
    """
    answer = client.get("/api/projects/nosuch/open")

    assert answer.status_code in (404, 405), answer.status_code
    assert "text/html" not in answer.headers.get("content-type", "")


def test_a_body_that_will_not_parse_says_which_field(client):
    """FastAPI's default is a list of objects under `detail`. `api.ts` has
    one error path and it reads `error`, so the writer was shown
    "[object Object]" for what is nearly always a missing field."""
    answer = client.post("/api/projects", json={})

    assert answer.status_code == 422
    body = answer.json()
    assert isinstance(body.get("error"), str), body
    assert "path" in body["error"]
