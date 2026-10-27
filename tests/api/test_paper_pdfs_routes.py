"""A citation's paper, from the routes the hover card and the preview use.

The browser asks which keys have a PDF, and then asks for a key's PDF by
the key alone. The path-escape assertion here is the second route's: no
key, however written, and no `file` field in a `.bib`, however it points
outside the project, makes it serve a file the index would not honour.
"""

import time
from pathlib import Path

from nexttex import paperpdfs
from server import main as server_main

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def put(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PDF)
    return path


def test_a_key_named_pdf_deep_in_the_project_is_offered_and_served(client, opened):
    root = server_main.SESSIONS[opened["id"]].project.root
    put(root / "literature" / "books" / "1984" / "knuth1984.pdf")
    answer = client.get(f"/api/projects/{opened['id']}/papers/pdfs")
    assert answer.status_code == 200, answer.text
    assert answer.json()["links"]["knuth1984"] == {
        "where": "project", "path": "literature/books/1984/knuth1984.pdf", "how": "name",
    }
    served = client.get(f"/api/projects/{opened['id']}/papers/pdf", params={"key": "knuth1984"})
    assert served.status_code == 200
    assert served.headers["content-type"] == "application/pdf"
    assert served.headers["content-disposition"].startswith("inline")
    assert served.content == PDF


def test_no_key_and_no_bib_path_reaches_a_file_outside(client, opened, tmp_path, monkeypatch):
    session = server_main.SESSIONS[opened["id"]]
    root = session.project.root
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(paperpdfs.Path, "home", classmethod(lambda cls: home))
    secret = put(tmp_path / "elsewhere" / "secret.pdf")
    (root / "references.bib").write_text(
        "@article{stolen,\n"
        f"  file = {{PDF:{secret}:application/pdf}},\n"
        "}\n"
        "@article{climb,\n"
        "  file = {:../elsewhere/secret.pdf:PDF},\n"
        "}\n",
        encoding="utf-8",
    )
    links = client.get(f"/api/projects/{opened['id']}/papers/pdfs").json()["links"]
    assert "stolen" not in links and "climb" not in links
    for key in ("stolen", "climb", "../elsewhere/secret", str(secret), "", "nobody"):
        answer = client.get(f"/api/projects/{opened['id']}/papers/pdf", params={"key": key})
        assert answer.status_code == 404, key
        assert answer.content != PDF


def test_a_pdf_dropped_in_later_is_picked_up_without_a_reload(client, opened):
    session = server_main.SESSIONS[opened["id"]]
    assert "knuth1984" not in client.get(f"/api/projects/{opened['id']}/papers/pdfs").json()["links"]
    put(session.project.root / "papers" / "knuth1984.pdf")
    # Nothing is asked again: the watcher's event is what brings it in.
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if "knuth1984" in session.papers.as_dict():
            break
        time.sleep(0.1)
    assert session.papers.as_dict()["knuth1984"]["path"] == "papers/knuth1984.pdf"


def test_a_click_on_a_bibliography_entry_answers_with_its_key(client, opened, monkeypatch):
    from nexttex import synctex

    monkeypatch.setattr(
        synctex, "pdf_to_source",
        lambda *a, **k: synctex.SourcePosition(file=Path("build/main.bbl"), line=4, citation="knuth1984"),
    )
    answer = client.get(
        f"/api/projects/{opened['id']}/synctex/inverse", params={"page": 2, "x": 90, "y": 120},
    )
    assert answer.json() == {"found": False, "citation": "knuth1984"}
