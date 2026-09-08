"""Whether this install is behind, and whether that matters.

Real git repositories throughout -- a bare remote and a clone of it in a
temporary directory.  Mocking git here would test the mock: every
interesting case in this module is a fact about what git prints.
"""

import subprocess
from pathlib import Path

import pytest

from nexttex import updates


def git(root, *arguments):
    subprocess.run(["git", *arguments], cwd=root, check=True,
                   capture_output=True, text=True)


@pytest.fixture
def pair(tmp_path):
    """A bare remote, and a clone sitting on it."""
    remote = tmp_path / "remote.git"
    remote.mkdir()
    git(remote, "init", "--bare", "--initial-branch=main")

    work = tmp_path / "work"
    work.mkdir()
    git(work, "init", "--initial-branch=main")
    git(work, "config", "user.email", "t@example.com")
    git(work, "config", "user.name", "Test")
    (work / "README.md").write_text("hello\n")
    git(work, "add", "-A")
    git(work, "commit", "-m", "first")
    git(work, "remote", "add", "origin", str(remote))
    git(work, "push", "-u", "origin", "main")

    clone = tmp_path / "clone"
    git(tmp_path, "clone", str(remote), str(clone))
    git(clone, "config", "user.email", "t@example.com")
    git(clone, "config", "user.name", "Test")
    return work, clone


def commit(work, path, body="x\n", message="a change"):
    target = work / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body)
    git(work, "add", "-A")
    git(work, "commit", "-m", message)
    git(work, "push")


# -- what a commit means ----------------------------------------------------
def test_a_commit_touching_only_docs_changes_nothing():
    assert updates.classify(["docs/design.md", "README.md"]) == ("neither", False)


def test_a_commit_touching_the_server_changes_the_app():
    assert updates.classify(["server/main.py"]) == ("app", False)
    assert updates.classify(["nexttex/compile.py", "docs/x.md"]) == ("app", False)


def test_a_commit_touching_only_the_frontend_needs_a_rebuild():
    assert updates.classify(["frontend/src/App.tsx"]) == ("interface", True)


def test_an_unrecognised_path_counts_as_changing_the_app():
    """A wrong "nothing to see here" is worse than a wrong "something
    changed", so anything the table does not know about reaches the app."""
    assert updates.classify(["some/new/thing.py"]) == ("app", False)


def test_a_commit_that_is_both_still_asks_for_a_rebuild():
    """The label a reader sees and the question "must the bundle be rebuilt"
    are different questions.  Reading the second off the first meant a
    commit touching a Python module and a React component installed new
    server code behind the interface that was already built -- found on a
    real deployment, against a real commit."""
    label, interface = updates.classify(["frontend/src/App.tsx", "server/main.py"])
    assert label == "app"
    assert interface is True


# -- against a real remote --------------------------------------------------
def test_an_install_level_with_its_remote_offers_nothing(pair):
    _, clone = pair
    report = updates.check(clone)
    assert report.behind == 0
    assert report.can_update is False
    assert report.reason == "already up to date"


def test_commits_on_the_remote_are_found_and_classified(pair):
    work, clone = pair
    commit(work, "docs/notes.md", message="just docs")
    commit(work, "server/main.py", message="a real change")

    report = updates.check(clone)
    assert report.behind == 2
    assert report.changing == 1
    assert [c.subject for c in report.commits] == ["a real change", "just docs"]
    assert [c.touches for c in report.commits] == ["app", "neither"]
    assert report.can_update is True


def test_documentation_alone_is_offered_but_not_called_a_change(pair):
    work, clone = pair
    commit(work, "docs/one.md", message="one")
    commit(work, "README.md", message="two")

    report = updates.check(clone)
    assert report.behind == 2
    assert report.changing == 0
    assert report.can_update is True      # offered, just never urgent


def test_a_frontend_commit_asks_for_a_rebuild(pair):
    work, clone = pair
    commit(work, "frontend/src/App.tsx", message="interface")
    report = updates.check(clone)
    assert report.rebuild is True


def test_a_commit_touching_both_halves_still_asks_for_a_rebuild(pair):
    work, clone = pair
    target = work / "frontend" / "src" / "App.tsx"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("x\n")
    (work / "server").mkdir(exist_ok=True)
    (work / "server" / "main.py").write_text("y\n")
    git(work, "add", "-A")
    git(work, "commit", "-m", "both halves")
    git(work, "push")

    report = updates.check(clone)
    assert report.commits[0].touches == "app"
    assert report.rebuild is True


def test_uncommitted_changes_here_refuse_the_update(pair):
    """`git pull --ff-only` would refuse anyway; better to say so before the
    writer presses a button than after."""
    work, clone = pair
    commit(work, "server/main.py", message="a change")
    (clone / "server").mkdir(exist_ok=True)
    (clone / "server" / "scratch.py").write_text("mine\n")
    git(clone, "add", "-A")

    report = updates.check(clone)
    assert report.can_update is False
    assert "uncommitted" in report.reason
    assert any("scratch.py" in path for path in report.dirty)


def test_a_directory_that_is_not_a_checkout_offers_nothing(tmp_path):
    report = updates.check(tmp_path)
    assert report.checkout is False
    assert report.can_update is False
    assert report.behind == 0


def test_a_remote_that_cannot_be_reached_is_reported_not_raised(pair, tmp_path):
    work, clone = pair
    git(clone, "remote", "set-url", "origin", str(tmp_path / "gone.git"))
    report = updates.check(clone)
    assert report.can_update is False
    assert report.error
    assert "Could not reach" in report.reason


def test_an_unpublished_interface_refuses_rather_than_half_updating(pair, monkeypatch):
    """Pulling to a commit CI has not built yet would leave the install
    running the old interface against new code."""
    work, clone = pair
    commit(work, "frontend/src/App.tsx", message="interface")
    monkeypatch.setattr(
        updates, "interface_published",
        lambda root, sha: (False, "The interface for that commit has not been published yet."),
    )
    report = updates.check(clone)
    assert report.can_update is False
    assert report.build_ok is False
    assert "published" in report.build_reason


def test_a_commit_that_leaves_the_interface_alone_never_waits_on_it(pair, monkeypatch):
    # Most commits touch nothing under frontend/, and the interface already
    # installed serves them perfectly well.
    work, clone = pair
    commit(work, "server/main.py", message="server only")
    called = []
    monkeypatch.setattr(
        updates, "interface_published",
        lambda root, sha: (called.append(sha), (False, "nope"))[1],
    )
    report = updates.check(clone)
    assert called == []
    assert report.can_update is True


# -- the cache --------------------------------------------------------------
def test_the_check_is_not_repeated_for_every_look(pair):
    work, clone = pair
    cache = updates.Cache(clone)
    first = cache.get()
    commit(work, "server/main.py", message="landed after the check")
    assert cache.get().behind == first.behind == 0
    assert cache.get(force=True).behind == 1


# -- restarting -------------------------------------------------------------
def test_a_service_knows_it_will_be_restarted(monkeypatch):
    monkeypatch.setenv("INVOCATION_ID", "abc")
    assert updates.supervised() is True


def test_a_bare_process_knows_it_will_not_be(monkeypatch):
    monkeypatch.delenv("INVOCATION_ID", raising=False)
    monkeypatch.delenv("XPC_SERVICE_NAME", raising=False)
    assert updates.supervised() is False
