"""Reading history: the Git drawer's History list, a commit's patch, and
which commit last touched the line under the caret."""

import subprocess

import pytest

from nexttex import gitrepo


def run(root, *arguments, email="test@example.invalid", name="A Test"):
    subprocess.run(["git", *arguments], cwd=root, check=True, capture_output=True,
                   env={"PATH": "/usr/bin:/bin", "HOME": str(root),
                        "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email,
                        "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email})


@pytest.fixture
def repo(tmp_path):
    run(tmp_path, "init", "-b", "main")
    run(tmp_path, "config", "user.email", "test@example.invalid")
    run(tmp_path, "config", "user.name", "A Test")
    (tmp_path / "main.tex").write_text("First line.\nSecond line.\n", encoding="utf-8")
    run(tmp_path, "add", "-A")
    run(tmp_path, "commit", "-m", "Start the thesis")
    (tmp_path / "main.tex").write_text("First line.\nSecond line, tightened.\n", encoding="utf-8")
    run(tmp_path, "commit", "-am", "Tighten the second line", email="mira@example.invalid", name="Mira")
    return tmp_path


def test_the_log_is_newest_first_and_knows_whose_commit_is_mine(repo):
    commits = gitrepo.log(repo)
    assert [c["subject"] for c in commits] == ["Tighten the second line", "Start the thesis"]
    assert [(c["author"], c["mine"]) for c in commits] == [("Mira", False), ("A Test", True)]
    assert all(len(c["sha"]) == 40 and c["sha"].startswith(c["short"]) and c["when"] > 0 for c in commits)


def test_no_repository_and_no_commit_are_an_empty_history(tmp_path):
    assert gitrepo.log(tmp_path) == []
    run(tmp_path, "init", "-b", "main")
    assert gitrepo.log(tmp_path) == []


def test_a_commit_opens_to_its_patch_and_nothing_else(repo):
    newest = gitrepo.log(repo)[0]
    patch = gitrepo.show(repo, newest["sha"])
    assert "-Second line." in patch and "+Second line, tightened." in patch
    assert "Tighten the second line" not in patch  # no header
    assert gitrepo.show(repo, newest["short"]) == patch


@pytest.mark.parametrize("sha", ["--output=x", "HEAD", "HEAD~1..HEAD", "abc", "g" * 10, ""])
def test_anything_but_a_hash_is_refused_before_git_sees_it(repo, sha):
    with pytest.raises(gitrepo.GitError):
        gitrepo.show(repo, sha)


def test_a_long_patch_is_cut(repo, monkeypatch):
    monkeypatch.setattr(gitrepo, "SHOW_LIMIT", 40)
    assert len(gitrepo.show(repo, gitrepo.log(repo)[0]["sha"])) <= 41


def test_blame_names_the_commit_that_last_touched_the_line(repo):
    first = gitrepo.blame(repo, "main.tex", 1)
    second = gitrepo.blame(repo, "main.tex", 2)
    assert first["subject"] == "Start the thesis" and first["mine"] is True
    assert second["subject"] == "Tighten the second line" and second["author"] == "Mira"
    assert second["mine"] is False and second["short"] == second["sha"][:7]


def test_the_editors_text_is_what_is_blamed(repo):
    # A line typed above the others and not yet on disk: line 2 is now
    # the old first line, and line 1 is nobody's yet.
    live = "A new opening.\nFirst line.\nSecond line, tightened.\n"
    assert gitrepo.blame(repo, "main.tex", 1, live) == {"uncommitted": True, "line": 1}
    assert gitrepo.blame(repo, "main.tex", 2, live)["subject"] == "Start the thesis"


@pytest.mark.parametrize("relative,line", [
    ("untracked.tex", 1), ("../main.tex", 1), ("-L1,1", 1), ("main.tex", 0), ("main.tex", 99),
])
def test_nothing_to_say_is_none(repo, relative, line):
    (repo / "untracked.tex").write_text("x\n", encoding="utf-8")
    assert gitrepo.blame(repo, relative, line) is None
