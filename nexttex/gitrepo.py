"""Just enough git to back a writing project up without leaving the browser.

This is deliberately not a git client.  A thesis needs four things -- see
what changed, commit it, send it somewhere safe, and pull it back on another
machine -- and every one of those is a single command.  Branching, merging
and history rewriting stay in the terminal, where the tools are better and
the mistakes are recoverable.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .atomic import write_atomically

TIMEOUT = 120

# Reaching the network gets its own, much shorter limit.  A fetch with no
# route to the remote hangs for the whole of `TIMEOUT`, and the caller is
# a screen the writer is waiting to look at.
FETCH_TIMEOUT = 10


class GitError(RuntimeError):
    """A git command failed; the message is what git said."""


def _environment() -> dict[str, str]:
    """A deliberately small environment for git, and what has to be in it.

    Built from nothing rather than inherited, so a writer's own git config
    variables and credential helpers cannot change what this app does. The
    four things below are the ones that being absent actually breaks.

    `GIT_TERMINAL_PROMPT` and `GIT_ASKPASS` stop git waiting for a password
    nobody will ever see on a headless machine.

    `LC_ALL` is set rather than left out. The parsing below reads git's
    English, and an empty environment happened to give it English by
    accident; stating it means a machine that starts passing a locale
    through cannot quietly break the parsing.

    The ssh agent's socket, because without it a project with an `ssh://`
    or `git@` remote cannot push at all: git finds no key, cannot ask for a
    passphrase either, and the writer is told authentication failed by an
    app that never gave their agent a chance to answer.
    """
    import os

    environment = {
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "true",
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(Path.home()),
        "LC_ALL": "C",
    }
    for passed in ("SSH_AUTH_SOCK", "SSH_AGENT_PID"):
        if os.environ.get(passed):
            environment[passed] = os.environ[passed]
    return environment


def _run(root: Path, *arguments: str, timeout: int = TIMEOUT) -> str:
    try:
        result = subprocess.run(
            ["git", *arguments], cwd=root, capture_output=True,
            text=True, timeout=timeout,
            # Never let git stop for a password prompt: on a headless server
            # nobody would ever see it, and the request would simply hang.
            env=_environment(),
        )
    except subprocess.TimeoutExpired:
        raise GitError("git took too long and was stopped")
    except OSError as error:
        raise GitError(f"could not run git: {error}")
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "").strip()
        raise GitError(message.splitlines()[-1] if message else "git failed")
    return result.stdout


@dataclass
class Status:
    repository: bool
    branch: str = ""
    ahead: int = 0
    behind: int = 0
    remote: str = ""
    changes: list[dict] | None = None
    detail: str = ""

    def as_dict(self) -> dict:
        return {
            "repository": self.repository,
            "branch": self.branch,
            "ahead": self.ahead,
            "behind": self.behind,
            "remote": self.remote,
            "changes": self.changes or [],
            "detail": self.detail,
        }


def fetch(root: Path, timeout: int = FETCH_TIMEOUT) -> None:
    """Bring the remote-tracking refs up to date, and nothing else.

    `status` reports how far behind the local tracking ref says it is,
    which is a fact about the last fetch rather than about the remote.
    Asking whether an update exists means asking the remote first.
    """
    _run(root, "fetch", "--quiet", timeout=timeout)


def status(root: Path) -> Status:
    if not (root / ".git").exists():
        return Status(repository=False)
    try:
        # `-z` rather than the default. Without it git quotes any path
        # that is not plain ASCII, so `café.tex` came back as
        # `"caf\303\251.tex"` and a rename came back as one field reading
        # `old -> new`: the panel showed the escape sequence, and clicking
        # the row opened nothing, because no such file exists.
        raw = _run(root, "status", "--porcelain=v1", "-z", "--branch", timeout=30)
    except GitError as error:
        return Status(repository=True, detail=str(error))

    branch = ""
    ahead = behind = 0
    changes: list[dict] = []
    # NUL separated, and a rename or a copy spends a second field on the
    # name it had before, which is why this is an index rather than a loop
    # over the whole list.
    fields = [field for field in raw.split("\0") if field]
    at = 0
    while at < len(fields):
        line = fields[at]
        at += 1
        if line.startswith("## "):
            head = line[3:]
            branch = head.split("...")[0].strip()
            if match := re.search(r"ahead (\d+)", head):
                ahead = int(match.group(1))
            if match := re.search(r"behind (\d+)", head):
                behind = int(match.group(1))
            continue
        if len(line) <= 3:
            continue
        state = line[:2].strip() or "?"
        change: dict = {"state": state, "path": line[3:]}
        if state and state[0] in {"R", "C"} and at < len(fields):
            change["from"] = fields[at]
            at += 1
        changes.append(change)

    remote = ""
    try:
        remote = _run(root, "remote", "get-url", "origin", timeout=15).strip()
    except GitError:
        pass
    # A URL can carry a token if someone pasted one in; never send it back.
    remote = re.sub(r"//[^/@]*@", "//", remote)
    return Status(True, branch, ahead, behind, remote, changes)


def commit(root: Path, message: str) -> str:
    if not message.strip():
        raise GitError("a commit needs a message")
    _run(root, "add", "-A")
    try:
        return _run(root, "commit", "-m", message)
    except GitError as error:
        if "nothing to commit" in str(error):
            raise GitError("nothing has changed since the last commit")
        raise


def push(root: Path) -> str:
    branch = _run(root, "rev-parse", "--abbrev-ref", "HEAD").strip()
    try:
        return _run(root, "push", "origin", branch)
    except GitError as error:
        if "no upstream" in str(error) or "does not appear" in str(error):
            return _run(root, "push", "--set-upstream", "origin", branch)
        raise


def pull(root: Path) -> str:
    return _run(root, "pull", "--ff-only")


def initialise(root: Path, ignore: str = "") -> None:
    """Make a repository, with a first commit, if there is not one already."""
    contents = (
        ignore
        or "build/\n.nexttex/\n*.aux\n*.log\n*.out\n*.synctex.gz\n*.bbl\n*.bcf\n"
    )
    gitignore = root / ".gitignore"
    if (root / ".git").exists():
        # A repository the writer made themselves, before NextTex saw the
        # project. It returned here without writing anything, so `build/`
        # and `.nexttex/` were never ignored and every build put a hundred
        # generated files into their next commit. Nothing else is touched:
        # no init, no commit, and an existing .gitignore is added to rather
        # than replaced.
        if not gitignore.exists():
            gitignore.write_text(contents, encoding="utf-8")
        elif "build/" not in gitignore.read_text(encoding="utf-8"):
            existing = gitignore.read_text(encoding="utf-8")
            joiner = "" if existing.endswith("\n") else "\n"
            gitignore.write_text(
                existing + joiner + "\n# What NextTex generates\n" + contents,
                encoding="utf-8",
            )
        return
    _run(root, "init", "-b", "main")
    if not gitignore.exists():
        gitignore.write_text(contents, encoding="utf-8")
    _run(root, "add", "-A")
    _run(root, "commit", "-m", "Start this writing project")


def gh_available() -> tuple[bool, str]:
    """Is the GitHub CLI here and signed in?"""
    import shutil

    if not shutil.which("gh"):
        return False, "The GitHub CLI is not installed."
    result = subprocess.run(
        ["gh", "auth", "status"], capture_output=True, text=True, timeout=20
    )
    if result.returncode != 0:
        return False, "The GitHub CLI is installed but not signed in."
    return True, ""


def create_github(root: Path, name: str, private: bool = True) -> str:
    """Make the repository on GitHub and push this project into it."""
    ready, reason = gh_available()
    if not ready:
        raise GitError(reason)
    initialise(root)
    visibility = "--private" if private else "--public"
    try:
        _run(root, "remote", "get-url", "origin", timeout=15)
        has_remote = True
    except GitError:
        has_remote = False
    if has_remote:
        raise GitError("this project already has an origin remote")
    # A repository name is typed by a person into a field, so it is checked
    # rather than trusted: `gh` has no `--` to hide behind here, since the
    # name is a positional among other options.
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", name):
        raise GitError(
            "a repository name may only hold letters, digits, dot, dash and "
            "underscore, and may not begin with a dash"
        )
    result = subprocess.run(
        ["gh", "repo", "create", name, visibility, "--source", ".",
         "--remote", "origin", "--push"],
        cwd=root, capture_output=True, text=True, timeout=TIMEOUT,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip()
        raise GitError(message.splitlines()[-1] if message else "gh failed")
    return _run(root, "remote", "get-url", "origin", timeout=15).strip()


def attach_remote(root: Path, url: str, token: str = "") -> str:
    """Point this project at an existing repository.

    A token, if given, is stored in the credential file rather than in the
    remote URL, so it never appears in `git remote -v` or in a log line.
    """
    initialise(root)
    if token:
        match = re.match(r"https://([^/]+)/(.+)", url)
        if not match:
            raise GitError("a token can only be used with an https:// URL")
        host = match.group(1)
        store = Path.home() / ".git-credentials"
        line = f"https://x-access-token:{token}@{host}\n"
        existing = store.read_text(encoding="utf-8") if store.exists() else ""
        if line not in existing:
            # The mode is set before the file is put in place, not after:
            # written first and chmod'ed second, the token sat there at the
            # process umask -- world-readable on most systems -- for as long
            # as those two calls took.
            write_atomically(store, existing + line, mode=0o600)
        _run(root, "config", "credential.helper", "store")
    try:
        _run(root, "remote", "remove", "origin", timeout=15)
    except GitError:
        pass
    # `--` first: a URL beginning with a dash is otherwise read by git as an
    # option rather than as a remote, and this value comes from a form.
    _run(root, "remote", "add", "origin", "--", url)
    return url
