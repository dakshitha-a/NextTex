"""Changes as PDF from a version in History: the route's own answers."""

import pytest


def test_a_version_that_is_not_there_is_404(client, opened):
    answer = client.post(
        f"/api/projects/{opened['id']}/history/changes",
        json={"path": "main.tex", "sha": "0" * 64},
    )
    assert answer.status_code == 404


@pytest.mark.parametrize("path", ["../outside.tex", "/etc/passwd", "chapters/../../x.tex"])
def test_a_version_outside_the_project_is_refused(client, opened, path):
    answer = client.post(
        f"/api/projects/{opened['id']}/history/changes", json={"path": path, "sha": "0" * 64},
    )
    assert answer.status_code in (400, 403, 404)


def test_the_served_name_takes_a_moment_and_nothing_else(client, opened):
    for name in ("main-at-20261001-143200.pdf", "main-since-a3f9c21.pdf"):
        answer = client.get(f"/api/projects/{opened['id']}/git/changes/{name}")
        assert answer.status_code == 404  # well formed, not built
    for name in ("main-at-..%2F..%2Fx.pdf", "main-at-2026.pdf"):
        answer = client.get(f"/api/projects/{opened['id']}/git/changes/{name}")
        assert answer.status_code == 404


@pytest.mark.skipif(__import__("shutil").which("pdflatex") is None, reason="pdflatex is needed")
def test_a_named_version_gives_a_marked_up_pdf(client, opened, project_dir, monkeypatch):
    from pathlib import Path

    fake = Path(__file__).parent.parent / "fake_latexdiff.py"
    monkeypatch.setenv("NEXTTEX_LATEXDIFF", str(fake))
    project_id = opened["id"]
    put = lambda text: client.put(
        f"/api/projects/{project_id}/file",
        json={"path": "main.tex", "text": text, "compile": False},
    )
    doc = "\\documentclass{article}\n\\begin{document}\n{}\n\\end{document}\n"
    assert put(doc.replace("{}", "In hexane.")).status_code == 200
    versions = client.get(f"/api/projects/{project_id}/history", params={"path": "main.tex"}).json()["versions"]
    sha = versions[-1]["sha"]
    assert put(doc.replace("{}", "In cyclohexane.")).status_code == 200
    answer = client.post(
        f"/api/projects/{project_id}/history/changes", json={"path": "main.tex", "sha": sha},
    )
    assert answer.status_code == 200, answer.text
    served = client.get(answer.json()["url"])
    assert served.status_code == 200 and served.content[:4] == b"%PDF"
