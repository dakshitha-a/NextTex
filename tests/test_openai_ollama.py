"""The OpenAI provider against a real local server: the Ollama on this
machine.

    NEXTTEX_OLLAMA=1 .venv/bin/python -m pytest tests/test_openai_ollama.py -q

Everything the provider does above the transport is covered with a
stubbed transport in `tests/test_openai_agent.py`; what that cannot say is
whether a real server still returns the shapes the stub replays.  This
asks one.  `NEXTTEX_OLLAMA` is the base URL, or `1` for Ollama's default
on this machine, and `NEXTTEX_OLLAMA_MODEL` names the model, a
tool-calling one: the default is `qwen3-coder:30b`, which answers a tool
prompt in seconds once loaded; `qwen3:14b` thinks first and takes a
minute.  Not `NEXTTEX_LIVE`, which is reserved for a test that needs an
account or the network; this is a local socket and costs nothing but a
model load.

Two turns: a small edit, which is the provider's ordinary day, and a
figure, which is the permission card in front of a real model's script.
"""

import asyncio
import os
import shutil
from pathlib import Path

import pytest

BASE = os.environ.get("NEXTTEX_OLLAMA", "")
if BASE == "1":
    BASE = "http://localhost:11434/v1"
MODEL = os.environ.get("NEXTTEX_OLLAMA_MODEL", "qwen3-coder:30b")

pytestmark = pytest.mark.skipif(
    not BASE, reason="needs a local model; set NEXTTEX_OLLAMA=1 to run against Ollama",
)

from nexttex.openai_agent import OpenAIAgent  # noqa: E402

TEMPLATE = Path(__file__).resolve().parent.parent / "nexttex" / "templates" / "basic"

#: Measured on 19 September 2026 on this machine: qwen3-coder:30b took
#: 3 to 12 s a turn once loaded, qwen3:14b 43 to 69 s because it thinks
#: before it answers, and a cold load of either adds about a minute.
TURN_SECONDS = 240


def make(tmp_path: Path) -> OpenAIAgent:
    root = tmp_path / "project"
    shutil.copytree(TEMPLATE, root)
    return OpenAIAgent(root, tmp_path / "state", api_key="", base_url=BASE, model=MODEL)


async def turn(agent: OpenAIAgent, prompt: str, answer: str = "allow") -> list[dict]:
    seen: list[dict] = []

    async def drain() -> None:
        async for event in agent.events():
            seen.append(event)
            if event["type"] == "permission" and "decision" not in event:
                agent.resolve_permission(event["id"], answer)
            if event["type"] == "done":
                return

    reader = asyncio.create_task(drain())
    await agent.ask(prompt)
    await asyncio.wait_for(reader, timeout=TURN_SECONDS)
    return seen


def test_a_small_edit_lands_on_disk(tmp_path):
    agent = make(tmp_path)
    seen = asyncio.run(turn(
        agent,
        "In main.tex, change the title inside \\title{...} to exactly "
        "'Ollama was here' using edit_file. Do nothing else and do not "
        "explain; just make the edit.",
    ))
    kinds = [event["type"] for event in seen]
    assert kinds[0] == "turn_start" and kinds[-1] == "done"
    done = seen[-1]
    assert done["subtype"] == "success", [e for e in seen if e["type"] == "error"]
    # A real server answers the usage chunk `_stream_once` asks for.
    assert done["usage"]["inputTokens"] > 0 and done["usage"]["turns"] == 1
    assert "Ollama was here" in (agent.root / "main.tex").read_text(encoding="utf-8")
    assert any(e["type"] == "edit" for e in seen)


def test_a_figure_is_asked_about_and_drawn(tmp_path):
    pytest.importorskip("matplotlib")
    agent = make(tmp_path)
    seen = asyncio.run(turn(
        agent,
        "Draw a figure of y = x squared for x from 0 to 10 with matplotlib, "
        "using run_plot_script with the name 'square'. Save it with the "
        "figure helper if one is seeded, otherwise call plt.show(). Do not "
        "edit any .tex file.",
    ))
    cards = [e for e in seen if e["type"] == "permission"]
    assert cards, [e["type"] for e in seen]
    assert cards[0]["headline"] == "Run a script to draw a figure"
    assert cards[0]["rule"].startswith("mcp__nexttex__run_plot_script:")
    assert "decision" not in cards[0], "the first card is asked, not settled"
    assert seen[-1]["subtype"] == "success", [e for e in seen if e["type"] == "error"]
    assert (agent.root / "scripts" / "square.py").is_file()
    tool_done = [e for e in seen if e["type"] == "tool_done" and e["name"] == "run_plot_script"]
    assert tool_done and tool_done[0]["ok"] is True
