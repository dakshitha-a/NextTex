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
import os
import re
import shutil
import sys
from pathlib import Path

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
        for key, value in os.environ.items()
        if key not in {"DISPLAY", "WAYLAND_DISPLAY"}
    }
    env["MPLBACKEND"] = "Agg"
    # So a first run does not write a font cache into the writer's home.
    env["MPLCONFIGDIR"] = str(state_dir / "matplotlib")
    return env


def _clip(raw: bytes) -> tuple[str, bool]:
    text = raw.decode("utf-8", errors="replace")
    if len(text) <= OUTPUT_LIMIT:
        return text, False
    return text[:OUTPUT_LIMIT], True


async def run(root: Path, state_dir: Path, path: Path) -> dict:
    """Run one script and say what happened, in a shape a model can act on."""
    (state_dir / "matplotlib").mkdir(parents=True, exist_ok=True)
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            str(path),
            cwd=str(root),
            env=environment(state_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # So the whole group can be killed: a script that starts a child
            # and then hangs would otherwise leave the child behind.
            start_new_session=True,
        )
    except OSError as error:
        return {"ok": False, "code": -1, "out": "", "err": str(error)}

    try:
        out, err = await asyncio.wait_for(process.communicate(), TIMEOUT)
    except asyncio.TimeoutError:
        try:
            os.killpg(os.getpgid(process.pid), 9)
        except (OSError, ProcessLookupError):
            process.kill()
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
    missing = MISSING.search(stderr)
    return {
        "ok": process.returncode == 0,
        "code": process.returncode,
        "out": stdout,
        "err": stderr,
        "clipped": out_clipped or err_clipped,
        "missing": missing.group(1).split(".")[0] if missing else "",
    }


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
