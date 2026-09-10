"""A shortcut on the desktop, on whichever of the three this is.

The installer prints a URL with a token in it and says to treat it like a
password, which is fine advice and a poor way to open an app every morning.
This writes something double-clickable instead.

All three run the same thing, `server/run.py --open`, rather than pointing at
a saved URL. A URL in a file is a copy of the token that goes stale the
moment the port or the token changes, and it does nothing at all when the
server is not running. The launcher asks the configuration where NextTex is,
starts it if nothing answers, and opens the browser once it does. One source
of truth, and it works from both states.

Linux is the platform that may have no desktop at all: NextTex runs on
headless boxes reached from another machine, and writing `~/Desktop` on one
of those invents a directory nobody asked for. So the directory is looked
for and the step is skipped when it is absent, rather than created.

Windows is done from PowerShell, because a `.lnk` is a COM object and
because `[Environment]::GetFolderPath('Desktop')` is the only thing that
knows where the desktop really is when OneDrive has moved it.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path


def shortcut_name(instance: str) -> str:
    return f"NextTex ({instance})" if instance else "NextTex"


def desktop_dir(home: Path, environ=None, is_dir=None) -> Path | None:
    """The desktop directory, or None when this machine has no desktop.

    `XDG_DESKTOP_DIR` first, because a translated desktop is called
    `Skrivebord` or `Escritorio` and `~/Desktop` beside it would be a second,
    empty one that no file manager shows.
    """
    environ = os.environ if environ is None else environ
    is_dir = is_dir or (lambda path: Path(path).is_dir())
    named = environ.get("XDG_DESKTOP_DIR", "").strip().strip('"')
    if named:
        named = named.replace("$HOME", str(home))
        candidate = Path(named)
        return candidate if is_dir(candidate) else None
    candidate = home / "Desktop"
    return candidate if is_dir(candidate) else None


def desktop_entry(root: Path, python: Path, instance: str) -> str:
    """The Linux `.desktop` file.

    `Terminal=false` because the launcher needs no console, and the server it
    may start writes to its own log rather than to a window.
    """
    entry = root / "server" / "run.py"
    icon = root / "frontend" / "public" / "icon.png"
    lines = [
        "[Desktop Entry]",
        "Type=Application",
        f"Name={shortcut_name(instance)}",
        "Comment=Write LaTeX with the typeset page beside you",
        f'Exec="{python}" "{entry}" --open',
        f"Path={root}",
        "Terminal=false",
        "Categories=Office;Publishing;",
        "StartupNotify=true",
    ]
    if icon.exists():
        lines.insert(-1, f"Icon={icon}")
    return "\n".join(lines) + "\n"


def command_script(root: Path, python: Path, instance: str) -> str:
    """The macOS `.command` file, which Finder runs on a double click."""
    entry = root / "server" / "run.py"
    return (
        "#!/bin/sh\n"
        f"# {shortcut_name(instance)}. Opens NextTex, starting it first if\n"
        "# nothing is listening yet.\n"
        f'exec "{python}" "{entry}" --open\n'
    )


def write(root: Path, platform: str, home: Path, python: Path,
          instance: str = "", environ=None) -> Path | None:
    """Write the shortcut and return where it went, or None.

    None means there was nowhere to put one, which on a headless Linux box
    is the ordinary answer and not a failure. Windows returns None here too:
    its shortcut is a COM object and is written by `desktop-shortcut.ps1`,
    through the installer's one child-process call site.
    """
    if platform == "windows":
        return None
    folder = desktop_dir(home, environ)
    if folder is None:
        return None
    if platform == "macos":
        target = folder / f"{shortcut_name(instance)}.command"
        target.write_text(command_script(root, python, instance), encoding="utf-8")
        target.chmod(target.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
        return target
    target = folder / f"{shortcut_name(instance)}.desktop"
    target.write_text(desktop_entry(root, python, instance), encoding="utf-8")
    # Executable, and marked trusted where the file manager asks for that.
    # A .desktop file without the bit shows as a text file on GNOME.
    target.chmod(target.stat().st_mode | stat.S_IXUSR)
    return target


def shortcut_argv(root: Path, instance: str) -> list:
    """How the Windows shortcut is written, once, for both callers."""
    return [
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", str(root / "scripts" / "desktop-shortcut.ps1"),
        "-Root", str(root),
        "-Name", shortcut_name(instance),
    ]
