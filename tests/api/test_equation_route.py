"""The equation route: the formula card's Copy as SVG and Save as PNG."""

import shutil

import pytest

needs_tex = pytest.mark.skipif(
    shutil.which("pdflatex") is None or shutil.which("pdftocairo") is None,
    reason="pdflatex and pdftocairo are needed",
)


def _main(project_dir, macro=r"\newcommand{\tauf}{\tau_{\mathrm{fast}}}"):
    (project_dir / "main.tex").write_text(
        f"\\documentclass{{article}}\n{macro}\n\\begin{{document}}\nx\n\\end{{document}}\n",
        encoding="utf-8",
    )


@needs_tex
def test_an_equation_with_the_projects_macro_comes_back_as_svg_and_png(client, opened, project_dir):
    _main(project_dir)
    url = f"/api/projects/{opened['id']}/equation"
    svg = client.post(url, json={"body": r"S(t) = A e^{-t/\tauf}", "format": "svg"})
    assert svg.status_code == 200, svg.text
    assert svg.headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in svg.content
    png = client.post(url, json={"body": r"S(t) = A e^{-t/\tauf}", "format": "png"})
    assert png.status_code == 200 and png.content.startswith(b"\x89PNG")
    # Nothing is left in the build directory.
    build = project_dir / "build"
    assert not build.exists() or not any(p.name.startswith("equation-") for p in build.iterdir())


@needs_tex
def test_what_tex_said_is_the_refusal(client, opened, project_dir):
    _main(project_dir, macro="")
    answer = client.post(f"/api/projects/{opened['id']}/equation", json={"body": r"\tauf", "format": "svg"})
    assert answer.status_code == 400
    assert "Undefined control sequence" in answer.json()["detail"]


def test_a_format_it_does_not_make_is_refused(client, opened, project_dir):
    _main(project_dir)
    answer = client.post(f"/api/projects/{opened['id']}/equation", json={"body": "x", "format": "gif"})
    assert answer.status_code == 400


@pytest.mark.parametrize("document", ["../outside.tex", "/etc/passwd", "x..y.tex"])
def test_a_document_outside_the_project_is_not_read(client, opened, project_dir, document):
    _main(project_dir)
    answer = client.post(
        f"/api/projects/{opened['id']}/equation",
        json={"body": "x", "format": "svg", "document": document},
    )
    assert answer.status_code == 404
