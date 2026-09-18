"""An edit made outside NextTex while the server is running is a version.

The watcher folded a `git pull` or another editor's save into the document
and nothing recorded what the file held before or after: only the
projection's own writes and, since the projection record, edits made while
the server was stopped were versions. `_fold_tick` is the watcher's work
for one tick, driven here directly with files written to disk, because the
watcher itself polls a real directory on a real timer.
"""

from pathlib import Path

from server import main as server_main


def versions_of(client, project_id: str, path: str) -> list[dict]:
    """A file's versions, oldest first; the route answers newest first."""
    answer = client.get(f"/api/projects/{project_id}/history", params={"path": path})
    return list(reversed(answer.json()["versions"]))


def fold(client, project_id: str, *paths: str) -> None:
    session = server_main.SESSIONS[project_id]
    client.portal.call(server_main._fold_tick, session, set(paths))


def document_text(client, project_id: str, path: str) -> str:
    """The shared document's text, read on the app's own loop: a pycrdt
    document belongs to the thread that built it, and this thread is not
    that one."""
    session = server_main.SESSIONS[project_id]

    async def read() -> str:
        return str(session.collab.body(session.collab.file_id_for(path)))

    return client.portal.call(read)


def test_files_a_tick_touched_share_one_stamp(client, opened, project_dir):
    """Two files written in one debounce window, the shape of a pull, get
    two versions carrying the same `source`, which is what the timeline
    folds on."""
    project_id = opened["id"]
    (project_dir / "main.tex").write_text("\\section{Pulled}\n", encoding="utf-8")
    (project_dir / "notes.tex").write_text("New in the pull.\n", encoding="utf-8")

    fold(client, project_id, "main.tex", "notes.tex")

    main = versions_of(client, project_id, "main.tex")
    notes = versions_of(client, project_id, "notes.tex")
    assert main and notes
    assert main[-1]["why"] == "changed outside NextTex"
    assert main[-1]["source"].startswith("outside:")
    assert main[-1]["source"] == notes[-1]["source"]
    # Neither document was open, so what the files held before the tick
    # was never anywhere NextTex could see: each history begins with the
    # pulled text, as a creation rather than an edit.
    assert [v["op"] for v in main] == ["create"]
    assert [v["op"] for v in notes] == ["create"]


def test_an_open_document_keeps_its_earlier_state_as_the_first_version(
    client, opened, project_dir,
):
    """A document that is open when the pull lands is the one case where
    the earlier state is known, and it seeds the history so what was there
    before can be got back."""
    project_id = opened["id"]
    template = (project_dir / "main.tex").read_text(encoding="utf-8")
    assert document_text(client, project_id, "main.tex") == template
    (project_dir / "main.tex").write_text("\\section{Pulled}\n", encoding="utf-8")

    fold(client, project_id, "main.tex")

    main = versions_of(client, project_id, "main.tex")
    assert [v["op"] for v in main] == ["create", "edit"]
    assert client.get(
        f"/api/projects/{project_id}/history/blob",
        params={"path": "main.tex", "sha": main[0]["sha"]},
    ).json()["text"] == template
    assert main[1]["why"] == "changed outside NextTex"
    assert document_text(client, project_id, "main.tex") == "\\section{Pulled}\n"


def test_a_typed_save_and_an_outside_save_inside_the_window_are_two_versions(
    client, opened, project_dir,
):
    project_id = opened["id"]
    saved = client.put(
        f"/api/projects/{project_id}/file",
        json={"path": "main.tex", "text": "typed here\n", "compile": False},
    )
    assert saved.status_code == 200, saved.text
    before = versions_of(client, project_id, "main.tex")
    assert before, "the typed save was never recorded"
    (project_dir / "main.tex").write_text("pulled from git\n", encoding="utf-8")

    fold(client, project_id, "main.tex")

    after = versions_of(client, project_id, "main.tex")
    assert len(after) == len(before) + 1
    assert after[-1]["source"].startswith("outside:")
    assert after[-2]["source"] == before[-1]["source"]
    assert document_text(client, project_id, "main.tex") == "pulled from git\n"


def test_a_file_written_to_what_the_document_holds_is_not_a_version(
    client, opened, project_dir,
):
    """`ingest` diffs, so a tool that rewrites a file unchanged, or the
    projection's own write coming back around, changes nothing and
    records nothing."""
    project_id = opened["id"]
    text = (project_dir / "main.tex").read_text(encoding="utf-8")
    assert document_text(client, project_id, "main.tex") == text
    before = versions_of(client, project_id, "main.tex")
    (project_dir / "main.tex").write_text(text, encoding="utf-8")

    fold(client, project_id, "main.tex")

    assert versions_of(client, project_id, "main.tex") == before


def test_a_figure_that_changes_outside_gets_no_text_version(client, opened, project_dir):
    project_id = opened["id"]
    (project_dir / "figures" / "plot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    fold(client, project_id, "figures/plot.png")
    assert versions_of(client, project_id, "figures/plot.png") == []
