"""The plan, and the rule that stops it lying about its own defaults.

Two of the bugs this rework exists to fix were the same bug twice: a
displayed default and an assumed default written as two separate pieces of
code, which then drifted.  The boot question showed `[Y/n]` and assumed `n`,
and TinyTeX's unattended default was `y`, so `--yes` spent 200 MB without
ever saying it would.  Both are structurally impossible now, and the tests
that say so are the first two here.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nexttex.install.plan import DEFAULTS, build_plan  # noqa: E402
from nexttex.install.survey import survey  # noqa: E402

PLATFORMS = ["linux", "macos", "windows"]


def bare(platform, root, **kwargs):
    return survey(platform, root, which=lambda _n: None,
                  exists=lambda _p: False, check_network=False,
                  environ={"XDG_DATA_HOME": str(Path(root) / "state")}, **kwargs)


@pytest.mark.parametrize("platform", PLATFORMS)
def test_the_prompt_and_the_assumed_answer_are_one_value(platform, tmp_path):
    """The `[Y/n]`-shown-but-`n`-assumed bug, made unrepresentable.

    If anybody ever splits the rendered default from the decided one again,
    this fails on the same day rather than on somebody's fresh machine.
    """
    for interactive in (True, False):
        plan = build_plan(bare(platform, tmp_path), interactive=interactive)
        for item in plan.items:
            if item.fixed or not item.options:
                continue
            shown = item.prompt().splitlines()[item.default_index() - 1]
            assert "[default]" in shown, f"{item.key}: the marked line is not the default"
            assert item.option(item.default).label in shown
            assert item.decided == item.default


@pytest.mark.parametrize("platform", PLATFORMS)
def test_an_unattended_install_never_quietly_spends_two_hundred_megabytes(platform, tmp_path):
    """`--yes` used to download TinyTeX without saying so.

    A person who typed the command and read the size wants a typesetter; a
    CI job that passed `--yes` did not ask for 200 MB.  `--tex=tinytex` is
    the opt-in, and the plan prints either way.
    """
    plan = build_plan(bare(platform, tmp_path), interactive=False)
    assert plan.choice("tex") == "none"
    assert plan.megabytes < 200

    asked = build_plan(bare(platform, tmp_path), interactive=False,
                       answers={"tex": "tinytex"})
    assert asked.choice("tex") == "tinytex"
    assert asked.megabytes >= 200


@pytest.mark.parametrize("platform", PLATFORMS)
def test_a_person_at_the_keyboard_gets_a_working_typesetter(platform, tmp_path):
    result = bare(platform, tmp_path)
    # `bare` has no service manager at all, and a machine that cannot start
    # things at login is a different question from one that will not.
    result.service = {"windows": "windows", "macos": "launchd"}.get(platform, "systemd")
    plan = build_plan(result, interactive=True)
    assert plan.choice("tex") == "tinytex"
    assert plan.choice("service") == "yes"
    # And the price of the whole job is on the screen before the question.
    assert plan.megabytes >= 200
    assert plan.minutes >= 1


def test_the_two_defaults_that_differ_are_the_only_two_that_differ():
    differing = {key for key, (a, b) in DEFAULTS.items() if a != b}
    assert differing == {"tex", "service"}


@pytest.mark.parametrize("platform", PLATFORMS)
def test_no_agent_is_the_default_everywhere(platform, tmp_path):
    """Opt-in, as agreed: a large download for a feature the README calls
    optional in its own first sentence is not a yes-by-default question."""
    for interactive in (True, False):
        plan = build_plan(bare(platform, tmp_path), interactive=interactive)
        assert plan.choice("agent") == "none"
        assert plan.megabytes < 400


def test_a_machine_that_already_has_tex_is_not_offered_it_again(tmp_path):
    result = bare("linux", tmp_path)
    result.tex_dir = "/usr/bin"
    plan = build_plan(result, interactive=True)
    assert plan.item("tex").fixed
    assert plan.choice("tex") == "present"
    assert plan.megabytes < 200


def test_an_existing_tailnet_install_is_not_quietly_downgraded(tmp_path):
    """`bind` cannot be changed from inside the app, so re-running the
    installer to fix something else must not silently turn Tailscale off."""
    result = bare("linux", tmp_path)
    result.config = {"tailscale": True}
    result.tailscale = True
    plan = build_plan(result, interactive=True)
    listen = plan.item("bind")
    assert listen.default == "both"
    assert listen.current is True
    assert "(current)" in listen.summary


def test_windows_says_tailscale_is_not_available_rather_than_hiding_it(tmp_path):
    plan = build_plan(bare("windows", tmp_path), interactive=True)
    listen = plan.item("bind")
    assert listen.fixed, "the listening item vanished instead of explaining itself"
    assert "not available on Windows" in listen.fixed
    assert "certificate" in listen.fixed
    assert plan.choice("bind") == "localhost"


def test_windows_gets_the_instance_and_listen_items_the_others_get(tmp_path):
    """The divergence that existed only because there were two installers."""
    keys = [item.key for item in build_plan(bare("windows", tmp_path),
                                            interactive=True).items]
    assert keys == [item.key for item in build_plan(bare("linux", tmp_path),
                                                    interactive=True).items]


def test_a_flag_beats_the_default_and_an_unknown_value_does_not(tmp_path):
    plan = build_plan(bare("linux", tmp_path), interactive=True,
                      answers={"agent": "openai", "service": "no"})
    assert plan.choice("agent") == "openai"
    assert plan.choice("service") == "no"
    plan.set("agent", "banana")
    assert plan.choice("agent") == "openai"


def test_a_machine_with_nothing_to_do_says_so(tmp_path):
    result = bare("linux", tmp_path)
    result.tex_dir = "/usr/bin"
    result.claude = "/usr/bin/claude"
    result.venv_ready = True
    plan = build_plan(result, interactive=True, answers={"service": "no"})
    assert plan.item("python").fixed.startswith(".venv is here")
    assert plan.item("agent").fixed
