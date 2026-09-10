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
    assert "poppler-windows" in bare("windows", tmp_path).get("pdftotext").command


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
                         "chktex", "texcount", "pdftotext", "tailscale",
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
