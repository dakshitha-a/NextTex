"""The Git drawer reads the state a terminal left the repository in.

Q-023: a merge the writer started in a terminal and left with conflicts
was committed by the drawer, `git add -A` marking every conflicted file
resolved whatever it held, so the markers went into the manuscript. The
status the drawer read already listed the file as `UU`. Q-024: a detached
head was shown as a branch called "HEAD (no branch)".
"""

import subprocess
from pathlib import Path

import pytest

from nexttex import gitrepo


def git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True,
        env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
             "GIT_COMMITTER_EMAIL": "t@t", "PATH": "/usr/bin:/bin", "HOME": str(root)},
    ).stdout


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "paper"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    (root / "main.tex").write_text("The first line.\n")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "first")
    return root


def conflicted(root: Path) -> None:
    git(root, "checkout", "-qb", "other")
    (root / "main.tex").write_text("Their line.\n")
    git(root, "commit", "-qam", "theirs")
    git(root, "checkout", "-q", "main")
    (root / "main.tex").write_text("Our line.\n")
    git(root, "commit", "-qam", "ours")
    subprocess.run(["git", "merge", "other"], cwd=root, capture_output=True,
                   env={"PATH": "/usr/bin:/bin", "HOME": str(root),
                        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})


def test_a_merge_left_with_conflicts_is_said_and_not_committed(repo):
    conflicted(repo)
    assert "<<<<<<<" in (repo / "main.tex").read_text()
    status = gitrepo.status(repo)
    assert status.merging is True
    assert status.conflicts == ["main.tex"]
    before = git(repo, "rev-parse", "HEAD")
    with pytest.raises(gitrepo.GitError, match="merge is in progress"):
        gitrepo.commit(repo, "tidy up")
    assert git(repo, "rev-parse", "HEAD") == before
    assert "<<<<<<<" not in git(repo, "show", "HEAD:main.tex")


def test_a_merge_whose_conflicts_are_resolved_can_be_committed(repo):
    conflicted(repo)
    (repo / "main.tex").write_text("Both lines, settled.\n")
    git(repo, "add", "main.tex")
    assert gitrepo.status(repo).conflicts == []
    gitrepo.commit(repo, "merge settled")
    assert git(repo, "show", "HEAD:main.tex") == "Both lines, settled.\n"


def test_a_detached_head_names_its_commit(repo):
    git(repo, "checkout", "-q", "--detach")
    status = gitrepo.status(repo)
    assert status.branch == ""
    assert status.detached == git(repo, "rev-parse", "--short", "HEAD").strip()
