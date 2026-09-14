"""Previewing more than one document in a project.

A dissertation and the supplementary information beside it are two
documents in one folder, and neither includes the other. The risk this
whole feature carries is serving one document's PDF for the other, so most
of what is checked here is that the two stay apart.

There is no main document. Every root `.tex` is a document, the one on the
screen is what an unqualified request means, and the preview follows the
file being written to the document that reads it.
"""

import json

import server.main as server_main


def add(client, project_dir, name: str, text: str) -> None:
    (project_dir / name).write_text(text, encoding="utf-8")


STANDALONE = (
    "\\documentclass{article}\n\\begin{document}\nSupplementary.\n\\end{document}\n"
)


def test_a_project_previews_its_guessed_document_and_nothing_else(client, opened):
    body = client.get(f"/api/projects/{opened['id']}/documents").json()
    assert body["previews"] == ["main.tex"]
    assert body["visible"] == "main.tex"
    assert "main" not in body


def test_a_standalone_document_is_offered_but_not_previewed(
    client, project_dir, opened
):
    add(client, project_dir, "esi.tex", STANDALONE)
    server_main.SESSIONS[opened["id"]].deps.invalidate()
    body = client.get(f"/api/projects/{opened['id']}/documents").json()
    assert "esi.tex" in body["candidates"]
    assert "esi.tex" not in body["previews"]


def test_a_new_document_is_found_without_reopening(client, project_dir, opened):
    """A file the writer makes is offered as soon as it exists.  The scan
    is debounced behind the `files_changed` event the write publishes, so
    this waits on the event stream rather than on a clock."""
    import time

    project_id = opened["id"]
    response = client.put(
        f"/api/projects/{project_id}/file",
        json={"path": "variant.tex", "text": STANDALONE, "compile": False, "create": True},
    )
    assert response.status_code == 200, response.text
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        body = client.get(f"/api/projects/{project_id}/documents").json()
        if "variant.tex" in body["candidates"]:
            break
        time.sleep(0.05)
    assert "variant.tex" in body["candidates"]


def test_a_fragment_is_not_offered(client, project_dir, opened):
    # No \documentclass of its own, so it cannot be built by itself.
    add(client, project_dir, "chapter.tex", "A chapter with no preamble.\n")
    server_main.SESSIONS[opened["id"]].deps.invalidate()
    body = client.get(f"/api/projects/{opened['id']}/documents").json()
    assert "chapter.tex" not in body["candidates"]


def test_previewing_a_second_document_is_remembered_by_this_install(
    client, project_dir, opened
):
    """The strip is viewer state, so it lives in `.nexttex/`, which is never
    synced, and not in the toml, which is shared with collaborators."""
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    body = client.post(
        f"/api/projects/{project_id}/previews", json={"path": "esi.tex"}
    ).json()
    assert body["previews"] == ["main.tex", "esi.tex"]
    assert body["document"] == "esi.tex"
    assert body["visible"] == "esi.tex"
    remembered = json.loads(
        (project_dir / ".nexttex" / "previews.json").read_text(encoding="utf-8")
    )
    assert remembered == ["main.tex", "esi.tex"]
    client.post(f"/api/projects/{project_id}/settings", json={"markWarnings": True})
    toml = (project_dir / "nexttex.toml").read_text(encoding="utf-8")
    assert "previews" not in toml and "main" not in toml


def test_an_older_toml_seeds_the_list_once(client, project_dir):
    """A project last opened by a NextTex that kept `main` and `previews`
    in the toml keeps the documents it had, in that order."""
    add(client, project_dir, "esi.tex", STANDALONE)
    (project_dir / "nexttex.toml").write_text(
        '[project]\nname = "T"\nmain = "esi.tex"\nprevews = 0\n'
        'previews = ["main.tex"]\n',
        encoding="utf-8",
    )
    project = client.post("/api/projects", json={"path": str(project_dir)}).json()
    body = client.post(f"/api/projects/{project['id']}/open").json()
    assert body["previews"] == ["esi.tex", "main.tex"]
    remembered = json.loads(
        (project_dir / ".nexttex" / "previews.json").read_text(encoding="utf-8")
    )
    assert remembered == ["esi.tex", "main.tex"]


def test_a_folder_with_no_document_opens_and_says_so(client, tmp_path):
    """A brand new project has no document until its template is loaded.
    Its PDF is a 404 that says why, not a 500 from an empty registry."""
    root = tmp_path / "blank"
    root.mkdir()
    (root / "notes.md").write_text("soon\n", encoding="utf-8")
    project = client.post("/api/projects", json={"path": str(root)}).json()
    body = client.post(f"/api/projects/{project['id']}/open").json()
    assert body["previews"] == []
    assert body["visible"] == ""
    answer = client.get(f"/api/projects/{project['id']}/pdf")
    assert answer.status_code == 404
    assert "no document" in answer.text
    # The template goes into a fresh main.tex, which becomes the document.
    loaded = client.post(f"/api/projects/{project['id']}/template", json={"name": "basic"})
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["document"] == "main.tex"
    body = client.get(f"/api/projects/{project['id']}/documents").json()
    assert body["previews"] == ["main.tex"]


def test_a_fragment_nothing_reads_has_nothing_to_preview(client, project_dir, opened):
    add(client, project_dir, "chapter.tex", "No preamble here.\n")
    response = client.post(
        f"/api/projects/{opened['id']}/previews", json={"path": "chapter.tex"}
    )
    assert response.status_code == 404
    assert "documentclass" in response.text


def test_a_chapter_previews_the_document_that_reads_it(client, project_dir, opened):
    """The preview follows the file being written, up the whole chain of
    parts, to the document at the top."""
    project_id = opened["id"]
    (project_dir / "parts").mkdir(exist_ok=True)
    add(client, project_dir, "esi.tex",
        "\\documentclass{article}\n\\begin{document}\n\\input{parts/one}\n\\end{document}\n")
    add(client, project_dir, "parts/one.tex", "\\input{two}\nOne.\n")
    add(client, project_dir, "parts/two.tex", "Two.\n")
    server_main.SESSIONS[project_id].deps.invalidate()
    body = client.post(
        f"/api/projects/{project_id}/previews", json={"path": "parts/two.tex"}
    ).json()
    assert body["document"] == "esi.tex"
    assert body["previews"] == ["main.tex", "esi.tex"]
    assert body["visible"] == "esi.tex"


def test_a_shared_part_stays_with_the_document_on_screen(client, project_dir, opened):
    """A block of text two variants both read previews whichever of them is
    in front, so the page never changes under the writer."""
    project_id = opened["id"]
    add(client, project_dir, "shared.tex", "Skills.\n")
    add(client, project_dir, "acme.tex",
        "\\documentclass{article}\n\\begin{document}\n\\input{shared}\n\\end{document}\n")
    add(client, project_dir, "globex.tex",
        "\\documentclass{article}\n\\begin{document}\n\\input{shared}\n\\end{document}\n")
    client.post(f"/api/projects/{project_id}/previews", json={"path": "globex.tex"})
    server_main.SESSIONS[project_id].deps.invalidate()
    body = client.post(
        f"/api/projects/{project_id}/previews", json={"path": "shared.tex"}
    ).json()
    assert body["document"] == "globex.tex"
    # Nothing previewed reads it: the first by path, the same on every open.
    session = server_main.SESSIONS[project_id]
    assert session.deps.root_of("shared.tex", prefer=["main.tex"]) == "acme.tex"


def test_a_subfile_chapter_previews_its_parent(client, project_dir, opened):
    """A `\\subfile` chapter has a documentclass of its own and is still a
    part of the document that reads it."""
    project_id = opened["id"]
    add(client, project_dir, "thesis.tex",
        "\\documentclass{report}\n\\begin{document}\n\\subfile{ch1}\n\\end{document}\n")
    add(client, project_dir, "ch1.tex",
        "\\documentclass[thesis]{subfiles}\n\\begin{document}\nOne.\n\\end{document}\n")
    server_main.SESSIONS[project_id].deps.invalidate()
    body = client.post(
        f"/api/projects/{project_id}/previews", json={"path": "ch1.tex"}
    ).json()
    assert body["document"] == "thesis.tex"


def test_two_documents_cannot_share_one_jobname(client, project_dir, opened):
    """Both would build to main.pdf, and each would serve the other's page."""
    (project_dir / "parts").mkdir(exist_ok=True)
    (project_dir / "parts" / "main.tex").write_text(STANDALONE, encoding="utf-8")
    response = client.post(
        f"/api/projects/{opened['id']}/previews", json={"path": "parts/main.tex"}
    )
    assert response.status_code == 409
    assert "main.pdf" in response.text
    # Following a chapter of the colliding document says the same thing,
    # rather than leaving the preview where it was without a word.
    add(client, project_dir, "parts/ch.tex", "A chapter.\n")
    (project_dir / "parts" / "main.tex").write_text(
        STANDALONE.replace("Supplementary.", "\\input{ch}"), encoding="utf-8"
    )
    server_main.SESSIONS[opened["id"]].deps.invalidate()
    response = client.post(
        f"/api/projects/{opened['id']}/previews", json={"path": "parts/ch.tex"}
    )
    assert response.status_code == 409
    assert "main.pdf" in response.text


def test_each_document_has_its_own_pdf_and_its_own_etag(client, project_dir, opened):
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    session = server_main.SESSIONS[project_id]
    session.project.build_dir.mkdir(parents=True, exist_ok=True)
    (session.project.build_dir / "main.pdf").write_bytes(b"%PDF-main\n")
    (session.project.build_dir / "esi.pdf").write_bytes(b"%PDF-esi-longer\n")

    main = client.get(f"/api/projects/{project_id}/pdf?document=main.tex")
    esi = client.get(f"/api/projects/{project_id}/pdf?document=esi.tex")
    assert main.content == b"%PDF-main\n"
    assert esi.content == b"%PDF-esi-longer\n"
    assert main.headers["etag"] != esi.headers["etag"]

    # And one document's ETag must never satisfy the other's request, or a
    # client that dropped the query string would be handed the wrong page.
    crossed = client.get(
        f"/api/projects/{project_id}/pdf?document=esi.tex",
        headers={"if-none-match": main.headers["etag"]},
    )
    assert crossed.status_code == 200


def test_an_unknown_document_falls_back_to_the_one_on_screen(
    client, project_dir, opened
):
    # Every caller written before a project could have several sends
    # nothing, and must keep working: it gets the document in front.
    project_id = opened["id"]
    session = server_main.SESSIONS[project_id]
    assert session.document_for("").path == "main.tex"
    assert session.document_for("nosuch.tex").path == "main.tex"
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    assert session.document_for("").path == "esi.tex"
    client.post(f"/api/projects/{project_id}/editor", json={"preview": "main.tex"})
    assert session.document_for("nosuch.tex").path == "main.tex"


def test_a_preview_can_be_taken_away(client, project_dir, opened):
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    body = client.request(
        "DELETE", f"/api/projects/{project_id}/previews", params={"path": "esi.tex"}
    ).json()
    assert body["previews"] == ["main.tex"]
    # It was in front, so the neighbour is now.
    assert body["visible"] == "main.tex"
    remembered = json.loads(
        (project_dir / ".nexttex" / "previews.json").read_text(encoding="utf-8")
    )
    assert remembered == ["main.tex"]


def test_the_last_document_cannot_be_unpreviewed(client, project_dir, opened):
    """Any document can go, including the one that used to be main, but not
    the last: a strip with nothing on it has no way to get anything back."""
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    gone = client.request(
        "DELETE", f"/api/projects/{project_id}/previews", params={"path": "main.tex"}
    )
    assert gone.status_code == 200
    assert gone.json()["previews"] == ["esi.tex"]
    response = client.request(
        "DELETE", f"/api/projects/{project_id}/previews", params={"path": "esi.tex"}
    )
    assert response.status_code == 409
    assert "last document" in response.text


def test_an_edit_rebuilds_only_the_documents_that_read_it(client, project_dir, opened):
    """The whole point: editing one document does not build the other."""
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    session = server_main.SESSIONS[project_id]
    session.deps.invalidate()

    session._dirty.clear()
    session.note_edit(project_dir / "esi.tex", STANDALONE + "More.\n")
    assert session._dirty == {"esi.tex"}

    session._dirty.clear()
    session.note_edit(project_dir / "main.tex", "\\documentclass{article}\n")
    assert session._dirty == {"main.tex"}


def test_an_asset_nobody_claims_rebuilds_everything(client, project_dir, opened):
    # A style file or an image: under-attributing it leaves a preview that
    # silently stops updating, which is the worst way this can fail.
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    session = server_main.SESSIONS[project_id]
    session.deps.invalidate()
    session._dirty.clear()
    session.note_edit(project_dir / "house.sty", "% styles\n")
    assert session._dirty == {"main.tex", "esi.tex"}


# -- the strip follows the files it names ------------------------------------
#
# Nothing kept `session.documents` in step with the file system.  A previewed
# document renamed from the tree was left registered under a path that no
# longer existed, `previews.json` named the old path, and the tab wore the
# old name until the next open silently dropped it; a deleted document stayed
# registered and its stale PDF went on being served.  Every path a change can
# arrive by goes through `reconcile_documents` now.


def spy_on(project_id):
    session = server_main.SESSIONS[project_id]
    seen = []
    original = session.events.publish

    async def record(event):
        seen.append(event)
        await original(event)

    session.events.publish = record
    return session, seen, original


def previews_events(seen):
    return [e for e in seen if e["type"] == "previews_changed"]


def remembered(project_dir):
    return json.loads(
        (project_dir / ".nexttex" / "previews.json").read_text(encoding="utf-8")
    )


def test_renaming_a_previewed_document_keeps_its_place_and_its_page(
    client, project_dir, opened,
):
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    client.post(f"/api/projects/{project_id}/editor", json={"preview": "main.tex"})
    session, seen, original = spy_on(project_id)
    try:
        response = client.post(
            f"/api/projects/{project_id}/file/rename",
            json={"path": "main.tex", "to": "paper.tex"},
        )
    finally:
        session.events.publish = original
    assert response.status_code == 200, response.text
    body = client.get(f"/api/projects/{project_id}/documents").json()
    # Same position, new name, still in front.
    assert body["previews"] == ["paper.tex", "esi.tex"]
    assert body["visible"] == "paper.tex"
    assert remembered(project_dir) == ["paper.tex", "esi.tex"]
    assert "main.tex" not in session.documents
    assert session.documents["paper.tex"].paths.jobname == "paper"
    # The strip moved before the tabs were told, and it said what moved.
    kinds = [e["type"] for e in seen]
    assert kinds.index("previews_changed") < kinds.index("renamed")
    assert previews_events(seen)[0]["renamed"] == {"main.tex": "paper.tex"}


def test_moving_a_folder_carries_the_document_inside_it(client, project_dir, opened):
    project_id = opened["id"]
    (project_dir / "drafts").mkdir()
    add(client, project_dir, "drafts/esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "drafts/esi.tex"})
    response = client.post(
        f"/api/projects/{project_id}/file/rename",
        json={"path": "drafts", "to": "final"},
    )
    assert response.status_code == 200, response.text
    body = client.get(f"/api/projects/{project_id}/documents").json()
    assert body["previews"] == ["main.tex", "final/esi.tex"]


def test_a_move_onto_a_taken_jobname_leaves_the_strip_and_says_so(
    client, project_dir, opened,
):
    """`sub/main.tex` would build to main.pdf beside main.tex.  The moved
    document cannot stay, and the notice says why rather than the strip
    silently losing a tab."""
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    session, seen, original = spy_on(project_id)
    try:
        response = client.post(
            f"/api/projects/{project_id}/file/rename",
            json={"path": "esi.tex", "to": "sub/main.tex"},
        )
    finally:
        session.events.publish = original
    assert response.status_code == 200, response.text
    body = client.get(f"/api/projects/{project_id}/documents").json()
    assert body["previews"] == ["main.tex"]
    assert "main.pdf" in previews_events(seen)[0]["notice"]


def test_a_same_stem_move_does_not_collide_with_itself(client, project_dir, opened):
    project_id = opened["id"]
    response = client.post(
        f"/api/projects/{project_id}/file/rename",
        json={"path": "main.tex", "to": "old/main.tex"},
    )
    assert response.status_code == 200, response.text
    body = client.get(f"/api/projects/{project_id}/documents").json()
    assert body["previews"] == ["old/main.tex"]
    assert body["visible"] == "old/main.tex"


def test_renaming_a_chapter_changes_nothing_on_the_strip(client, project_dir, opened):
    project_id = opened["id"]
    add(client, project_dir, "chapter.tex", "A chapter.\n")
    session, seen, original = spy_on(project_id)
    try:
        client.post(
            f"/api/projects/{project_id}/file/rename",
            json={"path": "chapter.tex", "to": "part.tex"},
        )
    finally:
        session.events.publish = original
    assert not previews_events(seen)
    assert list(session.documents) == ["main.tex"]


def test_deleting_a_previewed_document_takes_it_off_the_strip(
    client, project_dir, opened,
):
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    client.post(f"/api/projects/{project_id}/editor", json={"preview": "esi.tex"})
    response = client.delete(
        f"/api/projects/{project_id}/file", params={"path": "esi.tex"}
    )
    assert response.status_code == 200
    body = client.get(f"/api/projects/{project_id}/documents").json()
    assert body["previews"] == ["main.tex"]
    # The neighbour on the left comes forward, as after closing a tab.
    assert body["visible"] == "main.tex"
    assert remembered(project_dir) == ["main.tex"]


def test_deleting_the_only_document_leaves_an_empty_strip(client, project_dir, opened):
    """The "last document stays" refusal is for the writer's own close
    gesture.  A deleted document is gone, and the pane draws the empty
    state rather than serving a PDF of a file that is in the trash."""
    project_id = opened["id"]
    response = client.delete(
        f"/api/projects/{project_id}/file", params={"path": "main.tex"}
    )
    assert response.status_code == 200
    body = client.get(f"/api/projects/{project_id}/documents").json()
    assert body["previews"] == []
    assert body["visible"] == ""
    assert client.get(f"/api/projects/{project_id}/pdf").status_code == 404
    # And restoring it brings it back.
    entry = client.get(f"/api/projects/{project_id}/trash").json()["entries"][0]
    restored = client.post(f"/api/projects/{project_id}/trash/{entry['id']}/restore")
    assert restored.status_code == 200, restored.text
    body = client.get(f"/api/projects/{project_id}/documents").json()
    assert body["previews"] == ["main.tex"]
    assert body["visible"] == "main.tex"


def test_restoring_a_chapter_does_not_put_it_on_the_strip(client, project_dir, opened):
    project_id = opened["id"]
    add(client, project_dir, "chapter.tex", "A chapter.\n")
    client.delete(f"/api/projects/{project_id}/file", params={"path": "chapter.tex"})
    entry = client.get(f"/api/projects/{project_id}/trash").json()["entries"][0]
    client.post(f"/api/projects/{project_id}/trash/{entry['id']}/restore")
    body = client.get(f"/api/projects/{project_id}/documents").json()
    assert body["previews"] == ["main.tex"]


def test_a_document_deleted_outside_the_app_leaves_at_the_next_scan(
    client, project_dir, opened,
):
    """An `rm` in a terminal reaches the session only as the watcher's
    `files_changed`, and the re-scan behind it checks the disk."""
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    (project_dir / "esi.tex").unlink()
    session = server_main.SESSIONS[project_id]
    # On the app's own loop, the way the eviction tests run the reaper: the
    # scheduler this retires holds objects bound to that loop.
    client.portal.call(session._publish_documents)
    body = client.get(f"/api/projects/{project_id}/documents").json()
    assert body["previews"] == ["main.tex"]
    assert remembered(project_dir) == ["main.tex"]
