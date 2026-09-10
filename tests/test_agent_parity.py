"""One contract, four implementations, no Protocol to hold them together.

The agent is duck-typed: `ProjectSession` and the HTTP routes use a dozen
members, and four classes provide them -- the Claude one, the OpenAI one,
the scripted stand-in the browser tests drive, and the pair that stand in
for no agent at all.  Nothing in the language checks that they agree, and
the project has already paid for that twice: a constructor keyword added to
one of them turned every project open into a 500 for the other three, and a
guard added to the real agents was left out of the stand-in, so the browser
tests stopped covering it without anybody noticing.

These tests are that missing check.  They assert the shape, and then the
handful of promises the interface is actually built on -- above all that a
question always produces a `done`, because everything the panel does after
a question is keyed on one arriving.
"""

import asyncio
import inspect

import pytest

from nexttex.modes import MODES
from nexttex.providers import NoAgent, Unavailable
from nexttex.scripted_agent import ScriptedAgent

try:
    from nexttex.agent import ProjectAgent
except ImportError:                                  # no SDK on this machine
    ProjectAgent = None

from nexttex.openai_agent import OpenAIAgent


#: What ProjectSession and the routes call.  Adding to this list is how a
#: new member gets carried to every implementation instead of one.
CONTRACT = (
    "ask", "events", "disconnect", "interrupt", "reset", "current_why",
    "resolve_permission", "set_model",
)
#: Read, not called: `busy` and `idle_seconds` are properties everywhere.
ATTRIBUTES = ("model", "usage", "busy", "idle_seconds", "mode")


def build(kind, tmp_path):
    project = tmp_path / "project"
    state = project / ".nexttex"
    state.mkdir(parents=True, exist_ok=True)
    (project / "main.tex").write_text("x", encoding="utf-8")
    if kind is NoAgent:
        return NoAgent()
    if kind is Unavailable:
        return Unavailable("no sdk here")
    if kind is OpenAIAgent:
        return OpenAIAgent(project, state, api_key="")
    return kind(project, state)


KINDS = [NoAgent, Unavailable, ScriptedAgent, OpenAIAgent]
if ProjectAgent is not None:
    KINDS.append(ProjectAgent)

IDS = [k.__name__ for k in KINDS]


@pytest.mark.parametrize("kind", KINDS, ids=IDS)
def test_every_agent_has_the_whole_contract(kind, tmp_path):
    agent = build(kind, tmp_path)
    missing = [name for name in CONTRACT if not callable(getattr(agent, name, None))]
    assert not missing, f"{kind.__name__} is missing {missing}"
    absent = [name for name in ATTRIBUTES if not hasattr(agent, name)]
    assert not absent, f"{kind.__name__} is missing {absent}"


@pytest.mark.parametrize("kind", KINDS, ids=IDS)
def test_the_members_that_must_be_awaitable_are(kind, tmp_path):
    agent = build(kind, tmp_path)
    for name in ("ask", "disconnect", "interrupt", "reset", "set_model"):
        assert inspect.iscoroutinefunction(getattr(agent, name)), (
            f"{kind.__name__}.{name} is not awaitable"
        )


@pytest.mark.parametrize("kind", KINDS, ids=IDS)
def test_usage_carries_the_fields_the_footer_reads(kind, tmp_path):
    agent = build(kind, tmp_path)
    for field in ("turns", "costUsd", "inputTokens", "outputTokens", "model"):
        assert field in agent.usage, f"{kind.__name__}.usage has no {field}"


@pytest.mark.parametrize("kind", KINDS, ids=IDS)
def test_nothing_is_busy_before_it_is_asked_anything(kind, tmp_path):
    agent = build(kind, tmp_path)
    assert agent.busy is False
    assert agent.current_why() == ""
    assert agent.idle_seconds >= 0.0
    # Idle *seconds*, not the monotonic clock: NoAgent used to report the
    # machine's uptime, which reads as half a year of neglect.
    assert agent.idle_seconds < 60 * 60


@pytest.mark.parametrize("kind", KINDS, ids=IDS)
def test_stop_is_never_a_silent_no_op(kind, tmp_path):
    """Even with nothing running, the panel is told the turn is over.

    This is the state a turn that died without a `done` leaves behind, and
    Stop is the writer's one escape from it.
    """
    async def scenario():
        agent = build(kind, tmp_path)
        await agent.interrupt()
        return await asyncio.wait_for(agent._queue().get(), timeout=2)

    event = asyncio.run(scenario())
    assert event["type"] == "done", event


@pytest.mark.parametrize("kind", KINDS, ids=IDS)
def test_resolving_a_permission_nobody_asked_for_is_false_not_a_crash(kind, tmp_path):
    agent = build(kind, tmp_path)
    assert agent.resolve_permission("perm-nothing", "allow") is False


@pytest.mark.parametrize("kind", KINDS, ids=IDS)
def test_an_agent_with_nothing_running_can_be_reset(kind, tmp_path):
    async def scenario():
        agent = build(kind, tmp_path)
        await agent.reset()
        assert agent.busy is False

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "kind",
    [k for k in KINDS if k not in (NoAgent, Unavailable)],
    ids=[k.__name__ for k in KINDS if k not in (NoAgent, Unavailable)],
)
def test_a_second_question_while_one_is_running_is_refused(kind, tmp_path):
    """The route turns this into a 409 and the panel queues it.

    An agent that quietly accepted the second question would drop the
    first turn's task on the floor and leave its `done` unsent.
    """
    async def scenario():
        agent = build(kind, tmp_path)
        agent._turn = asyncio.create_task(asyncio.sleep(5))
        try:
            assert agent.busy is True
            with pytest.raises(RuntimeError):
                await agent.ask("and another thing")
        finally:
            agent._turn.cancel()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "kind",
    [k for k in KINDS if k not in (NoAgent, Unavailable)],
    ids=[k.__name__ for k in KINDS if k not in (NoAgent, Unavailable)],
)
def test_a_conversation_cannot_be_cleared_out_from_under_a_running_turn(kind, tmp_path):
    """The route answers 409 and the button is disabled, but this is the
    guard those two rest on: archiving the transcript while a turn is still
    writing into it leaves the record and the panel disagreeing."""
    async def scenario():
        agent = build(kind, tmp_path)
        agent._turn = asyncio.create_task(asyncio.sleep(5))
        try:
            with pytest.raises(RuntimeError):
                await agent.reset()
        finally:
            agent._turn.cancel()

    asyncio.run(scenario())


def test_no_implementation_offers_a_way_to_delegate():
    """One rule, checked against every tool list this app writes itself.

    The Claude agent's native tools come from the CLI, so `Agent` and
    `Task` are refused at the fence and removed through `disallowed_tools`,
    which `tests/test_permissions.py` asserts. The OpenAI agent's list is
    ours to write, so the way to keep it free of delegation is to say so
    here rather than to trust that nobody adds one. Every tool below runs
    in this process and shows up in the panel; a tool that farmed work out
    to a second conversation would not.
    """
    from nexttex.agent import ProjectAgent as _Claude  # noqa: F401  (import guarded above)
    from nexttex.openai_agent import TOOLS

    names = {tool["function"]["name"] for tool in TOOLS}
    assert names, "the OpenAI agent has no tools at all, which is a different bug"
    for banned in ("task", "agent", "subagent", "delegate", "spawn"):
        assert not [name for name in names if banned in name.lower()], names


@pytest.mark.parametrize("kind", KINDS, ids=[k.__name__ for k in KINDS])
def test_every_agent_can_say_where_its_permission_control_is(kind, tmp_path):
    """A route reads this on every agent, so every agent has to answer.

    `set_mode` is deliberately *not* on all four: only the Claude agent
    ever puts a card up, and the interface decides whether to draw the
    control by asking whether that method exists. So the probe and the
    method have to agree, and the way to keep them agreeing is to say it
    here rather than to trust that they do.
    """
    agent = build(kind, tmp_path)
    assert agent.mode in MODES
    if callable(getattr(agent, "set_mode", None)):
        agent.set_mode("project")
        assert agent.mode == "project"
        with pytest.raises(ValueError):
            agent.set_mode("nonsense")
    else:
        # Nothing to move, so it stays where it is rather than pretending.
        assert agent.mode == "ask"


def test_the_browser_s_copy_of_first_changed_line_has_the_same_answers():
    """One answer, two implementations, in two languages.

    Python has one copy, in `nexttex/lines.py`, shared by the fence, the
    stand-in and the OpenAI agent. The browser has the other, in
    `frontend/src/store.ts`, because the editor needs it without a round
    trip and it cannot import Python. Nothing in either language would
    notice them drifting, so these are the cases both are held to, and
    `frontend/src/store.test.ts` carries the same list with a comment
    naming this test.
    """
    from nexttex.lines import first_changed_line

    cases = [
        ("a\nb\nc", "a\nb\nc", 1),
        ("a\nb", "A\nb", 1),
        ("a\nb\nc", "a\nB\nc", 2),
        ("a\nb", "a\nb\nc", 3),
        ("a\nb\nc", "a\nc", 2),
        ("", "the first sentence", 1),
    ]
    for before, after, line in cases:
        assert first_changed_line(before, after) == line, (before, after)
