"""Where this install keeps its own state.

Split out of `project.py` so the installer can import it.  The installer
runs on a bare interpreter before there is a virtual environment, and
`project.py` reaches for `tomli` on Python 3.10, which would not be there
yet.  Nothing in this module imports anything outside the standard library,
and `project.py` re-exports both names so no caller had to change.
"""

from __future__ import annotations

import os
import re
from pathlib import Path


def instance_name(environ=None) -> str:
    """Which install this is, when a machine carries more than one.

    Empty is the ordinary case and the ordinary directory.  A name -- set
    by `--instance` at install time -- moves the whole state directory
    aside, so a development copy and the copy somebody actually writes in
    do not share a port, a token or a project list.  Validated as a single
    path segment: a name is a label, never a way out of the directory.

    `environ` is a seam for the installer, which surveys a machine on
    behalf of a hypothetical one: passing a mapping asks where state would
    go for *that* environment rather than for this process.  It defaults to
    the real one, so every existing caller is unchanged.
    """
    environ = environ if environ is not None else os.environ
    name = environ.get("NEXTTEX_INSTANCE", "").strip()
    return name if re.fullmatch(r"[A-Za-z0-9_-]{1,32}", name) else ""


def state_home(environ=None) -> Path:
    environ = environ if environ is not None else os.environ
    base = environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    name = instance_name(environ)
    return Path(base) / (f"nexttex-{name}" if name else "nexttex")
