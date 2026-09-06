"""Reading and writing files through the API.

Every route that takes a path is asked to leave the project; none of them
may.  And every write path is asked to do something ordinary but wrong --
write to a directory, rename what is not there -- because those are the
mistakes that turn into a 500 and a stranded temp file.
"""

import pytest

ESCAPES = [
    "../outside.tex",
    "chapters/../../outside.tex",
    "/etc/passwd",
    "./../../outside.tex",
]


def test_a_file_can_be_read(client, opened):
    body = client.get(f"/api/projects/{opened['id']}/file", params={"path": "main.tex"})
    assert body.status_code == 200
    assert "\\documentclass" in body.json()["text"]


def test_reading_something_that_is_not_there(client, opened):
    response = client.get(f"/api/projects/{opened['id']}/file", params={"path": "no.tex"})
    assert response.status_code == 404


def test_reading_a_file_that_is_not_text(client, opened, project_dir):
    (project_dir / "figures" / "plot.png").write_bytes(b"\x89PNG\x00\xff\xfe")
    response = client.get(
        f"/api/projects/{opened['id']}/file", params={"path": "figures/plot.png"}
    )
    assert response.status_code == 415


@pytest.mark.parametrize("path", ESCAPES)
def test_reading_outside_the_project_is_refused(client, opened, path):
    response = client.get(f"/api/projects/{opened['id']}/file", params={"path": path})
    assert response.status_code in (400, 403), f"{path} was not refused"


@pytest.mark.parametrize("path", ESCAPES)
def test_writing_outside_the_project_is_refused(client, opened, path):
    response = client.put(
        f"/api/projects/{opened['id']}/file",
        json={"path": path, "text": "x", "compile": False},
    )
    assert response.status_code in (400, 403), f"{path} was not refused"


def test_a_symlink_out_of_the_project_is_refused(client, opened, project_dir, tmp_path):
    secret = tmp_path / "secret.tex"
    secret.write_text("private", encoding="utf-8")
    (project_dir / "innocent.tex").symlink_to(secret)
    response = client.get(
        f"/api/projects/{opened['id']}/file", params={"path": "innocent.tex"}
    )
    assert response.status_code in (400, 403)


def test_a_write_lands_and_is_versioned(client, opened, project_dir):
    client.put(
        f"/api/projects/{opened['id']}/file",
        json={"path": "main.tex", "text": "new text", "compile": False},
    )
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == "new text"
    versions = client.get(
        f"/api/projects/{opened['id']}/history", params={"path": "main.tex"}
    ).json()["versions"]
    # The state before NextTex saw it, and the state after.
    assert len(versions) == 2
    assert versions[-1]["op"] == "create"


def test_writing_to_a_directory_says_so_rather_than_500ing(client, opened, project_dir):
    response = client.put(
        f"/api/projects/{opened['id']}/file",
        json={"path": "figures", "text": "x", "compile": False},
    )
    assert response.status_code == 400
    stranded = list(project_dir.glob("**/*.nexttex-tmp"))
    assert stranded == [], f"a temp file was left behind: {stranded}"


def test_renaming_something_that_is_not_there(client, opened):
    response = client.post(
        f"/api/projects/{opened['id']}/file/rename",
        json={"path": "nope.tex", "to": "other.tex"},
    )
    assert response.status_code == 404


def test_renaming_onto_an_existing_name_is_refused(client, opened):
    response = client.post(
        f"/api/projects/{opened['id']}/file/rename",
        json={"path": "main.tex", "to": "references.bib"},
    )
    assert response.status_code == 409


def test_a_rename_carries_the_history_across(client, opened):
    client.put(f"/api/projects/{opened['id']}/file",
               json={"path": "main.tex", "text": "before the rename", "compile": False})
    client.post(f"/api/projects/{opened['id']}/file/rename",
                json={"path": "main.tex", "to": "thesis.tex"})
    versions = client.get(f"/api/projects/{opened['id']}/history",
                          params={"path": "thesis.tex"}).json()["versions"]
    assert len(versions) >= 1


def test_a_new_file_and_a_new_folder(client, opened, project_dir):
    client.post(f"/api/projects/{opened['id']}/file/new",
                json={"path": "chapters/one.tex"})
    client.post(f"/api/projects/{opened['id']}/file/new",
                json={"path": "figures/raw", "directory": True})
    assert (project_dir / "chapters" / "one.tex").is_file()
    assert (project_dir / "figures" / "raw").is_dir()
    again = client.post(f"/api/projects/{opened['id']}/file/new",
                        json={"path": "chapters/one.tex"})
    assert again.status_code == 409


def test_the_tree_hides_what_it_should(client, opened, project_dir):
    (project_dir / "build").mkdir(exist_ok=True)
    (project_dir / "build" / "main.pdf").write_bytes(b"%PDF")
    names = [c["name"] for c in client.get(
        f"/api/projects/{opened['id']}/tree").json()["children"]]
    assert "main.tex" in names
    assert "build" not in names
    assert ".nexttex" not in names


def test_a_save_never_brings_a_deleted_file_back(client, opened, project_dir):
    """Renaming or deleting an open file left the tab pointing at the old
    name; this route's mkdir-and-write then recreated it, and the writer
    carried on editing an orphan nothing includes."""
    client.delete(f"/api/projects/{opened['id']}/file", params={"path": "main.tex"})
    assert not (project_dir / "main.tex").exists()

    response = client.put(
        f"/api/projects/{opened['id']}/file",
        json={"path": "main.tex", "text": "still typing", "compile": False},
    )
    assert response.status_code == 404
    assert not (project_dir / "main.tex").exists()


def test_a_deliberate_creation_is_still_allowed(client, opened, project_dir):
    response = client.put(
        f"/api/projects/{opened['id']}/file",
        json={"path": "chapters/new.tex", "text": "a start",
              "compile": False, "create": True},
    )
    assert response.status_code == 200
    assert (project_dir / "chapters" / "new.tex").read_text(
        encoding="utf-8") == "a start"


def test_history_follows_a_file_across_a_rename(client, opened):
    client.put(f"/api/projects/{opened['id']}/file",
               json={"path": "main.tex", "text": "early words", "compile": False})
    client.post(f"/api/projects/{opened['id']}/file/rename",
                json={"path": "main.tex", "to": "thesis.tex"})
    versions = client.get(f"/api/projects/{opened['id']}/history",
                          params={"path": "thesis.tex"}).json()["versions"]
    assert versions
    assert client.get(f"/api/projects/{opened['id']}/history",
                      params={"path": "main.tex"}).json()["versions"] == []


def test_creating_a_file_tells_the_other_tabs_a_name_appeared(client, opened):
    """An ordinary save is not structural -- nothing appeared, so the other
    windows reload that one file rather than walking the whole tree.  A
    *creation* is, and calling it otherwise left the new file missing from
    every open tab's tree until somebody reloaded the page."""
    from conftest import server_main

    session = server_main.SESSIONS[opened["id"]]
    seen = []
    original = session.events.publish

    async def spy(event):
        seen.append(event)
        await original(event)

    session.events.publish = spy
    try:
        client.put(f"/api/projects/{opened['id']}/file",
                   json={"path": "notes.tex", "text": "new\n",
                         "compile": False, "create": True})
    finally:
        session.events.publish = original

    told = [e for e in seen if e["type"] == "files_changed"]
    assert told and told[-1]["structural"] is True


def test_lint_answers_with_a_list_whether_or_not_chktex_is_installed(client, opened):
    """The route is optional by design: no chktex, no findings, and the
    editor simply shows nothing rather than an error.  What the findings
    themselves look like is not asserted here -- this machine has no chktex,
    and a test that only runs where a tool happens to be installed is worse
    than no test."""
    answer = client.get(f"/api/projects/{opened['id']}/lint",
                        params={"path": "main.tex"})
    assert answer.status_code == 200
    assert isinstance(answer.json()["diagnostics"], list)


def test_lint_will_not_read_outside_the_project(client, opened):
    answer = client.get(f"/api/projects/{opened['id']}/lint",
                        params={"path": "../../etc/passwd"})
    assert answer.status_code in (400, 403)


def test_lint_reports_what_chktex_finds(client, opened, project_dir):
    """The rules in `.chktexrc` are load-bearing, and were inert for the
    whole life of the file: it used a `WarnOff` keyword chktex has never
    had, so chktex refused to start, wrote one line to stderr, and the app
    read its empty stdout as "nothing to report".  Linting looked like a
    feature with nothing to say."""
    (project_dir / "rough.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n"
        "A sentence with a space before punctuation , like that.\n"
        "\\end{document}\n",
        encoding="utf-8",
    )
    body = client.get(f"/api/projects/{opened['id']}/lint",
                      params={"path": "rough.tex"}).json()
    messages = [item["message"] for item in body["diagnostics"]]
    assert any("punctuation" in message for message in messages), messages
    # One finding per line, not one blob: the format string carries a real
    # newline, and every diagnostic needs its own line and column.
    assert all(item["line"] and "\n" not in item["message"]
               for item in body["diagnostics"])


def test_lint_honours_the_projects_own_suppressions(client, opened, project_dir):
    """Warning 11 -- "you should use \\ldots" -- is style rather than
    correctness, and is switched off on purpose.  It is the cheapest proof
    that the rc file is being read at all."""
    (project_dir / "dots.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n"
        "A sentence trailing off ... and a space before punctuation , here.\n"
        "\\end{document}\n",
        encoding="utf-8",
    )
    body = client.get(f"/api/projects/{opened['id']}/lint",
                      params={"path": "dots.tex"}).json()
    messages = [item["message"] for item in body["diagnostics"]]
    # chktex ran and had something to say about this line...
    assert any("punctuation" in message for message in messages), messages
    # ...and what it chose not to say is the suppression working, rather
    # than chktex having failed to start.
    assert not any("ldots" in message for message in messages), messages
