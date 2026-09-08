"""Instance configuration: where NextTex listens and what it can find.

Resolved once at startup and never re-read, so a running server has a fixed
idea of its own environment. In particular the LaTeX engine is located here
rather than looked up on each compile: under `systemd --user` the PATH is
minimal and a TeX Live installed in the user's home is invisible, and the
failure that produces is far easier to understand at startup than on the
first keystroke of the first document.
"""

from __future__ import annotations

import hashlib
import json
import sys
import os
import secrets
import shutil
from dataclasses import dataclass, field, asdict
from pathlib import Path

from .project import instance_name, state_home

CONFIG_FILE = "config.json"
DEFAULT_PORT = 8450


def default_port() -> int:
    """The port a fresh install listens on.

    A named instance never defaults to the main install's port: two NextTex
    on one machine that both start on 8450 means the second simply refuses
    to start, with a message about a port rather than about the thing the
    person was actually doing.  Derived from the name so it is the same
    every time, and so two named instances do not collide either.
    """
    name = instance_name()
    if not name:
        return DEFAULT_PORT
    digest = hashlib.blake2b(name.encode(), digest_size=2).digest()
    return DEFAULT_PORT + 1 + int.from_bytes(digest, "big") % 40

# Where a TeX installation usually lands, in the order worth trying.  All
# three platforms are listed unconditionally: a path that does not exist
# costs one stat, and branching on sys.platform is one more thing to get
# wrong on the machine nobody is testing on.
TEX_HINTS = [
    # Linux, TinyTeX
    Path.home() / ".TinyTeX" / "bin" / "x86_64-linux",
    Path.home() / ".TinyTeX" / "bin" / "aarch64-linux",
    # macOS, TinyTeX -- one universal binary directory, and the older
    # per-architecture ones that installs from before 2022 still have
    Path.home() / "Library" / "TinyTeX" / "bin" / "universal-darwin",
    Path.home() / "Library" / "TinyTeX" / "bin" / "x86_64-darwin",
    # macOS, MacTeX
    Path("/Library/TeX/texbin"),
    Path("/usr/local/texlive/2026/bin/universal-darwin"),
    Path("/usr/local/texlive/2025/bin/universal-darwin"),
    Path.home() / "bin",
    Path("/usr/local/texlive/bin/x86_64-linux"),
    # Windows, TinyTeX -- what the installer puts there now, so it has to
    # come first.  Without this entry the installer finds pdflatex (it
    # prepends to its own PATH) and the logon task does not, which is a
    # working install that cannot typeset.
    Path.home() / "AppData" / "Roaming" / "TinyTeX" / "bin" / "windows",
    Path.home() / "AppData" / "Roaming" / "TinyTeX" / "bin" / "win32",
    # Windows: MiKTeX per-user and machine-wide, then TeX Live
    Path.home() / "AppData" / "Local" / "Programs" / "MiKTeX" / "miktex" / "bin" / "x64",
    Path("C:/Program Files/MiKTeX/miktex/bin/x64"),
    Path("C:/texlive/2026/bin/windows"),
    Path("C:/texlive/2025/bin/windows"),
]


@dataclass
class Settings:
    port: int = field(default_factory=default_port)
    # Bind addresses. Plain HTTP is only ever offered on loopback; anything
    # reachable from another machine gets TLS.
    localhost: bool = True
    tailscale: bool = False
    lan_host: str = ""
    certfile: str = ""
    keyfile: str = ""
    token: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    model: str = ""
    # Which writing agent, if any: "claude", "openai" or "none".  The
    # config file is already chmod 600 because it holds the access token,
    # which is what makes it the right place for an API key too.
    provider: str = "claude"
    openai_key: str = ""

    @classmethod
    def path(cls) -> Path:
        return state_home() / CONFIG_FILE

    @classmethod
    def load(cls) -> "Settings":
        path = cls.path()
        if not path.exists():
            settings = cls()
            try:
                settings.save()
            except OSError:
                pass      # unwritable state directory: run anyway, in memory
            return settings
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # A settings file that cannot be read used to be replaced by a
            # fresh one on every start -- a new token each time, so every
            # saved link and every open tab stopped working with nothing
            # said about why.  Keep the broken file, say so once, and write
            # a replacement that then stays put.
            broken = path.with_name(path.name + ".broken")
            try:
                path.replace(broken)
            except OSError:
                pass
            else:
                print(
                    f"  Settings file could not be read; kept as {broken.name}.\n"
                    "  A new access token has been generated, so any saved "
                    "NextTex link will need the new one.",
                    file=sys.stderr,
                )
            settings = cls()
            try:
                settings.save()
            except OSError:
                pass      # unwritable state directory: run anyway, in memory
            return settings
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})

    def save(self) -> None:
        path = self.path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        # The token is a credential; nobody else on the box should read it.
        temp.chmod(0o600)
        temp.replace(path)


# Every tool NextTex looks for, and whether it can work without it.
TOOLS = {
    "pdflatex": ("required", "the LaTeX engine"),
    "latexmk":  ("required", "full builds with bibliography"),
    "synctex":  ("required", "click-to-source navigation"),
    "biber":    ("optional", "biblatex bibliographies"),
    "chktex":   ("optional", "syntax linting"),
    "texcount": ("optional", "word counts"),
    "pdftotext": ("optional", "reading uploaded PDFs"),
    "git":      ("optional", "the version control panel"),
}


def _candidate_dirs() -> list[Path]:
    """Directories that plausibly hold TeX binaries, best first."""
    dirs: list[Path] = []
    for hint in TEX_HINTS:
        if hint.is_dir():
            dirs.append(hint)
    for name in ("pdflatex", "latexmk", "synctex"):
        found = shutil.which(name)
        if found:
            parent = Path(found).parent
            if parent not in dirs:
                dirs.append(parent)
    return dirs


def ensure_tex_on_path() -> Path | None:
    """Put every directory holding a TeX tool on PATH, for this process and
    its children.

    Adding one directory is not enough in practice.  A TeX Live installed in
    the user's home often exposes a partial set of symlinks somewhere else
    on PATH -- this machine has 81 of 92 in ~/.local/bin, missing biber --
    so resolving to the first `pdflatex` found silently loses tools that
    are installed. Every candidate goes on, richest first.

    Returns the directory holding pdflatex, or None when there is none; the
    caller reports that at startup rather than letting the first compile
    fail with a bare FileNotFoundError.
    """
    candidates = _candidate_dirs()
    if not candidates:
        return None

    def richness(directory: Path) -> int:
        return sum(1 for name in TOOLS if (directory / name).exists())

    for directory in sorted(candidates, key=richness, reverse=True):
        current = os.environ.get("PATH", "").split(os.pathsep)
        if str(directory) not in current:
            os.environ["PATH"] = os.pathsep.join([str(directory), *current])

    found = shutil.which("pdflatex")
    return Path(found).parent if found else None


def missing_tools() -> list[str]:
    """Tools NextTex needs that are not installed, for the startup report."""
    missing = []
    for name, (tier, why) in TOOLS.items():
        if not shutil.which(name):
            missing.append(f"{name} ({tier}) — {why}")
    return missing


def required_missing() -> list[str]:
    return [n for n, (tier, _) in TOOLS.items()
            if tier == "required" and not shutil.which(n)]
