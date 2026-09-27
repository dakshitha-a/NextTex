"""Files a writer hands to the agent: pictures, documents and text,
attached from the desktop or pointed to in the project.

The bytes go on disk and the question carries the path, which is the one
section 27 of the design document was written about: an image on this wire
is base64, the hook ships a tool result twice, and that is how a 290 KB
figure measured 1.15 MB and killed the reader mid-turn.  The agent already
reads images from disk, so there is no second image path to keep working.
"""

import io
import zlib

from tests.api.conftest import wait_idle


def png(colour: int = 0) -> bytes:
    """The smallest real PNG, so the route's own checks are what is tested
    rather than an image library's."""
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            len(payload).to_bytes(4, "big") + kind + payload
            + zlib.crc32(kind + payload).to_bytes(4, "big")
        )

    header = (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    pixel = zlib.compress(bytes([0, colour, colour, colour]))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", pixel)
        + chunk(b"IEND", b"")
    )


def attach(client, project_id, data=None, name="paste.png", kind="image/png"):
    return client.post(
        f"/api/projects/{project_id}/agent/attachment",
        files={"file": (name, io.BytesIO(data if data is not None else png()), kind)},
    )


def test_an_image_lands_on_disk_and_says_where(client, opened):
    response = attach(client, opened["id"])
    assert response.status_code == 200
    body = response.json()
    assert body["path"].startswith(".nexttex/attachments/")
    assert body["path"].endswith(".png")
    assert body["bytes"] > 0


def test_the_same_image_twice_costs_one_file(client, opened, project_dir):
    """Content addressed, like everything else this app keeps."""
    first = attach(client, opened["id"]).json()["path"]
    second = attach(client, opened["id"]).json()["path"]
    assert first == second
    kept = list((project_dir / ".nexttex" / "attachments").iterdir())
    assert len(kept) == 1


def test_a_kind_the_agent_cannot_read_is_refused_by_name(client, opened):
    """A file the model cannot read is better refused here than turned
    into a tool call that fails, and the refusal says what does go."""
    response = attach(
        client, opened["id"], data=b"PK\x03\x04", name="project.zip", kind="application/zip",
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "project.zip" in detail and "Word" in detail


def test_an_image_too_large_for_the_model_is_refused_with_a_number(client, opened):
    """The upload path allows 256 MB, which is right for a dataset and
    wrong here: the model has its own limit, so a huge screenshot is a
    failed turn rather than a slow one."""
    from nexttex import attachments

    response = attach(client, opened["id"], data=b"x" * (attachments.LIMIT + 1))
    # Refused on size before it is refused on not being a PNG, because size
    # is the thing worth telling the writer about.
    assert response.status_code in (400, 413)


def test_an_empty_file_is_refused(client, opened):
    assert attach(client, opened["id"], data=b"").status_code == 400


def test_the_question_carries_the_path_and_the_panel_does_not(client, opened):
    """`turn_start` shows what was typed, not the question with a list of
    paths stapled to it. The chips under the composer are what say an image
    went with it."""
    path = attach(client, opened["id"]).json()["path"]
    client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={"prompt": "What is wrong with this table?", "attached": [path]},
    )
    wait_idle(opened["id"])
    items = client.post(f"/api/projects/{opened['id']}/open").json()["transcript"]
    asked = [item for item in items if item["kind"] == "user"]
    assert asked and asked[0]["text"] == "What is wrong with this table?"
    assert ".nexttex" not in asked[0]["text"]


def test_a_path_nobody_attached_is_dropped(client, opened):
    """A list of strings out of an HTTP body, and the one thing it must not
    become is a way to make the agent read an arbitrary path."""
    response = client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={
            "prompt": "Look at this.",
            "attached": [
                "../../../../etc/passwd",
                ".nexttex/attachments/never-existed.png",
                "/etc/hosts",
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["attached"] == []
    wait_idle(opened["id"])


def test_only_so_many_are_taken(client, opened):
    """Ten things with a question at most, and six of them pictures."""
    from nexttex import attachments

    pictures = [
        attach(client, opened["id"], data=png(index)).json()["path"]
        for index in range(attachments.MOST_PICTURES + 2)
    ]
    notes = [
        attach(client, opened["id"], data=f"note {index}".encode(), name=f"n{index}.md", kind="").json()["path"]
        for index in range(attachments.MOST)
    ]
    response = client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={"prompt": "All of these.", "attached": pictures + notes},
    )
    taken = response.json()["attached"]
    assert len(taken) == attachments.MOST
    assert sum(path.endswith(".png") for path in taken) == attachments.MOST_PICTURES
    wait_idle(opened["id"])


def docx(text: str) -> bytes:
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>",
        )
    return buffer.getvalue()


def test_each_kind_goes_by_its_name_whatever_the_browser_called_it(client, opened):
    """A browser names a `.py`, a `.md` or a `.heic` with whatever the
    machine believes, often nothing, so the suffix decides."""
    for name, data in [
        ("fit.py", b"print('decay')\n"),
        ("README.md", b"# Notes\n"),
        ("reviewer-notes.docx", docx("Fine")),
        ("scan.tif", b"II*\x00"),
        ("photo.HEIC", b"\x00\x00\x00\x18ftypheic"),
    ]:
        response = attach(client, opened["id"], data=data, name=name, kind="")
        assert response.status_code == 200, (name, response.text)
        assert response.json()["path"].lower().endswith(name[name.rindex("."):].lower())


def test_a_word_document_is_kept_with_its_text_beside_it(client, opened, project_dir):
    body = attach(
        client, opened["id"], data=docx("The fast component is 180 fs."),
        name="reviewer-notes.docx", kind="application/octet-stream",
    ).json()
    # The original name stays in the kept name, which the model reads.
    assert "reviewer-notes" in body["name"]
    text = project_dir / ".nexttex" / "attachments" / (body["name"] + ".txt")
    assert text.read_text(encoding="utf-8").strip() == "The fast component is 180 fs."


def test_a_document_has_a_larger_allowance_than_a_picture(client, opened):
    from nexttex import attachments

    big = b"x" * (attachments.LIMITS["picture"] + 1)
    assert attach(client, opened["id"], data=big, name="large.md", kind="").status_code == 413
    assert attachments.LIMITS["document"] > attachments.LIMITS["picture"]


def test_an_attached_name_is_told_by_its_own_path_not_the_one_given(client, opened):
    """Only the base name is looked up, and the model is told the path
    rebuilt from it: a body that dresses a real attachment's name up as a
    path elsewhere does not carry that path through."""
    path = attach(client, opened["id"]).json()["path"]
    name = path.rsplit("/", 1)[1]
    response = client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={"prompt": "Look.", "attached": [f"../../../home/somebody/{name}"]},
    )
    assert response.json()["attached"] == [path]
    wait_idle(opened["id"])


def test_a_project_file_is_pointed_to_by_its_path(client, opened, project_dir):
    (project_dir / "notes").mkdir(exist_ok=True)
    (project_dir / "notes" / "reviewer.docx").write_bytes(docx("Cite Schuurman."))
    response = client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={"prompt": "Answer the reviewer.", "files": ["notes/reviewer.docx", "./main.tex", "notes"]},
    )
    assert response.status_code == 200
    assert response.json()["files"] == ["notes/reviewer.docx", "main.tex", "notes/"]
    # The Word file's text is kept among the attachments, by its content.
    made = list((project_dir / ".nexttex" / "attachments").glob("project-*-reviewer.docx.txt"))
    assert made and made[0].read_text(encoding="utf-8").strip() == "Cite Schuurman."
    wait_idle(opened["id"])


def test_a_project_path_that_leaves_the_project_is_dropped(client, opened, tmp_path):
    """The same fence every file route uses: `..`, an absolute path, a
    control file and a missing one each go nowhere."""
    outside = tmp_path / "secret.md"
    outside.write_text("private", encoding="utf-8")
    response = client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={
            "prompt": "Read these.",
            "files": ["../../../../etc/passwd", str(outside), "latexmkrc", "never-there.md"],
        },
    )
    assert response.status_code == 200
    assert response.json()["files"] == []
    wait_idle(opened["id"])


def test_the_model_is_told_each_file_and_how_to_read_it():
    from nexttex.attachments import Handed, sentence

    note = sentence(
        [
            Handed(".nexttex/attachments/a-notes.docx", "document", ".nexttex/attachments/a-notes.docx.txt"),
            Handed(".nexttex/attachments/b.png", "picture"),
            Handed(".nexttex/attachments/c.heic", "picture"),
        ],
        [Handed("figures/scan.tif", "picture", ".nexttex/attachments/project-1-scan.tif.png"), Handed("data/", None, folder=True)],
    )
    assert "The writer attached 3 files" in note
    assert "a Word document; its text is in .nexttex/attachments/a-notes.docx.txt" in note
    assert "b.png, a picture\n" in note
    assert "c.heic, a picture in a format that could not be converted here" in note
    assert "not files of theirs to edit" in note
    assert "The writer points you to 2 files in the project" in note
    assert "figures/scan.tif, a picture; a PNG of it is at" in note
    assert "data/ (a folder)" in note
