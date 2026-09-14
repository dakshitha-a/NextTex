"""The program a writer's script runs under, and what it keeps.

`nexttex/script_runner.py` runs in the child interpreter, so these tests run
it there too, with the real `sys.executable`, on scripts that need nothing
but the standard library.  The cases that draw need matplotlib and skip
without it, in the pattern `tests/test_plots.py` set.
"""

import asyncio
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

from nexttex import plots

HAS_MATPLOTLIB = importlib.util.find_spec("matplotlib") is not None
needs_matplotlib = pytest.mark.skipif(not HAS_MATPLOTLIB, reason="matplotlib is not installed")


def run(tmp_path: Path, body: str, name: str = "script.py") -> dict:
    """Through `plots.run` with a capture directory, the way the pane does."""
    root = tmp_path / "project"
    (root / "scripts").mkdir(parents=True, exist_ok=True)
    (root / "figures").mkdir(exist_ok=True)
    script = root / "scripts" / name
    script.write_text(body, encoding="utf-8")
    state = root / ".nexttex"
    return asyncio.run(plots.run(root, state, script, capture=state / "runs" / "one"))


# -- a script sees what `python script.py` gives it --------------------------
def test_the_scripts_own_directory_is_first_on_the_path(tmp_path):
    """The runner lives in the `nexttex/` package, which has a `config.py`
    and a `search.py` of its own.  Left in place, `sys.path[0]` would let
    a project's `import config` find NextTex's."""
    body = (
        "import os, sys\n"
        "print(sys.path[0] == os.path.dirname(os.path.abspath(__file__)))\n"
        "print('nexttex' in sys.path[0])\n"
        "print(len(sys.argv), os.path.basename(sys.argv[0]))\n"
    )
    result = run(tmp_path, body)
    assert result["ok"], result["err"]
    assert result["out"].split("\n")[:3] == ["True", "False", "1 script.py"]


def test_a_sibling_module_shadows_nothing_of_nexttexs(tmp_path):
    root = tmp_path / "project"
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "config.py").write_text("ANSWER = 42\n", encoding="utf-8")
    result = run(tmp_path, "import config\nprint(config.ANSWER)\n")
    assert result["ok"], result["err"]
    assert result["out"].strip() == "42"


def test_dunder_file_is_the_scripts_absolute_path(tmp_path):
    """The seeded helper resolves `__file__` at import to find the style
    sheet beside it and the figures directory above it."""
    result = run(tmp_path, "import os\nprint(os.path.isabs(__file__), __file__)\n")
    assert result["ok"], result["err"]
    assert result["out"].startswith("True ")
    assert result["out"].strip().endswith("scripts/script.py")


# -- how a run ends ----------------------------------------------------------
def test_an_uncaught_exception_is_the_scripts_traceback_and_exit_one(tmp_path):
    result = run(tmp_path, "x = 1\nraise ValueError('boom')\n")
    assert not result["ok"]
    assert result["code"] == 1
    assert "ValueError: boom" in result["err"]
    assert "line 2" in result["err"]
    # The runner's own frames are not the writer's problem.
    assert "script_runner" not in result["err"]
    assert "runpy" not in result["err"]


def test_sys_exit_keeps_its_code(tmp_path):
    result = run(tmp_path, "import sys\nsys.exit(3)\n")
    assert result["code"] == 3
    result = run(tmp_path, "import sys\nsys.exit('said so')\n")
    assert result["code"] == 1
    assert "said so" in result["err"]


def test_a_script_that_draws_nothing_reports_nothing(tmp_path):
    result = run(tmp_path, "print('hello')\n")
    assert result["ok"]
    assert result["figures"] == []
    assert result["saved"] == []
    assert result["duration_ms"] >= 0


def test_the_runner_is_standard_library_only():
    """It runs in an interpreter that may have no matplotlib and must not
    import NextTex, since the script's directory replaces its own."""
    source = Path(plots.RUNNER).read_text(encoding="utf-8")
    for line in source.splitlines():
        if line.startswith(("import ", "from ")):
            name = line.split()[1].split(".")[0]
            assert name in sys.stdlib_module_names, line
    completed = subprocess.run(
        [sys.executable, "-I", "-S", str(plots.RUNNER)],
        capture_output=True, text=True, timeout=30,
    )
    assert completed.returncode == 2
    assert "usage" in completed.stderr


# -- what a script draws -----------------------------------------------------
@needs_matplotlib
def test_show_keeps_the_figure_and_closes_it(tmp_path):
    body = (
        "import matplotlib.pyplot as plt\n"
        "plt.plot([1, 2, 3])\n"
        "plt.show()\n"
        "print(len(plt.get_fignums()))\n"
    )
    result = run(tmp_path, body)
    assert result["ok"], result["err"]
    assert result["figures"] == ["figure-1.png"]
    assert result["out"].strip() == "0"


@needs_matplotlib
def test_two_shows_are_two_figures_in_order(tmp_path):
    body = (
        "import matplotlib.pyplot as plt\n"
        "plt.plot([1])\nplt.show()\n"
        "plt.plot([2])\nplt.show()\n"
    )
    result = run(tmp_path, body)
    assert result["figures"] == ["figure-1.png", "figure-2.png"]


@needs_matplotlib
def test_a_figure_left_open_at_exit_is_kept(tmp_path):
    """The script that forgot to save and never called show."""
    body = "import matplotlib.pyplot as plt\nplt.plot([1, 2])\n"
    result = run(tmp_path, body)
    assert result["ok"], result["err"]
    assert result["figures"] == ["figure-1.png"]


@needs_matplotlib
def test_a_crash_after_drawing_still_keeps_the_figure(tmp_path):
    body = (
        "import matplotlib.pyplot as plt\n"
        "plt.plot([1, 2])\n"
        "raise RuntimeError('after')\n"
    )
    result = run(tmp_path, body)
    assert not result["ok"]
    assert "RuntimeError: after" in result["err"]
    assert result["figures"] == ["figure-1.png"]


@needs_matplotlib
def test_savefig_is_reported_project_relative_and_only_inside_the_project(tmp_path):
    outside = tmp_path / "elsewhere.png"
    body = (
        "import matplotlib.pyplot as plt\n"
        "fig, ax = plt.subplots()\nax.plot([1])\n"
        "fig.savefig('figures/a.pdf')\n"
        f"fig.savefig({str(outside)!r})\n"
        "plt.close(fig)\n"
    )
    result = run(tmp_path, body)
    assert result["ok"], result["err"]
    assert result["saved"] == ["figures/a.pdf"]
    assert outside.is_file()
    # A closed, saved figure is not also shown as a leftover.
    assert result["figures"] == []


@needs_matplotlib
def test_the_seeded_helper_is_captured_through_saved(tmp_path):
    """`figure.py` calls `matplotlib.use("Agg")` itself, which would defeat
    a `module://` backend; the pyplot patch survives it."""
    root = tmp_path / "project"
    plots.ensure_baseline(root)
    body = (
        "from figure import figure, save\n"
        "fig, ax = figure()\nax.plot([1, 2, 3])\n"
        "print(save(fig, 'runs'))\n"
    )
    result = run(tmp_path, body)
    assert result["ok"], result["err"]
    assert result["out"].strip() == "figures/runs.pdf"
    assert result["saved"] == ["figures/runs.pdf"]
    assert (root / "figures" / "runs.pdf").is_file()


def test_a_capture_file_that_lies_is_not_believed(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    capture = tmp_path / "cap"
    capture.mkdir()
    (capture / "capture.json").write_text(json.dumps({
        "figures": ["../secret.png", "figure-1.png", 7],
        "saved": ["/etc/passwd", str(root / "figures" / "gone.pdf"), 3],
    }), encoding="utf-8")
    (capture / "figure-1.png").write_bytes(b"png")
    assert plots.captured(root, capture) == {"figures": ["figure-1.png"], "saved": []}
