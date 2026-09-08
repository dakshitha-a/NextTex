"""Previewing more than one document in a project.

A dissertation and the supplementary information beside it are two
documents in one folder, and neither includes the other. The risk this
whole feature carries is serving one document's PDF for the other, so most
of what is checked here is that the two stay apart.
"""

import server.main as server_main


def add(client, project_dir, name: str, text: str) -> None:
    (project_dir / name).write_text(text, encoding="utf-8")


STANDALONE = (
    "\\documentclass{article}\n\\begin{document}\nSupplementary.\n\\end{document}\n"
)


def test_a_project_previews_its_main_document_and_nothing_else(client, opened):
    body = client.get(f"/api/projects/{opened['id']}/documents").json()
    assert body["previews"] == ["main.tex"]
    assert body["main"] == "main.tex"


def test_a_standalone_document_is_offered_but_not_previewed(
    client, project_dir, opened
):
    add(client, project_dir, "esi.tex", STANDALONE)
    server_main.SESSIONS[opened["id"]].deps.invalidate()
    body = client.get(f"/api/projects/{opened['id']}/documents").json()
    assert "esi.tex" in body["candidates"]
    assert "esi.tex" not in body["previews"]


def test_a_fragment_is_not_offered(client, project_dir, opened):
    # No \documentclass of its own, so it cannot be built by itself.
    add(client, project_dir, "chapter.tex", "A chapter with no preamble.\n")
    server_main.SESSIONS[opened["id"]].deps.invalidate()
    body = client.get(f"/api/projects/{opened['id']}/documents").json()
    assert "chapter.tex" not in body["candidates"]


def test_previewing_a_second_document_keeps_it_across_a_settings_change(
    client, project_dir, opened
):
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    body = client.post(
        f"/api/projects/{project_id}/previews", json={"path": "esi.tex"}
    ).json()
    assert body["previews"] == ["main.tex", "esi.tex"]
    assert "previews = [\"esi.tex\"]" in (project_dir / "nexttex.toml").read_text()

    # The switch route rewrites nexttex.toml.  Before `save` was taught
    # about this field, that is where a registered preview was silently
    # lost.
    client.post(f"/api/projects/{project_id}/settings", json={"markWarnings": True})
    assert "esi.tex" in (project_dir / "nexttex.toml").read_text()


def test_a_fragment_cannot_be_previewed(client, project_dir, opened):
    add(client, project_dir, "chapter.tex", "No preamble here.\n")
    response = client.post(
        f"/api/projects/{opened['id']}/previews", json={"path": "chapter.tex"}
    )
    assert response.status_code == 400
    assert "documentclass" in response.text


def test_two_documents_cannot_share_one_jobname(client, project_dir, opened):
    """Both would build to main.pdf, and each would serve the other's page."""
    (project_dir / "parts").mkdir(exist_ok=True)
    (project_dir / "parts" / "main.tex").write_text(STANDALONE, encoding="utf-8")
    response = client.post(
        f"/api/projects/{opened['id']}/previews", json={"path": "parts/main.tex"}
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

    main = client.get(f"/api/projects/{project_id}/pdf")
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


def test_an_unknown_document_falls_back_to_the_main_one(client, opened):
    # Every caller written before a project could have several sends
    # nothing, and must keep working.
    session = server_main.SESSIONS[opened["id"]]
    assert session.document_for("").path == "main.tex"
    assert session.document_for("nosuch.tex").path == "main.tex"


def test_a_preview_can_be_taken_away(client, project_dir, opened):
    project_id = opened["id"]
    add(client, project_dir, "esi.tex", STANDALONE)
    client.post(f"/api/projects/{project_id}/previews", json={"path": "esi.tex"})
    body = client.request(
        "DELETE", f"/api/projects/{project_id}/previews", params={"path": "esi.tex"}
    ).json()
    assert body["previews"] == ["main.tex"]
    assert "esi.tex" not in (project_dir / "nexttex.toml").read_text()


def test_the_main_document_cannot_be_unpreviewed(client, opened):
    response = client.request(
        "DELETE", f"/api/projects/{opened['id']}/previews", params={"path": "main.tex"}
    )
    assert response.status_code == 400


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
