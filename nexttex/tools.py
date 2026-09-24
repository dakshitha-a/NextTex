"""Every external tool NextTex looks for, and where TeX tends to hide.

Split out of `config.py` so the installer can import it on a bare
interpreter, before there is a virtual environment.  Nothing here imports
anything outside the standard library, and `config.py` re-exports every
name so no caller had to change.

This used to exist three times: here, in `install.sh` and in `install.ps1`,
and the three had already drifted apart -- the shell scripts each knew a
different subset of the paths below.  A machine where the installer finds
pdflatex and the running server does not is a working install that cannot
typeset, which is a hard thing to diagnose from the inside.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path


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


# Every tool NextTex looks for, and whether it can work without it.
TOOLS = {
    "pdflatex": ("required", "the LaTeX engine"),
    "latexmk":  ("required", "full builds with bibliography"),
    "synctex":  ("required", "click-to-source navigation"),
    "biber":    ("optional", "biblatex bibliographies"),
    "chktex":   ("optional", "syntax linting"),
    "texcount": ("optional", "word counts"),
    "pdftotext": ("optional", "reading uploaded PDFs"),
    "pdffonts":  ("optional", "the submission check's font rows"),
    "pdfimages": ("optional", "the submission check's image rows"),
    "pandoc":   ("optional", "Word, HTML and Markdown export"),
    "git":      ("optional", "the version control panel"),
}


def named_tex_dir() -> Path | None:
    """The TeX somebody has said to use, or None.

    `NEXTTEX_TEX` names the directory holding the engine, the way
    `NEXTTEX_TLMGR` names a tlmgr and `NEXTTEX_PANDOC` a pandoc.  It exists
    because the list below cannot answer the question it is asked on a
    machine with two TeXs on it: the list is in a fixed order, so whichever
    distribution happens to be higher up wins, whatever the writer
    installed on purpose.  A real install on 23 September 2026 had MiKTeX
    put there by NextTex's own installer, at the writer's explicit
    request, and compiled with the TinyTeX that happened to already be
    there, because TinyTeX is four lines earlier.

    It stays as the override.  What the installer was told to use is
    `recorded_tex_dir`, below it and above the list.
    """
    named = os.environ.get("NEXTTEX_TEX", "").strip()
    if not named:
        return None
    directory = Path(named)
    return directory if directory.is_dir() else None


def recorded_tex_dir() -> Path | None:
    """The TeX the installer was told to use, or None.

    The installer writes the directory of the distribution it installed to
    the `tex` field of this install's `config.json`, so a machine that had a
    TinyTeX before and was given MiKTeX on request builds with the MiKTeX.
    Before that was recorded the fixed list decided, and on the Windows
    laptop on 23 September 2026 it ran MiKTeX's engine against TinyTeX's
    package tree, and a one-sentence document took 95.6 seconds. Read here
    rather than through `Settings`, which imports this module; the file is
    plain JSON and a missing or unreadable one means nothing was recorded.
    """
    from .paths import state_home

    try:
        data = json.loads((state_home() / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    named = str(data.get("tex") or "").strip() if isinstance(data, dict) else ""
    if not named:
        return None
    directory = Path(named)
    return directory if directory.is_dir() else None


def distribution_dir(choice: str) -> Path | None:
    """Where the list says a distribution the installer offers lives, if it
    is there: the first existing hint whose path names it."""
    marker = {"tinytex": "tinytex", "miktex": "miktex"}.get(choice)
    if marker is None:
        return None
    for hint in TEX_HINTS:
        if marker in str(hint).lower() and hint.is_dir():
            return hint
    return None


def _candidate_dirs() -> list[Path]:
    """Directories that plausibly hold TeX binaries, best first."""
    dirs: list[Path] = []
    for chosen in (named_tex_dir(), recorded_tex_dir()):
        if chosen is not None and chosen not in dirs:
            dirs.append(chosen)
    for hint in TEX_HINTS:
        if hint.is_dir() and hint not in dirs:
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

    # Richest first, and a directory somebody named stays in front of all
    # of them however poor it looks: naming one is the answer to this
    # question and not an opinion about it. `NEXTTEX_TEX` first, then what
    # the installer recorded it was told to use.
    named, recorded = named_tex_dir(), recorded_tex_dir()

    def rank(directory: Path) -> int:
        return 0 if directory == named else 1 if directory == recorded else 2

    ordered = sorted(
        candidates,
        key=lambda directory: (rank(directory), -richness(directory)),
    )
    # Built in one go rather than prepended one at a time.  Prepending in a
    # loop reverses the order it is given: the first directory prepended
    # ends up behind every directory prepended after it, so "richest first"
    # put the *poorest* in front, and which TeX a machine with two of them
    # compiled with came down to that inversion.
    # And moved to the front when already on PATH further back, which a
    # MiKTeX that put itself on the user's PATH behind a TinyTeX is: left
    # where it was, the engine came from the TinyTeX whatever was chosen.
    ahead = [str(directory) for directory in ordered]
    current = [
        entry for entry in os.environ.get("PATH", "").split(os.pathsep)
        if entry not in ahead
    ]
    os.environ["PATH"] = os.pathsep.join([*ahead, *current])

    found = shutil.which("pdflatex")
    return Path(found).parent if found else None


def missing_tools() -> list[str]:
    """Tools NextTex needs that are not installed, for the startup report."""
    missing = []
    for name, (tier, why) in TOOLS.items():
        if not shutil.which(name):
            missing.append(f"{name} ({tier}): {why}")
    return missing


def required_missing() -> list[str]:
    return [n for n, (tier, _) in TOOLS.items()
            if tier == "required" and not shutil.which(n)]
