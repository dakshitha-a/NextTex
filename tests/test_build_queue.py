"""One build at a time across a project, the visible document first.

Concurrency code that is only exercised through a compiler is concurrency
code nobody can debug, so this drives the queue directly with no subprocess
anywhere near it.
"""

import asyncio

import pytest

from nexttex.compile import BuildQueue


async def hold(queue: BuildQueue, log: list, name: str, seconds: float,
               priority: bool = False) -> None:
    async with queue.slot(priority=priority):
        log.append(f"start {name}")
        await asyncio.sleep(seconds)
        log.append(f"end {name}")


def test_only_one_build_runs_at_a_time():
    """Two latexmk runs in one build directory is the bug this prevents."""
    queue = BuildQueue()
    log: list[str] = []

    async def main() -> None:
        await asyncio.gather(
            hold(queue, log, "a", 0.02),
            hold(queue, log, "b", 0.02),
            hold(queue, log, "c", 0.02),
        )

    asyncio.run(main())
    # Never two starts in a row: each build ends before the next begins.
    assert log == ["start a", "end a", "start b", "end b", "start c", "end c"]


def test_the_visible_document_goes_first():
    queue = BuildQueue()
    log: list[str] = []

    async def main() -> None:
        running = asyncio.create_task(hold(queue, log, "running", 0.05))
        await asyncio.sleep(0.01)          # let it take the slot
        background = asyncio.create_task(hold(queue, log, "background", 0.01))
        await asyncio.sleep(0.005)         # queued behind it
        visible = asyncio.create_task(hold(queue, log, "visible", 0.01, priority=True))
        await asyncio.gather(running, background, visible)

    asyncio.run(main())
    # The one in flight is never abandoned -- no preemption -- but the
    # visible document jumps the queue behind it.
    assert log.index("start visible") < log.index("start background")


def test_a_queue_that_has_formed_is_not_jumped_by_a_newcomer():
    """Otherwise a background document under steady typing never builds."""
    queue = BuildQueue()
    log: list[str] = []

    async def main() -> None:
        first = asyncio.create_task(hold(queue, log, "running", 0.04))
        await asyncio.sleep(0.01)
        waiting = asyncio.create_task(hold(queue, log, "waiting", 0.01))
        await asyncio.sleep(0.005)
        latecomer = asyncio.create_task(hold(queue, log, "latecomer", 0.01))
        await asyncio.gather(first, waiting, latecomer)

    asyncio.run(main())
    assert log.index("start waiting") < log.index("start latecomer")


def test_a_slot_is_given_back_when_the_waiter_is_cancelled():
    """A lost slot would wedge every later build for the life of the session."""
    queue = BuildQueue()
    log: list[str] = []

    async def main() -> None:
        running = asyncio.create_task(hold(queue, log, "running", 0.03))
        await asyncio.sleep(0.01)
        doomed = asyncio.create_task(hold(queue, log, "doomed", 0.01))
        await asyncio.sleep(0.005)
        doomed.cancel()
        with pytest.raises(asyncio.CancelledError):
            await doomed
        await running
        # The queue is idle again, and still usable.
        await hold(queue, log, "after", 0.001)

    asyncio.run(main())
    assert "start doomed" not in log
    assert log[-1] == "end after"
    assert queue.active == 0 and queue.waiting == 0


def test_a_failing_build_does_not_keep_its_slot():
    queue = BuildQueue()

    async def main() -> None:
        with pytest.raises(RuntimeError):
            async with queue.slot():
                raise RuntimeError("latexmk fell over")
        assert queue.active == 0
        async with queue.slot():
            pass

    asyncio.run(main())
