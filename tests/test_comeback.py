"""An update whose new version will not start goes back to the one it left.

Q-012: the update page restarted into the new commit, and if that failed
to start the service manager restarted it every few seconds for ever. Here
a real checkout moves to a new commit the way an update does, the start is
counted as `server/run.py` counts it, and the fourth start that never became
healthy puts the old commit and the old interface back.
"""


import subprocess
from pathlib import Path

from server import comeback


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, check=True,
                          capture_output=True, text=True).stdout.strip()


def checkout(tmp_path: Path) -> tuple[Path, str, str]:
    root = tmp_path / "install"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.email", "t@example.com")
    git(root, "config", "user.name", "T")
    (root / "server.py").write_text("good\n")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "good")
    good = git(root, "rev-parse", "HEAD")
    (root / "frontend" / "dist").mkdir(parents=True)
    (root / "frontend" / "dist" / "index.html").write_text("old interface")
    return root, good, ""


def update(root: Path) -> str:
    (root / "server.py").write_text("broken\n")
    git(root, "commit", "-qam", "broken")
    (root / "frontend" / "dist" / "index.html").write_text("new interface")
    return git(root, "rev-parse", "HEAD")


def environ(tmp_path: Path) -> dict:
    return {"XDG_DATA_HOME": str(tmp_path / "data")}


def test_a_version_that_keeps_dying_is_rolled_back(tmp_path):
    root, good, _ = checkout(tmp_path)
    env = environ(tmp_path)
    state = comeback.state_home(env)
    assert comeback.leaving(state, root) == good
    broken = update(root)

    for _ in range(comeback.TRIES):
        assert comeback.at_start([], root, env) is False
    assert git(root, "rev-parse", "HEAD") == broken

    assert comeback.at_start([], root, env) is True
    assert git(root, "rev-parse", "HEAD") == good
    assert (root / "server.py").read_text() == "good\n"
    assert (root / "frontend" / "dist" / "index.html").read_text() == "old interface"
    note = comeback.rolled_back(state)
    assert note["from"] == broken and note["to"] == good
    # The next start is the old version's own, and nothing is counted.
    assert comeback.at_start([], root, env) is False


def test_a_version_that_answers_is_kept(tmp_path):
    root, good, _ = checkout(tmp_path)
    env = environ(tmp_path)
    state = comeback.state_home(env)
    comeback.leaving(state, root)
    new = update(root)
    assert comeback.at_start([], root, env) is False
    comeback.healthy(state)
    for _ in range(comeback.TRIES + 2):
        assert comeback.at_start([], root, env) is False
    assert git(root, "rev-parse", "HEAD") == new
    assert not (state / comeback.PREVIOUS_INTERFACE).exists()


def test_the_instance_is_read_from_the_command_line(tmp_path):
    assert comeback.instance_from(["run.py", "--instance", "dev"]) == "dev"
    assert comeback.instance_from(["run.py", "--instance=dev"]) == "dev"
    env = environ(tmp_path)
    root, good, _ = checkout(tmp_path)
    named = comeback.state_home({**env, "NEXTTEX_INSTANCE": "dev"})
    comeback.leaving(named, root)
    update(root)
    for _ in range(comeback.TRIES):
        comeback.at_start(["--instance", "dev"], root, env)
    assert comeback.at_start(["--instance", "dev"], root, env) is True
    # The default instance's state was never touched.
    assert not (comeback.state_home(env) / comeback.PENDING).exists()


def test_nothing_happens_without_an_update(tmp_path):
    root, _, _ = checkout(tmp_path)
    assert comeback.at_start([], root, environ(tmp_path)) is False


def test_the_start_goes_back_before_anything_of_nextTexs_is_imported():
    """A new version that cannot import its own modules is the case the
    rollback is for, so `server/run.py` asks before it imports them. Read
    rather than run: run for real, it would act on this checkout."""
    source = (Path(__file__).resolve().parents[1] / "server" / "run.py").read_text()
    asked = source.index("from comeback import")
    assert "from server.comeback import" in source[asked:asked + 400], "python -m server.run"
    assert asked < source.index("from nexttex import")
    assert asked < source.index("import uvicorn")
    assert "raise SystemExit(3)" in source[asked:asked + 600]
