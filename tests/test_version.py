"""The version number: its shape, and the two ways of asking for it.

There is deliberately no test that a tag exists for the number, because CI
checks the repository out one commit deep and would never see one; the
`release` workflow is what refuses a tag that disagrees with the file.
"""

import subprocess
import sys
from pathlib import Path

from nexttex import report, version

ROOT = Path(__file__).resolve().parent.parent


def test_the_number_has_three_parts():
    assert version.SHAPE.match(version.VERSION)


def test_the_line_is_found_the_way_git_show_sees_it():
    text = (ROOT / "nexttex" / "version.py").read_text(encoding="utf-8")
    assert version.parse(text) == version.VERSION
    assert version.parse("nothing here\n") == ""


def test_a_bare_interpreter_prints_the_version_and_both_commits():
    """The spelling for an install whose virtual environment broke, which
    `server/run.py --version` cannot be, since it imports uvicorn first."""
    result = subprocess.run(
        [sys.executable, "-m", "nexttex.version"], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    lines = result.stdout.splitlines()
    assert lines[0] == f"NextTex   {version.VERSION}"
    assert lines[1].startswith("code      ")
    assert lines[2].startswith("interface ")


def test_the_bug_report_leads_with_the_version(tmp_path):
    facts = report.facts_of(tmp_path)
    assert facts["version"] == version.VERSION
    assert report.install_section(facts)[0] == f"version    {version.VERSION}"
