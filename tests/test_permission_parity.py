"""One script, one card, whichever provider proposed it.

The browser and the replay do not know which provider put a card up and
must not be able to tell: the same script draws the same card on the
Claude agent and on the OpenAI one, a no reaches neither's runner, and an
"always" given under one holds under the other, because the rule names
the code the writer approved and not the model.
"""

import asyncio
import json
import shutil
from pathlib import Path

import pytest

from nexttex.openai_agent import OpenAIAgent

try:
    from nexttex.agent import ProjectAgent
except ImportError:                                  # no SDK on this machine
    ProjectAgent = None

pytestmark = pytest.mark.skipif(ProjectAgent is None, reason="no SDK here")

TEMPLATE = Path(__file__).resolve().parent.parent / "nexttex" / "templates" / "basic"
SCRIPT = "import matplotlib.pyplot as plt\nplt.plot([1, 2])\nplt.show()\n"


def project(tmp_path: Path) -> tuple[Path, Path]:
    root = tmp_path / "project"
    if not root.exists():
        shutil.copytree(TEMPLATE, root)
    return root, tmp_path / "state"


def claude_card(root: Path, state: Path) -> dict:
    agent = ProjectAgent(root, state)
    return {
        "card": agent.describe("mcp__nexttex__run_plot_script", {"name": "fig", "script": SCRIPT}),
        "rule": agent._rule_for("mcp__nexttex__run_plot_script", {"name": "fig", "script": SCRIPT}),
        "agent": agent,
    }


def openai_card(root: Path, state: Path) -> dict:
    agent = OpenAIAgent(root, state, api_key="k")
    return {
        "card": agent.describe("run_plot_script", {"name": "fig", "script": SCRIPT}),
        "rule": agent._rule_for("run_plot_script", {"name": "fig", "script": SCRIPT}),
        "agent": agent,
    }


def test_the_same_script_draws_the_same_card_with_the_same_rule(tmp_path):
    root, state = project(tmp_path)
    one, two = claude_card(root, state), openai_card(root, state)
    assert one["card"] == two["card"]
    assert one["rule"] == two["rule"]
    assert one["rule"].startswith("mcp__nexttex__run_plot_script:")


@pytest.mark.parametrize("mode", ["ask", "project", "all"])
def test_both_providers_read_the_same_position(tmp_path, mode):
    root, state = project(tmp_path)
    OpenAIAgent(root, state, api_key="k").set_mode(mode)
    assert ProjectAgent(root, state).mode == mode
    ProjectAgent(root, state).set_mode("ask")
    assert OpenAIAgent(root, state, api_key="k").mode == "ask"


def test_an_always_given_under_one_provider_holds_under_the_other(tmp_path):
    root, state = project(tmp_path)
    given = openai_card(root, state)

    async def answer_always() -> None:
        agent = given["agent"]
        events: list[dict] = []

        async def drain() -> None:
            async for event in agent.events():
                events.append(event)
                if event["type"] == "permission" and "decision" not in event:
                    agent.resolve_permission(event["id"], "always")
                    return

        reader = asyncio.create_task(drain())
        decision = await agent._permitted("run_plot_script", {"name": "fig", "script": SCRIPT}, "c1")
        await reader
        assert decision is True

    asyncio.run(answer_always())
    stored = json.loads((state / "agent-settings.json").read_text())
    assert stored["allow"] == [given["rule"]]

    claude = ProjectAgent(root, state)
    assert claude.already_answered(
        "mcp__nexttex__run_plot_script", {"name": "fig", "script": SCRIPT},
    ) == "always"
    # And not for a different script, which is the whole point of the digest.
    assert claude.already_answered(
        "mcp__nexttex__run_plot_script", {"name": "fig", "script": SCRIPT + "x = 1\n"},
    ) == ""

    # The other way round: an "always" the Claude agent wrote is read here.
    claude._always_allow.add("install:numpy")
    claude._save_settings()
    assert OpenAIAgent(root, state, api_key="k").already_answered(
        "install_package", {"name": "numpy"},
    ) == "always"
