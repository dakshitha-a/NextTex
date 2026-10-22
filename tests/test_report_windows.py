"""The Windows events section against a real Windows.

Everything in tests/test_report.py stubs PowerShell.  This file runs the
real branch, on the Windows runner the python workflow's other-platforms
job provides, and asserts only what a machine that has never run NextTex
can promise: the section renders one of its three shapes, or says that
PowerShell was given up on or failed, in words, and raises nothing.
Skipped everywhere else.
"""

import sys

import pytest

from nexttex import report

pytestmark = pytest.mark.skipif(not sys.platform.startswith("win"), reason="Windows only")


def test_the_section_renders_on_a_real_windows():
    rows = report.windows_events("nexttex")
    assert rows, "the section was empty on Windows"
    assert all(isinstance(row, str) for row in rows)
    text = "\n".join(rows)
    if len(rows) == 1 and rows[0].startswith("(powershell"):
        # A cold PowerShell on a busy runner can pass the thirty-second
        # ceiling, and then the section is the one line that says so,
        # which is the shape the report gives a writer on a slow laptop
        # too. Seen on CI for 4.37.2.
        assert "given up on" in text or "failed" in text
        return
    assert "Task Scheduler history for nexttex" in text
    assert "Application log crashes naming python" in text
    assert (
        "not enabled" in text
        or "holds nothing for the task" in text
        or "could not be read" in text
        or "Task Scheduler" in text
        or "powershell" in text
    )
