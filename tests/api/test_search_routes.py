"""Project-wide find and replace.

The two things worth guarding here are the two the pure module in
`tests/test_search.py` cannot see: that the search reads what is in the
editor rather than only what has reached disk, and that a replace leaves a
version behind in every file it touched, because that version is the undo.
"""

from pathlib import Path


def seed(client, project_id, path, text):
    answer = client.put(
        f"/api/projects/{project_id}/file",
        json={"path": path, "text": text, "compile": False, "create": True},
    )
    assert answer.status_code == 200, answer.text


def test_a_string_is_found_in_every_file_that_has_it(client, opened):
    pid = opened["id"]
    seed(client, pid, "one.tex", "see \\ref{eq:flux} here\nand nothing")
    seed(client, pid, "two.tex", "also \\ref{eq:flux}")
    answer = client.get(f"/api/projects/{pid}/search", params={"q": "eq:flux"})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["files"] == 2
    assert {hit["path"] for hit in body["hits"]} == {"one.tex", "two.tex"}
    first = [hit for hit in body["hits"] if hit["path"] == "one.tex"][0]
    assert (first["line"], first["column"]) == (1, 10)
    assert first["text"] == "see \\ref{eq:flux} here"


def test_a_pattern_that_is_not_one_is_a_bad_request(client, opened):
    answer = client.get(
        f"/api/projects/{opened['id']}/search",
        params={"q": "(unclosed", "regex": "true"},
    )
    assert answer.status_code == 400
    assert "not a pattern" in answer.json()["detail"]


def test_nothing_to_search_for_is_a_bad_request(client, opened):
    answer = client.get(f"/api/projects/{opened['id']}/search", params={"q": ""})
    assert answer.status_code == 400


def test_the_build_directory_and_the_control_directory_are_not_searched(
    client, opened, project_dir
):
    pid = opened["id"]
    build = project_dir / "build"
    build.mkdir(exist_ok=True)
    (build / "main.log").write_text("needleneedle", encoding="utf-8")
    (project_dir / ".nexttex").mkdir(exist_ok=True)
    (project_dir / ".nexttex" / "notes.md").write_text("needleneedle", encoding="utf-8")
    answer = client.get(f"/api/projects/{pid}/search", params={"q": "needleneedle"})
    assert answer.json()["hits"] == []


def test_replacing_rewrites_every_file_and_leaves_a_version_in_each(client, opened):
    pid = opened["id"]
    # A command the shipped template does not use, so the count is the two
    # files this test made and not whatever else is in the project.
    seed(client, pid, "one.tex", "\\mycite{a} and \\mycite{b}")
    seed(client, pid, "two.tex", "\\mycite{c}")
    answer = client.post(
        f"/api/projects/{pid}/search/replace",
        json={"q": "\\mycite", "with": "\\mycitep"},
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert (body["files"], body["replaced"]) == (2, 3)

    read = client.get(f"/api/projects/{pid}/file", params={"path": "one.tex"})
    assert read.json()["text"] == "\\mycitep{a} and \\mycitep{b}"

    # The undo the confirmation promises: the text before the replace is in
    # that file's own history.
    history = client.get(
        f"/api/projects/{pid}/history", params={"path": "one.tex"}
    )
    assert history.status_code == 200, history.text
    assert history.json()["versions"], "the replace left nothing to go back to"


def test_replacing_can_be_held_to_the_files_that_were_chosen(client, opened):
    pid = opened["id"]
    seed(client, pid, "one.tex", "keep")
    seed(client, pid, "two.tex", "keep")
    answer = client.post(
        f"/api/projects/{pid}/search/replace",
        json={"q": "keep", "with": "gone", "paths": ["two.tex"]},
    )
    assert answer.json()["paths"] == ["two.tex"]
    read = client.get(f"/api/projects/{pid}/file", params={"path": "one.tex"})
    assert read.json()["text"] == "keep"


def test_a_replacement_of_backslashes_is_not_read_as_escapes(client, opened):
    # `re.sub` would raise "bad escape \\c" on this, which as a 500 with an
    # empty body is the worst way for a writer to find out.
    pid = opened["id"]
    seed(client, pid, "one.tex", "\\cite{a}")
    answer = client.post(
        f"/api/projects/{pid}/search/replace",
        json={"q": "\\cite", "with": "\\citep"},
    )
    assert answer.status_code == 200, answer.text
    read = client.get(f"/api/projects/{pid}/file", params={"path": "one.tex"})
    assert read.json()["text"] == "\\citep{a}"
