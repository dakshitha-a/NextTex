"""What the installer works out about a machine before it asks anything.

`platform` is injected rather than detected, which is the whole reason these
assertions can exist: a Windows machine with nothing installed is a case this
Linux box can check exactly, and the divergences between the two old
installers were exactly the cases nobody could check.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nexttex.install.survey import (  # noqa: E402
    FETCHED,
    NOT_NEEDED,
    PRESENT,
    YOURS,
    survey,
)

PLATFORMS = ["linux", "macos", "windows"]


def which_none(_name):
    return None


def which_only(*names):
    have = set(names)
    return lambda name: f"/usr/bin/{name}" if name in have else None


def bare(platform, root, **kwargs):
    """A machine with nothing on it, and no network probing.

    XDG_DATA_HOME is pointed at the temporary directory deliberately.  The
    survey reads whatever configuration already exists so the plan can show
    it, and without this a test would be reading the developer's own.
    """
    kwargs.setdefault("which", which_none)
    kwargs.setdefault("exists", lambda _p: False)
    kwargs.setdefault("environ", {"XDG_DATA_HOME": str(Path(root) / "state")})
    return survey(platform, root, check_network=False, **kwargs)


@pytest.mark.parametrize("platform", PLATFORMS)
def test_a_bare_machine_is_told_everything_before_it_is_asked_anything(platform, tmp_path):
    result = bare(platform, tmp_path)
    keys = {finding.key for finding in result.findings}
    # Every group the screen renders is populated, so nothing is silently
    # left off the report.
    assert {"git", "python", "tex", "pdftotext", "interface", "claude"} <= keys
    assert result.of_kind(FETCHED), "nothing said it would be downloaded"
    assert result.of_kind(YOURS), "nothing said what the person must do"


@pytest.mark.parametrize("platform", PLATFORMS)
def test_everything_you_must_install_yourself_comes_with_the_command(platform, tmp_path):
    """The complaint that produced this module.

    Naming a missing dependency without naming the command that installs it
    is not telling somebody anything they can act on.
    """
    result = bare(platform, tmp_path)
    for finding in result.of_kind(YOURS):
        assert finding.command, f"{finding.key} on {platform} has no command"
        assert finding.why, f"{finding.key} on {platform} does not say why it matters"


def test_the_command_is_the_one_for_this_platform(tmp_path):
    assert "apt install poppler-utils" in bare("linux", tmp_path).get("pdftotext").command
    assert "brew install poppler" in bare("macos", tmp_path).get("pdftotext").command
    assert "winget install" in bare("windows", tmp_path).get("pdftotext").command


@pytest.mark.parametrize("manager, expected", [
    ("apt", "sudo apt install poppler-utils"),
    ("dnf", "sudo dnf install poppler-utils"),
    ("pacman", "sudo pacman -S poppler"),
    ("apk", "sudo apk add poppler-utils"),
    ("zypper", "sudo zypper install poppler-utils"),
])
def test_the_linux_command_is_the_one_for_this_linux(tmp_path, manager, expected):
    """I-023.  Every Linux was told `sudo apt install`; Fedora and Alpine,
    which the install lane runs the bootstrap on, do not have it."""
    which = lambda name: f"/usr/bin/{name}" if name == manager else None  # noqa: E731
    assert bare("linux", tmp_path, which=which).get("pdftotext").command == expected


def test_a_linux_with_no_known_package_manager_still_gets_a_line(tmp_path):
    assert bare("linux", tmp_path).get("pdftotext").command == "sudo apt install poppler-utils"


@pytest.mark.parametrize("platform", PLATFORMS)
def test_a_missing_tex_is_named_as_the_thing_that_stops_you_typesetting(platform, tmp_path):
    tex = bare(platform, tmp_path).get("tex")
    assert tex.kind == FETCHED
    assert tex.size, "the 200 MB is not shown before the question"
    assert "typeset" in tex.why


def test_tex_found_only_where_it_hides_still_counts(tmp_path, monkeypatch):
    """A TeX Live in the user's home is invisible to `which` under a minimal
    PATH, which is exactly the state `systemd --user` runs in."""
    from nexttex import tools

    hint = tools.TEX_HINTS[0]

    def exists(path):
        path = Path(path)
        return path == hint or path.parent == hint

    result = survey("linux", tmp_path, which=which_none, exists=exists,
                    check_network=False,
                    environ={"XDG_DATA_HOME": str(tmp_path / "state")})
    assert result.tex_dir == str(hint)
    assert result.get("tex").kind == PRESENT


def test_a_debian_python_without_ensurepip_is_reported_not_crashed_into(tmp_path, monkeypatch):
    """The single most common first-install failure there is.

    `python3 -m venv` fails on a fresh Debian with an error naming a package
    nobody would guess, and it used to fail *after* the install had started.
    It is a line on the survey now, before any question.
    """
    import importlib.util

    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
    result = bare("linux", tmp_path)
    assert result.has_ensurepip is False
    uv = result.get("uv")
    assert uv is not None and uv.kind == FETCHED
    assert "ensurepip" in uv.why


def test_a_machine_with_everything_is_told_there_is_nothing_to_do(tmp_path):
    (tmp_path / "frontend").mkdir()
    (tmp_path / "frontend" / "dist").mkdir()
    (tmp_path / "frontend" / "dist" / "index.html").write_text("<html>")
    venv = tmp_path / ".venv" / "bin"
    venv.mkdir(parents=True)
    (venv / "python").write_text("")
    result = survey(
        "linux", tmp_path,
        which=which_only("git", "pdflatex", "latexmk", "synctex", "biber",
                         "chktex", "texcount", "pdftotext", "pandoc", "tailscale",
                         "claude", "uv", "tlmgr"),
        check_network=False, environ={"XDG_DATA_HOME": str(tmp_path / "state")},
    )
    assert not result.of_kind(FETCHED), [f.key for f in result.of_kind(FETCHED)]
    assert not result.of_kind(YOURS), [f.key for f in result.of_kind(YOURS)]
    assert result.venv_ready and result.interface_present and result.has_tex


def test_the_extras_a_first_build_needs_are_noticed(tmp_path):
    result = survey("linux", tmp_path, which=which_only("pdflatex", "tlmgr"),
                    exists=lambda _p: False, check_network=False,
                    environ={"XDG_DATA_HOME": str(tmp_path / "state")})
    assert result.tlmgr is True
    # latexmk missing is the one that turns a working install into a project
    # that fails on its first full build.
    assert "latexmk" in result.missing_tex_extras
    assert "biber" in result.missing_tex_extras


@pytest.mark.parametrize("raw, ok", [
    ("v22.13.0", True), ("v22.13.1", True), ("v24.1.0", True), ("v23.0.0", True),
    ("v22.12.9", False), ("v20.19.0", False), ("v18.20.4", False), ("", False), ("nonsense", False),
])
def test_node_new_enough_to_build_the_interface_is_22_13(raw, ok):
    """Vite 8 needs Node 20.19 and pdf.js 6 needs 22.13, so a fallback
    build on Node 20 would fail after the download already had. The floor
    is read to the minor version, since 22.12 is not enough either."""
    from nexttex.install.survey import NODE_FLOOR, node_new_enough

    assert NODE_FLOOR == (22, 13)
    assert node_new_enough(raw) is ok


def test_a_missing_node_names_the_floor(tmp_path):
    node = bare("linux", tmp_path).get("node")
    assert node.name == "Node 22.13+"


def test_node_is_absent_without_being_alarming(tmp_path):
    node = bare("linux", tmp_path).get("node")
    assert node.kind == NOT_NEEDED
    assert "only if" in node.why


def test_no_agent_is_a_real_choice_not_a_missing_dependency(tmp_path):
    """Its absence is reported in the group for things that are fine to be
    missing, never in the group of things you have to go and install."""
    agent = bare("linux", tmp_path).get("claude")
    assert agent.kind == NOT_NEEDED
    assert "without one" in agent.why


def test_windows_does_not_look_for_a_unix_service_manager(tmp_path):
    result = bare("windows", tmp_path)
    assert result.service == "windows"
    assert result.get("service").kind == PRESENT


def test_an_existing_configuration_is_read_so_the_plan_can_show_it(tmp_path, monkeypatch):
    """`bind` has no route to change it from inside the app, so re-running
    the installer is the only way -- and a plan that offered a blank default
    would quietly downgrade a tailnet install to localhost."""
    import json

    state = tmp_path / "state" / "nexttex"
    state.mkdir(parents=True)
    (state / "config.json").write_text(json.dumps({"tailscale": True, "port": 8450}))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "state"))
    result = survey("linux", tmp_path, which=which_none,
                    exists=lambda _p: False, check_network=False)
    assert result.config.get("tailscale") is True


# ---------------------------------------------------------------------------
# What it looks like, which is the whole complaint this answered


def render(platform, root, columns=80):
    """The survey and the plan as somebody at a terminal would see them."""
    import io

    from nexttex.install import __main__ as installer
    from nexttex.install.plan import build_plan
    from nexttex.install.ui import Console

    class Narrow(Console):
        width = columns

    console = Narrow(stream=io.StringIO(), plain=True)
    result = bare(platform, root)
    result.service = "windows" if platform == "windows" else "systemd"
    installer.show_survey(console, result)
    installer.show_plan(console, build_plan(result, interactive=True))
    return console.stream.getvalue()


@pytest.mark.parametrize("platform", PLATFORMS)
@pytest.mark.parametrize("columns", [80, 60, 120])
def test_nothing_runs_off_the_edge_of_the_terminal(platform, columns, tmp_path):
    """Several of these explanations are a whole sentence, and at a column of
    thirty-four they ran to a hundred characters -- so the first screen of
    the first thing anybody runs was a wall of stumps in a normal window."""
    for line in render(platform, tmp_path, columns).splitlines():
        assert len(line) <= columns, f"{len(line)} columns: {line}"


def test_a_version_wider_than_its_column_still_ends_in_a_gap():
    """I-019.  Git for Windows reports `2.55.0.windows.5`, three characters
    wider than the version column, and the survey ran it straight into
    the path beside it: `2.55.0.windows.5C:\\Program Files\\Git\\bin`."""
    import io

    from nexttex.install import __main__ as installer
    from nexttex.install.survey import PRESENT, Finding, Survey
    from nexttex.install.ui import Console

    console = Console(stream=io.StringIO(), plain=True)
    result = Survey(platform="windows", root=Path("."))
    result.findings.append(Finding("git", "git", PRESENT,
                                   where=r"C:\Program Files\Git\bin\git.EXE",
                                   version="2.55.0.windows.5"))
    result.findings.append(Finding("service", "starting at login", PRESENT,
                                   where="a logon task, or the Startup folder"))
    installer.show_survey(console, result)
    text = console.stream.getvalue()
    assert "2.55.0.windows.5 C:" in text, text
    assert "starting at login " in text and "logina logon" not in text, text


@pytest.mark.parametrize("platform", PLATFORMS)
def test_a_command_meant_to_be_copied_is_never_wrapped(platform, tmp_path):
    """A copy-paste line broken across two rows is one somebody has to
    reassemble by hand before it will run."""
    text = render(platform, tmp_path)
    for finding in bare(platform, tmp_path).of_kind(YOURS):
        assert finding.command in text, finding.key
        assert len(finding.command) <= 46, (
            f"{finding.command!r} is too long to sit in the wide column"
        )


@pytest.mark.parametrize("platform", PLATFORMS)
def test_nothing_that_is_not_needed_is_given_an_install_command(platform, tmp_path):
    """An instruction under "Not needed here" is one nobody asked for."""
    text = render(platform, tmp_path)
    tail = text[text.index("Not needed here"):text.index("The plan")]
    for finding in bare(platform, tmp_path).of_kind(NOT_NEEDED):
        if finding.command:
            assert finding.command not in tail, finding.key


def test_tinytex_is_named_where_it_actually_lands(tmp_path):
    """`~/.TinyTeX` names a directory a Windows user will not find."""
    from nexttex.install.plan import build_plan

    for platform, expected in (("linux", "~/.TinyTeX"),
                               ("macos", "~/Library/TinyTeX"),
                               ("windows", r"%APPDATA%\TinyTeX")):
        plan = build_plan(bare(platform, tmp_path), interactive=True)
        assert expected in plan.item("tex").option("tinytex").label


def test_the_estimate_does_not_promise_a_tex_install_in_three_minutes(tmp_path):
    """An estimate that is under by a factor of five is worse than none:
    somebody told three minutes and fifteen minutes in has been given a
    reason to think it has hung.  The first-session guide says twenty."""
    from nexttex.install.plan import build_plan

    with_tex = build_plan(bare("linux", tmp_path), interactive=True)
    assert with_tex.choice("tex") == "tinytex"
    assert with_tex.minutes >= 10

    without = build_plan(bare("linux", tmp_path), interactive=True,
                         answers={"tex": "none"})
    assert without.minutes < with_tex.minutes


def test_the_tex_finding_carries_the_engines_version(tmp_path, monkeypatch):
    """The bug report prints `Finding.version` for every tool, and the TeX
    finding never filled it, so a build that differed between two machines
    could not be explained from the report."""
    from nexttex.install import survey as module

    tex = tmp_path / "tex"
    tex.mkdir()
    (tex / "pdflatex").write_text("")
    monkeypatch.setattr(module, "TEX_HINTS", [tex])
    monkeypatch.setattr(
        module, "_version_at",
        lambda exe, *args: "pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)"
        if Path(exe).name == "pdflatex" else "",
    )
    result = survey("linux", tmp_path, which=which_none, check_network=False,
                    environ={"XDG_DATA_HOME": str(tmp_path / "state")})
    finding = result.get("tex")
    assert finding.kind == PRESENT
    assert finding.version == "pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)"


def test_a_tex_that_cannot_print_its_version_is_still_present(tmp_path, monkeypatch):
    from nexttex.install import survey as module

    tex = tmp_path / "tex"
    tex.mkdir()
    (tex / "pdflatex").write_text("")     # not executable: the probe fails
    monkeypatch.setattr(module, "TEX_HINTS", [tex])
    result = survey("linux", tmp_path, which=which_none, check_network=False,
                    environ={"XDG_DATA_HOME": str(tmp_path / "state")})
    assert result.get("tex").kind == PRESENT
    assert result.get("tex").version == ""


def test_two_texs_on_one_machine_are_reported_as_two(tmp_path):
    """One line of the bug report described a mismatched toolchain.

    It carried MiKTeX's version string beside TinyTeX's directory, which
    looked impossible and was not: MiKTeX's engine really was running
    against TinyTeX's package tree, because the directory comes from the
    hint list and the binary from PATH. A document whose body was one
    sentence took ninety-five seconds. The line says so now.
    """
    tiny = tmp_path / "TinyTeX" / "bin" / "windows"
    tiny.mkdir(parents=True)
    (tiny / "pdflatex.exe").write_text("", encoding="utf-8")
    other = tmp_path / "MiKTeX" / "bin"
    other.mkdir(parents=True)
    (other / "pdflatex.exe").write_text("", encoding="utf-8")

    from nexttex.install import survey as survey_module

    original = survey_module.TEX_HINTS
    survey_module.TEX_HINTS = [tiny]
    try:
        result = survey_module.survey(
            "windows", tmp_path,
            which=lambda name: str(other / "pdflatex.exe") if name == "pdflatex" else None,
            exists=lambda p: Path(p).exists(),
            check_network=False,
            environ={"XDG_DATA_HOME": str(tmp_path / "state")},
        )
    finally:
        survey_module.TEX_HINTS = original

    tex = next(f for f in result.findings if f.key == "tex")
    assert str(tiny) in tex.where
    assert "MiKTeX" in tex.why, f"the second TeX was not mentioned: {tex.why!r}"
    assert "different TeX" in tex.why


def test_one_tex_says_nothing_about_a_second(tmp_path):
    """The note is for the machine that has two, and nobody else."""
    tiny = tmp_path / "TinyTeX" / "bin" / "windows"
    tiny.mkdir(parents=True)
    (tiny / "pdflatex.exe").write_text("", encoding="utf-8")

    from nexttex.install import survey as survey_module

    original = survey_module.TEX_HINTS
    survey_module.TEX_HINTS = [tiny]
    try:
        result = survey_module.survey(
            "windows", tmp_path,
            which=lambda name: str(tiny / "pdflatex.exe") if name == "pdflatex" else None,
            exists=lambda p: Path(p).exists(),
            check_network=False,
            environ={"XDG_DATA_HOME": str(tmp_path / "state")},
        )
    finally:
        survey_module.TEX_HINTS = original

    tex = next(f for f in result.findings if f.key == "tex")
    assert tex.why == ""
