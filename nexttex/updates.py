"""Is this install behind the repository it came from, and does it matter?

NextTex is always a git checkout, and there is no package and no release
artefact to download, so "is there an update" is a question about `git`.
The version number in `nexttex/version.py` names what an update would move
to, and is read off the upstream commit for the footer to say so; it does
not decide anything here.  The interesting half is the second one. Most commits to a project like this
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
from .version import VERSION, parse as parse_version

# How long a check is trusted before the network is asked again.  A writer
# who opens the app four times in an afternoon should pay for one fetch.
CACHE_SECONDS = 6 * 60 * 60

# What a changed path means for the install.  Ordered: the first prefix that
# matches wins, so `frontend/` beats the catch-all.
INTERFACE_PREFIXES = ("frontend/",)
NOT_THE_PROGRAM = (
    "docs/", "README.md", "LICENSE", "tests/", "e2e/", "bench/", "examples/",
    # What the agent that develops NextTex reads, not what a writer runs.
    "CLAUDE.md", ".claude/",
    # The repository's own furniture: what git ignores and how it checks
    # files out.  Neither reaches a running install.
    ".gitignore", ".gitattributes",
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
    #: Whether the fetch that decides everything below actually happened.
    #: `behind` is a count, and a count cannot say "I could not ask": it was
    #: left at its default of zero when the fetch failed, and the footer
    #: reads `behind === 0` as "up to date", so an install five commits
    #: behind a repository it could not reach was told it was current.
    checked: bool = False
    head: str = ""
    #: The version this install is on, and the one the upstream commit
    #: carries.  The second is "" when the upstream commit has no
    #: `nexttex/version.py`, which every install that predates the number
    #: sees once, and when the fetch failed.
    version: str = ""
    upstream_version: str = ""
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


#: Where the checkout came from, for anything that has to name it when the
#: remote cannot say: a clone whose origin is a local path, or a tarball.
CANONICAL_SLUG = "dakshitha-a/NextTex"


def repository_slug(root: Path) -> str:
    """`owner/repo` for the checkout's origin, or nothing if it is not GitHub.

    Both spellings a clone can carry, with or without the `.git`.  Empty
    rather than a guess when the remote is somewhere else, because the two
    callers want different things then: the update check stops asking, and
    the bug report falls back to the canonical name.
    """
    try:
        remote = gitrepo._run(root, "remote", "get-url", "origin").strip()
    except gitrepo.GitError:
        return ""
    slug = re.sub(r"^git@github\.com:", "", remote)
    slug = re.sub(r"^(?:https?|ssh)://(?:[^@/]+@)?github\.com/", "", slug)
    slug = re.sub(r"\.git$", "", slug).strip("/")
    if slug == remote.strip("/") or slug.count("/") != 1:
        return ""
    return slug


def slug_or_canonical(root: Path) -> str:
    return repository_slug(root) or CANONICAL_SLUG


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
    slug = repository_slug(root)
    if not slug:
        return True, ""     # nothing to ask, or not GitHub; the scripts fall back
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
    """Whether something will start NextTex again if it stops on purpose.

    systemd sets `INVOCATION_ID` for every service it runs and launchd sets
    `XPC_SERVICE_NAME`; both are configured to restart on a non-zero exit.
    Windows registers a logon task, which is not a supervisor: a task that
    ends stays ended.  So there the server arranges its own return before
    it leaves, with the helper `windows_restart_argv` describes, and the
    answer is yes wherever that helper can run.  It needs the same Python
    it is running on and PowerShell, which every Windows has.  Until it existed the
    update button on Windows finished with "stop it and start it again",
    which for a server a task started meant finding Task Scheduler.
    """
    if os.environ.get("INVOCATION_ID") or os.environ.get("XPC_SERVICE_NAME"):
        return True
    return os.name == "nt" and shutil.which("powershell") is not None


def windows_restart_argv(pid: int, root: Path, instance: str, python: str,
                         state: Path) -> list:
    """A PowerShell that waits for this process to end and starts NextTex
    the way it was started.

    Started outside the task's job, which is the part that took the install
    lane two tries to learn.  A scheduled task runs its action inside a
    job object, and everything the action starts is in that job: a helper
    inside it could not restart the task, because a job with a live
    process in it is a task that has not finished, and when the action's
    own process exited the job was torn down and the helper with it.  So
    the server starts the helper with CREATE_BREAKAWAY_FROM_JOB, see
    `windows_restart_flags`, and from outside the job the helper waits for
    the pid, then for the task to leave Running, then starts the task, so
    the new server is the task's own process again.  With no task, the
    Startup shortcut; failing both, the command line, hidden, logging to
    the state directory.  The wait is on the pid, not a sleep: the port
    has to be free before anything can bind it again.

    It writes what it does to restart.log beside server.log, with
    Add-Content rather than a transcript: a transcript needs the console
    host to be up, and a helper that died before its first statement left
    nothing at all for the lane to read.  Each step is a line, and a
    failure is a line too, so a restart that did not happen is a helper
    that can be asked.
    """
    name = "nexttex" + (f"-{instance}" if instance else "")
    q = lambda text: "'" + str(text).replace("'", "''") + "'"  # noqa: E731
    run = root / "server" / "run.py"
    args = ["'-u'", q(run), "'--log-to-state'"]
    if instance:
        args += ["'--instance'", q(instance)]
    log = q(state / "restart.log")
    task = f"Get-ScheduledTask -TaskName {q(name)}"
    # One statement per line here; the joins below put the semicolons in,
    # and none between a brace and the elseif or else that follows it.
    body = "; ".join([
        f"say 'waiting for pid {int(pid)}'",
        f"$p = Get-Process -Id {int(pid)} -ErrorAction SilentlyContinue",
        "if ($p) { $p.WaitForExit() }",
        "Start-Sleep -Milliseconds 500",
        f"$t = {task} -ErrorAction SilentlyContinue",
        f"$link = Join-Path ([Environment]::GetFolderPath('Startup')) {q(name + '.lnk')}",
        # The task is still Running for a moment after its process has
        # gone, and Start-ScheduledTask on a running task does nothing.
        "if ($t) { "
        f"for ($i = 0; $i -lt 120 -and ({task}).State -eq 'Running'; $i++) {{ Start-Sleep -Milliseconds 250 }}; "
        f"say ('task state: ' + ({task}).State); "
        f"Start-ScheduledTask -TaskName {q(name)}; "
        "say 'started the task' } "
        "elseif (Test-Path $link) { say ('starting ' + $link); Start-Process -FilePath $link } "
        "else { "
        f"say ('starting ' + {q(python)}); "
        f"Start-Process -FilePath {q(python)} -ArgumentList @({', '.join(args)}) "
        f"-WorkingDirectory {q(root)} -WindowStyle Hidden; "
        "say 'started' }",
    ])
    script = "; ".join([
        f"New-Item -ItemType Directory -Force -Path {q(state)} | Out-Null",
        f"function say($m) {{ Add-Content -Path {log} -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] helper: ' + $m) }}",
        "$ErrorActionPreference = 'Stop'",
        f"try {{ {body} }} catch {{ say ('failed: ' + $_) }}",
    ])
    return ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-Command", script]


#: How the helper is started: with a console it does not show, in its own
#: group, and out of the job the scheduled task runs its action in, so it
#: outlives the action.  Not DETACHED_PROCESS: that is no console at all,
#: and PowerShell's console host stops before the first statement without
#: one, which is what the lane saw, a helper pid noted by the server and
#: not a line from the helper itself.  CREATE_NO_WINDOW is what every
#: hidden launcher gives it.
CREATE_BREAKAWAY_FROM_JOB = 0x01000000
CREATE_NO_WINDOW = 0x08000000


def windows_restart_flags(breakaway: bool = True) -> int:
    flags = CREATE_NO_WINDOW | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    if breakaway:
        flags |= CREATE_BREAKAWAY_FROM_JOB
    return flags


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


def _upstream_version(root: Path) -> str:
    """The number the upstream commit carries, or "" when it carries none.

    `git show` of one file at one ref, after the fetch that `check` has
    already paid for, so it costs nothing on the network.  An upstream
    without the file is an upstream older than the number, and "" is the
    honest answer rather than a guess.
    """
    try:
        text = gitrepo._run(root, "show", "@{upstream}:nexttex/version.py")
    except gitrepo.GitError:
        return ""
    return parse_version(text)


def check(root: Path) -> Report:
    """Ask the remote what it has, and work out what it would mean."""
    report = Report(
        at=time.time(), restart="auto" if supervised() else "manual", version=VERSION,
    )

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

    report.checked = True
    report.upstream_version = _upstream_version(root)
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
