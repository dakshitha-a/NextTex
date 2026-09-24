"""The submission check's route, and the two venue facts on `/settings`."""

import shutil

import pytest

from nexttex.project import ProjectConfig

FIXTURE_LOG = """This is pdfTeX
(./main.tex
LaTeX Warning: Reference `fig:gone' on page 1 undefined on input line 3.
)
Output written on main.pdf (12 pages, 1000 bytes).
"""


def fake_build(project_dir, text=FIXTURE_LOG):
    """A log where the build would have put one, without running TeX."""
    build = project_dir / "build"
    build.mkdir(exist_ok=True)
    (build / "main.log").write_text(text, encoding="utf-8")


def test_a_document_with_no_build_is_a_409(client, opened):
    answer = client.get(f"/api/projects/{opened['id']}/submit")
    assert answer.status_code == 409
    assert "build" in answer.json()["detail"]


def test_the_report_reads_the_log_and_the_sources(client, opened, project_dir):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nSee \\ref{fig:gone}, \\today.\n"
        "\\label{a}\\label{a}\n\\end{document}\n", encoding="utf-8",
    )
    fake_build(project_dir)
    answer = client.get(f"/api/projects/{opened['id']}/submit")
    assert answer.status_code == 200, answer.text
    report = answer.json()
    assert report["document"] == "main.tex" and report["pages"] == 12
    kinds = {row["kind"] for row in report["findings"]}
    assert {"undefined", "today", "duplicate-label"} <= kinds
    undefined = next(row for row in report["findings"] if row["kind"] == "undefined")
    assert undefined["file"] == "main.tex" and undefined["line"] == 3
    assert undefined["source"] == "submit" and undefined["explain"]["fix"]
    assert report["counts"]["today"] == 1
    # No PDF was written, so nothing about fonts or images and no gap row.
    assert not {"font", "image", "tool"} & kinds


def test_the_page_limit_and_blind_review_come_from_the_settings(client, opened, project_dir):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\\author{Ada}\\begin{document}x\\end{document}\n",
        encoding="utf-8",
    )
    fake_build(project_dir)
    project_id = opened["id"]
    settings = client.post(f"/api/projects/{project_id}/settings", json={"pageLimit": 8, "blind": True})
    assert settings.status_code == 200, settings.text
    assert settings.json()["pageLimit"] == 8 and settings.json()["blind"] is True
    # Written to the project's own file, where a co-author sees it.
    config = ProjectConfig.load(project_dir)
    assert config.page_limit == 8 and config.blind is True
    report = client.get(f"/api/projects/{project_id}/submit").json()
    kinds = {row["kind"] for row in report["findings"]}
    assert "pages" in kinds and "blind" in kinds
    pages = next(row for row in report["findings"] if row["kind"] == "pages")
    assert pages["message"] == "12 pages against a limit of 8"


def test_a_venue_that_wants_pdfa_is_a_setting_the_check_reads(client, opened, project_dir):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}x\\end{document}\n", encoding="utf-8",
    )
    fake_build(project_dir)
    project_id = opened["id"]
    before = {row["kind"] for row in client.get(f"/api/projects/{project_id}/submit").json()["findings"]}
    assert "pdfa" not in before
    settings = client.post(f"/api/projects/{project_id}/settings", json={"pdfa": True})
    assert settings.status_code == 200 and settings.json()["pdfa"] is True
    assert ProjectConfig.load(project_dir).pdfa is True
    after = {row["kind"] for row in client.get(f"/api/projects/{project_id}/submit").json()["findings"]}
    assert "pdfa" in after


@pytest.mark.parametrize("limit", [-1, 100_001, "eight"])
def test_a_page_limit_that_is_not_a_count_is_refused(client, opened, limit):
    answer = client.post(f"/api/projects/{opened['id']}/settings", json={"pageLimit": limit})
    assert answer.status_code in (400, 422), answer.text


def test_a_document_that_leaves_the_project_is_refused(client, opened, project_dir):
    fake_build(project_dir)
    for hostile in ("../../etc/passwd", "/etc/passwd", "..\\..\\x.tex", "main.tex\x00"):
        answer = client.get(f"/api/projects/{opened['id']}/submit", params={"document": hostile})
        assert answer.status_code in (400, 404), (hostile, answer.status_code)


def test_an_unregistered_document_is_a_404(client, opened, project_dir):
    fake_build(project_dir)
    answer = client.get(f"/api/projects/{opened['id']}/submit", params={"document": "other.tex"})
    assert answer.status_code == 404


@pytest.mark.skipif(
    shutil.which("pdflatex") is None or shutil.which("pdffonts") is None,
    reason="pdflatex and poppler are needed",
)
def test_a_real_build_reports_its_pdf(client, opened, project_dir):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}Hello.\\end{document}\n", encoding="utf-8",
    )
    project_id = opened["id"]
    result = client.post(f"/api/projects/{project_id}/compile", json={"full": True}).json()
    assert result["outcome"] == "ok", result
    report = client.get(f"/api/projects/{project_id}/submit").json()
    assert report["pages"] == 1 and report["built"] and report["engine"] == "pdflatex"
    assert not any(row["kind"] in ("font", "tool") for row in report["findings"]), report["findings"]
