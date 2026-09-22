"""The version of NextTex, and the commit it is running from.

The number below is the whole of the version system's storage: one line,
the first assignment in the file, so `grep ^VERSION nexttex/version.py` and
`git show <ref>:nexttex/version.py` both find it without parsing Python.
`CLAUDE.md` says what x, y and z mean and how a push advances them; this
module only reports.

`describe` is what `server/run.py --version` prints, and what
`python -m nexttex.version` prints from a bare interpreter.  The second
spelling exists because `run.py` imports uvicorn before it reads its
arguments, so on an install whose virtual environment is the thing that
broke, the version was the one fact that could not be asked for.

Two commits rather than one because they can disagree: the interface is
downloaded per commit, so a failed or half-finished update can leave new
code serving an older bundle.  Nothing could see that before the second
line existed, which is the reason to print it at all.
"""

import re
import sys
from pathlib import Path

VERSION = "3.6.1"

#: What a version looks like.  Anchored, so a stray character in the file
#: is a test failure rather than a tag the release workflow refuses later.
SHAPE = re.compile(r"^\d+\.\d+\.\d+$")

#: The line the number lives on, as `git show` and the release workflow
#: see it, so that both read the file the same way this module does.
LINE = re.compile(r'^VERSION\s*=\s*"(\d+\.\d+\.\d+)"', re.M)


def parse(text: str) -> str:
    """The version in a copy of this file's text, or "" when it has none.

    Used on the text of the upstream commit's copy, which an install that
    predates the number does not have, and which a future commit could in
    principle move; a miss is "" rather than an error because the caller
    is drawing a footer, not deciding anything.
    """
    found = LINE.search(text)
    return found.group(1) if found else ""


def describe(root: "Path | None" = None) -> list[str]:
    """The three lines `--version` prints: the version, the commit the
    code is on, and the commit the interface was built from."""
    from . import gitrepo

    root = Path(root) if root is not None else Path(__file__).resolve().parent.parent
    try:
        head = gitrepo._run(root, "rev-parse", "HEAD").strip()
    except Exception:
        head = "unknown (not a git checkout)"
    stamp = root / "frontend" / "dist" / "BUILD_SHA"
    try:
        built = stamp.read_text(encoding="utf-8").strip()
    except OSError:
        built = "unknown (built here, or before this was recorded)"
    lines = [f"NextTex   {VERSION}", f"code      {head}", f"interface {built}"]
    if head != built and not built.startswith("unknown"):
        lines.append("")
        lines.append("These differ: the interface does not belong to this commit.")
        lines.append("Run scripts/update.sh, or scripts/fetch-interface.sh on its own.")
    return lines


def main() -> int:
    for line in describe():
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
