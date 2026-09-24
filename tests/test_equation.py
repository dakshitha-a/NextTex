"""An equation typeset on its own with the document's preamble, as SVG or PNG."""

from __future__ import annotations

import shutil
import struct

import pytest

from nexttex import equation

MAIN = r"""\documentclass{article}
\newcommand{\tauf}{\tau_{\mathrm{fast}}}
\begin{document}
Text.
\end{document}
"""


def test_the_preamble_is_what_comes_before_the_document():
    assert equation.preamble(MAIN).rstrip().endswith(r"\newcommand{\tauf}{\tau_{\mathrm{fast}}}")
    assert r"\documentclass{article}" in equation.preamble("no document here")


def test_a_line_break_or_an_alignment_is_set_in_aligned():
    one = equation.standalone(equation.preamble(MAIN), "a + b")
    assert r"$\displaystyle a + b$" in one and "aligned" not in one
    two = equation.standalone(equation.preamble(MAIN), r"a &= b \\ c &= d")
    assert r"\begin{aligned}a &= b \\ c &= d\end{aligned}" in two
    # An escaped ampersand is text, not an alignment point.
    assert "aligned" not in equation.standalone("", r"\text{R\&D}")


def test_amsmath_is_loaded_only_when_the_preamble_lacks_it():
    assert r"\usepackage{amsmath}" in equation.standalone(r"\documentclass{article}", "x")
    assert equation.standalone("\\documentclass{article}\\usepackage{mathtools}", "x").count("amsmath") == 0


def test_nonsense_is_refused_before_anything_runs(tmp_path):
    with pytest.raises(equation.EquationError, match="format"):
        equation.render(main_source=MAIN, body="x", engine="pdflatex", fmt="gif", cwd=tmp_path)
    with pytest.raises(equation.EquationError, match="no equation"):
        equation.render(main_source=MAIN, body="  ", engine="pdflatex", fmt="svg", cwd=tmp_path)
    with pytest.raises(equation.EquationError, match="too long"):
        equation.render(main_source=MAIN, body="x" * (equation.MAX_BODY + 1),
                        engine="pdflatex", fmt="svg", cwd=tmp_path)


def test_a_missing_tool_is_named(tmp_path, monkeypatch):
    monkeypatch.setattr(equation.shutil, "which", lambda name: None if name == "pdftocairo" else "/bin/x")
    with pytest.raises(equation.EquationError, match="pdftocairo is not installed"):
        equation.render(main_source=MAIN, body="x", engine="pdflatex", fmt="svg", cwd=tmp_path)


needs_tex = pytest.mark.skipif(
    shutil.which("pdflatex") is None or shutil.which("pdftocairo") is None,
    reason="pdflatex and pdftocairo are needed",
)


@needs_tex
def test_the_projects_own_macro_is_typeset_into_an_svg(tmp_path):
    made = equation.render(
        main_source=MAIN, body=r"S(t) = A e^{-t/\tauf}", engine="pdflatex", fmt="svg",
        cwd=tmp_path, scratch_parent=tmp_path / "build",
    )
    assert made.media_type == "image/svg+xml"
    assert made.data.startswith(b"<?xml") and b"<svg" in made.data
    # Cut to the equation, not a letter page: a line of maths is far
    # wider than it is tall.
    text = made.data.decode()
    width = float(text.split('width="', 1)[1].split("pt", 1)[0])
    height = float(text.split('height="', 1)[1].split("pt", 1)[0])
    assert 20 < width < 300 and height < 40
    # The scratch directory is gone.
    assert list((tmp_path / "build").iterdir()) == []


@needs_tex
def test_a_png_is_transparent_and_at_print_resolution(tmp_path):
    made = equation.render(main_source=MAIN, body=r"a &= b \\ c &= d", engine="pdflatex",
                           fmt="png", cwd=tmp_path)
    assert made.media_type == "image/png" and made.data.startswith(b"\x89PNG")
    width, height, depth, colour = struct.unpack(">IIBB", made.data[16:26])
    assert colour == 6  # RGBA
    # Two lines at 300 dpi.
    assert height > 80 and width < 600


@needs_tex
def test_an_error_says_what_tex_said(tmp_path):
    with pytest.raises(equation.EquationError, match="Undefined control sequence"):
        equation.render(main_source=MAIN, body=r"\nosuchmacro", engine="pdflatex", fmt="svg", cwd=tmp_path)
