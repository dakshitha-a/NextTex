"""The unit, the plist and the Windows logon task.

These used to be shell heredocs, so the only thing any test could say about
them was that the words "LaunchAgents" and "systemd/user" appeared somewhere
in install.sh -- an assertion every one of the bugs in this rework would
have passed.  They are strings built by functions now, and a Linux machine
can assert exactly what a Mac would get.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nexttex.install import service  # noqa: E402

ROOT = Path("/home/ada/apps/NextTex")
HOME = Path("/home/ada")
STATE = Path("/home/ada/.local/share/nexttex")


def test_the_systemd_unit_carries_home_and_a_full_path():
    """Under `systemd --user` the inherited PATH is minimal, so a TeX Live in
    the user's home is invisible; and the agent spawns `claude`, which has to
    find the credentials the browser sign-in wrote, so HOME has to be right
    as well.  Both were learned the hard way."""
    unit = service.systemd_unit(ROOT, HOME, STATE, "")
    assert f"Environment=HOME={HOME}" in unit
    assert ".TinyTeX/bin/x86_64-linux" in unit
    assert ".local/bin" in unit
    assert f"ExecStart={ROOT}/.venv/bin/python {ROOT}/server/run.py" in unit
    assert "Restart=on-failure" in unit
    assert "WantedBy=default.target" in unit


def test_the_launch_agent_carries_the_macos_tex_paths():
    plist = service.launchd_plist(ROOT, HOME, STATE, "")
    assert "Library/TinyTeX/bin/universal-darwin" in plist
    assert "/Library/TeX/texbin" in plist
    assert "/opt/homebrew/bin" in plist
    assert "<key>RunAtLoad</key><true/>" in plist
    assert f"{STATE}/server.log" in plist
    assert "<string>com.nexttex.server</string>" in plist


def test_an_instance_gets_its_own_everything():
    """A development copy and the copy somebody actually writes in must not
    share a unit, a label or a state directory."""
    assert service.unit_name("scratch") == "nexttex-scratch"
    assert service.plist_label("scratch") == "com.nexttex.server-scratch"
    unit = service.systemd_unit(ROOT, HOME, STATE, "scratch")
    assert "Environment=NEXTTEX_INSTANCE=scratch" in unit
    plist = service.launchd_plist(ROOT, HOME, STATE, "scratch")
    assert "<key>NEXTTEX_INSTANCE</key><string>scratch</string>" in plist
    assert service.unit_path(HOME, "scratch").name == "nexttex-scratch.service"


def test_an_ordinary_install_keeps_the_names_it_has_always_had():
    """So an existing install is untouched by any of this."""
    assert service.unit_name("") == "nexttex"
    assert service.plist_label("") == "com.nexttex.server"
    assert service.unit_path(HOME, "") == (
        HOME / ".config" / "systemd" / "user" / "nexttex.service"
    )
    assert service.plist_path(HOME, "") == (
        HOME / "Library" / "LaunchAgents" / "com.nexttex.server.plist"
    )


def test_xdg_config_home_is_honoured():
    path = service.unit_path(HOME, "", "/tmp/config")
    assert path == Path("/tmp/config/systemd/user/nexttex.service")


def test_windows_calls_its_own_helper_rather_than_reimplementing_it():
    """Register-ScheduledTask and the WScript.Shell COM object cannot be
    ported to Python; policy lives in the installer and the incantation
    lives in a script the installer calls."""
    argv = service.register_task_argv(ROOT, "scratch")
    assert argv[0] == "powershell"
    assert "-ExecutionPolicy" in argv and "Bypass" in argv
    assert str(ROOT / "scripts" / "register-task.ps1") in argv
    assert "nexttex-scratch" in argv
    assert (Path(__file__).resolve().parents[1] / "scripts"
            / "register-task.ps1").is_file()


def test_the_helper_falls_back_to_the_startup_folder():
    """A scheduled task in the root folder wants administrator, and this
    installer is deliberately not run elevated -- which is how a real Windows
    install ended on "Access is denied" at the very last step."""
    text = (Path(__file__).resolve().parents[1] / "scripts"
            / "register-task.ps1").read_text(encoding="utf-8")
    assert "Register-ScheduledTask" in text
    assert "GetFolderPath('Startup')" in text
    assert "pythonw.exe" in text, "logging in would leave a console window open"


def test_nothing_is_written_by_importing_any_of_this(tmp_path):
    """The plist and the unit used to be written before the question that
    decided whether they were wanted, so answering no left a file behind."""
    before = set(tmp_path.rglob("*"))
    service.systemd_unit(tmp_path, tmp_path, tmp_path, "")
    service.launchd_plist(tmp_path, tmp_path, tmp_path, "")
    service.register_task_argv(tmp_path, "")
    assert set(tmp_path.rglob("*")) == before
