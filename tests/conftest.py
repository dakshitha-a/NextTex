import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# The suite must never reach the real `claude` binary on the machine running
# it.  `nexttex.claude_auth` looks for the CLI at NEXTTEX_CLAUDE_BINARY, then
# on PATH, then at `~/.local/bin/claude`, and `tests/api/conftest.py`
# redirects XDG_DATA_HOME and XDG_CONFIG_HOME but not HOME, so nothing kept a
# test away from the developer's own installation.  `/api/claude/logout` runs
# `claude auth logout`, which deletes `~/.claude/.credentials.json` and empties
# the account out of `~/.claude.json`, and a same-origin case in
# `tests/api/test_cross_origin.py` posted to exactly that route: every full run
# of this suite signed the developer out of Claude Code.  Pointing the whole
# suite at the stand-in shuts that off for every test at once, including the
# ones nobody has written yet.
os.environ["NEXTTEX_CLAUDE_BINARY"] = str(
    Path(__file__).resolve().parent / "fake_claude.py"
)
