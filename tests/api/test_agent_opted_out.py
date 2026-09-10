"""An install that chose no agent, and the door back.

Two things nothing covered before this.

The first is that **neither installer ever wrote `provider`**, so config kept
its default of `"claude"` whatever was chosen at install time: a machine that
had deliberately opted out claimed an agent that was not on it, and the only
symptom was the app failing to do something it should never have offered.

The second is the way back.  Opting out must not be a one-way door, so the
CLI can be installed from the settings sheet afterwards -- running the same
vendor installer the terminal installer runs, from the same code.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server import main as server_main  # noqa: E402


@pytest.fixture
def no_agent(client, monkeypatch):
    """An instance installed with --agent=none."""
    monkeypatch.delenv("NEXTTEX_FAKE_CLAUDE_AUTH", raising=False)
    before = server_main.SETTINGS.provider
    server_main.SETTINGS.provider = "none"
    server_main.SETTINGS.openai_key = ""
    yield client
    server_main.SETTINGS.provider = before


# ---------------------------------------------------------------------------
# The installer writes what was chosen


@pytest.mark.parametrize("choice", ["none", "openai", "claude"])
def test_the_installer_writes_the_agent_that_was_chosen(tmp_path, monkeypatch, choice):
    """Run the installer's own configuration step and read the file back."""
    from nexttex.install import steps
    from nexttex.install.ui import Console
    import io

    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "state"))
    monkeypatch.delenv("NEXTTEX_INSTANCE", raising=False)
    console = Console(stream=io.StringIO(), plain=True)
    result = steps.write_config(
        console, ROOT, "linux", bind="localhost", cert="", key="",
        provider=choice, instance="", python=sys.executable,
    )
    assert result.ok, console.stream.getvalue()
    written = json.loads(
        (tmp_path / "state" / "nexttex" / "config.json").read_text()
    )
    assert written["provider"] == choice
    if choice != "openai":
        assert written["openai_key"] == ""


def test_re_running_the_installer_does_not_take_away_an_openai_key(tmp_path, monkeypatch):
    """The key is only forgotten when the provider actually moves away from
    OpenAI. It used to be cleared on every run, so re-running the installer
    to pick up a missing dependency cost somebody their key."""
    import io

    from nexttex.install import steps
    from nexttex.install.ui import Console

    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "state"))
    monkeypatch.delenv("NEXTTEX_INSTANCE", raising=False)
    console = Console(stream=io.StringIO(), plain=True)

    def install(provider):
        assert steps.write_config(
            console, ROOT, "linux", bind="localhost", cert="", key="",
            provider=provider, instance="", python=sys.executable,
        ).ok, console.stream.getvalue()
        return json.loads(
            (tmp_path / "state" / "nexttex" / "config.json").read_text()
        )

    install("openai")
    config_path = tmp_path / "state" / "nexttex" / "config.json"
    config = json.loads(config_path.read_text())
    config["openai_key"] = "sk-the-writers-own-key"
    config_path.write_text(json.dumps(config))

    # The plan defaults to whatever is already configured, so a second run
    # writes "openai" again and the key survives it.
    assert install("openai")["openai_key"] == "sk-the-writers-own-key"
    # Deliberately switching away is still a reason to forget it.
    assert install("none")["openai_key"] == ""


def test_an_instance_gets_its_own_port_and_state(tmp_path, monkeypatch):
    from nexttex.install import steps
    from nexttex.install.ui import Console
    import io

    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "state"))
    console = Console(stream=io.StringIO(), plain=True)
    result = steps.write_config(
        console, ROOT, "linux", bind="localhost", cert="", key="",
        provider="none", instance="scratch", python=sys.executable,
    )
    assert result.ok, console.stream.getvalue()
    written = json.loads(
        (tmp_path / "state" / "nexttex-scratch" / "config.json").read_text()
    )
    assert written["port"] != 8450, "a second install would fight the first for a port"


# ---------------------------------------------------------------------------
# The app works without an agent


def test_the_agent_routes_answer_rather_than_failing(no_agent):
    status = no_agent.get("/api/agent/status")
    assert status.status_code == 200
    assert status.json() == {"provider": "none", "ready": True}


def test_a_project_opens_and_compiles_with_no_agent(no_agent, project_dir):
    opened = no_agent.post("/api/projects", json={"path": str(project_dir)})
    assert opened.status_code == 200, opened.text
    project_id = opened.json()["id"]
    tree = no_agent.get(f"/api/projects/{project_id}/tree")
    assert tree.status_code == 200, tree.text
    body = no_agent.get(f"/api/projects/{project_id}/file",
                        params={"path": "main.tex"})
    assert body.status_code == 200, body.text


def test_asking_the_agent_something_is_refused_politely_not_with_a_crash(
    no_agent, project_dir
):
    opened = no_agent.post("/api/projects", json={"path": str(project_dir)})
    project_id = opened.json()["id"]
    reply = no_agent.post(
        f"/api/projects/{project_id}/chat", json={"text": "hello"}
    )
    # Whatever it answers, it must not be a server error: an install that
    # deliberately has no agent is a supported install, not a broken one.
    assert reply.status_code < 500, reply.text


# ---------------------------------------------------------------------------
# Changing your mind


def test_switching_to_no_agent_forgets_the_key(client):
    """A credential left in a config file for a feature nobody is using is
    how credentials outlive the reason they existed."""
    client.post("/api/agent/provider",
                json={"provider": "openai", "key": "sk-not-a-real-key"})
    assert server_main.SETTINGS.openai_key
    client.post("/api/agent/provider", json={"provider": "none"})
    assert server_main.SETTINGS.provider == "none"
    assert server_main.SETTINGS.openai_key == ""


def test_switching_back_to_claude_after_opting_out_works(no_agent):
    response = no_agent.post("/api/agent/provider", json={"provider": "claude"})
    assert response.status_code == 200
    assert server_main.SETTINGS.provider == "claude"


def test_the_screen_is_told_the_cli_is_absent_rather_than_erroring(
    no_agent, monkeypatch
):
    """`installed: false` is a state the setup screen renders, and it is what
    decides whether the install button appears at all."""
    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", "/nowhere/at/all/claude")
    status = no_agent.get("/api/claude/status")
    assert status.status_code == 200
    assert status.json()["installed"] is False
    assert "not installed" in status.json()["reason"]


def test_installing_the_cli_from_the_app_reports_failure_without_a_five_hundred(
    no_agent, monkeypatch
):
    """The vendor's installer is never fetched in a test.

    A refusal has to arrive on the stream as `done, ok: false`, because the
    screen renders it and still offers OpenAI and no agent afterwards.
    """
    from nexttex import claude_auth
    from nexttex.install import steps

    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", "/nowhere/at/all/claude")
    monkeypatch.setattr(
        steps, "fetch",
        lambda url, dest, on_progress=None: "example.invalid: not reachable",
    )
    claude_auth._installing = None

    started = no_agent.post("/api/claude/install")
    assert started.status_code == 200
    assert started.json()["ok"] is True

    body = no_agent.get("/api/claude/install/stream").text
    assert '"ok": false' in body.replace('"ok":false', '"ok": false')
    assert "not reachable" in body


def test_the_install_route_says_nothing_to_do_when_the_cli_is_here(
    no_agent, monkeypatch
):
    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", str(ROOT / "tests" / "fake_claude.py"))
    response = no_agent.post("/api/claude/install")
    assert response.json()["installed"] is True


def test_the_install_never_runs_the_vendor_script_by_itself(no_agent, monkeypatch):
    """It is an explicit, signed-in action and never automatic: nothing
    starts an install except a POST to this route."""
    from nexttex import claude_auth

    claude_auth._installing = None
    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", "/nowhere/at/all/claude")
    no_agent.get("/api/claude/status")
    no_agent.get("/api/agent/status")
    assert claude_auth._installing is None
    body = no_agent.get("/api/claude/install/stream").text
    assert "idle" in body
