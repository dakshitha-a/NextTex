"""The two SyncTeX routes.

What is under test is which file and which line the route asks synctex
about, not synctex itself: `source_to_pdf` and `pdf_to_source` are
replaced with recorders, since a real .synctex.gz needs a real engine.
"""

import server.main as server_main
from nexttex import synctex


def _recorder(monkeypatch, answers):
    """Replace `source_to_pdf` with one that records every call and answers
    from `answers`, keyed by the source path's name."""
    calls = []

    def fake(pdf, source, line, project_root, column=0):
        calls.append((source, line))
        return answers.get(source.name, [])

    monkeypatch.setattr(synctex, "source_to_pdf", fake)
    return calls


def test_forward_search_asks_about_the_file_named(client, opened, monkeypatch):
    calls = _recorder(monkeypatch, {"main.tex": [synctex.PdfPosition(1, 10.0, 20.0)]})
    answer = client.get(
        f"/api/projects/{opened['id']}/synctex/forward",
        params={"path": "main.tex", "line": 12},
    )
    assert answer.status_code == 200
    assert answer.json()["positions"] == [
        {"page": 1, "x": 10.0, "y": 20.0, "width": 0.0, "height": 0.0}
    ]
    assert [(s.name, l) for s, l in calls] == [("main.tex", 12)]


def test_forward_search_falls_back_to_the_shadow_a_scoped_build_compiled(
    client, opened, project_dir, monkeypatch
):
    """A scoped build compiled the stand-in main file, and its map names
    that file and never main.tex, so the route's question about main.tex
    answered nothing for the whole of a chapter-scoped session.  It asks
    about the shadow next, with the line moved down past the directive the
    shadow inserted."""
    session = server_main.SESSIONS[opened["id"]]
    paths = session.paths
    main_text = paths.main.read_text(encoding="utf-8")
    first_newline = main_text.index("\n") + 1
    paths.shadow.parent.mkdir(parents=True, exist_ok=True)
    paths.shadow.write_text(
        main_text[:first_newline] + "\\includeonly{chapters/one}\n" + main_text[first_newline:],
        encoding="utf-8",
    )
    calls = _recorder(
        monkeypatch, {paths.shadow.name: [synctex.PdfPosition(2, 1.0, 2.0)]}
    )
    answer = client.get(
        f"/api/projects/{opened['id']}/synctex/forward",
        params={"path": "main.tex", "line": 12},
    )
    assert answer.status_code == 200
    assert answer.json()["positions"][0]["page"] == 2
    assert [(s.name, l) for s, l in calls] == [("main.tex", 12), (paths.shadow.name, 13)]


def test_a_stale_shadow_is_never_asked_when_the_main_file_answers(
    client, opened, monkeypatch
):
    """The shadow stays on disk after a later full build whose map does not
    know it.  Asked first and fallen back to, rather than decided by the
    shadow's presence."""
    session = server_main.SESSIONS[opened["id"]]
    paths = session.paths
    paths.shadow.parent.mkdir(parents=True, exist_ok=True)
    paths.shadow.write_text("stale", encoding="utf-8")
    calls = _recorder(monkeypatch, {"main.tex": [synctex.PdfPosition(1, 0.0, 0.0)]})
    client.get(
        f"/api/projects/{opened['id']}/synctex/forward",
        params={"path": "main.tex", "line": 3},
    )
    assert [s.name for s, _ in calls] == ["main.tex"]


def test_forward_search_refuses_a_path_outside_the_project(client, opened, monkeypatch):
    calls = _recorder(monkeypatch, {})
    for escape in ["../../etc/passwd", "/etc/passwd"]:
        answer = client.get(
            f"/api/projects/{opened['id']}/synctex/forward",
            params={"path": escape, "line": 1},
        )
        assert answer.status_code == 403, escape
    assert calls == []


def test_inverse_search_reports_the_main_file_for_the_shadow(
    client, opened, monkeypatch
):
    session = server_main.SESSIONS[opened["id"]]
    paths = session.paths
    main_text = paths.main.read_text(encoding="utf-8")
    first_newline = main_text.index("\n") + 1
    paths.shadow.parent.mkdir(parents=True, exist_ok=True)
    paths.shadow.write_text(
        main_text[:first_newline] + "\\includeonly{chapters/one}\n" + main_text[first_newline:],
        encoding="utf-8",
    )
    monkeypatch.setattr(
        synctex, "_run",
        lambda args, cwd: (
            "SyncTeX result begin\n"
            f"Output:main.pdf\nInput:{paths.shadow}\nLine:13\nColumn:-1\n"
            "SyncTeX result end\n"
        ),
    )
    answer = client.get(
        f"/api/projects/{opened['id']}/synctex/inverse",
        params={"page": 1, "x": 100.0, "y": 100.0},
    )
    assert answer.status_code == 200
    body = answer.json()
    assert body["found"] is True
    assert body["file"] == "main.tex"
    # Line 13 of the shadow is line 12 of the file the writer has open.
    assert body["line"] == 12
