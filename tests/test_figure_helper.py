"""The figure helper every agent-drawn script imports, run for real.

Q-005: it had no test at all, and it loaded its style sheet at import time,
so a writer who renamed or deleted `scripts/plotstyle.mplstyle`, which is
handed to them as theirs, broke every figure script with a traceback that
did not say why. Q-044: a script with a plain `savefig('figures/x.pdf')`
failed on a project with no `figures/` yet.
"""

import asyncio
import importlib.util
from pathlib import Path

import pytest

from nexttex import plots

needs_matplotlib = pytest.mark.skipif(
    importlib.util.find_spec("matplotlib") is None, reason="matplotlib is needed",
)

DRAW = (
    "import figure\n"
    "fig, ax = figure.figure()\n"
    "ax.plot([0, 1], [0, 1])\n"
    "print('Saved', figure.save(fig, 'line'))\n"
)


def project(tmp_path: Path) -> Path:
    root = tmp_path / "paper"
    root.mkdir()
    plots.ensure_baseline(root)
    (root / "scripts" / "line.py").write_text(DRAW, encoding="utf-8")
    return root


def run(root: Path, tmp_path: Path, name: str = "line.py") -> dict:
    return asyncio.run(plots.run(root, tmp_path / "state", root / "scripts" / name))


@needs_matplotlib
def test_the_helper_draws_at_the_page_width_and_saves_a_pdf(tmp_path):
    root = project(tmp_path)
    result = run(root, tmp_path)
    assert result["ok"], result
    assert "Saved figures/line.pdf" in result["out"]
    assert (root / "figures" / "line.pdf").read_bytes().startswith(b"%PDF")


@needs_matplotlib
def test_a_missing_style_sheet_is_said_and_the_figure_is_still_drawn(tmp_path):
    root = project(tmp_path)
    (root / "scripts" / "plotstyle.mplstyle").unlink()
    result = run(root, tmp_path)
    assert result["ok"], result
    assert result["err"].splitlines()[0] == (
        "scripts/plotstyle.mplstyle is missing, so this figure uses matplotlib's own style."
    )
    assert (root / "figures" / "line.pdf").is_file()


def test_figures_is_there_before_a_script_runs(tmp_path):
    root = tmp_path / "paper"
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "plain.py").write_text(
        "open('figures/square.pdf', 'w').write('not really a pdf')\n", encoding="utf-8",
    )
    result = run(root, tmp_path, "plain.py")
    assert result["ok"], result
    assert (root / "figures" / "square.pdf").is_file()
