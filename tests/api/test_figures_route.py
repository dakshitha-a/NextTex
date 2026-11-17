"""The Figures list's route: the source's figures, before and after a build."""


def test_the_figures_of_the_document_are_listed_before_any_build(client, project_dir, opened):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n"
        "\\begin{figure}\\caption{One}\\label{fig:one}\\end{figure}\n"
        "See~\\ref{fig:one}.\n\\end{document}\n",
        encoding="utf-8",
    )
    answer = client.get(f"/api/projects/{opened['id']}/figures")
    assert answer.status_code == 200, answer.text
    entries = answer.json()["entries"]
    assert [(e["kind"], e["caption"], e["refs"], e["number"]) for e in entries] == [
        ("figure", "One", 1, None),
    ]


def test_a_document_that_is_not_one_is_refused(client, opened):
    for name in ("../outside.tex", "/etc/passwd", "nope.tex"):
        answer = client.get(f"/api/projects/{opened['id']}/figures", params={"document": name})
        assert answer.status_code == 404


def test_the_pictures_are_read_from_the_pdf_once_per_build(client, project_dir, opened, monkeypatch):
    # `pdfimages` took three seconds on a thesis and ran on every visit to
    # the list, though nothing had been built in between.
    import os

    import server.main as server_main
    from nexttex import submit

    runs = []

    def fake(pdf):
        runs.append(pdf.name)
        return ""

    monkeypatch.setattr(submit, "run_pdfimages", fake)
    pdf = server_main.session_for(opened["id"]).paths.pdf
    pdf.parent.mkdir(parents=True, exist_ok=True)
    pdf.write_bytes(b"%PDF-1.4\n")
    for _ in range(3):
        assert client.get(f"/api/projects/{opened['id']}/figures").status_code == 200
    assert len(runs) == 1
    # A new build is asked again.
    pdf.write_bytes(b"%PDF-1.4\n% rebuilt\n")
    os.utime(pdf, ns=(pdf.stat().st_atime_ns, pdf.stat().st_mtime_ns + 1_000_000_000))
    assert client.get(f"/api/projects/{opened['id']}/figures").status_code == 200
    assert len(runs) == 2


def test_a_tool_that_could_not_answer_is_asked_again(client, project_dir, opened, monkeypatch):
    import server.main as server_main
    from nexttex import submit

    runs = []
    monkeypatch.setattr(submit, "run_pdfimages", lambda pdf: runs.append(1))
    pdf = server_main.session_for(opened["id"]).paths.pdf
    pdf.parent.mkdir(parents=True, exist_ok=True)
    pdf.write_bytes(b"%PDF-1.4\n")
    client.get(f"/api/projects/{opened['id']}/figures")
    client.get(f"/api/projects/{opened['id']}/figures")
    assert len(runs) == 2
