"""The update script, run for real against a throwaway pair of repositories.

`scripts/update.sh` parses itself into a function before it does anything, so
that `git pull` replacing the file underneath bash cannot make bash carry on
at its old byte offset in new text. That is necessary and it has a cost: the
*old* script is then what runs every step after the pull, so an update that
adds an install step is precisely the update that skips it.

That is not hypothetical. The release that added iroh landed on a machine
whose update had been started by the previous release's script, so pycrdt
arrived -- it is named in requirements.txt, which is read at run time -- and
iroh did not, and sharing stayed switched off with no error anywhere.

So the script hands over to the version it just pulled. These tests drive the
real script through a real pull to check that it does, because a text
assertion would have been satisfied by the broken version too.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
UPDATE = ROOT / "scripts" / "update.sh"

# Only the essentials, so that a `uv` or a `systemctl` on the developer's
# machine cannot change which branch of the script the test exercises.
PATH = "/usr/bin:/bin"

pytestmark = pytest.mark.skipif(
    shutil.which("git") is None or os.name == "nt",
    reason="needs git and a POSIX shell",
)


def git(where: Path, *arguments: str) -> str:
    done = subprocess.run(
        ["git", *arguments],
        cwd=where,
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
             "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"},
    )
    return done.stdout


def plant(checkout: Path) -> None:
    """The smallest tree `update.sh` will run to completion against."""
    (checkout / "scripts").mkdir(parents=True, exist_ok=True)
    shutil.copy(UPDATE, checkout / "scripts" / "update.sh")
    (checkout / "scripts" / "update.sh").chmod(0o755)

    fetch = checkout / "scripts" / "fetch-interface.sh"
    fetch.write_text("#!/bin/sh\nexit 0\n")
    fetch.chmod(0o755)

    (checkout / "requirements.txt").write_text("")

    # A stand-in for the virtualenv's Python. It records every install it is
    # asked for, which is how the iroh test below knows the step ran.
    venv = checkout / ".venv" / "bin"
    venv.mkdir(parents=True, exist_ok=True)
    python = venv / "python"
    python.write_text(
        "#!/bin/sh\n"
        'printf "%s\\n" "$*" >> "$(dirname "$0")/../../pip.log"\n'
        'case "$*" in *--print-url*) echo "http://127.0.0.1:8000/?token=x" ;; esac\n'
        "exit 0\n"
    )
    python.chmod(0o755)


def repositories(tmp_path: Path) -> tuple[Path, Path]:
    """An origin, and a checkout of it one commit behind."""
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(origin)],
                   check=True, capture_output=True)

    work = tmp_path / "work"
    subprocess.run(["git", "clone", str(origin), str(work)],
                   check=True, capture_output=True)
    plant(work)
    git(work, "add", "-A")
    git(work, "commit", "-m", "first")
    git(work, "push", "-u", "origin", "main")
    return origin, work


def release(origin: Path, tmp_path: Path, change) -> None:
    """Publish a second commit, `change` having edited the script."""
    other = tmp_path / "release"
    subprocess.run(["git", "clone", str(origin), str(other)],
                   check=True, capture_output=True)
    script = other / "scripts" / "update.sh"
    script.write_text(change(script.read_text()))
    git(other, "add", "-A")
    git(other, "commit", "-m", "second")
    git(other, "push", "origin", "main")


def run(work: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "scripts/update.sh", "--instance=nothinglistenshere", "--no-restart"],
        cwd=work,
        capture_output=True,
        text=True,
        env={"PATH": PATH, "HOME": str(work), "LANG": "C"},
    )


def test_the_pulled_script_is_what_finishes_the_update(tmp_path: Path) -> None:
    """The whole point: steps added by a release run on that release."""
    origin, work = repositories(tmp_path)
    release(origin, tmp_path, lambda text: text.replace(
        '  say "Dependencies"',
        '  touch "$PWD/the-new-script-ran"\n  say "Dependencies"',
        1,
    ))

    done = run(work)
    assert done.returncode == 0, done.stderr

    # The marker exists only in the second commit's copy of the script, so
    # its presence is proof that the pulled version is the one that carried
    # on rather than the one that started.
    assert (work / "the-new-script-ran").is_file(), done.stdout


def test_an_install_step_a_release_adds_runs_on_that_release(tmp_path: Path) -> None:
    """The iroh case itself, in the shape it actually happened."""
    origin, work = repositories(tmp_path)
    release(origin, tmp_path, lambda text: text.replace(
        '  note "python packages up to date"',
        '  .venv/bin/python -m pip install --quiet somethingnew\n'
        '  note "python packages up to date"',
        1,
    ))

    done = run(work)
    assert done.returncode == 0, done.stderr
    assert "somethingnew" in (work / "pip.log").read_text()


def test_the_hand_over_happens_once(tmp_path: Path) -> None:
    """A guard that re-execs unconditionally would never finish."""
    origin, work = repositories(tmp_path)
    release(origin, tmp_path, lambda text: text.replace(
        '  say "Dependencies"',
        '  echo "ran-the-body" >> "$PWD/times"\n  say "Dependencies"',
        1,
    ))

    done = run(work)
    assert done.returncode == 0, done.stderr
    assert (work / "times").read_text().count("ran-the-body") == 1


def test_the_arguments_survive_the_hand_over(tmp_path: Path) -> None:
    """Losing --no-restart would have systemd stop the server mid-update.

    `main` is called at the bottom of the script, so `"$@"` inside it is the
    arguments only because they are passed through. Left off, this test is
    the one that fails.
    """
    origin, work = repositories(tmp_path)
    release(origin, tmp_path, lambda text: text.replace(
        '  say "Done"',
        '  echo "restart=$RESTART instance=$UNIT" > "$PWD/how"\n  say "Done"',
        1,
    ))

    done = run(work)
    assert done.returncode == 0, done.stderr
    assert (work / "how").read_text().strip() == (
        "restart=0 instance=nexttex-nothinglistenshere"
    )


def test_nothing_is_handed_over_when_there_was_nothing_to_pull(tmp_path: Path) -> None:
    """An update that changes nothing should not re-exec at all."""
    _, work = repositories(tmp_path)
    done = run(work)
    assert done.returncode == 0, done.stderr
    assert "already up to date" in done.stdout
    assert "continuing with the updated script" not in done.stdout
