"""Starting NextTex when you log in, on each of the three platforms.

The unit and the plist are built as strings by functions that take
everything they depend on as arguments, so a test on Linux can assert the
exact launchd plist a Mac would get.  The previous arrangement wrote these
files out of a shell heredoc *before* asking whether they were wanted, so
answering no still left a unit file behind; here nothing is written until
the plan says so.

Windows keeps its own file, `scripts/register-task.ps1`, because
`Register-ScheduledTask` and the `WScript.Shell` COM object are not things
that can be ported to Python without reimplementing them.  Policy lives
here, the incantation lives there.

Nothing in this module imports anything outside the standard library.
"""

from __future__ import annotations

from pathlib import Path

# What the service needs on PATH.  Written out in full on purpose: under
# `systemd --user` the inherited PATH is minimal, a TeX Live in the user's
# home is invisible, and the agent spawns `claude`, which has to find the
# credentials the browser sign-in wrote -- which is also why HOME is set.
TEX_PATH = {
    "linux": [
        "{home}/.local/bin",
        "{home}/.TinyTeX/bin/x86_64-linux",
        "{home}/.TinyTeX/bin/aarch64-linux",
        "{home}/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ],
    "macos": [
        "{home}/.local/bin",
        "{home}/Library/TinyTeX/bin/universal-darwin",
        "{home}/Library/TinyTeX/bin/x86_64-darwin",
        "/Library/TeX/texbin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ],
}


def service_path(platform: str, home: Path) -> str:
    return ":".join(
        part.format(home=str(home)) for part in TEX_PATH.get(platform, [])
    )


def unit_name(instance: str) -> str:
    return f"nexttex-{instance}" if instance else "nexttex"


def plist_label(instance: str) -> str:
    return f"com.nexttex.server-{instance}" if instance else "com.nexttex.server"


def systemd_unit(root: Path, home: Path, state: Path, instance: str) -> str:
    return f"""[Unit]
Description=NextTex
After=network-online.target

[Service]
Type=simple
WorkingDirectory={root}
Environment=HOME={home}
Environment=PYTHONUNBUFFERED=1
Environment=NEXTTEX_INSTANCE={instance}
Environment=PATH={service_path("linux", home)}
ExecStart={root}/.venv/bin/python {root}/server/run.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
"""


def launchd_plist(root: Path, home: Path, state: Path, instance: str) -> str:
    label = plist_label(instance)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{root}/.venv/bin/python</string>
    <string>{root}/server/run.py</string>
  </array>
  <key>WorkingDirectory</key><string>{root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>{home}</string>
    <key>PYTHONUNBUFFERED</key><string>1</string>
    <key>NEXTTEX_INSTANCE</key><string>{instance}</string>
    <key>PATH</key><string>{service_path("macos", home)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>{state}/server.log</string>
  <key>StandardErrorPath</key><string>{state}/server.log</string>
</dict>
</plist>
"""


def unit_path(home: Path, instance: str, config_home: str = "") -> Path:
    base = Path(config_home) if config_home else home / ".config"
    return base / "systemd" / "user" / f"{unit_name(instance)}.service"


def plist_path(home: Path, instance: str) -> Path:
    return home / "Library" / "LaunchAgents" / f"{plist_label(instance)}.plist"


def register_task_argv(root: Path, instance: str) -> list:
    """What the Windows helper is called with.

    A scheduled task first, because it is the tidier of the two: it survives
    a missing console and can be listed and stopped by name.  But registering
    one in the root task folder wants elevation, and this installer is
    deliberately not run as administrator, so on an ordinary account it fails
    with "Access is denied" -- which is exactly what the first real Windows
    install hit, at the very last step, after everything else had gone right.
    The helper falls back to a Startup shortcut, which is how a per-user
    program has always been started at login on Windows.
    """
    return [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(root / "scripts" / "register-task.ps1"),
        "-Root",
        str(root),
        "-Name",
        unit_name(instance),
        "-Instance",
        instance,
    ]
