"""The download route's source bundle, through the project's own graph."""

import io
import zipfile

import pytest


def test_a_document_s_source_is_a_zip_of_what_it_reads(client, project_dir, opened):
    # Through the file route, as the editor writes: the project's graph
    # reads the open shared document, which a write behind its back does
    # not reach until the watcher does.
    for path, text in (
        ("part.tex", "Part.\n"),
        ("stray.tex", "Not read.\n"),
        ("main.tex", "\\documentclass{article}\n\\begin{document}\n% a note\n\\input{part}\n\\end{document}\n"),
    ):
        written = client.put(
            f"/api/projects/{opened['id']}/file",
            json={"path": path, "text": text, "compile": False, "create": True},
        )
        assert written.status_code == 200, written.text
    answer = client.get(
        f"/api/projects/{opened['id']}/download",
        params={"format": "source", "document": "main.tex", "comments": "strip"},
    )
    assert answer.status_code == 200, answer.text
    assert "main-source.zip" in answer.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(answer.content)) as archive:
        names = set(archive.namelist())
        assert {"main.tex", "part.tex"} <= names and "stray.tex" not in names
        assert "% a note" not in archive.read("main.tex").decode()


@pytest.mark.parametrize("document", ["../outside.tex", "/etc/passwd", "chapters/../../x.tex"])
def test_a_source_outside_the_project_is_refused(client, opened, document):
    answer = client.get(
        f"/api/projects/{opened['id']}/download", params={"format": "source", "document": document},
    )
    assert answer.status_code in (400, 403, 404)
