"""The whole install, driven end to end, without spawning anything.

Every child process goes through `Console.run`, which is the point of there
being only one such call site: replace it and the entire install becomes a
list of argv you can assert on, for any platform, from this one.

The assertion that matters most is the last kind: a step that fails must
stop the install.  The PowerShell installer checked no exit codes at all, so
a failed `pip install` reached "Ready" and told the person NextTex was
working.
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nexttex.install import __main__ as installer  # noqa: E402
from nexttex.install import steps  # noqa: E402
from nexttex.install.plan import build_plan  # noqa: E402
from nexttex.install.survey import survey  # noqa: E402
from nexttex.install.ui import Console, Result  # noqa: E402


class Recorder(Console):
    """A console that records what would have been run and runs nothing."""

    def __init__(self, fails=(), output=()):
        super().__init__(stream=io.StringIO(), plain=True)
        self.calls: list = []
        self.fails = set(fails)
        self.output = list(output)

    def run(self, label, argv, *, cwd=None, env=None, counter="",
            shell_input=None):
        argv = [str(a) for a in argv]
        self.calls.append(argv)
        joined = " ".join(argv)
        ok = not any(marker in joined for marker in self.fails)
        self.write(f"  {label}" + ("" if ok else "  FAILED"))
        return Result(ok, 0 if ok else 1, 0.0, list(self.output) if not ok else [])

    @property
    def ran(self) -> str:
        return "\n".join(" ".join(call) for call in self.calls)

    def index_of(self, needle: str) -> int:
        for index, call in enumerate(self.calls):
            if needle in " ".join(call):
                return index
        return -1


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """A machine with nothing on it, and nowhere real to write."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    # Path.home() reads USERPROFILE on Windows and HOME everywhere else, so
    # without this the "nothing was written" assertions below sweep the real
    # home directory of whoever is running the tests.
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setenv("XDG_DATA_HOME", str(home / "state"))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(home / "config"))
    monkeypatch.delenv("NEXTTEX_INSTANCE", raising=False)

    def fake_fetch(url, dest, on_progress=None):
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_text("# a stand-in for " + url)
        return ""

    monkeypatch.setattr(steps, "fetch", fake_fetch)
    root = tmp_path / "NextTex"
    (root / "scripts").mkdir(parents=True)
    return root



def _unit_path(root, instance):
    from nexttex.install import service as service_mod

    return service_mod.unit_path(Path.home(), instance,
                                 os.environ.get("XDG_CONFIG_HOME", ""))


def _plist_path(root, instance):
    from nexttex.install import service as service_mod

    return service_mod.plist_path(Path.home(), instance)


def a_survey(root, platform="linux", **overrides):
    result = survey(platform, root, which=lambda _n: None,
                    exists=lambda _p: False, check_network=False,
                    environ={"XDG_DATA_HOME": str(root / "state")})
    result.service = {"windows": "windows", "macos": "launchd"}.get(platform, "systemd")
    for key, value in overrides.items():
        setattr(result, key, value)
    return result


def run_install(console, root, platform="linux", instance="", **answers):
    plan = build_plan(a_survey(root, platform), interactive=True, answers=answers)
    return installer.execute(console, plan, root, platform, instance)


# ---------------------------------------------------------------------------
# The order things happen in


def test_the_environment_comes_before_the_packages(sandbox):
    console = Recorder()
    run_install(console, sandbox, tex="none", service="no")
    venv = console.index_of("venv")
    pip = console.index_of("requirements.txt")
    assert venv >= 0 and pip > venv, console.ran


def test_the_configuration_is_written_after_the_interface(sandbox):
    console = Recorder()
    run_install(console, sandbox, tex="none", service="no")
    interface = console.index_of("fetch-interface")
    config = console.index_of("settings.save()")
    assert interface >= 0 and config > interface, console.ran


def test_the_service_is_the_last_thing_that_happens(sandbox):
    console = Recorder()
    run_install(console, sandbox, tex="none", service="yes")
    service = console.index_of("systemctl --user enable")
    config = console.index_of("settings.save()")
    assert service > config >= 0, console.ran


def test_no_certificate_is_made_for_a_localhost_install(sandbox):
    console = Recorder()
    run_install(console, sandbox, tex="none", service="no", bind="localhost")
    assert "gen_cert" not in console.ran


def test_a_tailnet_install_makes_one(sandbox):
    console = Recorder()
    plan = build_plan(a_survey(sandbox, tailscale=True), interactive=True,
                      answers={"tex": "none", "service": "no", "bind": "both"})
    installer.execute(console, plan, sandbox, "linux", "")
    assert "gen_cert" in console.ran


def test_a_fresh_install_gets_the_tools_a_first_build_needs(sandbox, monkeypatch):
    """The survey ran before TinyTeX existed, so it reported no tlmgr and no
    way to add anything with it.  Believing that afterwards left every new
    install without latexmk, biber, synctex, chktex or texcount: a NextTex
    that starts, opens a project, and fails on its first full build."""
    seen = {"tlmgr": False}

    def which(name):
        # A bare machine, and then a machine with TinyTeX on it. TinyTeX
        # brings pdflatex and tlmgr and nothing else: latexmk, biber and the
        # rest are what tlmgr is then for.
        if not seen["tlmgr"]:
            return None
        return (f"/home/ada/.TinyTeX/bin/{name}"
                if name in ("tlmgr", "pdflatex") else None)

    console = Recorder()
    real_run = console.run

    def run(label, argv, **kwargs):
        result = real_run(label, argv, **kwargs)
        if "install-tinytex" in " ".join(str(a) for a in argv):
            seen["tlmgr"] = True
        return result

    console.run = run
    monkeypatch.setattr(installer.shutil, "which", which)
    run_install(console, sandbox, tex="tinytex", service="no")

    tinytex = console.index_of("install-tinytex")
    extras = console.index_of("tlmgr install")
    assert tinytex >= 0, console.ran
    assert extras > tinytex, f"tlmgr never ran after TinyTeX\n{console.ran}"
    for tool in ("latexmk", "biber", "synctex", "chktex", "texcount"):
        assert tool in console.ran, tool


def test_a_machine_with_no_tlmgr_is_told_rather_than_left_guessing(sandbox, monkeypatch):
    monkeypatch.setattr(installer.shutil, "which", lambda _n: None)
    console = Recorder()
    run_install(console, sandbox, tex="none", service="no")
    assert "tlmgr install" not in console.ran
    assert "latexmk" in console.stream.getvalue()


# ---------------------------------------------------------------------------
# A failure stops the install


def test_a_failed_dependency_install_stops_everything(sandbox):
    """The bug that hid every other bug.

    `pip install` returning non-zero must end the install with a non-zero
    exit and the captured output on screen -- not walk on to "Ready".
    """
    console = Recorder(fails=("requirements.txt",),
                       output=["ERROR: Could not find a version that satisfies pycrdt"])
    code = run_install(console, sandbox, tex="none", service="no")
    assert code != 0
    assert "settings.save()" not in console.ran, "it configured a broken install"
    assert "run.py --print-url" not in console.ran, "it printed a URL anyway"
    printed = console.stream.getvalue()
    assert "Could not find a version" in printed
    assert "Run the installer again" in printed


def test_a_failed_venv_stops_everything_and_says_what_to_install(sandbox):
    console = Recorder(fails=("venv",))
    code = run_install(console, sandbox, tex="none", service="no")
    assert code != 0
    assert "python3-venv" in console.stream.getvalue()


def test_a_failed_tex_install_does_not_stop_the_rest(sandbox):
    """TeX is the one big optional piece: an install without it is a working
    NextTex that cannot typeset yet, which is worth having."""
    console = Recorder(fails=("install-tinytex",))
    code = run_install(console, sandbox, tex="tinytex", service="no")
    assert code == 0
    assert "settings.save()" in console.ran
    assert "TeX did not install" in console.stream.getvalue()


def test_a_failed_agent_install_does_not_stop_the_rest(sandbox):
    console = Recorder(fails=("claude-install",))
    code = run_install(console, sandbox, tex="none", agent="claude", service="no")
    assert code == 0
    printed = console.stream.getvalue()
    assert "add it later" in printed
    # And the config records no agent rather than one that is not there.
    assert " none " in console.ran or console.ran.rstrip().endswith("none")


def test_a_failed_interface_download_with_no_node_is_fatal(sandbox):
    console = Recorder(fails=("fetch-interface",))
    code = run_install(console, sandbox, tex="none", service="no")
    assert code != 0
    assert "nodejs.org" in console.stream.getvalue()


def test_a_failed_interface_download_builds_it_instead_when_node_is_here(sandbox):
    console = Recorder(fails=("fetch-interface",))
    plan = build_plan(a_survey(sandbox, node_major=22), interactive=True,
                      answers={"tex": "none", "service": "no"})
    code = installer.execute(console, plan, sandbox, "linux", "")
    assert code == 0
    assert "npm ci" in console.ran or "ci --no-audit" in console.ran


# ---------------------------------------------------------------------------
# What ends up in the configuration


def test_the_chosen_agent_reaches_the_configuration(sandbox):
    """Neither installer used to set `provider` at all, so config kept its
    default of "claude" whatever was chosen: an install that had opted out
    still claimed an agent that was not on the machine."""
    for choice in ("none", "openai"):
        console = Recorder()
        run_install(console, sandbox, tex="none", service="no", agent=choice)
        config = [c for c in console.calls if "settings.save()" in " ".join(c)][0]
        assert config[-2] == choice, config


def test_an_instance_reaches_the_configuration_and_the_unit(sandbox):
    console = Recorder()
    run_install(console, sandbox, instance="scratch", tex="none", service="yes")
    config = [c for c in console.calls if "settings.save()" in " ".join(c)][0]
    assert config[-1] == "scratch"
    unit = _unit_path(sandbox, "scratch")
    assert unit.is_file(), sorted(Path.home().rglob("*.service"))
    assert "NEXTTEX_INSTANCE=scratch" in unit.read_text()


# ---------------------------------------------------------------------------
# The service, and what is not written when it is not wanted


def test_nothing_is_written_when_the_service_is_declined(sandbox):
    """It used to write the unit and the plist *before* asking, so answering
    no still left a file behind."""
    console = Recorder()
    run_install(console, sandbox, tex="none", service="no")
    assert not _unit_path(sandbox, "").exists()
    assert not _plist_path(sandbox, "").exists()
    assert "systemctl" not in console.ran


def test_macos_gets_a_plist_and_linux_gets_a_unit(sandbox):
    console = Recorder()
    run_install(console, sandbox, platform="macos", tex="none", service="yes")
    assert _plist_path(sandbox, "").is_file()
    assert "launchctl load" in console.ran
    assert "systemctl" not in console.ran


def test_windows_calls_the_helper_rather_than_writing_a_unit(sandbox):
    console = Recorder()
    run_install(console, sandbox, platform="windows", tex="none", service="yes")
    assert "register-task.ps1" in console.ran
    assert not _unit_path(sandbox, "").exists()


def test_the_stray_directory_the_old_windows_installer_made_is_removed(
    sandbox, monkeypatch, tmp_path
):
    """It made %LOCALAPPDATA%\\nexttex and never used it. Removed only when
    empty, so a machine that does keep something there loses nothing."""
    local = tmp_path / "LocalAppData"
    (local / "nexttex").mkdir(parents=True)
    monkeypatch.setenv("LOCALAPPDATA", str(local))
    installer._tidy_stray_state(Recorder(), "windows")
    assert not (local / "nexttex").exists()

    (local / "nexttex").mkdir()
    (local / "nexttex" / "something.json").write_text("{}")
    installer._tidy_stray_state(Recorder(), "windows")
    assert (local / "nexttex").exists()


# ---------------------------------------------------------------------------
# Nothing to do


def test_a_machine_with_everything_runs_almost_nothing(sandbox):
    # The venv is made on disk, not merely claimed by the survey: the step
    # asks the disk at the moment it acts rather than trusting a survey that
    # may be minutes old, which is what makes re-running the installer safe.
    (sandbox / ".venv" / "bin").mkdir(parents=True)
    (sandbox / ".venv" / "bin" / "python").write_text("")
    console = Recorder()
    result = a_survey(sandbox, tex_dir="/usr/bin", claude="/usr/bin/claude",
                      venv_ready=True, interface_present=True)
    plan = build_plan(result, interactive=True, answers={"service": "no"})
    installer.execute(console, plan, sandbox, "linux", "")
    assert "install-tinytex" not in console.ran
    assert "claude-install" not in console.ran
    assert "-m venv" not in console.ran
    # The packages are still checked, which is what "brought up to date"
    # means and is why re-running the installer is the documented repair.
    assert "requirements.txt" in console.ran


def test_windows_tinytex_runs_the_script_not_the_wrapper(monkeypatch, tmp_path):
    """TinyTeX publishes a .bat next to its .ps1, and the .bat is a wrapper
    whose whole job is to fetch the .ps1 and run it.  It fetches it with
    `curl.exe -fsSLO 'https://...'`, and cmd.exe does not strip single
    quotes, so curl is handed a URL beginning with one and refuses it.  The
    next line then runs a script that was never downloaded, and the line
    after deletes it.  A user's install did all three and ended with no TeX.

    Nothing on our side can repair a wrapper like that, so we fetch what it
    was trying to fetch.
    """
    urls: list = []

    def download(console, label, url, dest, counter=""):
        urls.append(url)
        Path(dest).write_text("", encoding="utf-8")
        return Result(True, 0, 0.0, [])

    monkeypatch.setattr(steps, "download", download)
    console = Recorder()
    steps.install_tex(console, tmp_path, "windows", "tinytex")

    assert urls == ["https://tinytex.yihui.org/install-bin-windows.ps1"]
    assert "cmd.exe" not in console.ran
    assert "powershell" in console.ran
    assert console.ran.endswith("install-tinytex.ps1"), console.ran


def test_a_tex_tool_in_the_tex_directory_counts_as_present(tmp_path):
    """TinyTeX does not put its bin directory on PATH, so `shutil.which`
    answers "no" for tools that are sitting right there. Windows spells an
    executable more than one way and TinyTeX uses two of them in the same
    directory: `tlmgr.bat` beside `latexmk.exe`."""
    from nexttex.install.survey import tex_tool

    tex_dir = tmp_path / "TinyTeX" / "bin" / "windows"
    tex_dir.mkdir(parents=True)
    (tex_dir / "tlmgr.bat").write_text("", encoding="utf-8")
    (tex_dir / "latexmk.exe").write_text("", encoding="utf-8")

    nothing_on_path = lambda _name: None  # noqa: E731
    assert tex_tool("tlmgr", str(tex_dir), which=nothing_on_path)
    assert tex_tool("latexmk", str(tex_dir), which=nothing_on_path)
    assert not tex_tool("biber", str(tex_dir), which=nothing_on_path)
    assert not tex_tool("tlmgr", None, which=nothing_on_path)
    assert tex_tool("biber", None, which=lambda _name: "/usr/bin/biber")


def test_the_extras_are_counted_against_the_tex_directory_too(tmp_path, monkeypatch):
    """The list that goes in the "still missing" note. `latexmk` appeared
    in it on a machine that had `latexmk.exe`, which is how the whole thing
    came to light.

    PATH is emptied for the duration, because the machine these tests are
    written on has all five installed and would pass without testing
    anything.
    """
    import shutil as shutil_module

    from nexttex.install.survey import TEX_EXTRAS

    monkeypatch.setattr(shutil_module, "which", lambda _name: None)

    tex_dir = tmp_path / "bin"
    tex_dir.mkdir()
    (tex_dir / "latexmk.exe").write_text("", encoding="utf-8")

    missing = installer._missing_tex_extras(str(tex_dir))
    assert "latexmk" not in missing, missing
    assert set(missing) == set(TEX_EXTRAS) - {"latexmk"}


def test_tex_is_put_on_path_before_anything_asks_what_is_missing(sandbox, monkeypatch):
    """The bug, in the order it happened.

    Putting TeX's own directory on PATH used to run only in the branch
    where TinyTeX had just been installed, which is the one case where it
    mattered least. A machine that already had TeX skipped it, the question
    that follows was a bare `shutil.which`, and the install announced that
    there was no tlmgr and that latexmk, biber, synctex, chktex and
    texcount were all missing, standing next to a directory holding tlmgr
    and latexmk that it had printed on screen two lines earlier. Then it
    exited successfully.

    That is the worst shape a bug can take here: the person is told the
    install worked, and finds out it did not when a build fails days later
    with no error to bring back. So the order is what is asserted, on every
    path and not just the one that installs something.
    """
    order = []
    monkeypatch.setattr(installer, "_add_tex_to_path", lambda: order.append("path"))
    real = installer._missing_tex_extras

    def counted(tex_dir=None):
        order.append("ask")
        return real(tex_dir)

    monkeypatch.setattr(installer, "_missing_tex_extras", counted)

    console = Recorder()
    run_install(console, sandbox, tex="none", service="no")
    assert order[:2] == ["path", "ask"], order


def test_tlmgr_is_run_by_the_path_it_was_found_at(sandbox, monkeypatch):
    """Detection and execution have to agree about what "tlmgr" means.

    On Windows they did not. TinyTeX ships `tlmgr.bat`; `shutil.which`
    honours PATHEXT and returns it, while `CreateProcess` appends only
    `.exe` to a bare name and cannot find it. So the installer detected
    tlmgr, decided four packages were missing, ran the step, and died with
    "[WinError 2] The system cannot find the file specified" on a machine
    where tlmgr was present and working. The fix that made the detection
    correct is what exposed this: the step had never run here before.

    The stub returns a .BAT path for the same reason, since a bare name
    would pass whatever the code did.
    """
    tlmgr_path = "C:\\TinyTeX\\bin\\windows\\tlmgr.BAT"
    seen = {"tlmgr": False}

    def which(name):
        if not seen["tlmgr"]:
            return None
        if name == "tlmgr":
            return tlmgr_path
        return f"C:\\TinyTeX\\bin\\windows\\{name}.EXE" if name == "pdflatex" else None

    console = Recorder()
    real_run = console.run

    def run(label, argv, **kwargs):
        result = real_run(label, argv, **kwargs)
        if "install-tinytex" in " ".join(str(a) for a in argv):
            seen["tlmgr"] = True
        return result

    console.run = run
    monkeypatch.setattr(installer.shutil, "which", which)
    run_install(console, sandbox, tex="tinytex", service="no")

    adding = [call for call in console.calls
              if len(call) > 1 and call[1] == "install" and "biber" in call]
    assert adding, f"tlmgr never ran\n{console.ran}"
    assert adding[0][0] == tlmgr_path, adding[0]


def test_the_address_is_checked_rather_than_just_printed():
    """An install that prints a link and the word Ready has claimed
    something it never looked at. A server that died on startup left the
    person with a browser saying the site could not be reached and an
    installer insisting everything had worked."""
    import socket

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    listener.listen(1)
    try:
        assert installer._answers(port, timeout=2.0)
    finally:
        listener.close()

    # And the same port once nothing is behind it.
    assert not installer._answers(port, timeout=1.0)


def test_the_port_is_read_out_of_whatever_the_server_printed():
    assert installer._port_of(["http://127.0.0.1:8450/?token=abc"]) == 8450
    assert installer._port_of(["https://box.tail.ts.net:8451/?token=abc"]) == 8451
    assert installer._port_of(["nothing here"]) == 0
    assert installer._port_of([]) == 0


def test_nothing_is_checked_when_nothing_was_started(sandbox, monkeypatch):
    """The check only makes sense where the install undertook to start it.
    Somebody who said no to starting at login has nothing running on
    purpose, and telling them so would be noise."""
    called = []
    monkeypatch.setattr(installer, "_answers",
                        lambda port, timeout=20.0: called.append(port) or True)
    console = Recorder()
    run_install(console, sandbox, tex="none", service="no")
    assert called == [], called
