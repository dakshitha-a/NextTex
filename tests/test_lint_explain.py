"""Every chktex warning this project explains, proved against chktex.

The risk in a table keyed on a tool's warning numbers is that the numbers
are read out of a comment somewhere and one of them is wrong, so the
drawer confidently explains a warning the writer is not looking at. Every
rule therefore carries the fragment that produces it, and this file runs
chktex over each one.
"""

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from nexttex.config import ensure_tex_on_path
from nexttex.lint_explain import LINT_RULES, explain

# The TeX tree is not on the default PATH here any more than it is for the
# app, and chktex lives in it. Put it there before deciding to skip.
ensure_tex_on_path()

chktex = pytest.mark.skipif(
    shutil.which("chktex") is None, reason="chktex is not installed here"
)

RC = Path(__file__).resolve().parent.parent / ".chktexrc"


def numbers_for(fragment: str) -> set[int]:
    """The warning numbers chktex reports for one fragment, under our rc."""
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / "probe.tex"
        source.write_text(
            "\\documentclass{article}\n\\begin{document}\n"
            f"{fragment}\n\\end{{document}}\n",
            encoding="utf-8",
        )
        out = subprocess.run(
            ["chktex", "-q", "-I0", "-f", "%n:%m\n", "-l", str(RC), str(source)],
            capture_output=True, text=True, timeout=30, cwd=folder,
        ).stdout
    found = set()
    for row in out.splitlines():
        head = row.split(":", 1)[0].strip()
        if head.isdigit():
            found.add(int(head))
    return found


@chktex
@pytest.mark.parametrize("number", sorted(LINT_RULES))
def test_the_number_is_the_warning_it_claims_to_be(number):
    assert number in numbers_for(LINT_RULES[number].trigger), (
        f"chktex did not report warning {number} for the fragment the rule "
        f"for it carries; the table and this chktex disagree"
    )


@chktex
def test_nothing_is_explained_that_the_project_has_muted():
    # Parsed out of the file rather than listed here, because a mute added
    # to `.chktexrc` and an explanation left behind would leave the drawer
    # holding English for a warning nobody can see.
    muted = {int(n) for n in re.findall(r"-n(\d+)", RC.read_text(encoding="utf-8"))}
    assert muted, "the rc no longer mutes anything, which is worth knowing"
    assert not (muted & set(LINT_RULES)), (
        f"explained but muted: {sorted(muted & set(LINT_RULES))}"
    )


@chktex
def test_everything_the_triggers_produce_is_explained():
    # The corpus is the rules' own triggers, so a rule whose fragment fires
    # a second warning that has no English is caught: that second warning
    # is one a writer can see and this file is the list of the ones that
    # get explained.
    fired: set[int] = set()
    for rule in LINT_RULES.values():
        fired |= numbers_for(rule.trigger)
    assert not (fired - set(LINT_RULES)), (
        f"seen but not explained: {sorted(fired - set(LINT_RULES))}"
    )


def test_an_unknown_number_is_not_explained():
    assert explain(9999) is None
    assert explain(None) is None
    assert explain("not a number") is None


def test_the_explanation_has_the_three_fields_the_drawer_draws():
    said = explain(45)
    assert said and set(said) == {"title", "detail", "fix"}
    assert "$$" in said["title"]
