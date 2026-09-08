"""Is this install behind the repository it came from, and does it matter?

NextTex is always a git checkout -- there is no package, no version string,
no release artefact -- so "is there an update" is a question about `git`.
The interesting half is the second one. Most commits to a project like this
change its documentation or its tests, and telling somebody every session
that three commits exist, when none of them changes the program they are
running, is a nag rather than a service. So every commit is classified by
the paths it touches, and only the ones that reach the running program are
described as changing anything.
"""

from __future__ import annotations

import os
import shutil
import re
import subprocess
import urllib.error
import urllib.request
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

from . import gitrepo

# How long a check is trusted before the network is asked again.  A writer
# who opens the app four times in an afternoon should pay for one fetch.
CACHE_SECONDS = 6 * 60 * 60

# What a changed path means for the install.  Ordered: the first prefix that
# matches wins, so `frontend/` beats the catch-all.
INTERFACE_PREFIXES = ("frontend/",)
NOT_THE_PROGRAM = (
    "docs/", "README.md", "LICENSE", "tests/", "e2e/", "bench/", "examples/",
)

MIN_NODE_MAJOR = 20

#: Where CI publishes the built interface, one asset per commit.
INTERFACE_TAG = "interface"


@dataclass
class Commit:
    sha: str
    subject: str
    # "app", "interface" or "neither" -- one label, for the screen to show.
    touches: str
    # Whether it touched the interface *at all*.  Separate from the label
    # on purpose: a commit that changes both a Python module and a React
    # component is labelled "app", and reading the rebuild question off
    # that label meant a commit like that installed new server code behind
    # the interface that was already built.
    interface: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Report:
    """What a check found.  Everything the screen needs, and no opinions."""

    checkout: bool = True
    head: str = ""
    behind: int = 0
    # How many of those reach the running program rather than the docs.
    changing: int = 0
    commits: list[Commit] = field(default_factory=list)
    # Uncommitted paths in the install directory, truncated.
    dirty: list[str] = field(default_factory=list)
    rebuild: bool = False
    #: Whether the thing that has to exist before an update can land does.
    #: It used to mean "is Node usable here", because the interface was
    #: rebuilt on the machine; it now means "has CI published the interface
    #: for the commit we would move to".
    build_ok: bool = True
    build_reason: str = ""
    can_update: bool = False
    reason: str = ""
    restart: str = "manual"
    error: str = ""
    at: float = 0.0

    def as_dict(self) -> dict:
        body = asdict(self)
        body["commits"] = [commit.as_dict() for commit in self.commits]
        return body


def classify(paths: list[str]) -> tuple[str, bool]:
    """What a commit touching these paths means for a running install.

    Returns the one label worth showing, and separately whether the
    interface has to be rebuilt.  The two are not the same question: a
    commit that changes a Python module *and* a React component is an
    "app" change to a reader, and still needs the bundle rebuilt.

    Anything unrecognised counts as reaching the program: a wrong "nothing
    to see here" is worse than a wrong "something changed".
    """
    interface = False
    app = False
    for path in paths:
        if any(path.startswith(prefix) for prefix in INTERFACE_PREFIXES):
            interface = True
        elif not any(path.startswith(prefix) for prefix in NOT_THE_PROGRAM):
            app = True
    if app:
        return "app", interface
    if interface:
        return "interface", True
    return "neither", False


def interface_published(root: Path, sha: str) -> tuple[bool, str]:
    """Whether the interface for a commit has been built and published yet.

    This replaced a check for a usable Node. The interface is no longer
    built on the machine that installs it, so "can this machine build it"
    stopped being the question -- but the gate itself is still needed,
    because a new one arrives in its place: an update can land on a commit
    CI has not finished building, and pulling to it would leave the install
    running the previous interface against newer code.

    A HEAD request rather than a download: this runs on every check, six
    hourly, and the answer is one bit.
    """
    if not sha:
        return True, ""
    try:
        remote = gitrepo._run(root, "remote", "get-url", "origin").strip()
    except gitrepo.GitError:
        return True, ""     # nothing to ask; do not block on it
    slug = re.sub(r"^git@github\.com:", "", remote)
    slug = re.sub(r"^https://github\.com/", "", slug)
    slug = re.sub(r"\.git$", "", slug).strip("/")
    if slug.count("/") != 1:
        return True, ""     # not a GitHub remote; the scripts fall back
    url = (
        f"https://github.com/{slug}/releases/download/{INTERFACE_TAG}"
        f"/nexttex-frontend-{sha}.tar.gz"
    )
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=10):
            return True, ""
    except urllib.error.HTTPError as error:
        if error.code in (403, 404):
            return False, "The interface for that commit has not been published yet."
        return True, ""     # some other server mood; not the writer's problem
    except (urllib.error.URLError, OSError, ValueError):
        return True, ""     # offline: the fetch will fall back to a local build


def node_available() -> tuple[bool, str]:
    """Whether the interface could be rebuilt here, and why not if it could not."""
    binary = shutil.which("node")
    if not binary:
        return False, "Node is not installed, and rebuilding the interface needs it."
    try:
        raw = subprocess.run(
            [binary, "-v"], capture_output=True, text=True, timeout=10
        ).stdout.strip()
        major = int(raw.lstrip("v").split(".")[0])
    except (OSError, ValueError, subprocess.SubprocessError):
        return False, "Node is installed but did not report a version."
    if major < MIN_NODE_MAJOR:
        return False, f"Node {raw} was found; version {MIN_NODE_MAJOR} or newer is needed."
    return True, ""


def supervised() -> bool:
    """Whether something will start NextTex again if it stops.

    systemd sets `INVOCATION_ID` for every service it runs and launchd sets
    `XPC_SERVICE_NAME`; both are configured to restart on a non-zero exit.
    Windows registers a logon task, which is not a supervisor -- so there
    the writer restarts it themselves and is told so.
    """
    return bool(os.environ.get("INVOCATION_ID") or os.environ.get("XPC_SERVICE_NAME"))


def _commits_behind(root: Path) -> list[Commit]:
    """Every commit between here and the upstream branch, newest first."""
    raw = gitrepo._run(
        root, "log", "--reverse", "--name-only",
        "--pretty=format:\x01%h\x02%s", "HEAD..@{upstream}",
    )
    commits: list[Commit] = []
    for block in raw.split("\x01"):
        if not block.strip():
            continue
        header, _, rest = block.partition("\n")
        sha, _, subject = header.partition("\x02")
        paths = [line for line in rest.splitlines() if line.strip()]
        label, interface = classify(paths)
        commits.append(Commit(sha.strip(), subject.strip(), label, interface))
    commits.reverse()
    return commits


def check(root: Path) -> Report:
    """Ask the remote what it has, and work out what it would mean."""
    report = Report(at=time.time(), restart="auto" if supervised() else "manual")

    if not (root / ".git").exists():
        report.checkout = False
        report.reason = "This install is not a git checkout, so it cannot update itself."
        return report

    try:
        report.head = gitrepo._run(root, "rev-parse", "--short", "HEAD").strip()
        gitrepo.fetch(root)
        report.commits = _commits_behind(root)
    except gitrepo.GitError as error:
        report.error = str(error)
        report.reason = "Could not reach the repository."
        return report

    report.behind = len(report.commits)
    report.changing = sum(1 for c in report.commits if c.touches != "neither")
    report.rebuild = any(c.interface for c in report.commits)

    dirty = gitrepo.status(root)
    report.dirty = [change["path"] for change in dirty.as_dict()["changes"]][:20]

    # Only when the interface actually changed: a commit touching nothing
    # under frontend/ is served perfectly well by the interface already
    # installed, and blocking on a missing asset would stop updates that
    # have nothing to do with it.
    target = ""
    if report.rebuild:
        try:
            target = gitrepo._run(root, "rev-parse", "@{upstream}").strip()
        except gitrepo.GitError:
            target = ""
    report.build_ok, report.build_reason = (
        interface_published(root, target) if report.rebuild else (True, "")
    )

    if report.behind == 0:
        report.reason = "already up to date"
    elif report.dirty:
        report.reason = "the install directory has uncommitted changes"
    elif not report.build_ok:
        report.reason = "the interface for that commit is still being built"
    else:
        report.can_update = True

    return report


class Cache:
    """One check, kept for a while.  The screen that asks is one the writer
    opens every session, and it must not wait on the network to draw a list
    it already has."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.report: Report | None = None

    def get(self, force: bool = False) -> Report:
        fresh = (
            self.report is not None
            and not force
            and time.time() - self.report.at < CACHE_SECONDS
        )
        if not fresh:
            self.report = check(self.root)
        return self.report

    def forget(self) -> None:
        self.report = None
