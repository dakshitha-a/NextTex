"""What publishing fills in on a page: KaTeX with the project's macros, a
project figure as an image address, and a labelled equation's maths."""

import base64
import shutil

import pytest

from nexttex import page_parts

PREAMBLE = r"""\documentclass{article}
\newcommand{\Ham}{\hat{H}}
\newcommand{\bra}[1]{\langle #1|}
\DeclareMathOperator{\Tr}{Tr}
\begin{document}
\begin{equation}\label{eq:tdse} i\partial_t\Psi = \Ham\Psi \end{equation}
\begin{align}\label{eq:two} a &= b \\ c &= d \nonumber\end{align}
\begin{figure}\label{fig:x}\end{figure}
\end{document}
"""


@pytest.fixture
def project(tmp_path):
    (tmp_path / "main.tex").write_text(PREAMBLE, encoding="utf-8")
    return tmp_path


def test_maths_loads_katex_with_the_projects_macros(project):
    filled = page_parts.fill("<p>$\\Ham$</p>{{maths}}", project)
    assert filled.problems == []
    assert '<script src="/assets/katex/katex.min.js"></script>' in filled.html
    assert "contrib/mhchem.min.js" in filled.html
    assert '"\\\\Ham": "\\\\hat{H}"' in filled.html
    assert '"\\\\bra": "\\\\langle #1|"' in filled.html
    assert '"\\\\Tr": "\\\\operatorname{Tr}"' in filled.html
    assert "{{maths}}" not in filled.html


def test_a_macro_cannot_close_the_script_it_is_written_into(project):
    tags = page_parts.maths_tags({"\\x": "</script><script>alert(1)"})
    # One for each of the four scripts the tags write, and none from the macro.
    assert tags.count("</script>") == 4
    assert "<\\/script><script>alert(1)" in tags


def test_an_equation_is_quoted_from_the_source_by_its_label(project):
    filled = page_parts.fill("{{equation:eq:tdse}} {{equation: eq:two }}", project)
    assert filled.problems == []
    assert "\\[i\\partial_t\\Psi = \\Ham\\Psi\\]" in filled.html
    assert "\\[\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}\\]" in filled.html
    assert "\\label" not in filled.html and "\\nonumber" not in filled.html


def test_what_cannot_be_filled_in_is_named(project):
    filled = page_parts.fill("{{equation:eq:nope}}{{equation:fig:x}}{{figure:none.pdf}}{{figure:../main.tex}}", project)
    assert filled.problems == [
        "No label eq:nope is in the project.",
        "fig:x labels figure that is not an equation.",
        "none.pdf is not in the project.",
        "../main.tex is not inside the project.",
    ]


def test_a_picture_becomes_its_own_address(project):
    (project / "figures").mkdir()
    png = b"\x89PNG\r\n\x1a\nfake"
    (project / "figures" / "plot.png").write_bytes(png)
    filled = page_parts.fill('<img src="{{figure:figures/plot.png}}">', project)
    assert filled.html == f'<img src="data:image/png;base64,{base64.b64encode(png).decode()}">'


@pytest.mark.skipif(shutil.which("pdftocairo") is None, reason="needs poppler's pdftocairo")
def test_a_pdf_figure_is_drawn_as_svg(project):
    import subprocess

    (project / "fig.tex").write_text(
        "\\documentclass{standalone}\\begin{document}x\\end{document}", encoding="utf-8")
    if shutil.which("pdflatex") is None:
        pytest.skip("needs pdflatex to make a PDF")
    subprocess.run(["pdflatex", "-interaction=nonstopmode", "fig.tex"], cwd=project,
                   capture_output=True, timeout=60)
    filled = page_parts.fill("{{figure:fig.pdf}}", project)
    assert filled.problems == []
    assert filled.html.startswith("data:image/svg+xml;base64,")
