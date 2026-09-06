"""The one test a stand-in cannot replace.

`nexttex/scripted_agent.py` lets every part of the agent interface be
driven without a model: streamed prose, edit chips, permission cards, the
follow-up queue, usage.  What it cannot tell you is whether the real SDK
still emits the message shapes those scripts assume.  A rename upstream --
`text_end` becoming something else, `usage` losing a field the footer reads
-- would leave 250 green tests and an app that shows nothing.

So this drives the real `ProjectAgent` against a real account and asserts
the vocabulary, not the answer.  It costs money and needs somebody signed
in, which is why it is opt-in:

    NEXTTEX_LIVE=1 .venv/bin/python -m pytest tests/test_live_agent.py -q

Run it before a release, and after any Agent SDK upgrade.
"""

import asyncio
import os
import shutil
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("NEXTTEX_LIVE") != "1",
    reason="needs a real Claude account; set NEXTTEX_LIVE=1 to run",
)

TEMPLATE = Path(__file__).resolve().parent.parent / "nexttex" / "templates" / "basic"

# What the browser reads.  Every one of these is consumed somewhere in
# frontend/src/store.ts, so losing one is a silent blank in the interface.
TURN_EVENTS = {"turn_start", "text", "text_end", "done"}
USAGE_FIELDS = {"turns", "costUsd", "inputTokens", "outputTokens", "durationMs"}


def live_session(root: Path):
    """A session on a fresh copy of the template, with the real agent.

    The guard matters: with NEXTTEX_SCRIPTED_AGENT set in the environment
    -- which it is for every other tier -- this would quietly test the
    stand-in against itself and prove nothing at all.
    """
    from nexttex.project import Project
    from server.session import ProjectSession

    shutil.copytree(TEMPLATE, root)
    session = ProjectSession(Project.open(root))
    assert type(session.agent).__name__ == "ProjectAgent", (
        "a scripted stand-in was selected; unset NEXTTEX_SCRIPTED_AGENT"
    )
    return session


async def collect(session, timeout: float = 180.0) -> list[dict]:
    """Everything the agent emits, up to and including the turn's `done`."""
    seen: list[dict] = []

    async def drain() -> None:
        async for event in session.agent.events():
            seen.append(event)
            if event.get("type") == "done":
                return

    await asyncio.wait_for(drain(), timeout=timeout)
    return seen


def test_a_real_turn_still_speaks_the_vocabulary_the_app_reads(tmp_path):
    session = live_session(tmp_path / "project")

    async def run() -> list[dict]:
        await session.agent.ask(
            "Reply with the single word ACKNOWLEDGED and nothing else. "
            "Do not read or write any file."
        )
        return await collect(session)

    seen = asyncio.run(run())
    kinds = {event["type"] for event in seen}
    missing = TURN_EVENTS - kinds
    assert not missing, f"the SDK no longer emits {sorted(missing)}; saw {sorted(kinds)}"

    done = seen[-1]
    assert done["subtype"] in {"success", "error_max_turns", "error_during_execution"}
    usage = done.get("usage") or {}
    assert USAGE_FIELDS <= set(usage), (
        f"usage lost {sorted(USAGE_FIELDS - set(usage))}, which the footer reads"
    )
    assert "".join(e.get("text", "") for e in seen if e["type"] == "text").strip()


def test_a_real_edit_arrives_as_an_edit_event(tmp_path):
    """The chip, its diff and its undo are all built from this one event."""
    session = live_session(tmp_path / "project")

    async def run() -> list[dict]:
        await session.agent.ask(
            "In main.tex, change the title from 'A Working Title' to "
            "'A Live Test'. Change nothing else and do not explain."
        )
        return await collect(session)

    seen = asyncio.run(run())
    edits = [event for event in seen if event["type"] == "edit"]
    assert edits, f"no edit event; saw {sorted({e['type'] for e in seen})}"
    assert {"path", "before", "after"} <= set(edits[0])
    assert "A Live Test" in (tmp_path / "project" / "main.tex").read_text(
        encoding="utf-8"
    )
