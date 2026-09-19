import os
import sys
from pathlib import Path

import pytest

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


def pytest_configure(config):
    """A pycrdt object dropped on the wrong thread is a failure, not a note.

    pycrdt's objects belong to the thread that made them and it says so at
    the drop, as an exception nobody can catch, which pytest reports as a
    `PytestUnraisableExceptionWarning` at the end of whichever test the
    garbage collector happened to run in.  The full suite carried one for
    months, filed under a test that had nothing to do with it: a session's
    re-scan timer firing into a closed store.  Made an error here rather
    than in a pytest.ini, so the rule lives beside the other rule this
    file holds; a red on this is a leak to find, never a filter to relax.
    """
    config.addinivalue_line(
        "filterwarnings", "error::pytest.PytestUnraisableExceptionWarning"
    )


@pytest.fixture(scope="session", autouse=True)
def the_machines_own_login_is_untouched():
    """A tripwire around the whole run, not just around the CLI lookup.

    The guard above points `nexttex.claude_auth` at the stand-in, and
    `test_the_suite_never_reaches_the_real_cli` fails if that guard is ever
    removed.  Neither notices a route or a library that reaches the real
    `claude` some other way, and one already did: `/api/claude/logout` ran
    `claude auth logout` against the developer's own installation on every
    full run, which deleted their credentials and signed them out.

    So this asserts the damage rather than the mechanism.  It checks only
    whether the file still exists, never its contents, because a token
    refresh landing mid-run rewrites it legitimately and must not fail the
    suite, whereas a sign-out removes it.  On a machine with no Claude Code
    installed, which is what CI is, there is nothing to protect and this does
    nothing at all.
    """
    login = Path.home() / ".claude" / ".credentials.json"
    existed = login.exists()
    yield
    if existed and not login.exists():
        raise AssertionError(
            "this test run signed the machine out of Claude Code: "
            f"{login} existed when it started and is gone now. Something "
            "reached the real CLI. See tests/conftest.py."
        )
