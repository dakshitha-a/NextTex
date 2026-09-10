"""The shell bootstrap, driven through a real controlling terminal.

`pty.fork` rather than `pty.openpty` with an inherited descriptor.  Only the
fork makes the pty the child's *controlling* terminal, and without one
`install.sh`'s `tty_available` says no -- so a test built the other way
would quietly exercise the unattended branch and assert nothing about the
interactive one, which is the branch every reported bug has been in.

Everything runs under `sh`, which on this machine and on Debian and Ubuntu
is dash, because `curl ... | sh` is the documented command and in that shape
the shebang is never read.  Writing these tests found two bugs on the first
run that no amount of reading the file had: `set -o pipefail` on line seven,
which dash rejects outright, and a `/dev/tty` probe that killed the shell
instead of returning a status.  Both had shipped.

Nothing here reaches the network or installs anything: `git` and `python3`
are stand-ins on PATH that record what they were asked to do.
"""

from __future__ import annotations

import os
import select
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

# This whole file is about a shell script for Linux and macOS, and `pty` is
# not importable on Windows, so collecting it there is an error before a
# single test runs.
pty = pytest.importorskip("pty")

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"

PYTHON_NAMES = ("python3.13", "python3.12", "python3.11", "python3.10", "python3")

# Answers the version probe, then records the arguments it was handed and
# proves whether it inherited a terminal.
FAKE_PYTHON = """#!/bin/sh
if [ "$1" = "-c" ]; then echo "3.13"; exit 0; fi
: > "$NEXTTEX_TEST_ARGV"
for arg in "$@"; do printf '%s\\n' "$arg" >> "$NEXTTEX_TEST_ARGV"; done
if [ -n "${NEXTTEX_TEST_READ:-}" ]; then
  IFS= read -r line || line="(nothing to read)"
  printf 'ECHO:%s\\n' "$line"
fi
exit 0
"""

# Makes a checkout that looks enough like one for the bootstrap to re-exec
# into: a requirements.txt and the real installer.
FAKE_GIT = """#!/bin/sh
if [ "$1" = "clone" ]; then
  target="$3"
  mkdir -p "$target/scripts"
  cp "$NEXTTEX_TEST_INSTALLER" "$target/scripts/install.sh"
  chmod +x "$target/scripts/install.sh"
  : > "$target/requirements.txt"
  echo "clone $2 $target" >> "$NEXTTEX_TEST_GIT_LOG"
  exit 0
fi
echo "$@" >> "$NEXTTEX_TEST_GIT_LOG"
exit 0
"""


@pytest.fixture
def sandbox(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    # A copy of the installer with no requirements.txt beside it, so it takes
    # the clone path.  Run from inside the real checkout it would install
    # that checkout, which is correct and is not what these tests are for.
    loose = tmp_path / "loose"
    loose.mkdir()
    shutil.copy(INSTALLER, loose / "install.sh")
    (loose / "install.sh").chmod(0o755)
    binaries = tmp_path / "bin"
    binaries.mkdir()
    for name in PYTHON_NAMES:
        path = binaries / name
        path.write_text(FAKE_PYTHON)
        path.chmod(0o755)
    git = binaries / "git"
    git.write_text(FAKE_GIT)
    git.chmod(0o755)

    env = dict(os.environ)
    env.update(
        HOME=str(home),
        PATH=f"{binaries}:/usr/bin:/bin",
        NEXTTEX_TEST_ARGV=str(tmp_path / "argv.txt"),
        NEXTTEX_TEST_GIT_LOG=str(tmp_path / "git.log"),
        NEXTTEX_TEST_INSTALLER=str(INSTALLER),
        NEXTTEX_TEST_LOOSE=str(loose / "install.sh"),
        NEXTTEX_REPO="https://example.invalid/NextTex.git",
    )
    for name in ("NEXTTEX_DIR", "NEXTTEX_INSTANCE", "CI", "NEXTTEX_TEST_READ"):
        env.pop(name, None)
    return tmp_path, home, env


def argv_of(tmp_path) -> list:
    path = tmp_path / "argv.txt"
    if not path.is_file():
        return []
    return [line for line in path.read_text().splitlines() if line]


def loose_installer(tmp_path) -> str:
    return str(tmp_path / "loose" / "install.sh")


def run_plain(env, *args, stdin=subprocess.DEVNULL, timeout=60, script=None):
    """No controlling terminal at all: CI, a container build, a systemd unit."""
    return subprocess.run(
        ["sh", script or env["NEXTTEX_TEST_LOOSE"], *args],
        env=env, stdin=stdin, capture_output=True, text=True, timeout=timeout,
        start_new_session=True,
    )


def run_at_a_terminal(env, typed: list, *args, timeout=60):
    """A real controlling terminal, which is the only way the questions run."""
    pid, master = pty.fork()
    if pid == 0:                                    # the child
        try:
            os.execve("/bin/sh", ["sh", env["NEXTTEX_TEST_LOOSE"], *args], env)
        finally:
            os._exit(127)
    seen = []
    pending = list(typed)
    deadline = time.monotonic() + timeout
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.5)
            if ready:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                seen.append(chunk.decode("utf-8", "replace"))
            if pending and any("Directory" in part for part in seen):
                os.write(master, (pending.pop(0) + "\n").encode())
                time.sleep(0.2)
            finished, _ = os.waitpid(pid, os.WNOHANG)
            if finished:
                # Drain whatever is still buffered before giving up on it.
                for _ in range(4):
                    ready, _, _ = select.select([master], [], [], 0.2)
                    if not ready:
                        break
                    try:
                        chunk = os.read(master, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    seen.append(chunk.decode("utf-8", "replace"))
                break
        else:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
            raise AssertionError("the installer never finished:\n" + "".join(seen))
    finally:
        os.close(master)
    return "".join(seen)


# ---------------------------------------------------------------------------
# Where it goes


def test_a_pipe_with_nobody_there_takes_the_default_and_does_not_block(sandbox):
    """`curl ... | sh` with no terminal.  Under that shape stdin *is* the
    installer, so a bare `read` would eat the rest of the script and then
    fail, which under `set -e` takes the whole install down at the first
    question."""
    tmp_path, home, env = sandbox
    with open(INSTALLER) as script:
        result = subprocess.run(
            ["sh"], env=env, stdin=script, capture_output=True, text=True,
            timeout=60, start_new_session=True,
        )
    assert result.returncode == 0, result.stderr
    assert (home / "apps" / "NextTex").is_dir()


def test_the_directory_question_is_asked_at_a_terminal(sandbox):
    tmp_path, home, env = sandbox
    seen = run_at_a_terminal(env, [""])
    assert "Where should NextTex be installed?" in seen
    assert "Directory [" in seen
    assert (home / "apps" / "NextTex").is_dir()


def test_a_typed_path_is_used(sandbox):
    tmp_path, home, env = sandbox
    run_at_a_terminal(env, [str(tmp_path / "elsewhere")])
    assert (tmp_path / "elsewhere" / "requirements.txt").is_file()
    assert not (home / "apps" / "NextTex").exists()


def test_a_typed_tilde_is_expanded_rather_than_taken_literally(sandbox):
    """A path read with `read` is never expanded by the shell, so "~/code"
    would otherwise become a directory actually called "~"."""
    tmp_path, home, env = sandbox
    run_at_a_terminal(env, ["~/code/NextTex"])
    assert (home / "code" / "NextTex" / "requirements.txt").is_file()
    assert not (Path.cwd() / "~").exists()


def test_an_occupied_directory_is_refused_and_asked_again(sandbox):
    tmp_path, home, env = sandbox
    occupied = tmp_path / "occupied"
    occupied.mkdir()
    (occupied / "somebody-elses-work.tex").write_text("hello")
    seen = run_at_a_terminal(env, [str(occupied), str(tmp_path / "fine")])
    assert "already has something in it" in seen
    assert (tmp_path / "fine" / "requirements.txt").is_file()
    assert (occupied / "somebody-elses-work.tex").read_text() == "hello"


def test_an_empty_directory_is_accepted(sandbox):
    tmp_path, home, env = sandbox
    empty = tmp_path / "empty"
    empty.mkdir()
    run_at_a_terminal(env, [str(empty)])
    assert (empty / "requirements.txt").is_file()


def test_dir_and_the_environment_variable_skip_the_question(sandbox):
    tmp_path, home, env = sandbox
    assert run_plain(env, f"--dir={tmp_path / 'flag'}").returncode == 0
    assert (tmp_path / "flag" / "requirements.txt").is_file()

    env2 = dict(env, NEXTTEX_DIR=str(tmp_path / "variable"))
    assert run_plain(env2).returncode == 0
    assert (tmp_path / "variable" / "requirements.txt").is_file()


def test_a_tilde_in_the_flag_is_expanded_too(sandbox):
    tmp_path, home, env = sandbox
    assert run_plain(env, "--dir=~/from-a-flag").returncode == 0
    assert (home / "from-a-flag" / "requirements.txt").is_file()


def test_an_existing_checkout_is_updated_rather_than_cloned_over(sandbox):
    tmp_path, home, env = sandbox
    existing = tmp_path / "existing"
    (existing / ".git").mkdir(parents=True)
    (existing / "scripts").mkdir()
    shutil.copy(INSTALLER, existing / "scripts" / "install.sh")
    (existing / "scripts" / "install.sh").chmod(0o755)
    (existing / "requirements.txt").write_text("")
    result = run_plain(env, f"--dir={existing}")
    assert result.returncode == 0, result.stderr
    log = (tmp_path / "git.log").read_text()
    assert "pull --ff-only" in log
    assert "clone" not in log


# ---------------------------------------------------------------------------
# The handover


def test_it_hands_over_to_the_python_installer(sandbox):
    tmp_path, home, env = sandbox
    assert run_plain(env, f"--dir={tmp_path / 'x'}").returncode == 0
    argv = argv_of(tmp_path)
    assert argv[:2] == ["-m", "nexttex.install"], argv


def test_every_option_reaches_the_python_installer(sandbox):
    """The Windows bootstrap used to forward two of them and silently drop
    the rest; this is the assertion that would have caught it."""
    tmp_path, home, env = sandbox
    options = ["--yes", "--tex=none", "--agent=openai", "--bind=localhost",
               "--instance=scratch", "--no-service"]
    assert run_plain(env, f"--dir={tmp_path / 'x'}", *options).returncode == 0
    argv = argv_of(tmp_path)
    for option in options:
        assert option in argv, f"{option} was dropped\n{argv}"


def test_with_no_terminal_the_installer_is_told_to_be_plain(sandbox):
    tmp_path, home, env = sandbox
    run_plain(env, f"--dir={tmp_path / 'x'}")
    assert "--plain" in argv_of(tmp_path)


def test_at_a_terminal_the_installer_inherits_it(sandbox):
    """Under `curl | sh` stdin is the script and is exhausted by the time
    Python starts, so the installer's first question would see EOF.  The
    handover points stdin at /dev/tty, and this proves it: the stand-in
    reads a line and echoes it back."""
    tmp_path, home, env = sandbox
    env = dict(env, NEXTTEX_TEST_READ="1")
    seen = run_at_a_terminal(env, ["", "hello from the terminal"])
    assert "--plain" not in argv_of(tmp_path)
    assert "ECHO:hello from the terminal" in seen, seen[-2000:]


def test_help_says_what_the_options_are_and_installs_nothing(sandbox):
    tmp_path, home, env = sandbox
    result = run_plain(env, "--help")
    assert result.returncode == 0
    for option in ("--dir", "--tex", "--agent", "--bind", "--instance", "--plain"):
        assert option in result.stdout
    assert not (home / "apps").exists()


def test_the_script_is_valid_shell():
    assert subprocess.run(["bash", "-n", str(INSTALLER)]).returncode == 0


@pytest.mark.skipif(shutil.which("shellcheck") is None,
                    reason="shellcheck is not installed here")
def test_shellcheck_is_happy():
    result = subprocess.run(["shellcheck", "-S", "warning", str(INSTALLER)],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout


def test_it_still_refuses_the_platform_it_is_not_for():
    text = INSTALLER.read_text(encoding="utf-8")
    assert "install.ps1" in text, "does not point Windows users anywhere"
    assert "Darwin" in text and "Linux" in text
