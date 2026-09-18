"""A turn always ends, and always says how.

Everything the chat panel does after a question is keyed on a `done` event
arriving.  A turn that stops without one leaves the server idle and the
browser thinking for ever: the composer stays disabled, the queued
follow-up never drains, and Stop is a no-op because there is no longer a
turn to interrupt.  Only a page reload recovers it.

That is not hypothetical.  It happened on the dissertation, from changing
the model in the dropdown thirteen seconds into a running answer: the
model change disconnected the client, the SDK closed its transport
*cleanly*, `receive_response()` ended without raising, and `_stream` fell
off the end of its `async for` having emitted nothing.  No exception, no
log line, no event.

These tests break the turn on purpose, one shape at a time.  They drive the
real `ProjectAgent` against a stub client rather than the scripted agent,
because the scripted agent has no SDK client at all -- a test that changed
the model on *it* would prove nothing, since its `disconnect()` ends its
stream cleanly with a result.
"""

from __future__ import annotations

import asyncio
import time

from nexttex import agent as agent_module
from nexttex.agent import ProjectAgent


class StubClient:
    """The SDK client, reduced to what `_stream` touches.

    `messages` is what `receive_response()` yields.  An empty list is the
    incident: a stream that ends without a ResultMessage.
    """

    def __init__(self, messages=(), raises: Exception | None = None):
        self.messages = list(messages)
        self.raises = raises
        self.queries: list[str] = []
        self.disconnected = False
        self.interrupted = False

    async def query(self, prompt: str) -> None:
        self.queries.append(prompt)

    async def receive_response(self):
        if self.raises is not None:
            raise self.raises
        for message in self.messages:
            yield message

    async def disconnect(self) -> None:
        self.disconnected = True

    async def interrupt(self) -> None:
        self.interrupted = True


def make_agent(tmp_path) -> ProjectAgent:
    state = tmp_path / "state"
    state.mkdir(parents=True, exist_ok=True)
    return ProjectAgent(tmp_path, state)


async def drain(subject: ProjectAgent, until: str = "done", timeout: float = 5.0):
    """Every event up to and including the first `until`."""
    seen: list[dict] = []

    async def collect():
        async for event in subject.events():
            seen.append(event)
            if event.get("type") == until:
                return

    await asyncio.wait_for(collect(), timeout)
    return seen


def test_a_stream_that_ends_with_no_result_still_ends_the_turn(tmp_path):
    """The incident, exactly: the loop finishes having emitted nothing."""
    subject = make_agent(tmp_path)
    subject._client = StubClient(messages=[])

    async def run():
        await subject.ask("does this end?")
        return await drain(subject)

    events = asyncio.run(run())
    kinds = [event["type"] for event in events]
    assert kinds.count("done") == 1, kinds
    assert events[-1]["subtype"] == "no_result"
    # And it says why, rather than ending in silence -- the writer is owed
    # an explanation for an answer that stopped mid-sentence.
    assert "error" in kinds, kinds
    assert not subject.busy


def test_a_turn_that_raises_still_ends(tmp_path):
    subject = make_agent(tmp_path)
    subject._client = StubClient(raises=RuntimeError("the transport went away"))

    async def run():
        await subject.ask("and this?")
        return await drain(subject)

    events = asyncio.run(run())
    assert events[-1]["type"] == "done"
    assert events[-1]["subtype"] == "error"
    assert "the transport went away" in "".join(
        event.get("message", "") for event in events
    )


def test_changing_the_model_mid_turn_does_not_kill_it(tmp_path):
    """The trigger.

    Deferred rather than refused: the writer's intent is kept, and it takes
    effect at the one moment where it cannot break anything.
    """
    subject = make_agent(tmp_path)
    client = StubClient(messages=[])
    subject._client = client

    started = asyncio.Event()

    async def slow_stream():
        started.set()
        await asyncio.sleep(0.2)
        return
        yield  # pragma: no cover -- this is what makes it a generator

    client.receive_response = slow_stream

    async def run():
        await subject.ask("a long answer")
        await asyncio.wait_for(started.wait(), 2)
        await subject.set_model("claude-sonnet-5")
        # Nothing was torn down: the running turn still holds its client,
        # and the model it was started with has not changed under it.
        assert not client.disconnected
        assert subject.model is None
        return await drain(subject)

    events = asyncio.run(run())
    assert events[-1]["type"] == "done"
    # And the change was not lost.
    assert subject.model == "claude-sonnet-5"


def test_stop_is_never_a_no_op(tmp_path):
    """Stop is the writer's one escape hatch.

    With no turn running -- which is the state a vanished turn leaves
    behind -- `interrupt()` used to do nothing at all, so the interface went
    on waiting after the user had explicitly asked it not to.
    """
    subject = make_agent(tmp_path)
    assert not subject.busy

    async def run():
        await subject.interrupt()
        return await drain(subject)

    assert asyncio.run(run())[-1] == {"type": "done", "subtype": "interrupted"}


def test_a_permission_nobody_answers_is_denied(tmp_path, monkeypatch):
    """A card that never reached a browser blocked the turn for ever, and
    held the project's agent lock while it did."""
    monkeypatch.setattr(agent_module, "PERMISSION_TIMEOUT", 0.05)
    subject = make_agent(tmp_path)

    decision = asyncio.run(subject._ask_user("Bash", {"command": "rm -rf /"}))

    assert decision == "deny"
    # And it says so, rather than letting the agent report a refusal the
    # writer never made.
    events = []
    while not subject._queue().empty():
        events.append(subject._queue().get_nowait())
    assert any(event["type"] == "notice" for event in events), events
    assert not subject._pending


def test_stopping_while_a_card_is_up_ends_the_turn_rather_than_one_call(tmp_path):
    """The card the writer is looking at is the one they press Stop on.

    Refusing only that call and letting the agent carry on would answer a
    question they did not ask: they stopped the turn, not the command.  So
    the hook denies *and* tells the SDK not to continue.
    """
    subject = make_agent(tmp_path)

    async def run():
        hook = asyncio.ensure_future(
            subject._pre_tool(
                {"tool_name": "Bash", "tool_input": {"command": "sleep 60"}},
                None,
                None,
            )
        )
        card = await asyncio.wait_for(subject._queue().get(), timeout=2)
        assert card["type"] == "permission", card
        await subject.interrupt()
        return await asyncio.wait_for(hook, timeout=2)

    result = asyncio.run(run())
    output = result["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    # Not just this call: the whole turn.
    assert result.get("continue_") is False
    assert result.get("stopReason")
    assert not subject._pending


def test_a_card_left_open_is_forgotten_when_the_turn_is_stopped(tmp_path):
    """A pending future nothing will ever resolve is a wedged turn waiting
    to happen: the next card would find a stale entry under its own id."""
    subject = make_agent(tmp_path)

    async def run():
        hook = asyncio.ensure_future(
            subject._pre_tool(
                {"tool_name": "Bash", "tool_input": {"command": "sleep 60"}},
                None,
                None,
            )
        )
        await asyncio.wait_for(subject._queue().get(), timeout=2)
        assert subject._pending
        await subject.interrupt()
        await asyncio.wait_for(hook, timeout=2)

    asyncio.run(run())
    assert subject._pending == {}


def test_answering_a_card_twice_is_refused_the_second_time(tmp_path):
    """Two tabs can both be showing the same card.

    The second answer must not land on a future that already has a result,
    and the route reads this to tell the second tab the decision was
    already made rather than throwing.
    """
    subject = make_agent(tmp_path)

    async def run():
        hook = asyncio.ensure_future(
            subject._pre_tool(
                {"tool_name": "Bash", "tool_input": {"command": "ls"}}, None, None
            )
        )
        card = await asyncio.wait_for(subject._queue().get(), timeout=2)
        first = subject.resolve_permission(card["id"], "allow")
        second = subject.resolve_permission(card["id"], "deny")
        await asyncio.wait_for(hook, timeout=2)
        return first, second

    first, second = asyncio.run(run())
    assert first is True
    assert second is False

def test_a_long_running_command_is_not_mistaken_for_a_dead_turn(tmp_path, monkeypatch):
    """The turn watchdog measures silence, and a tool emits nothing while it runs.

    In auto mode the approval goes out before the command starts, so a build
    that took longer than the silence timeout was ended with "the agent
    stopped responding", which is a false statement about a machine that is
    working.  A thesis with biber is twenty seconds here, but a first run
    that installs packages is bounded by nothing this app knows.
    """
    from nexttex import agent as agent_module

    fence = ProjectAgent(tmp_path, tmp_path / ".nexttex")
    monkeypatch.setattr(agent_module, "WATCHDOG_INTERVAL", 0.01)
    monkeypatch.setattr(agent_module, "TURN_SILENCE_TIMEOUT", 0.02)
    monkeypatch.setattr(agent_module, "TOOL_RUNNING_TIMEOUT", 30.0)

    async def scenario():
        async def turn():
            await asyncio.sleep(5)

        fence._turn = asyncio.create_task(turn())
        fence.set_mode("project")
        await fence._pre_tool(
            {"tool_name": "Bash", "tool_input": {"command": "latexmk"}}, "call-1", None
        )
        assert "call-1" in fence._running_tools
        # Long past the point where silence alone would have ended it.
        fence._last_event = time.monotonic() - 600
        watch = asyncio.create_task(fence._watch_for_silence())
        await asyncio.sleep(0.15)
        alive = not fence._turn.done()
        watch.cancel()
        fence._turn.cancel()
        return alive

    assert asyncio.run(scenario())


def test_a_command_that_never_returns_still_ends_the_turn(tmp_path, monkeypatch):
    """Holding the turn open for a running tool must not mean holding it for ever."""
    from nexttex import agent as agent_module

    fence = ProjectAgent(tmp_path, tmp_path / ".nexttex")
    monkeypatch.setattr(agent_module, "WATCHDOG_INTERVAL", 0.01)
    monkeypatch.setattr(agent_module, "TURN_SILENCE_TIMEOUT", 0.02)
    monkeypatch.setattr(agent_module, "TOOL_RUNNING_TIMEOUT", 0.05)

    async def scenario():
        async def turn():
            await asyncio.sleep(5)

        fence._turn = asyncio.create_task(turn())
        fence._running_tools["call-1"] = ("Bash", time.monotonic() - 600)
        fence._last_event = time.monotonic() - 600
        watch = asyncio.create_task(fence._watch_for_silence())
        await asyncio.sleep(0.2)
        ended = fence._turn.cancelled() or fence._turn.done()
        said = []
        queue = fence._queue()
        while not queue.empty():
            said.append(queue.get_nowait())
        watch.cancel()
        fence._turn.cancel()
        return ended, said

    ended, said = asyncio.run(scenario())
    assert ended
    message = " ".join(event.get("message", "") for event in said)
    # It says what it was waiting for rather than blaming the model for silence.
    assert "Bash" in message
    assert "stopped responding" not in message


def test_the_pair_of_hooks_brackets_a_running_call(tmp_path):
    """What the watchdog reads has to be cleared by every path, including
    the early returns in the post hook that only an edit gets past."""
    fence = ProjectAgent(tmp_path, tmp_path / ".nexttex")

    async def scenario():
        await fence._pre_tool(
            {"tool_name": "Read", "tool_input": {"file_path": "main.tex"}}, "call-9", None
        )
        during = "call-9" in fence._running_tools
        await fence._post_tool(
            {"tool_name": "Read", "tool_input": {"file_path": "main.tex"}}, "call-9", None
        )
        return during, "call-9" in fence._running_tools

    during, after = asyncio.run(scenario())
    assert during
    assert not after


def test_a_notebook_edit_naming_only_notebook_path_is_still_an_edit(tmp_path):
    """The post hook read one path key and the pre hook read three.

    A NotebookEdit carries `notebook_path` and no `file_path`, so the pre
    hook snapshotted the file and the post hook returned before it looked
    at anything: no edit event, so no chip and no undo, and the snapshot
    stayed in `_file_snapshots` until a new conversation cleared it.  A
    notebook is not the common case here, which is exactly why nobody
    noticed a whole file's text being held for the life of the agent.
    """
    project = tmp_path / "project"
    (project / ".nexttex").mkdir(parents=True)
    notebook = project / "analysis.ipynb"
    notebook.write_text("before", encoding="utf-8")
    fence = ProjectAgent(project, project / ".nexttex")
    call = {"tool_name": "NotebookEdit", "tool_input": {"notebook_path": str(notebook)}}

    async def scenario():
        await fence._pre_tool(call, "call-1", None)
        snapshotted = len(fence._file_snapshots)
        notebook.write_text("after", encoding="utf-8")
        await fence._post_tool(call, "call-1", None)
        return snapshotted

    snapshotted = asyncio.run(scenario())
    assert snapshotted == 1
    edits = fence.drain_edits()
    assert [edit.path for edit in edits] == ["analysis.ipynb"]
    assert edits[0].before == "before"
    assert edits[0].after == "after"
    # And nothing is left behind, which is the half that leaked.
    assert fence._file_snapshots == {}


def test_a_dead_client_is_not_kept_for_the_next_question(tmp_path):
    """The second half of a real incident, and the worse half.

    A figure the agent had just drawn was read back, and the image came
    over the wire as a JSON line larger than the SDK would frame, so the
    reader died mid-turn.  That much is one lost answer.  What made it a
    lost conversation is that the client stayed cached: it was still an
    object, so every later question went to a transport that would never
    speak again and came back in under two milliseconds saying the
    connection had ended.  The writer's only way out was a new
    conversation, which loses the thread.
    """
    subject = make_agent(tmp_path)
    dead = StubClient(messages=[])
    subject._client = dead

    async def run():
        await subject.ask("does this end?")
        return await drain(subject)

    asyncio.run(run())
    assert subject._client is None
    assert dead.disconnected


def test_a_client_whose_transport_raised_is_thrown_away(tmp_path):
    """The same recovery for the loud version of the same failure."""
    subject = make_agent(tmp_path)
    dead = StubClient(raises=RuntimeError("the transport went away"))
    subject._client = dead

    async def run():
        await subject.ask("and this?")
        return await drain(subject)

    asyncio.run(run())
    assert subject._client is None


def test_dropping_a_dead_client_leaves_a_fresh_one_alone(tmp_path):
    """A drop names the client it is dropping, so a rebuild that has
    already happened is not undone by a late arrival."""
    subject = make_agent(tmp_path)
    dead, fresh = StubClient(), StubClient()
    subject._client = fresh
    asyncio.run(subject._drop_client(dead))
    assert subject._client is fresh
    assert not fresh.disconnected


def test_the_stdout_guard_clears_an_image_sized_message(tmp_path):
    """The first half of that incident: the SDK frames the CLI's stdout as
    one JSON line per message and refuses a line over a megabyte, which a
    290 KB figure exceeded.  Base64 costs a third, and the PostToolUse
    hook means the result crosses twice, so the ceiling has to sit well
    above the largest image the model will accept rather than just above
    the last one that broke it."""
    options = make_agent(tmp_path)._options()
    assert options.max_buffer_size is not None
    assert options.max_buffer_size >= 32 * 1024 * 1024


def test_a_call_that_died_with_its_turn_is_not_still_running(tmp_path):
    """A tool is recorded when its PreToolUse hook fires and forgotten
    when PostToolUse fires, so a turn stopped mid-command, or one whose
    transport died under it, leaves a call that runs for ever.  Nothing
    notices at the time: the table is read by the watchdog that ends
    silent turns, and it reads it on the next turn.  The phantom would
    hold a stuck turn open and then end a healthy one, minutes in, over a
    tool nobody had called."""
    subject = make_agent(tmp_path)
    subject._running_tools["ghost"] = ("Read", time.monotonic() - 100_000)
    subject._client = StubClient(messages=[])

    async def run():
        await subject.ask("a fresh question")
        return await drain(subject)

    asyncio.run(run())
    assert subject._running_tools == {}


def test_the_agent_is_told_which_claude_to_run(tmp_path, monkeypatch):
    """Finding the CLI and then not saying where it is would leave the agent
    unable to start on the very machine where the setup screen had just
    reported success: the SDK searches PATH on its own, and PATH is exactly
    what does not contain it after a Windows install."""
    subject = make_agent(tmp_path)
    monkeypatch.setattr(agent_module, "claude_binary",
                        lambda: "C:\\Users\\ada\\.local\\bin\\claude.exe")
    assert subject._options().cli_path == "C:\\Users\\ada\\.local\\bin\\claude.exe"


class SubagentMessage:
    """A message the SDK emits for a call made inside a subagent.

    The real ones are `AssistantMessage` and `UserMessage`; what matters to
    `_stream` is only that `parent_tool_use_id` is not None, which is how
    the SDK marks a block that came from a spawned agent rather than from
    the main thread.
    """

    def __init__(self, parent: str = "toolu_parent"):
        self.parent_tool_use_id = parent
        self.content = []


def test_a_message_from_inside_a_subagent_ends_the_turn(tmp_path):
    """The layer that is supposed to be unreachable, which is why it is here.

    Subagents are refused at the fence and removed from the model's
    context, so nothing should ever arrive carrying a parent id. If one
    does, the fence is being routed around, and the writer finds out in the
    panel instead of nobody finding out. A turn that quietly rendered a
    subagent's work would be the same failure as the one this whole change
    is about: work happening where the person whose document it is cannot
    see it.
    """
    subject = make_agent(tmp_path)
    client = StubClient(messages=[SubagentMessage()])
    subject._client = client

    async def run():
        await subject.ask("do it in parallel")
        return await drain(subject)

    events = asyncio.run(run())
    kinds = [event["type"] for event in events]
    # It says so, it stops, and it ends where the panel can see.
    assert "notice" in kinds, kinds
    assert "subagent" in "".join(event.get("message", "") for event in events)
    assert events[-1]["type"] == "done"
    assert events[-1]["subtype"] == "interrupted"
    assert client.interrupted
    assert not subject.busy


def _stream_event(payload: dict):
    """A real `StreamEvent`, because `_stream` dispatches on the type."""
    from claude_agent_sdk import StreamEvent

    return StreamEvent(uuid="u", session_id="s", event=payload)


def test_thinking_is_reported_while_it_happens_and_not_after(tmp_path):
    """The live edge, not the completed block.

    With partial messages on, the finished `ThinkingBlock` arrives when the
    reasoning is already over, so a panel keyed on it would light up at the
    one moment there was nothing left to wait for. The start comes from the
    stream and the block is only the stop edge.
    """
    subject = make_agent(tmp_path)
    subject._client = StubClient(messages=[
        _stream_event({"type": "content_block_start",
                       "content_block": {"type": "thinking"}}),
        _stream_event({"type": "content_block_delta",
                       "delta": {"type": "thinking_delta", "thinking": "..."}}),
        _stream_event({"type": "content_block_stop"}),
        _stream_event({"type": "content_block_delta",
                       "delta": {"type": "text_delta", "text": "Here."}}),
        _stream_event({"type": "content_block_stop"}),
    ])

    async def run():
        await subject.ask("think about it")
        return await drain(subject)

    kinds = [event["type"] for event in asyncio.run(run())]
    # Once, not once per delta: the panel says "reasoning" either way, and a
    # per-delta event would be traffic bought for nothing.
    assert kinds.count("thinking") == 1, kinds
    assert kinds.count("thinking_end") == 1, kinds
    # And it stops before the prose starts, so the two never claim the line
    # at the same time.
    assert kinds.index("thinking_end") < kinds.index("text"), kinds


def test_thinking_that_never_stops_is_closed_by_the_turn(tmp_path):
    """A stream that ends mid-thought must not leave the panel reasoning."""
    subject = make_agent(tmp_path)
    subject._client = StubClient(messages=[
        _stream_event({"type": "content_block_start",
                       "content_block": {"type": "thinking"}}),
    ])

    async def run():
        await subject.ask("think about it")
        return await drain(subject)

    events = asyncio.run(run())
    kinds = [event["type"] for event in events]
    assert "thinking" in kinds
    # `done` always arrives, and the browser clears the activity on it, so
    # the panel recovers even from a stream that stops mid-thought.
    assert events[-1]["type"] == "done"


def test_a_stream_event_from_inside_a_subagent_is_caught_too(tmp_path):
    """The check is the first thing in the loop, not a branch further down.

    A `StreamEvent` carries `parent_tool_use_id` like every other message,
    and it used to reach the text path before anything looked: a subagent's
    prose would have been streamed as the answer.
    """
    from claude_agent_sdk import StreamEvent

    subject = make_agent(tmp_path)
    subject._client = StubClient(messages=[
        StreamEvent(
            uuid="u", session_id="s", parent_tool_use_id="toolu_parent",
            event={"type": "content_block_delta",
                   "delta": {"type": "text_delta", "text": "from the subagent"}},
        ),
    ])

    async def run():
        await subject.ask("delegate it")
        return await drain(subject)

    events = asyncio.run(run())
    kinds = [event["type"] for event in events]
    assert "notice" in kinds, kinds
    assert "text" not in kinds, kinds
    assert events[-1]["subtype"] == "interrupted"


def test_a_fold_that_fails_is_not_swallowed(tmp_path):
    """R-052. `on_edit` records the version, folds the new text into the
    shared document and tells the other tabs. All three are downstream of a
    write that already happened, so when it raises the file on disk is
    right and every open browser holds text the agent has already replaced.

    What that looks like from the writing chair is the agent having done
    nothing: the panel says the edit landed, the editor shows the old
    paragraph, and there is no reason to suspect the two disagree. The
    exception was caught and dropped on the floor.
    """
    (tmp_path / ".nexttex").mkdir(parents=True, exist_ok=True)
    target = tmp_path / "main.tex"
    target.write_text("Before.\n", encoding="utf-8")

    def refuse(path, before, after):
        raise RuntimeError("the document was closed")

    fence = ProjectAgent(tmp_path, tmp_path / ".nexttex", on_edit=refuse)
    call = {"tool_name": "Write", "tool_input": {"file_path": str(target)}}

    async def scenario():
        await fence._pre_tool(call, "call-1", None)
        target.write_text("After.\n", encoding="utf-8")
        await fence._post_tool(call, "call-1", None)
        seen = []
        while not fence._queue().empty():
            seen.append(fence._queue().get_nowait())
        return seen

    seen = asyncio.run(scenario())
    notices = [event for event in seen if event.get("type") == "notice"]
    assert notices, f"the failed fold said nothing: {[e['type'] for e in seen]}"
    assert "main.tex" in notices[0]["message"]
    assert notices[0].get("tone") == "error"
    # And the edit itself stands: the bytes are on disk either way.
    assert target.read_text(encoding="utf-8") == "After.\n"


# -- Stop and the SDK's buffer -----------------------------------------------
#
# Reported from a writing session: after Stop, every reply arrived one
# question late.  `interrupt()` cancelled the reader task first and told the
# CLI second, the CLI still sent a `result` for the stopped turn, and with
# nobody reading it sat in the SDK's buffer.  The next `receive_response()`
# yielded the buffer before anything new and stopped at that stale result,
# three milliseconds in; the real answer then waited in the buffer to be
# replayed as the answer to the question after.
#
# `StubClient` iterates a fixed list and cannot show any of this.  This stub
# has what the real client has: one buffer that outlives a turn, a
# `receive_response()` that reads it until a result, and an `interrupt()`
# that, like the CLI, answers with a result for the stopped turn.


def _result(subtype: str = "success"):
    from claude_agent_sdk import ResultMessage

    return ResultMessage(
        subtype=subtype, duration_ms=1, duration_api_ms=1, is_error=False,
        num_turns=1, session_id="s", total_cost_usd=0.0, usage={},
    )


def _text(text: str):
    return _stream_event({"type": "content_block_delta",
                          "delta": {"type": "text_delta", "text": text}})


class QueueClient:
    """The SDK client with the buffer the real one has.

    `reply(prompt)` says what the CLI writes for a prompt: messages, with a
    float meaning "wait this long first".  `interrupt()` stops that and, when
    `answers_interrupt`, puts a result for the stopped turn in the buffer the
    way the CLI does.
    """

    def __init__(self, reply, *, answers_interrupt: bool = True):
        self.reply = reply
        self.answers_interrupt = answers_interrupt
        self.buffer: asyncio.Queue = asyncio.Queue()
        self.queries: list[str] = []
        self.interrupted = 0
        self.disconnected = False
        self._feeder: asyncio.Task | None = None

    async def query(self, prompt: str) -> None:
        self.queries.append(prompt)
        self._feeder = asyncio.create_task(self._feed(prompt))

    async def _feed(self, prompt: str) -> None:
        for item in self.reply(prompt):
            if isinstance(item, (int, float)):
                await asyncio.sleep(item)
            else:
                await self.buffer.put(item)

    async def receive_response(self):
        from claude_agent_sdk import ResultMessage

        while True:
            message = await self.buffer.get()
            yield message
            if isinstance(message, ResultMessage):
                return

    async def interrupt(self) -> None:
        self.interrupted += 1
        if self._feeder is not None and not self._feeder.done():
            self._feeder.cancel()
        if self.answers_interrupt:
            await self.buffer.put(_result("success"))

    async def disconnect(self) -> None:
        self.disconnected = True


def _slow_then_quick(prompt: str):
    """A first turn that takes a while, and later ones that answer at once."""
    if prompt.startswith("slow"):
        return [_text("Working"), 30, _text(" still"), _result()]
    return [0.02, _text(f"Answer to {prompt}"), _result()]


def test_the_reply_after_stop_answers_the_question_that_was_asked(tmp_path):
    """The report's repro: a slow turn, Stop, then a question.

    The second turn must carry its own answer and end with its own result,
    not end instantly at the result of the stopped turn.
    """
    subject = make_agent(tmp_path)
    client = QueueClient(_slow_then_quick)
    subject._client = client

    async def run():
        await subject.ask("slow one")
        await asyncio.wait_for(drain(subject, until="text"), 2)
        await subject.interrupt()
        first = await drain(subject)
        assert first[-1]["subtype"] == "interrupted", first[-1]
        assert not subject.busy
        await subject.ask("next")
        return await drain(subject)

    second = asyncio.run(run())
    texts = "".join(e.get("text", "") for e in second if e["type"] == "text")
    assert texts == "Answer to next", second
    assert second[-1]["type"] == "done"
    assert second[-1]["subtype"] == "success"
    # The client was kept: the CLI ended the turn itself and left nothing
    # behind, so there was no reason to pay for a new process.
    assert subject._client is client
    assert client.interrupted == 1
    assert client.buffer.empty()


def test_stop_reads_the_last_words_before_the_result(tmp_path):
    """Deltas the model got out between Stop and its result are shown:
    they are what the turn said before it was stopped, and the transcript
    already renders a cut-off answer."""
    subject = make_agent(tmp_path)

    def reply(prompt):
        return [_text("Before"), 30, _result()]

    client = QueueClient(reply)

    async def interrupt():
        client.interrupted += 1
        client._feeder.cancel()
        await client.buffer.put(_text(" and after"))
        await client.buffer.put(_result())

    client.interrupt = interrupt
    subject._client = client

    async def run():
        await subject.ask("say something")
        await asyncio.wait_for(drain(subject, until="text"), 2)
        await subject.interrupt()
        return await drain(subject)

    events = asyncio.run(run())
    texts = "".join(e.get("text", "") for e in events if e["type"] == "text")
    assert texts.endswith(" and after"), events
    assert events[-1]["subtype"] == "interrupted"


def test_a_cli_that_does_not_answer_stop_is_cancelled_and_dropped(tmp_path, monkeypatch):
    """The fallback.  The interrupt goes through but no result follows, so
    after the grace period the reader is cancelled from outside, and the
    client goes with it: its buffer may hold anything."""
    monkeypatch.setattr(agent_module, "INTERRUPT_GRACE", 0.1)
    subject = make_agent(tmp_path)
    client = QueueClient(_slow_then_quick, answers_interrupt=False)
    subject._client = client

    async def run():
        await subject.ask("slow one")
        await asyncio.wait_for(drain(subject, until="text"), 2)
        started = time.monotonic()
        await subject.interrupt()
        events = await drain(subject)
        return events, time.monotonic() - started

    events, took = asyncio.run(run())
    assert events[-1] == {"type": "done", "subtype": "interrupted"}
    assert took < 1.0, took
    assert client.interrupted == 1
    assert client.disconnected
    assert subject._client is None
    assert not subject.busy


def test_a_second_stop_does_not_wait_for_the_first(tmp_path, monkeypatch):
    """Stop is never a no-op, including while a Stop is already waiting."""
    monkeypatch.setattr(agent_module, "INTERRUPT_GRACE", 5.0)
    subject = make_agent(tmp_path)
    client = QueueClient(_slow_then_quick, answers_interrupt=False)
    subject._client = client

    async def run():
        await subject.ask("slow one")
        await asyncio.wait_for(drain(subject, until="text"), 2)
        started = time.monotonic()
        first = asyncio.create_task(subject.interrupt())
        await asyncio.sleep(0.05)
        await subject.interrupt()
        await asyncio.wait_for(first, 2)
        events = await drain(subject)
        return events, time.monotonic() - started

    events, took = asyncio.run(run())
    assert events[-1]["subtype"] == "interrupted"
    assert took < 1.0, took
    assert subject._client is None


def test_a_turn_the_watchdog_ends_drops_its_client(tmp_path, monkeypatch):
    """The watchdog cancels from outside, exactly like Stop's fallback, and
    used to leave the client, so a turn that went silent set up the same
    one-behind conversation as a Stop did."""
    monkeypatch.setattr(agent_module, "WATCHDOG_INTERVAL", 0.02)
    monkeypatch.setattr(agent_module, "TURN_SILENCE_TIMEOUT", 0.05)
    subject = make_agent(tmp_path)
    client = QueueClient(lambda prompt: [_text("..."), 30, _result()])
    subject._client = client

    async def run():
        await subject.ask("go quiet")
        return await drain(subject)

    events = asyncio.run(run())
    assert events[-1]["subtype"] == "interrupted"
    assert client.disconnected
    assert subject._client is None


def test_a_turn_the_subagent_guard_ends_drops_its_client(tmp_path):
    """The guard interrupts the CLI and raises, so the CLI's result for the
    turn is never read.  Same buffer, same client, same fix."""
    subject = make_agent(tmp_path)
    client = QueueClient(lambda prompt: [SubagentMessage(), 30, _result()])
    subject._client = client

    async def run():
        await subject.ask("delegate")
        return await drain(subject)

    events = asyncio.run(run())
    assert events[-1]["subtype"] == "interrupted"
    assert client.interrupted == 1
    assert client.disconnected
    assert subject._client is None


def test_a_turn_that_ends_on_its_own_keeps_its_client(tmp_path):
    """The other side of the invariant: a client that answered normally is
    reused, so an ordinary conversation still costs one process."""
    subject = make_agent(tmp_path)
    client = QueueClient(_slow_then_quick)
    subject._client = client

    async def run():
        await subject.ask("one")
        await drain(subject)
        await subject.ask("two")
        return await drain(subject)

    events = asyncio.run(run())
    assert events[-1]["subtype"] == "success"
    assert subject._client is client
    assert not client.disconnected
