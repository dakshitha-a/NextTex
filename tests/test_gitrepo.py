"""What git is told, and what is read back from it.

There were no tests on this file at all, which is how three things survived
in it: a remote over ssh that could never authenticate, a repository the
writer made themselves that never got a `.gitignore`, and a renamed file
whose path came back as `old -> new` with any non-ASCII character escaped.

Each of the three is about the seam rather than about git. The environment
git is handed, and the exact bytes it hands back.
"""

import subprocess

import pytest

from nexttex import gitrepo


def a_repository(root):
    root.mkdir(parents=True, exist_ok=True)
    for arguments in (
        ("init", "-b", "main"),
        ("config", "user.email", "test@example.invalid"),
        ("config", "user.name", "A Test"),
    ):
        subprocess.run(["git", *arguments], cwd=root, check=True,
                       capture_output=True)
    return root


def commit_everything(root, message="a commit"):
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", message], cwd=root, check=True,
                   capture_output=True,
                   env={"PATH": "/usr/bin:/bin", "HOME": str(root),
                        "GIT_AUTHOR_NAME": "A Test",
                        "GIT_AUTHOR_EMAIL": "test@example.invalid",
                        "GIT_COMMITTER_NAME": "A Test",
                        "GIT_COMMITTER_EMAIL": "test@example.invalid"})


class TestTheEnvironmentGitIsGiven:
    def test_the_ssh_agent_is_passed_through_when_there_is_one(self, monkeypatch):
        """Without it a project on an ssh remote cannot push at all.

        The environment is built from nothing, deliberately, so a writer's
        own git configuration cannot change what this app does. That is
        right and it dropped the one variable that makes key-based
        authentication possible: git found no agent, could not ask for a
        passphrase either because prompting is turned off, and the writer
        was told authentication failed by an app that never gave their
        agent a chance to answer.
        """
        monkeypatch.setenv("SSH_AUTH_SOCK", "/run/user/1000/keyring/ssh")
        monkeypatch.setenv("SSH_AGENT_PID", "4242")

        environment = gitrepo._environment()

        assert environment["SSH_AUTH_SOCK"] == "/run/user/1000/keyring/ssh"
        assert environment["SSH_AGENT_PID"] == "4242"

    def test_nothing_is_invented_when_there_is_no_agent(self, monkeypatch):
        monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)
        monkeypatch.delenv("SSH_AGENT_PID", raising=False)

        assert "SSH_AUTH_SOCK" not in gitrepo._environment()

    def test_the_locale_is_stated_rather_than_left_to_luck(self):
        """The parsing reads git's English. An empty environment gave it
        English by accident, which is a property of an absence rather than
        a decision, and absences change."""
        assert gitrepo._environment()["LC_ALL"] == "C"

    def test_prompting_is_still_off(self):
        environment = gitrepo._environment()
        assert environment["GIT_TERMINAL_PROMPT"] == "0"
        assert environment["GIT_ASKPASS"] == "true"


class TestWhatStatusReadsBack:
    def test_a_name_that_is_not_ascii_comes_back_as_itself(self, tmp_path):
        """git quotes such a path unless it is asked not to, so the panel
        showed `"caf\\303\\251.tex"` and clicking the row opened nothing."""
        root = a_repository(tmp_path / "paper")
        (root / "café.tex").write_text("Une phrase.\n", encoding="utf-8")

        changes = gitrepo.status(root).changes or []

        assert [change["path"] for change in changes] == ["café.tex"]

    def test_a_rename_reports_the_name_it_has_now(self, tmp_path):
        """The porcelain gives `old -> new` as one field for a rename, so
        the path was that whole string and named no file on disk."""
        root = a_repository(tmp_path / "paper")
        (root / "chapter.tex").write_text("A chapter.\n", encoding="utf-8")
        commit_everything(root)
        subprocess.run(["git", "mv", "chapter.tex", "chapitre.tex"], cwd=root,
                       check=True, capture_output=True)

        changes = gitrepo.status(root).changes or []
        renamed = [c for c in changes if c["state"].startswith("R")]

        assert renamed, f"no rename in {changes}"
        assert renamed[0]["path"] == "chapitre.tex"
        assert renamed[0].get("from") == "chapter.tex"
        assert (root / renamed[0]["path"]).exists()

    def test_an_ordinary_change_is_unchanged(self, tmp_path):
        root = a_repository(tmp_path / "paper")
        (root / "main.tex").write_text("A line.\n", encoding="utf-8")
        commit_everything(root)
        (root / "main.tex").write_text("Another line.\n", encoding="utf-8")

        changes = gitrepo.status(root).changes or []

        assert [c["path"] for c in changes] == ["main.tex"]
        assert "from" not in changes[0]


class TestMakingARepository:
    def test_a_repository_the_writer_made_still_gets_the_ignores(self, tmp_path):
        """It returned early, so `build/` and `.nexttex/` were never
        ignored and every build put a hundred generated files into their
        next commit."""
        root = a_repository(tmp_path / "paper")
        (root / "main.tex").write_text("A line.\n", encoding="utf-8")

        gitrepo.initialise(root)

        ignored = (root / ".gitignore").read_text(encoding="utf-8")
        assert "build/" in ignored
        assert ".nexttex/" in ignored

    def test_an_existing_gitignore_is_added_to_and_not_replaced(self, tmp_path):
        root = a_repository(tmp_path / "paper")
        (root / ".gitignore").write_text("*.pdf\n", encoding="utf-8")

        gitrepo.initialise(root)

        ignored = (root / ".gitignore").read_text(encoding="utf-8")
        assert "*.pdf" in ignored, "the writer's own ignores were thrown away"
        assert "build/" in ignored

    def test_a_gitignore_that_already_covers_it_is_left_alone(self, tmp_path):
        root = a_repository(tmp_path / "paper")
        (root / ".gitignore").write_text("build/\nmine/\n", encoding="utf-8")

        gitrepo.initialise(root)

        assert (root / ".gitignore").read_text(encoding="utf-8") == "build/\nmine/\n"

    def test_no_repository_still_gets_one_with_a_first_commit(self, tmp_path):
        root = tmp_path / "paper"
        root.mkdir()
        (root / "main.tex").write_text("A line.\n", encoding="utf-8")

        gitrepo.initialise(root)

        assert (root / ".git").exists()
        assert "build/" in (root / ".gitignore").read_text(encoding="utf-8")
        assert gitrepo.status(root).branch == "main"


def test_a_machine_with_no_git_identity_still_gets_its_first_commit(tmp_path,
                                                                    monkeypatch):
    """"Just keep versions here" is a button for somebody who does not use
    git, and has therefore never run `git config --global user.name`.

    On such a machine the first commit failed outright with "empty ident
    name", so the button did nothing and reported an error about a tool
    they were not using. Found on a CI runner, which is exactly that
    machine: no config, and an account with no full name for git to build
    one out of. That second half is why this stubs the question rather than
    emptying HOME, which is not enough on a developer's own machine.
    """
    real = gitrepo._run

    def without_an_identity(root, *arguments, **named):
        if arguments[:2] == ("var", "GIT_COMMITTER_IDENT"):
            raise gitrepo.GitError("fatal: empty ident name (for <r@h>) not allowed")
        return real(root, *arguments, **named)

    monkeypatch.setattr(gitrepo, "_run", without_an_identity)

    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text("A line.\n", encoding="utf-8")

    gitrepo.initialise(root)

    assert gitrepo.status(root).branch == "main"
    log = subprocess.run(["git", "log", "--oneline", "--format=%an %s"], cwd=root,
                         capture_output=True, text=True, check=True)
    assert "NextTex Start this writing project" in log.stdout


def test_the_writer_s_own_name_is_not_overridden(tmp_path):
    """It has to lose to whatever they have set: a fallback that wins is a
    commit attributed to this app instead of to its author."""
    root = a_repository(tmp_path / "paper")
    (root / "main.tex").write_text("A line.\n", encoding="utf-8")

    assert gitrepo._who(root) == [], "a configured identity was overridden"


def test_the_windows_socket_stack_gets_what_it_needs(monkeypatch):
    """Without `SystemRoot` no name resolves on Windows.

    Diagnosed on a real laptop whose update check said "Could not resolve
    host: github.com", persistently and across restarts, while
    `git ls-remote` from a shell on that same machine over that same URL
    worked. The environment here is built from nothing on purpose, so a
    writer's own git configuration cannot change what this app does, and
    that deliberate emptiness was the cause: the Windows socket stack will
    not initialise without `SystemRoot`.

    Proved by varying one name at a time against this builder. With
    `SystemRoot` the lookup succeeds; with `SystemDrive` instead of it the
    lookup fails; with the whole inherited environment it succeeds. So it
    is that one variable rather than a general shortage.
    """
    monkeypatch.setenv("SystemRoot", r"C:\WINDOWS")

    assert gitrepo._environment()["SystemRoot"] == r"C:\WINDOWS"


def test_nothing_is_invented_where_there_is_no_such_variable(monkeypatch):
    """It does not exist on POSIX, which is why it is passed through
    rather than set: an invented value would be a lie on the platform this
    is usually run on."""
    monkeypatch.delenv("SystemRoot", raising=False)

    assert "SystemRoot" not in gitrepo._environment()


def test_the_patch_for_an_edited_file_shows_the_line_that_changed(tmp_path):
    # "See what changed" showed a status letter and a path. This is the
    # rest of the promise: the hunk, with the old line and the new one.
    root = a_repository(tmp_path / "repo")
    (root / "main.tex").write_text("one\ntwo\n", encoding="utf-8")
    commit_everything(root)
    (root / "main.tex").write_text("one\nthree\n", encoding="utf-8")
    patch = gitrepo.diff(root, "main.tex")
    assert "@@" in patch
    assert "-two" in patch and "+three" in patch


def test_a_staged_change_shows_as_well_as_an_unstaged_one(tmp_path):
    # Against HEAD rather than the index: the panel has no notion of the
    # index, and a file it says is modified must not show an empty patch.
    root = a_repository(tmp_path / "repo")
    (root / "main.tex").write_text("one\n", encoding="utf-8")
    commit_everything(root)
    (root / "main.tex").write_text("two\n", encoding="utf-8")
    subprocess.run(["git", "add", "main.tex"], cwd=root, check=True,
                   capture_output=True)
    assert "+two" in gitrepo.diff(root, "main.tex")


def test_a_file_git_has_never_seen_is_a_patch_of_additions(tmp_path):
    # `git diff` prints nothing for an untracked file, which would read as
    # "nothing changed" about a file the panel lists as new.
    root = a_repository(tmp_path / "repo")
    (root / "main.tex").write_text("one\n", encoding="utf-8")
    commit_everything(root)
    (root / "notes.tex").write_text("alpha\nbeta\n", encoding="utf-8")
    patch = gitrepo.diff(root, "notes.tex")
    body = [line for line in patch.splitlines() if not line.startswith(("---", "+++", "@@"))]
    assert body and all(line.startswith("+") for line in body), patch


def test_a_path_shaped_like_an_option_is_still_a_path(tmp_path):
    root = a_repository(tmp_path / "repo")
    (root / "--output").write_text("one\n", encoding="utf-8")
    commit_everything(root)
    (root / "--output").write_text("two\n", encoding="utf-8")
    assert "+two" in gitrepo.diff(root, "--output")


def test_no_repository_means_no_patch(tmp_path):
    (tmp_path / "main.tex").write_text("one\n", encoding="utf-8")
    assert gitrepo.diff(tmp_path, "main.tex") == ""
