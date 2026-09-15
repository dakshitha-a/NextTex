"""Drawing a figure by running a script, and the fence that has to ask.

Almost none of this needs matplotlib, deliberately: what is worth asserting
is the confinement, the argv, the environment and the four ways a run can
fail quietly.  One case at the end draws a real figure and skips where the
library is absent, in the pattern `docs/architecture.md` describes for TeX
tools.
"""

import asyncio
import importlib.util
import os
import sys
import time

import pytest

from nexttex import plots
from nexttex.agent import ProjectAgent

HAS_MATPLOTLIB = importlib.util.find_spec("matplotlib") is not None


def agent(tmp_path):
    project = tmp_path / "project"
    (project / ".nexttex").mkdir(parents=True)
    (project / "main.tex").write_text("x", encoding="utf-8")
    subject = ProjectAgent(project, project / ".nexttex")
    subject.apply_edit = lambda path, text: (
        path.parent.mkdir(parents=True, exist_ok=True),
        path.write_text(text, encoding="utf-8"),
    )
    return subject


def said(result) -> str:
    return result["content"][0]["text"]


def plot(subject, **args):
    return asyncio.run(subject.plot_tool(args))


# -- what a name may be ------------------------------------------------------
@pytest.mark.parametrize("name", [
    "../../evil", "/etc/passwd", "a/b", "..", "", "-rf", "a" * 80,
])
def test_a_name_that_could_be_a_path_is_refused(tmp_path, name):
    assert plots.script_path(tmp_path, name) is None


def test_an_ordinary_name_lands_in_the_scripts_directory(tmp_path):
    assert plots.script_path(tmp_path, "runs") == tmp_path / "scripts" / "runs.py"
    # With or without the extension the writer thought to add.
    assert plots.script_path(tmp_path, "runs.py") == tmp_path / "scripts" / "runs.py"


def test_the_tool_refuses_a_name_that_is_not_one(tmp_path):
    subject = agent(tmp_path)
    result = plot(subject, name="../../evil", script="print(1)")
    assert "not a name I can save" in said(result)


# -- the baseline ------------------------------------------------------------
def test_the_baseline_is_written_once_and_never_overwritten(tmp_path):
    written = plots.ensure_baseline(tmp_path)
    assert sorted(written) == ["scripts/figure.py", "scripts/plotstyle.mplstyle"]
    style = tmp_path / "scripts" / "plotstyle.mplstyle"
    assert "font.family: serif" in style.read_text(encoding="utf-8")

    # The writer's own edit survives the next plot, which is the whole
    # reason these live in the project rather than inside NextTex.
    style.write_text("font.size: 42\n", encoding="utf-8")
    assert plots.ensure_baseline(tmp_path) == []
    assert style.read_text(encoding="utf-8") == "font.size: 42\n"


def test_the_helper_names_the_width_that_matters(tmp_path):
    """The one number a writer has to change for their own document, and the
    reason a default matplotlib figure has unreadable labels."""
    plots.ensure_baseline(tmp_path)
    helper = (tmp_path / "scripts" / "figure.py").read_text(encoding="utf-8")
    assert "COLUMN_INCHES" in helper and "PAGE_INCHES" in helper
    assert "showthe" in helper


# -- how it runs -------------------------------------------------------------
def test_no_display_reaches_the_script(tmp_path):
    """`Agg` is the whole answer to a script trying to open a window: with
    it set, `show()` is a no-op rather than a wait on an event loop that
    will never arrive."""
    env = plots.environment(tmp_path)
    assert env["MPLBACKEND"] == "Agg"
    assert "DISPLAY" not in env and "WAYLAND_DISPLAY" not in env
    assert env["MPLCONFIGDIR"].endswith("matplotlib")


def test_a_stdlib_script_runs_and_writes_its_output(tmp_path):
    subject = agent(tmp_path)
    result = plot(
        subject, name="plain",
        script=(
            "from pathlib import Path\n"
            "Path('figures').mkdir(exist_ok=True)\n"
            "Path('figures/plain.pdf').write_text('not really a pdf')\n"
            "print('drew it')\n"
        ),
        output="figures/plain.pdf",
    )
    assert "Drew figures/plain.pdf" in said(result)
    assert "drew it" in said(result)
    assert (subject.root / "figures" / "plain.pdf").is_file()
    # And the script is in the project, as source the writer can change.
    assert (subject.root / "scripts" / "plain.py").is_file()


def test_a_script_that_writes_nothing_is_not_a_success(tmp_path):
    """The common failure, and a tool that reported success for it would
    send the model on to insert a figure that is not there."""
    subject = agent(tmp_path)
    result = plot(subject, name="empty", script="pass\n", output="figures/empty.pdf")
    assert "no file at figures/empty.pdf" in said(result)


def test_a_file_that_was_already_there_does_not_count(tmp_path):
    subject = agent(tmp_path)
    (subject.root / "figures").mkdir()
    stale = subject.root / "figures" / "old.pdf"
    stale.write_text("from last week", encoding="utf-8")
    os.utime(stale, (1, 1))
    result = plot(subject, name="nothing", script="pass\n", output="figures/old.pdf")
    assert "was not written by this run" in said(result)


def test_an_output_outside_the_project_is_refused(tmp_path):
    subject = agent(tmp_path)
    result = plot(
        subject, name="escape", script="pass\n",
        output=str(tmp_path / "elsewhere.pdf"),
    )
    assert "outside this project" in said(result)


def test_a_script_that_fails_says_what_it_said(tmp_path):
    subject = agent(tmp_path)
    result = plot(subject, name="broken", script="raise SystemExit(3)\n")
    assert "failed (exit 3)" in said(result)


def test_a_missing_module_is_reported_as_a_package(tmp_path):
    subject = agent(tmp_path)
    result = plot(subject, name="needy", script="import seaborn_definitely_absent\n")
    assert "seaborn_definitely_absent is not installed" in said(result)
    assert "install_package" in said(result)


def test_a_flood_of_output_is_truncated(tmp_path):
    subject = agent(tmp_path)
    result = plot(
        subject, name="loud",
        script="print('x' * 200000)\n",
    )
    # Well under the megabyte that killed the reader in section 27, and the
    # tool result is bounded whatever the script does.
    assert len(said(result)) < plots.OUTPUT_LIMIT * 2


def test_a_script_that_never_returns_is_stopped(tmp_path, monkeypatch):
    monkeypatch.setattr(plots, "TIMEOUT", 0.6)
    subject = agent(tmp_path)
    result = plot(subject, name="forever", script="import time; time.sleep(30)\n")
    assert "still running" in said(result)


def test_a_script_that_asks_for_input_is_answered_at_once(tmp_path, monkeypatch):
    """Left to inherit, stdin was the server's own, and an `input()` sat
    waiting on a terminal nobody was at until the timeout stopped it two
    minutes later.  Closed, it raises EOFError in the script at once."""
    monkeypatch.setattr(plots, "TIMEOUT", 3.0)
    subject = agent(tmp_path)
    # Under pytest stdin is already closed, so the fault would not show.
    # Give this process a stdin somebody could type into, held open and
    # never written, which is what a server started from a terminal has.
    reader, writer = os.pipe()
    saved = os.dup(0)
    os.dup2(reader, 0)
    try:
        result = plot(subject, name="asks", script="input('name? ')\n")
    finally:
        os.dup2(saved, 0)
        os.close(saved)
        os.close(reader)
        os.close(writer)
    assert "EOFError" in said(result)
    assert "still running" not in said(result)


def test_cancelling_a_run_ends_the_interpreter(tmp_path):
    """A stop button and a rerun of the same script both cancel the task
    awaiting the run.  The interpreter used to keep running to its timeout
    as an orphan; now the cancellation kills the process group, and the
    assertion is on the pid, not on the task having returned."""
    script = tmp_path / "forever.py"
    script.write_text(
        "import os, sys, time\n"
        "print(os.getpid(), flush=True)\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )

    async def scenario() -> int:
        started: list[int] = []
        original = asyncio.create_subprocess_exec

        async def noting(*args, **kwargs):
            process = await original(*args, **kwargs)
            started.append(process.pid)
            return process

        asyncio.create_subprocess_exec = noting  # type: ignore[assignment]
        try:
            task = asyncio.ensure_future(plots.run(tmp_path, tmp_path / ".nexttex", script))
            while not started:
                await asyncio.sleep(0.02)
            await asyncio.sleep(0.2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            asyncio.create_subprocess_exec = original  # type: ignore[assignment]
        return started[0]

    pid = asyncio.run(scenario())
    # The kill is delivered before the cancellation propagates, and the
    # wait after it reaps the process, so by here the pid is gone.
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


# -- installing on demand ----------------------------------------------------
@pytest.mark.parametrize("name", [
    "--index-url", "seaborn; curl evil", "../../etc", "", "-U", "a b",
])
def test_an_install_argument_that_is_not_a_package_is_refused(name):
    result = asyncio.run(plots.install(name))
    assert not result["ok"]
    assert "not a package name" in result["err"]


# -- the fence ---------------------------------------------------------------
def test_running_a_script_is_asked_about_like_a_shell_call(tmp_path):
    """The tool of ours the fence has to ask about hardest.

    Most `mcp__nexttex__` tools are waved past because none can reach the
    shell or a path outside the project. Python can do both, and more than
    `Bash` can, so routing this around the fence would put the app's one
    real fence behind a tool whose purpose is to run arbitrary code.

    It is asked about at the middle position too, and this test used to
    assert the opposite. That was the bug, not the test: the middle
    position's whole promise is that a write outside the project and
    anything reaching the internet still stop, and a script can do either
    without being named as either. The exclusion set that decides had
    grown a fifth answer, `"script"`, and the test reading it still named
    four, so this went through in silence.
    """
    subject = agent(tmp_path)

    async def refuse(tool, tool_input, tool_use_id=None):
        return "deny"

    subject._ask_user = refuse
    call = {
        "tool_name": "mcp__nexttex__run_plot_script",
        "tool_input": {"name": "x", "script": "import os; os.system('id')"},
    }
    result = asyncio.run(subject._pre_tool(call, None, None))
    assert result["hookSpecificOutput"]["permissionDecision"] == "deny"

    # And at the position that runs the work, which is the one this is
    # really about: it is where somebody who has said "stop asking" is
    # still promised that two things will stop it.
    subject.set_mode("project")
    result = asyncio.run(subject._pre_tool(call, None, None))
    assert result["hookSpecificOutput"]["permissionDecision"] == "deny"

    # Silent only at the last position, where nothing is asked about.
    subject.set_mode("all")
    result = asyncio.run(subject._pre_tool(call, None, None))
    assert result["hookSpecificOutput"]["permissionDecision"] == "allow"


def test_installing_a_package_asks_wherever_the_network_asks(tmp_path):
    subject = agent(tmp_path)
    subject.set_mode("project")

    async def refuse(tool, tool_input, tool_use_id=None):
        return "deny"

    subject._ask_user = refuse
    call = {
        "tool_name": "mcp__nexttex__install_package",
        "tool_input": {"name": "seaborn"},
    }
    result = asyncio.run(subject._pre_tool(call, None, None))
    assert result["hookSpecificOutput"]["permissionDecision"] == "deny"


def test_the_card_shows_the_script_rather_than_a_summary_of_it(tmp_path):
    subject = agent(tmp_path)
    card = subject.describe(
        "mcp__nexttex__run_plot_script", {"script": "import pandas as pd"},
    )
    assert card["headline"] == "Run a script to draw a figure"
    assert card["detail"] == "import pandas as pd"
    assert "anything Python can" in card["consequence"]


# -- and once, for real ------------------------------------------------------
@pytest.mark.skipif(not HAS_MATPLOTLIB, reason="matplotlib is not installed here")
def test_the_baseline_really_draws_a_pdf(tmp_path):
    subject = agent(tmp_path)
    result = plot(
        subject, name="line",
        script=(
            "from figure import figure, save\n"
            "fig, ax = figure()\n"
            "ax.plot([1, 2, 3], [2, 4, 9])\n"
            "ax.set_xlabel('Time / fs')\n"
            "ax.set_ylabel('Population')\n"
            "print(save(fig, 'line'))\n"
        ),
        output="figures/line.pdf",
    )
    assert "Drew figures/line.pdf" in said(result), said(result)
    drawn = subject.root / "figures" / "line.pdf"
    assert drawn.read_bytes().startswith(b"%PDF")


# --- what a script prints reaches the caller while it runs ------------------

def _stream(tmp_path, source: str, **kwargs):
    script = tmp_path / "talker.py"
    script.write_text(source, encoding="utf-8")
    seen: list[tuple[str, str, float]] = []
    started = time.monotonic()

    def on_output(stream: str, text: str) -> None:
        seen.append((stream, text, time.monotonic() - started))

    result = asyncio.run(
        plots.run(tmp_path, tmp_path / ".nexttex", script, on_output=on_output, **kwargs)
    )
    return result, seen, time.monotonic() - started


def test_output_reaches_the_callback_in_order_and_whole(tmp_path):
    result, seen, _ = _stream(tmp_path, "for i in range(50):\n    print(i)\n")
    out = "".join(text for stream, text, _ in seen if stream == "out")
    assert out == result["out"]
    assert [int(n) for n in out.split()] == list(range(50))


def test_a_line_arrives_before_the_script_ends(tmp_path):
    """The child block-buffers stdout when it is a pipe, so a print followed
    by a sleep did not leave it until exit.  PYTHONUNBUFFERED in the
    environment is what makes this hold, and the print here has no flush
    of its own on purpose."""
    result, seen, total = _stream(
        tmp_path, "import time\nprint('one')\ntime.sleep(1.0)\nprint('two')\n"
    )
    assert result["ok"] is True
    first = next(at for stream, text, at in seen if "one" in text)
    assert first < total - 0.8, "the first line waited for the script to end"


def test_the_environment_says_unbuffered(tmp_path):
    assert plots.environment(tmp_path)["PYTHONUNBUFFERED"] == "1"


def test_the_callback_stops_at_the_clip_and_the_child_is_not_blocked(tmp_path):
    """Past the clip the reader keeps reading and discards, because a full
    pipe would block the child until the timeout; and the callback is
    handed no more than the result carries."""
    result, seen, _ = _stream(tmp_path, "print('x' * 200000)\n")
    assert result["ok"] is True
    assert result["clipped"] is True
    assert len(result["out"]) == plots.OUTPUT_LIMIT
    handed = sum(len(text) for stream, text, _ in seen if stream == "out")
    assert handed <= plots.OUTPUT_LIMIT + 8192


def test_a_script_that_never_returns_is_stopped_while_streaming(tmp_path, monkeypatch):
    monkeypatch.setattr(plots, "TIMEOUT", 0.6)
    result, seen, _ = _stream(tmp_path, "import time\nprint('going')\ntime.sleep(30)\n")
    assert result["timeout"] is True
    assert any("going" in text for _, text, _ in seen)


def test_stderr_streams_apart_from_stdout(tmp_path):
    result, seen, _ = _stream(
        tmp_path, "import sys\nprint('out')\nprint('err', file=sys.stderr)\n"
    )
    assert [s for s, _, _ in seen if s == "err"]
    assert result["err"].strip() == "err"
