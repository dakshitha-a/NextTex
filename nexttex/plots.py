"""Running a script that draws a figure, and nothing else.

The tool takes a script rather than a chart description, and that is the
decision the rest of this file follows from. A description-shaped tool can
draw a bar chart and cannot draw the figure a paper needs; a script can do
anything, and it is also the thing a reader can check, re-run and change
next year when a referee asks for the same plot on a log axis.

**This is the one tool of ours that the fence has to ask about.** Every
other `mcp__nexttex__` tool is waved past it, on the argument written above
`_ALWAYS_OK` in `agent.py`: none of them can reach the shell or a path
outside the project, so a card for one would be a card for nothing, and a
card for nothing teaches the writer to click Allow without reading. A tool
that runs Python the model wrote breaks that sentence outright. Python can
start a subprocess, open a socket and write anywhere the server's user can
write, so this has strictly more reach than `Bash`. Routing it around the
fence would put the app's one real fence behind a tool whose whole purpose
is to run arbitrary code.

So it is fenced like a shell call: asked at the first position with the
script itself as the card's literal text, silent at the other two. One card
per plot is not the hundreds of cards this rework exists to remove.
"""

from __future__ import annotations

import asyncio
import codecs
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Callable

from .childenv import without_secrets

#: Where a script lives, and where its figure goes.  Both inside the
#: project, both ordinary directories the writer can open.
SCRIPTS = "scripts"
FIGURES = "figures"

#: The two files that make the first attempt look like a paper's figure.
#: Written once and never overwritten, because they are the writer's to
#: argue with and an edit of theirs has to survive the next plot.
BASELINE = {
    "plotstyle.mplstyle": "plotstyle.mplstyle",
    "figure.py": "figure_helper.py",
}

#: A script name, and nothing that could be a path or an option.
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

#: The build's own timeout, because a figure over a large dataset is the
#: same kind of wait as a compile and a writer's patience is the same.
TIMEOUT = 120.0

#: Per stream.  A script looping over a warning per row is how a tool result
#: becomes a megabyte, and section 27 of the design document is about
#: exactly that failure on exactly this wire.
OUTPUT_LIMIT = 64 * 1024

#: What a missing import looks like, so it can be reported as a package
#: rather than as a traceback.
MISSING = re.compile(r"No module named ['\"]([A-Za-z0-9_.]+)['\"]")

#: The variable the runner reads the capture directory from, and what a
#: captured figure may be called: the route that serves one matches this
#: and nothing else.
CAPTURE_ENV = "NEXTTEX_CAPTURE_DIR"
FIGURE_NAME = re.compile(r"^figure-\d{1,4}\.png$")


def ensure_baseline(root: Path) -> list[str]:
    """Put the style sheet and the helper in the project, once.

    Returns what it wrote, which is empty on every run after the first.
    """
    written: list[str] = []
    target = root / SCRIPTS
    target.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).resolve().parent
    for name, source in BASELINE.items():
        destination = target / name
        if destination.exists():
            continue
        try:
            shutil.copyfile(here / source, destination)
        except OSError:
            continue
        written.append(f"{SCRIPTS}/{name}")
    return written


def script_path(root: Path, name: str) -> Path | None:
    """Where a script of this name belongs, or None if the name is not one."""
    stem = name[:-3] if name.endswith(".py") else name
    if not NAME.match(stem):
        return None
    return root / SCRIPTS / f"{stem}.py"


def environment(state_dir: Path) -> dict[str, str]:
    """What the subprocess runs with.

    `Agg` is the whole answer to a figure script trying to open a window:
    with it set, `pyplot.show()` is a no-op rather than a wait on a GUI
    event loop that will never arrive, so the ordinary script a model writes
    cannot hang the run.  The two display variables go as well, because a
    library that reads them directly should not find one either.
    """
    env = {
        key: value
        for key, value in without_secrets(os.environ).items()
        if key not in {"DISPLAY", "WAYLAND_DISPLAY"}
    }
    env["MPLBACKEND"] = "Agg"
    # So a first run does not write a font cache into the writer's home.
    env["MPLCONFIGDIR"] = str(state_dir / "matplotlib")
    # A Python child block-buffers stdout when it is a pipe, so a print
    # followed by a long computation did not leave the child until it
    # exited, and nothing could be shown while it ran.  The variable
    # covers the script, the runner, and any Python the script starts.
    env["PYTHONUNBUFFERED"] = "1"
    return env


def _kill(process: asyncio.subprocess.Process) -> None:
    """End the run and everything it started, on either platform; see
    `nexttex/proctree.py`, since Windows has no `os.killpg`."""
    from .proctree import end_tree

    end_tree(process.pid, hard=True)
    try:
        process.kill()
    except (ProcessLookupError, OSError):
        pass


def _clip(raw: bytes) -> tuple[str, bool]:
    text = raw.decode("utf-8", errors="replace")
    if len(text) <= OUTPUT_LIMIT:
        return text, False
    return text[:OUTPUT_LIMIT], True


#: The program that runs a script when what it draws is wanted: see
#: `script_runner.py`, which is standard library only and imports nothing
#: of NextTex, since the script's directory replaces its own on `sys.path`.
RUNNER = Path(__file__).resolve().with_name("script_runner.py")


async def _pump(
    process: asyncio.subprocess.Process,
    on_output: Callable[[str, str], None] | None,
) -> tuple[bytes, bytes]:
    """Read both pipes as they fill, and say what arrives while it does.

    What `communicate()` did in one go at exit, done a chunk at a time:
    each chunk under the clip is kept and handed to `on_output`, and past
    the clip the reader keeps reading and throws away, because stopping
    would fill the pipe and block the child until the timeout.  Chunks
    rather than lines, since a script can print one line longer than the
    reader's line limit; an incremental decoder per stream keeps a
    multibyte character split across two chunks whole.
    """
    async def read(stream: asyncio.StreamReader | None, name: str) -> bytes:
        if stream is None:
            return b""
        kept = bytearray()
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        while True:
            chunk = await stream.read(8192)
            if not chunk:
                break
            # One chunk past the clip is kept, so `_clip` can see that
            # there was more and say so.
            if len(kept) > OUTPUT_LIMIT:
                continue
            kept.extend(chunk)
            if on_output is not None:
                text = decoder.decode(chunk)
                if text:
                    on_output(name, text)
        return bytes(kept)

    out, err = await asyncio.gather(
        read(process.stdout, "out"), read(process.stderr, "err"),
    )
    await process.wait()
    return out, err


async def run(
    root: Path, state_dir: Path, path: Path, capture: Path | None = None,
    *, on_output: Callable[[str, str], None] | None = None,
) -> dict:
    """Run one script and say what happened, in a shape a model can act on.

    The script runs under `script_runner.py`, which keeps what it starts
    within reach of a stop.  With `capture`, the runner also keeps
    what `pyplot.show()` and the end of the run see as PNGs in that
    directory and notes every `savefig`; the result then carries `figures`
    (their names, in order) and `saved` (the project-relative paths the
    script wrote, with anything outside the project left out).

    `on_output(stream, text)` is called with each chunk of output as it
    arrives, "out" or "err", up to the same clip the result carries, so
    a pane can show what a script prints while it is still running.
    """
    (state_dir / "matplotlib").mkdir(parents=True, exist_ok=True)
    # Made before the run, since the tool tells the model figures go there
    # and a script with a plain `savefig('figures/square.pdf')` failed on a
    # project with none, and the model spent two rounds finding out why
    # (Q-044).
    (root / FIGURES).mkdir(exist_ok=True)
    env = environment(state_dir)
    # Always the runner, captured or not: it is also what keeps a child
    # that left the script's session within reach of a stop (Q-007).
    argv = [sys.executable, str(RUNNER), str(path)]
    if capture is not None:
        capture.mkdir(parents=True, exist_ok=True)
        env[CAPTURE_ENV] = str(capture)
    started = time.monotonic()
    try:
        process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(root),
            env=env,
            # Nothing to read.  Left to inherit, stdin was the server's
            # own, so an `input()` in a script sat waiting on a terminal
            # nobody was at until the timeout stopped it two minutes later.
            # Closed, it raises EOFError at once, which is an answer.
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # So the whole group can be killed: a script that starts a child
            # and then hangs would otherwise leave the child behind.
            start_new_session=True,
        )
    except OSError as error:
        return {"ok": False, "code": -1, "out": "", "err": str(error)}

    try:
        out, err = await asyncio.wait_for(_pump(process, on_output), TIMEOUT)
    except asyncio.CancelledError:
        # The task awaiting this run was cancelled, which is what a stop
        # button and a rerun of the same script both do.  Without this the
        # interpreter kept running to its timeout as an orphan of nobody,
        # holding whatever file it was writing.
        _kill(process)
        await process.wait()
        raise
    except asyncio.TimeoutError:
        _kill(process)
        await process.wait()
        return {
            "ok": False,
            "code": -1,
            "out": "",
            "err": f"It was still running after {int(TIMEOUT)} seconds and was stopped.",
            "timeout": True,
        }

    stdout, out_clipped = _clip(out or b"")
    stderr, err_clipped = _clip(err or b"")
    # A traceback names the script by its absolute path, which is the
    # machine's business and not the writer's: `scripts/fig.py` is how the
    # file is known everywhere else on the screen, and it is the name the
    # agent should be handed.
    for prefix in {str(root), str(root.resolve())}:
        stderr = stderr.replace(prefix + os.sep, "")
    missing = MISSING.search(stderr)
    result = {
        "ok": process.returncode == 0,
        "code": process.returncode,
        "out": stdout,
        "err": stderr,
        "clipped": out_clipped or err_clipped,
        "missing": missing.group(1).split(".")[0] if missing else "",
        "duration_ms": int((time.monotonic() - started) * 1000),
    }
    if capture is not None:
        result.update(captured(root, capture))
    return result


def captured(root: Path, capture: Path) -> dict:
    """What the runner left in the capture directory, checked before it is
    believed: the names are matched against the pattern the route serves,
    and a saved path is reported only when it is inside the project."""
    figures: list[str] = []
    saved: list[str] = []
    try:
        data = json.loads((capture / "capture.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    for name in data.get("figures") or []:
        if isinstance(name, str) and FIGURE_NAME.match(name) and (capture / name).is_file():
            figures.append(name)
    resolved_root = root.resolve()
    for raw in data.get("saved") or []:
        if not isinstance(raw, str):
            continue
        try:
            target = Path(raw).resolve()
            relative = target.relative_to(resolved_root).as_posix()
        except (OSError, ValueError):
            continue
        if target.is_file() and relative not in saved:
            saved.append(relative)
    return {"figures": figures, "saved": saved}


#: A package name, and nothing that could be an option, a URL or a path.
#: This is what refuses `--index-url http://evil`, `seaborn; curl ...` and
#: `../../etc`.  A version pin is a second feature and can wait.
PACKAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

#: Longer than a plot, because a wheel has to be fetched and built.
INSTALL_TIMEOUT = 300.0


async def install(name: str) -> dict:
    """Install one package into the environment the server is running in."""
    if not PACKAGE.match(name):
        return {"ok": False, "err": f"{name!r} is not a package name."}
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "pip", "install", "--no-input", name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
        out, _ = await asyncio.wait_for(process.communicate(), INSTALL_TIMEOUT)
    except asyncio.TimeoutError:
        return {"ok": False, "err": "The install was still running after five minutes."}
    except OSError as error:
        return {"ok": False, "err": str(error)}
    text, _ = _clip(out or b"")
    return {"ok": process.returncode == 0, "err": text}
