"""What is on this machine, worked out before a single question is asked.

The complaint that produced this module was exact: the installer asked to
install things one at a time, so you could not see what the whole job was
going to cost until you were halfway through it.  So everything is detected
first, in one pass, and printed in four groups -- and the group that matters
most is the third, the things NextTex cannot install for you, because that
is the list somebody needs *before* they start rather than after.

`platform` is passed in rather than detected.  That is what lets a test on
Linux assert exactly what a Windows machine with nothing installed would be
told, which is the only way any of this was ever going to be checked.

Nothing here imports anything outside the standard library.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path

from ..tools import TEX_HINTS, TOOLS

# What the installer will do about a thing that is not here.
PRESENT = "present"        # nothing to do
FETCHED = "fetched"        # the installer downloads it
YOURS = "yours"            # you have to install it, and here is the command
NOT_NEEDED = "not-needed"  # absent and that is fine; said so it is not alarming

PLATFORMS = ("linux", "macos", "windows")


# The five a project needs beyond pdflatex.  Here rather than beside the
# installer's own code because the survey and the installer both ask about
# them, and asking differently is how the answers came apart.
TEX_EXTRAS = ("latexmk", "biber", "synctex", "chktex", "texcount")


def tex_tool(name: str, tex_dir, *, which=None, exists=None):
    """Where a TeX tool is, or None: on PATH, or inside the TeX directory.

    It answers with the path rather than with yes, because on Windows those
    are different questions and answering the easy one shipped a bug.
    `shutil.which` honours PATHEXT and happily returns `tlmgr.BAT`, while
    `CreateProcess` appends only `.exe` to a bare name and cannot run it.
    So the installer found tlmgr and then failed to start it, on the same
    machine, for the same file. Anything that runs what this found must run
    the path it returns.

    PATH alone is not the question, and believing it cost a real install.
    TinyTeX does not put its bin directory on PATH, so on a machine that
    already has TeX, `tlmgr` is sitting right there and `shutil.which` says
    it is not.  An installer that trusts `which` then reports tlmgr missing
    while standing next to it, skips the step that would have added biber
    and synctex, and exits successfully, leaving a NextTex that opens a
    project and dies on its first full build.

    Windows spells an executable more than one way, so the suffixes are
    tried too: TinyTeX ships `tlmgr.bat` and `latexmk.exe` in the same
    directory.
    """
    # Both resolved here rather than in the signature: a default argument
    # binds at import, and the installer's tests replace `shutil.which`
    # afterwards to describe a machine that is not this one.
    which = which or shutil.which
    exists = exists or (lambda p: Path(p).exists())
    found = which(name)
    if found:
        return found
    if not tex_dir:
        return None
    for suffix in ("", ".exe", ".bat", ".cmd"):
        candidate = Path(tex_dir) / (name + suffix)
        if exists(candidate):
            return str(candidate)
    return None


def this_platform() -> str:
    if sys.platform == "darwin":
        return "macos"
    if os.name == "nt":
        return "windows"
    return "linux"


@dataclass
class Finding:
    key: str
    name: str
    kind: str
    where: str = ""
    version: str = ""
    why: str = ""
    size: str = ""
    command: str = ""

    @property
    def found(self) -> bool:
        return self.kind == PRESENT


@dataclass
class Survey:
    platform: str
    root: Path
    findings: list = field(default_factory=list)
    # The details the plan needs, rather than only what the screen shows.
    python: str = ""
    python_version: str = ""
    has_ensurepip: bool = True
    uv: str = ""
    venv_ready: bool = False
    tex_dir: str = ""
    tlmgr: bool = False
    missing_tex_extras: list = field(default_factory=list)
    claude: str = ""
    node_major: int = 0
    tailscale: bool = False
    service: str = ""          # "systemd", "launchd", "windows" or ""
    service_running: bool = False
    interface_present: bool = False
    offline: list = field(default_factory=list)
    config: dict = field(default_factory=dict)

    def get(self, key: str):
        for finding in self.findings:
            if finding.key == key:
                return finding
        return None

    def of_kind(self, kind: str) -> list:
        return [f for f in self.findings if f.kind == kind]

    @property
    def has_tex(self) -> bool:
        return bool(self.tex_dir)


# The command that installs a thing NextTex will not install for you.  Named
# per platform, because "install poppler" is not an instruction anybody can
# act on and `sudo apt install poppler-utils` is.
#
# Short enough to fit an eighty-column terminal without wrapping, and with
# nothing after them in parentheses.  These are meant to be copied, and a
# copy-paste line that wraps is one somebody has to reassemble by hand.
COMMANDS = {
    "git": {
        "linux": "sudo apt install git",
        "macos": "xcode-select --install",
        "windows": "winget install --id Git.Git -e",
    },
    "pdftotext": {
        "linux": "sudo apt install poppler-utils",
        "macos": "brew install poppler",
        "windows": "winget install --id oschwartz10612.Poppler",
    },
    "tailscale": {
        "linux": "https://tailscale.com/download",
        "macos": "brew install --cask tailscale",
        "windows": "winget install --id tailscale.tailscale",
    },
    "node": {
        "linux": "https://nodejs.org",
        "macos": "brew install node",
        "windows": "winget install OpenJS.NodeJS.LTS",
    },
}

# Roughly what each download costs, so the plan can add them up.  Deliberately
# approximate and deliberately shown: the previous installer asked "Install
# TinyTeX (about 200 MB)?" one question at a time, which tells you the price
# of each thing and never the price of the whole.
SIZES = {
    "uv": ("15 MB", 15),
    "packages": ("~90 MB", 90),
    "tex": ("~200 MB", 200),
    "interface": ("~1 MB", 1),
    "claude": ("~100 MB", 100),
}


def _reachable(host: str, timeout: float = 2.0) -> bool:
    try:
        socket.create_connection((host, 443), timeout=timeout).close()
        return True
    except OSError:
        return False


def _unreachable_hosts(hosts) -> list:
    """Which of the hosts the install needs cannot be reached right now.

    Checked in parallel and with a short timeout, because the point is to
    tell somebody they are offline before they wait three minutes for a
    download to fail, not to add three seconds to every install.
    """
    out: list = []
    lock = threading.Lock()

    def probe(host: str) -> None:
        if not _reachable(host):
            with lock:
                out.append(host)

    threads = [threading.Thread(target=probe, args=(host,)) for host in hosts]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=4)
    return sorted(out)


def _version_of(argv, which) -> str:
    exe = which(argv[0])
    if not exe:
        return ""
    try:
        out = subprocess.run(
            [exe, *argv[1:]], capture_output=True, text=True, timeout=10,
            errors="replace",
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    text = (out.stdout or out.stderr or "").strip().splitlines()
    return text[0].strip() if text else ""


def survey(
    platform: str,
    root: Path,
    *,
    which=shutil.which,
    exists=None,
    check_network: bool = True,
    environ=None,
) -> Survey:
    """Everything, in one pass, before anything is asked."""
    exists = exists or (lambda p: Path(p).exists())
    environ = environ if environ is not None else os.environ
    root = Path(root)
    result = Survey(platform=platform, root=root)
    add = result.findings.append

    def command_for(key: str) -> str:
        return COMMANDS.get(key, {}).get(platform, "")

    # -- the things the bootstrap already proved ---------------------------
    git = which("git")
    if git:
        add(Finding("git", "git", PRESENT, where=git,
                    version=_version_of(["git", "--version"], which)
                    .replace("git version ", "")))
    else:
        add(Finding("git", "git", YOURS, why="NextTex is a git checkout, and stays one so it can update itself",
                    command=command_for("git")))

    result.python = sys.executable
    result.python_version = "%d.%d.%d" % sys.version_info[:3]
    add(Finding("python", "Python", PRESENT, where=sys.executable,
                version=result.python_version))

    # Debian and Ubuntu ship python3 without ensurepip, so `python3 -m venv`
    # fails on a fresh machine with an error naming a package nobody would
    # guess.  This is the single most common first-install failure there is,
    # and it now appears on the survey rather than as a crash.
    try:
        import importlib.util

        result.has_ensurepip = importlib.util.find_spec("ensurepip") is not None
    except Exception:
        result.has_ensurepip = False

    result.uv = which("uv") or (
        str(root / ".uv" / "uv") if exists(root / ".uv" / "uv") else ""
    )
    if result.uv:
        add(Finding("uv", "uv", PRESENT, where=result.uv,
                    version=_version_of(["uv", "--version"], which).replace("uv ", "")))
    elif not result.has_ensurepip:
        add(Finding("uv", "uv", FETCHED, size=SIZES["uv"][0],
                    why="this Python has no ensurepip, so `python -m venv` cannot "
                        "work here; uv brings its own"))

    venv_python = (
        root / ".venv" / ("Scripts" if platform == "windows" else "bin")
        / ("python.exe" if platform == "windows" else "python")
    )
    result.venv_ready = bool(exists(venv_python))
    add(Finding(
        "packages", "Python packages",
        PRESENT if result.venv_ready else FETCHED,
        where=str(root / ".venv") if result.venv_ready else "",
        size="" if result.venv_ready else SIZES["packages"][0],
        why="checked and brought up to date" if result.venv_ready
            else "fastapi, uvicorn, pycrdt and the rest",
    ))

    # -- TeX ---------------------------------------------------------------
    for hint in TEX_HINTS:
        if exists(hint) and any(
            exists(hint / n) or exists(hint / (n + ".exe"))
            for n in ("pdflatex", "latexmk", "synctex")
        ):
            result.tex_dir = str(hint)
            break
    if not result.tex_dir and which("pdflatex"):
        result.tex_dir = str(Path(which("pdflatex")).parent)

    if result.tex_dir:
        add(Finding("tex", "TeX", PRESENT, where=result.tex_dir))
    else:
        add(Finding("tex", "TeX (TinyTeX)", FETCHED, size=SIZES["tex"][0],
                    why="pdflatex, latexmk and synctex; nothing can be typeset "
                        "without them"))

    result.tlmgr = bool(tex_tool("tlmgr", result.tex_dir, which=which, exists=exists))
    result.missing_tex_extras = [
        name for name in TEX_EXTRAS
        if not tex_tool(name, result.tex_dir, which=which, exists=exists)
    ]

    # -- the ones NextTex will not install for you --------------------------
    if which("pdftotext"):
        add(Finding("pdftotext", "pdftotext", PRESENT, where=which("pdftotext")))
    else:
        add(Finding("pdftotext", "pdftotext", YOURS,
                    why="only for reading a folder of papers into a .bib. "
                        "NextTex works without it.",
                    command=command_for("pdftotext")))

    result.tailscale = bool(which("tailscale"))
    if result.tailscale:
        add(Finding("tailscale", "tailscale", PRESENT, where=which("tailscale")))
    else:
        add(Finding("tailscale", "tailscale", YOURS,
                    why="only to reach this install from your other devices",
                    command=command_for("tailscale")))

    # -- the ones that are fine to be missing -------------------------------
    result.interface_present = bool(exists(root / "frontend" / "dist" / "index.html"))
    add(Finding("interface", "the interface",
                PRESENT if result.interface_present else FETCHED,
                size="" if result.interface_present else SIZES["interface"][0],
                why="downloaded, not built, so no Node is needed"))

    node = which("node") or which("nodejs")
    if node:
        raw = _version_of([Path(node).name, "-v"], which).lstrip("v")
        try:
            result.node_major = int(raw.split(".")[0])
        except (ValueError, IndexError):
            result.node_major = 0
    if result.node_major >= 20:
        add(Finding("node", "Node", PRESENT, where=node, version=f"v{result.node_major}"))
    else:
        add(Finding("node", "Node 20+", NOT_NEEDED,
                    why="only if the interface download fails",
                    command=command_for("node")))

    result.claude = which("claude") or ""
    if result.claude:
        add(Finding("claude", "claude", PRESENT, where=result.claude))
    else:
        add(Finding("claude", "an agent CLI", NOT_NEEDED,
                    why="NextTex works fully without one; choose below, or none"))

    # -- how it will start --------------------------------------------------
    if platform == "windows":
        result.service = "windows"
        add(Finding("service", "starting at login", PRESENT,
                    where="a logon task, or the Startup folder"))
    elif platform == "macos":
        result.service = "launchd" if which("launchctl") else ""
        add(Finding("service", "launchd",
                    PRESENT if result.service else NOT_NEEDED,
                    why="can start NextTex at login" if result.service
                        else "no launchctl here; start it yourself"))
    else:
        systemd = bool(which("systemctl"))
        if systemd:
            try:
                probe = subprocess.run(
                    [which("systemctl"), "--user", "show-environment"],
                    capture_output=True, timeout=10,
                )
                systemd = probe.returncode == 0
            except (OSError, subprocess.SubprocessError):
                systemd = False
        result.service = "systemd" if systemd else ""
        add(Finding("service", "systemd --user",
                    PRESENT if systemd else NOT_NEEDED,
                    why="can start NextTex at login" if systemd
                        else "not available here; start it yourself"))

    # -- what is already configured -----------------------------------------
    result.config = _read_config(environ)

    if check_network:
        hosts = ["codeload.github.com"]
        if not result.tex_dir:
            hosts.append("yihui.org")
        if not result.uv and not result.has_ensurepip:
            hosts.append("astral.sh")
        result.offline = _unreachable_hosts(hosts)

    return result


def _read_config(environ) -> dict:
    """Whatever this machine already decided, so the plan can show it.

    `bind` has no route to change it from inside the app: re-running the
    installer is the only way.  A plan screen that offered a blank default
    would therefore quietly downgrade a tailnet install to localhost the
    next time somebody re-ran it to fix something else.
    """
    import json

    from ..paths import state_home

    path = state_home(environ) / "config.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def required_missing_after(survey_result: Survey) -> list:
    """Required tools that will still be missing when the install finishes."""
    return [
        name for name, (tier, _) in TOOLS.items()
        if tier == "required" and not survey_result.tex_dir and name != "git"
    ]
