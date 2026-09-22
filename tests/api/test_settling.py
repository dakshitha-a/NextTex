"""The preview settles on its own.

A writer saw figures on the wrong page until they commented them out,
built, uncommented and pressed Rebuild everything.  Compile as you type
is one engine pass, and a single pass typesets against the last pass's
aux files, so wherever an edit changed what a reference or a page number
says the page flow, and with it where the floats land, is one pass
behind.  The engine says so in its log; nothing read it.  Now a fast pass
that leaves the document unconverged is followed by one settling build,
a full pass, on the same road as any other build.
"""

import asyncio

from nexttex.compile import CompileResult, Outcome
from nexttex.latexlog import ParsedLog


def fast(rerun: bool, outcome: Outcome = Outcome.OK) -> CompileResult:
    log = ParsedLog()
    log.rerun_needed = rerun
    return CompileResult(
        outcome=outcome, log=log, pdf=None, duration=0.01,
        scope="full", engine_pass="fast",
    )


def full(rerun: bool) -> CompileResult:
    log = ParsedLog()
    log.rerun_needed = rerun
    return CompileResult(
        outcome=Outcome.OK, log=log, pdf=None, duration=0.02,
        scope="full", engine_pass="full",
    )


def drive(session, results: list[CompileResult], **first):
    """Run one compile with the scheduler's build stubbed to hand back the
    results in order, and gather what was built and what was published."""
    state = session.documents["main.tex"]
    # A fast pass only ever runs while the scheduler does not need a full
    # one (a fresh scheduler assumes the worst and runs full), so that is
    # the state a stubbed fast result stands in for; a test that wants the
    # mark set by `_note_unresolved` sets it after this.
    if "needs_full" not in first:
        state.compiler._needs_full = False
    first.pop("needs_full", None)
    calls: list[dict] = []
    remaining = list(results)

    async def build(focus=None, force_full=False):
        calls.append({"force_full": force_full})
        return remaining.pop(0) if remaining else full(False)

    async def cancel():
        return None

    async def run():
        queue = session.events.subscribe()
        state.compiler.build = build
        state.compiler.cancel = cancel
        try:
            await session.compile(document="main.tex", **first)
            # Let a spawned settling build run to its end.
            for _ in range(20):
                await asyncio.sleep(0.01)
        finally:
            session.events.unsubscribe(queue)
        events = []
        while not queue.empty():
            events.append(queue.get_nowait())
        return events

    events = asyncio.run(run())
    return calls, [e for e in events if e["type"] in ("compile_start", "compile_done")]


def test_a_fast_pass_that_asks_for_a_rerun_is_followed_by_one_full_pass(client, opened):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    calls, events = drive(session, [fast(rerun=True), full(rerun=False)])
    assert [c["force_full"] for c in calls] == [False, True]
    done = [e for e in events if e["type"] == "compile_done"]
    assert [e["settling"] for e in done] == [False, True]
    # The fast result went out before the settling build started, so the
    # preview showed something at once.
    kinds = [(e["type"], e["settling"]) for e in events]
    assert kinds.index(("compile_done", False)) < kinds.index(("compile_start", True))


def test_a_fast_pass_with_a_settled_log_is_followed_by_nothing(client, opened):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    calls, events = drive(session, [fast(rerun=False)])
    assert [c["force_full"] for c in calls] == [False]
    assert all(e["settling"] is False for e in events)


def test_a_settling_build_that_still_asks_for_a_rerun_does_not_spawn_another(client, opened):
    """A package that asks for a rerun on every pass must not keep the
    engine running for ever: one settling build per triggering build."""
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    calls, _ = drive(session, [fast(rerun=True), full(rerun=True)])
    assert [c["force_full"] for c in calls] == [False, True]


def test_a_fast_pass_with_errors_is_not_settled(client, opened):
    """A full pass of a broken document fixes nothing and costs seconds."""
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    calls, _ = drive(session, [fast(rerun=True, outcome=Outcome.ERRORS)])
    assert [c["force_full"] for c in calls] == [False]


def test_a_pass_the_scheduler_already_marked_for_a_full_build_is_settled_now(client, opened):
    """`_note_unresolved` asked for a full pass at the next build; the next
    build is this one, rather than whenever the writer types again."""
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    state.compiler._needs_full = True
    calls, _ = drive(session, [fast(rerun=False), full(rerun=False)], needs_full=True)
    assert [c["force_full"] for c in calls] == [False, True]
