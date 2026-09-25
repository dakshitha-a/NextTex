"""Coming back from an update that does not start.

The update page pulls, installs, fetches the interface and restarts. If the
new code then failed to start, the service manager restarted the same
broken commit every few seconds for ever, and nothing went back (Q-012).

So the update writes down the commit it is leaving, in
`update-pending.json` in the state directory, and this counts the starts
since. A server that has answered for `HEALTHY_AFTER` seconds deletes the
note, which is an update that worked. A note that reaches `TRIES` starts is
a new version that keeps dying: the checkout goes back to the commit it
left, the interface the update replaced is put back, `update-rolled-back.json`
says what happened for the update sheet to show, and the process exits for
the supervisor to start the old code.

Standard library only, and imported by `server/run.py` before anything
else of NextTex's: a new version that cannot import its own modules is the
one this is for.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PENDING = "update-pending.json"
ROLLED_BACK = "update-rolled-back.json"
#: Where the update keeps the interface it replaced.
PREVIOUS_INTERFACE = "update-previous-interface"
#: Starts a new version gets before it is given up on.
TRIES = 3
#: How long a server must answer before its update counts as having worked.
HEALTHY_AFTER = 30.0


def state_home(environ=None) -> Path:
    """`nexttex.paths.state_home`, copied rather than imported, since this
    runs before the new version's own modules are trusted to import."""
    environ = environ if environ is not None else os.environ
    base = environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    name = environ.get("NEXTTEX_INSTANCE", "").strip()
    name = name if re.fullmatch(r"[A-Za-z0-9_-]{1,32}", name) else ""
    return Path(base) / (f"nexttex-{name}" if name else "nexttex")


#: Flags that print something and exit rather than serve, which a start
#: after an update must not count.
NOT_SERVING = {"--print-url", "--version", "--report", "--set-password"}


def serving(argv: list[str]) -> bool:
    return not NOT_SERVING.intersection(argv)


def instance_from(argv: list[str]) -> str:
    """`--instance NAME` or `--instance=NAME`, read before argparse runs."""
    for index, arg in enumerate(argv):
        if arg.startswith("--instance="):
            return arg.split("=", 1)[1]
        if arg == "--instance" and index + 1 < len(argv):
            return argv[index + 1]
    return ""


def _read(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value), encoding="utf-8")
    os.replace(temporary, path)


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, check=True,
    ).stdout.strip()


def leaving(state: Path, root: Path = ROOT) -> str | None:
    """Before an update: write down the commit it leaves, and keep the
    interface it may replace. Returns the commit, or None when this is not
    a checkout."""
    try:
        commit = _git(root, "rev-parse", "HEAD")
    except (OSError, subprocess.CalledProcessError):
        return None
    dist = root / "frontend" / "dist"
    kept = state / PREVIOUS_INTERFACE
    shutil.rmtree(kept, ignore_errors=True)
    if dist.is_dir():
        try:
            shutil.copytree(dist, kept)
        except OSError:
            shutil.rmtree(kept, ignore_errors=True)
    _write(state / PENDING, {"from": commit, "starts": 0, "at": time.time()})
    return commit


def abandoned(state: Path) -> None:
    """The update did not get as far as restarting: nothing to watch."""
    (state / PENDING).unlink(missing_ok=True)


def healthy(state: Path) -> None:
    """This server has answered for long enough: the update worked."""
    (state / PENDING).unlink(missing_ok=True)
    shutil.rmtree(state / PREVIOUS_INTERFACE, ignore_errors=True)
    (state / ROLLED_BACK).unlink(missing_ok=True)


def at_start(argv: list[str], root: Path = ROOT, environ=None) -> bool:
    """Count this start; go back if the new version keeps dying.

    Returns True when it went back, and the caller exits for the
    supervisor to start the old code.
    """
    environ = dict(environ if environ is not None else os.environ)
    name = instance_from(argv)
    if name:
        environ["NEXTTEX_INSTANCE"] = name
    state = state_home(environ)
    note = _read(state / PENDING)
    if note is None:
        return False
    starts = int(note.get("starts") or 0) + 1
    if starts <= TRIES:
        note["starts"] = starts
        _write(state / PENDING, note)
        return False
    before = str(note.get("from") or "")
    try:
        now = _git(root, "rev-parse", "HEAD")
        if before and before != now:
            _git(root, "reset", "--hard", before)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"could not go back to {before[:7]} after a failed update: {error}",
              file=sys.stderr)
        (state / PENDING).unlink(missing_ok=True)
        return False
    kept = state / PREVIOUS_INTERFACE
    if kept.is_dir():
        dist = root / "frontend" / "dist"
        shutil.rmtree(dist, ignore_errors=True)
        try:
            shutil.copytree(kept, dist)
        except OSError:
            pass
    _write(state / ROLLED_BACK, {
        "from": now, "to": before, "at": time.time(), "starts": starts - 1,
    })
    (state / PENDING).unlink(missing_ok=True)
    print(f"the update to {now[:7]} did not start {starts - 1} times; "
          f"went back to {before[:7]}", file=sys.stderr)
    return True


def rolled_back(state: Path) -> dict | None:
    """What the last rollback did, for the update sheet, or None."""
    return _read(state / ROLLED_BACK)
