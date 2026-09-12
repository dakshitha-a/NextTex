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

#: Named rather than inherited.  The message shapes this file asserts can
#: differ by model, so a run that does not say which model it charged has
#: not recorded the thing that makes its answer mean anything.
LIVE_MODEL = "claude-sonnet-5"


@pytest.fixture(autouse=True)
def the_real_cli(monkeypatch):
    """Undo, for this file only, the guard that sends the suite elsewhere.

    `tests/conftest.py` points NEXTTEX_CLAUDE_BINARY at `fake_claude.py` at
    import time, for every test, and that is right: before it, a same-origin
    case posted to `/api/claude/logout` and every full run signed the
    developer out of Claude Code.

    It also silently disabled this file, which exists to do the opposite,
    and the way it failed was the cruellest possible: the stand-in prints
    `unknown command:` and exits 2, the SDK turns that into a ProcessError,
    and the assertion below reports that the SDK no longer emits `text` --
    which is the exact upstream change this file is run before a release to
    catch.  For three days it said the SDK had changed when nothing had.

    Per test, after the conftest has imported, and only here.  The guard
    stays in force for the other 1284.
    """
    real = shutil.which("claude")
    if not real:
        pytest.skip("no claude on PATH")
    monkeypatch.setenv("NEXTTEX_CLAUDE_BINARY", real)


def live_session(root: Path, model: str = LIVE_MODEL):
    """A session on a fresh copy of the template, with the real agent.

    The guard matters: with NEXTTEX_SCRIPTED_AGENT set in the environment
    -- which it is for every other tier -- this would quietly test the
    stand-in against itself and prove nothing at all.

    The fence is left where a writer who has answered once actually has it,
    the middle position, so the project's own editing tools do not each
    stop for a card.  Everything outside the project still asks, and
    `collect` answers those with no.
    """
    from nexttex.project import Project
    from server.session import ProjectSession

    shutil.copytree(TEMPLATE, root)
    session = ProjectSession(Project.open(root), model=model)
    assert type(session.agent).__name__ == "ProjectAgent", (
        "a scripted stand-in was selected; unset NEXTTEX_SCRIPTED_AGENT"
    )
    session.agent.set_mode("project")
    return session


async def collect(session, timeout: float = 180.0) -> tuple[list[dict], list[dict]]:
    """Everything the agent emits, up to and including the turn's `done`.

    Cards are answered with no, and recorded.  A test that drives a real
    model cannot also decide which tools it will reach for: the second test
    here asks for an edit and the model quite reasonably runs `grep` first,
    so a harness with no answer for a card waits out the whole timeout and
    reports it as the SDK having gone quiet.  Denying rather than allowing,
    because a live model on somebody's real account must never be handed a
    blanket yes by a test.
    """
    seen: list[dict] = []
    refused: list[dict] = []

    async def drain() -> None:
        async for event in session.agent.events():
            seen.append(event)
            if event.get("type") == "permission":
                refused.append(event)
                session.agent.resolve_permission(event["id"], "deny")
            if event.get("type") == "done":
                return

    await asyncio.wait_for(drain(), timeout=timeout)
    return seen, refused


def test_a_real_turn_still_speaks_the_vocabulary_the_app_reads(tmp_path):
    session = live_session(tmp_path / "project")

    async def run():
        await session.agent.ask(
            "Reply with the single word ACKNOWLEDGED and nothing else. "
            "Do not read or write any file."
        )
        return await collect(session)

    seen, _refused = asyncio.run(run())
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
    # Which model was charged, said out loud. `_note_usage` writes this
    # field on every turn, so a default rather than a miss would be a
    # failure here and not a shrug.
    assert usage.get("model") == LIVE_MODEL, (
        f"this turn ran on {usage.get('model')!r}, not on the model this file names"
    )


def test_a_real_edit_arrives_as_an_edit_event(tmp_path):
    """The chip, its diff and its undo are all built from this one event."""
    session = live_session(tmp_path / "project")

    async def run():
        await session.agent.ask(
            "In main.tex, change the title from 'A Working Title' to "
            "'A Live Test'. Change nothing else and do not explain. "
            "Use your editing tools; do not run shell commands."
        )
        return await collect(session)

    seen, refused = asyncio.run(run())
    edits = [event for event in seen if event["type"] == "edit"]
    assert edits, (
        f"no edit event; saw {sorted({e['type'] for e in seen})}"
        + (f"; refused {[c['tool'] for c in refused]}" if refused else "")
    )
    assert {"path", "before", "after"} <= set(edits[0])
    assert "A Live Test" in (tmp_path / "project" / "main.tex").read_text(
        encoding="utf-8"
    )
