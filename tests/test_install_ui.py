"""The installer's screen, and the one place it starts a child process.

The first test in this file is the one that matters most, because the bug it
guards is the bug that hid every other bug: the PowerShell installer ran pip,
uv, winget and npm without checking an exit code after any of them, so a
failed dependency install walked on and told the person NextTex was ready.
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import pytest

# The rest of this file runs anywhere; the two cases that need a real
# terminal do not exist on Windows, where `pty` is not importable at all.
# Skipping at collection is the difference between "two tests did not run"
# and a red suite on a platform this installer is meant to support.
pty = pytest.importorskip("pty")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nexttex.install import ui  # noqa: E402


def quiet_console(log: Path | None = None) -> ui.Console:
    return ui.Console(stream=io.StringIO(), plain=True, log=log)


def test_a_failing_step_is_reported_as_failing():
    """The whole reason this module exists.

    A step whose child exits non-zero must come back not-ok, carrying what
    the child actually said.  Nothing downstream may treat it as done.
    """
    console = quiet_console()
    result = console.run("Installing the Python dependencies",
                         ["sh", "-c", "echo 'ERROR: could not build wheel'; exit 1"])
    assert result.ok is False
    assert result.code == 1
    assert any("could not build wheel" in line for line in result.output)
    assert "FAILED" in console.stream.getvalue()


def test_a_failing_step_prints_what_the_child_said():
    console = quiet_console()
    result = console.run("Installing", ["sh", "-c", "echo boom >&2; exit 2"])
    console.failed(result, "The Python dependencies did not install.")
    printed = console.stream.getvalue()
    assert "boom" in printed
    assert "The Python dependencies did not install." in printed
    # And it says the install can simply be run again, which is true and is
    # the only thing somebody reading this actually wants to know.
    assert "Run the installer again" in printed


def test_a_missing_program_is_a_failure_not_a_traceback():
    console = quiet_console()
    result = console.run("Doing a thing", ["nexttex-no-such-program-anywhere"])
    assert result.ok is False
    assert result.code == 127


def test_without_a_terminal_nothing_is_ever_redrawn():
    """`_STEPS` in server/main.py reads this shape of output out of a pipe,
    line by line, and matches substrings in it to name the step the in-app
    update footer is showing.  A carriage return in that stream arrives as
    one enormous line and the footer stops naming anything."""
    console = quiet_console()
    console.run("Downloading the interface", ["sh", "-c", "echo a; echo b"])
    printed = console.stream.getvalue()
    assert "\r" not in printed
    assert "\033" not in printed
    # The child's own output is still there, indented, which is what makes a
    # stall on a slow mirror legible rather than a mystery.
    assert "      a" in printed and "      b" in printed


def test_the_lines_downstream_matches_on_survive():
    """The literal substrings `_STEPS` looks for."""
    console = quiet_console()
    console.run("Downloading the interface", ["sh", "-c", "true"])
    assert "interface" in console.stream.getvalue()


def test_with_a_terminal_the_line_is_redrawn_in_place(monkeypatch):
    # A real terminal, and nothing telling the installer it is in CI.
    # GitHub sets CI on every runner, and the animation is deliberately off
    # there, so without this the test asserts the opposite of the intended
    # behaviour on the one machine that is not a laptop.
    monkeypatch.delenv("CI", raising=False)
    parent, child = pty.openpty()
    try:
        stream = os.fdopen(child, "w", buffering=1)
        console = ui.Console(stream=stream)
        assert console.animate is True
        console.run("Installing", ["sh", "-c", "echo one; sleep 0.3; echo two"])
        stream.flush()
        os.set_blocking(parent, False)
        try:
            seen = os.read(parent, 65536).decode("utf-8", "replace")
        except BlockingIOError:
            seen = ""
    finally:
        os.close(parent)
    assert "\r" in seen, "an animated run never redrew its line"
    assert "Installing" in seen


def test_a_terminal_in_ci_still_gets_the_plain_output(monkeypatch):
    """A build log is read afterwards, not watched, so a spinner in one is
    thousands of redraws nobody ever saw.

    This is not hypothetical: the two tests above passed on a laptop and
    failed on every GitHub runner, because the runners set CI and the
    animation is off there by design. The behaviour was right and the tests
    were asserting the wrong thing on the one machine that is not a laptop.
    """
    monkeypatch.setenv("CI", "true")
    parent, child = pty.openpty()
    try:
        console = ui.Console(stream=os.fdopen(child, "w", buffering=1))
        assert console.animate is False
    finally:
        os.close(parent)


def test_a_console_that_cannot_print_a_spinner_gets_one_it_can():
    """The Windows console bug, tested from Linux.

    System Python in a PowerShell 5.1 window can report cp1252, where the
    braille spinner raises UnicodeEncodeError -- inside the draw loop, in the
    middle of a step, on the machine nobody is testing on.
    """
    stream = io.TextIOWrapper(io.BytesIO(), encoding="cp1252")
    console = ui.Console(stream=stream, plain=True)
    assert console.unicode is False
    assert console.frames == ui.PLAIN_FRAMES
    assert console.tick.isascii() and console.dash.isascii()
    # And it can actually be written, which is the thing that used to throw.
    console.run("Installing", ["sh", "-c", "true"])
    console.write(console.tick + console.cross + console.bullet)


def test_a_utf8_console_gets_the_good_spinner():
    stream = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")
    console = ui.Console(stream=stream, plain=True)
    assert console.frames == ui.FANCY_FRAMES


def test_the_output_is_truncated_to_the_width_of_the_terminal(monkeypatch):
    import shutil as shutil_mod

    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setattr(ui.shutil, "get_terminal_size",
                        lambda default=(80, 24): os.terminal_size((60, 24)))
    parent, child = pty.openpty()
    try:
        stream = os.fdopen(child, "w", buffering=1)
        console = ui.Console(stream=stream)
        console.run("Installing", ["sh", "-c", f"echo {'x' * 400}; sleep 0.3"])
        stream.flush()
        os.set_blocking(parent, False)
        try:
            seen = os.read(parent, 262144).decode("utf-8", "replace")
        except BlockingIOError:
            seen = ""
    finally:
        os.close(parent)
    assert seen, "nothing was drawn"
    longest = max(len(part) for part in seen.replace("\033[2K", "").split("\r"))
    assert longest <= 200, f"a drawn line was {longest} characters wide"
    assert shutil_mod is not None


def test_the_log_is_readable_afterwards(tmp_path):
    log = tmp_path / "install.log"
    console = quiet_console(log=log)
    console.run("Installing", ["sh", "-c", "echo hello; exit 4"])
    text = log.read_text(encoding="utf-8")
    assert "hello" in text
    assert "$ sh -c" in text, "the log does not say what was run"
    # Read in an editor afterwards, not watched: no redraws, no escapes.
    assert "\r" not in text
    assert "\033" not in text


def test_the_log_names_itself_when_a_step_fails(tmp_path):
    log = tmp_path / "install.log"
    console = quiet_console(log=log)
    result = console.run("Installing", ["sh", "-c", "exit 1"])
    console.failed(result)
    assert str(log) in console.stream.getvalue()


def test_nobody_there_means_the_default_answer():
    console = quiet_console()
    assert console.ask("  Directory: ", "~/apps/NextTex") == "~/apps/NextTex"


@pytest.mark.parametrize(
    "seconds,expected", [(0, "0s"), (9, "9s"), (59, "59s"), (60, "1m 00s"), (191, "3m 11s")]
)
def test_the_clock_reads_the_way_a_person_would_say_it(seconds, expected):
    assert ui._clock(seconds) == expected
