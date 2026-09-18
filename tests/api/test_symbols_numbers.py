"""The symbols route carries each label's number after a build."""

import shutil

import pytest


@pytest.mark.skipif(shutil.which("pdflatex") is None, reason="pdflatex is needed")
def test_labels_carry_their_numbers_after_a_real_build(client, opened, project_dir):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}\n"
        "\\section{Intro}\\label{sec:intro}\nSee \\ref{fig:one}.\n"
        "\\begin{figure}\\centering\\rule{1cm}{1cm}\\caption{A box}\\label{fig:one}\\end{figure}\n"
        "\\end{document}\n",
        encoding="utf-8",
    )
    project_id = opened["id"]
    # Before a build: the place, and no number.
    before = {l["name"]: l for l in client.get(f"/api/projects/{project_id}/symbols").json()["labels"]}
    assert before["fig:one"]["file"] == "main.tex" and "number" not in before["fig:one"]

    result = client.post(f"/api/projects/{project_id}/compile", json={"full": True}).json()
    assert result["outcome"] == "ok", result
    after = {l["name"]: l for l in client.get(f"/api/projects/{project_id}/symbols").json()["labels"]}
    assert after["fig:one"]["number"] == "1"
    assert after["fig:one"]["page"] == "1"
    assert after["fig:one"]["kind"] == "figure"
    assert after["sec:intro"]["kind"] == "section"
    # The place is still there beneath the number.
    assert after["fig:one"]["file"] == "main.tex" and after["fig:one"]["line"] == 6
