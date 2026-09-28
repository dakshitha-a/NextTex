"""The agent's own build and compile as you type no longer supersede each other.

The agent edits a file and calls `compile` at once. The watcher sees the
same write a moment later and schedules a build of its own, and that
build used to cancel the agent's, killing its pdflatex part way through
the `.aux`: a torn `si.aux` four times in two days (27 and 28 September
2026), and the agent was told its build was "cancelled". Now a debounced
build waits for a running build that began after its edits, and skips
itself when a whole build has read them; a keystroke made while a build
runs still replaces it; and a caller whose build is replaced gets the
replacement's result.

Driven against the session with a stand-in compiler that keeps the real
one's rules, one build at a time and a newer one cancelling the older,
because the timing under test is the session's, not latexmk's.
"""

import asyncio

from nexttex.compile import CompileResult, Outcome
from server import main as server_main
from server import session as session_module


class Compiler:
    """The scheduler's rules without an engine: each build takes `took`
    seconds, and a newer one cancels it."""

    timeout = 5.0
    needs_full = False

    def __init__(self, took: float = 0.3) -> None:
        self.took = took
        self.ran = 0
        self.killed = 0
        self._running = False
        self._stop = False
        self._generation = 0
        self._lock = asyncio.Lock()

    async def cancel(self) -> None:
        if self._running and not self._stop:
            self.killed += 1
            self._stop = True

    async def build(self, focus=None, force_full=False, clean=False) -> CompileResult:
        self._generation += 1
        generation = self._generation
        await self.cancel()
        async with self._lock:
            if generation != self._generation:
                return CompileResult(Outcome.CANCELLED, None, None, 0.0, "full", "fast")
            self.ran += 1
            self._running = True
            self._stop = False
            try:
                for _ in range(int(self.took / 0.02)):
                    await asyncio.sleep(0.02)
                    if self._stop or generation != self._generation:
                        return CompileResult(
                            Outcome.CANCELLED, None, None, 0.0, "full", "fast",
                        )
            finally:
                self._running = False
            return CompileResult(Outcome.OK, None, None, self.took, "full", "fast")

    def note_edit(self, *args, **kwargs) -> None:
        pass

    def cleanup(self) -> None:
        pass


def _stand_in(client, project_id: str) -> Compiler:
    session = server_main.SESSIONS[project_id]
    fake = Compiler()

    async def swap() -> None:
        for state in session.documents.values():
            if state.debounce is not None and not state.debounce.done():
                state.debounce.cancel()
            state.debounce = None
            await state.compiler.cancel()
        session.documents["main.tex"].compiler = fake

    client.portal.call(swap)
    return fake


def test_the_agents_build_is_not_replaced_by_the_watchers(
    client, opened, project_dir, monkeypatch,
):
    monkeypatch.setattr(session_module, "COMPILE_DEBOUNCE", 0.05)
    project_id = opened["id"]
    fake = _stand_in(client, project_id)
    session = server_main.SESSIONS[project_id]
    main = project_dir / "main.tex"
    text = main.read_text(encoding="utf-8") + "\nOne more sentence.\n"
    main.write_text(text, encoding="utf-8")
    written = main.stat().st_mtime

    async def agent_then_watcher():
        # The agent's compile, straight after its Edit.
        agent = asyncio.ensure_future(session.compile(document="main.tex"))
        await asyncio.sleep(0.05)
        # The watcher's sighting of that same Edit, by the file's clock.
        session.note_edit(main, text, None, written)
        session.schedule_compile()
        result = await agent
        await asyncio.sleep(0.6)
        return result

    result = client.portal.call(agent_then_watcher)

    assert result.outcome is Outcome.OK
    assert fake.killed == 0, "the watcher's build cancelled the agent's"
    assert fake.ran == 1, "the edit the agent's build read was built twice"


def test_a_keystroke_during_a_build_still_replaces_it_and_the_caller_hears_the_result(
    client, opened, project_dir, monkeypatch,
):
    monkeypatch.setattr(session_module, "COMPILE_DEBOUNCE", 0.05)
    project_id = opened["id"]
    fake = _stand_in(client, project_id)
    session = server_main.SESSIONS[project_id]
    main = project_dir / "main.tex"

    async def build_then_type():
        asked = asyncio.ensure_future(session.compile(document="main.tex"))
        await asyncio.sleep(0.05)
        text = main.read_text(encoding="utf-8") + "\nTyped while it built.\n"
        main.write_text(text, encoding="utf-8")
        session.note_edit(main, text, None)
        session.schedule_compile()
        return await asked

    result = client.portal.call(build_then_type)

    assert fake.killed == 1, "a newer edit must still replace the build"
    assert fake.ran == 2
    assert result.outcome is Outcome.OK, "the caller was told 'cancelled'"


def _after_a_whole_build(client, project_id, fake):
    """A finished whole build that left nothing owed, so that anything the
    session thinks it read will be skipped."""
    session = server_main.SESSIONS[project_id]

    async def build():
        await session.compile(document="main.tex")

    client.portal.call(build)
    assert fake.ran == 1


def test_a_file_synced_in_with_an_old_mtime_is_still_built(
    client, opened, project_dir, monkeypatch,
):
    """Dropbox, `rsync -a` and `unzip` keep the source's mtime. Believed,
    it is older than the last whole build, which would then count as
    having read the file, and the preview would stay stale."""
    import os

    monkeypatch.setattr(session_module, "COMPILE_DEBOUNCE", 0.05)
    project_id = opened["id"]
    fake = _stand_in(client, project_id)
    _after_a_whole_build(client, project_id, fake)
    session = server_main.SESSIONS[project_id]
    main = project_dir / "main.tex"
    text = main.read_text(encoding="utf-8") + "\nSynced from elsewhere.\n"
    main.write_text(text, encoding="utf-8")
    old = main.stat().st_mtime - 3600
    os.utime(main, (old, old))

    async def fold_then_wait():
        await server_main._fold_tick(session, {"main.tex"})
        for _ in range(100):
            await asyncio.sleep(0.02)
            if fake.ran == 2 and not session.documents["main.tex"].in_flight:
                break

    client.portal.call(fold_then_wait)

    assert fake.ran == 2, "a synced file was taken as already built"


def test_an_upload_that_says_nothing_about_what_changed_is_still_built(
    client, opened, monkeypatch,
):
    """An upload or a restore schedules a build with no `note_edit`, so
    nothing stamped when it happened."""
    monkeypatch.setattr(session_module, "COMPILE_DEBOUNCE", 0.05)
    project_id = opened["id"]
    fake = _stand_in(client, project_id)
    _after_a_whole_build(client, project_id, fake)
    session = server_main.SESSIONS[project_id]

    async def schedule_then_wait():
        session.schedule_compile()
        for _ in range(100):
            await asyncio.sleep(0.02)
            if fake.ran == 2 and not session.documents["main.tex"].in_flight:
                break

    client.portal.call(schedule_then_wait)

    assert fake.ran == 2


def test_a_keystroke_during_a_debounced_build_does_not_cancel_its_task(
    client, opened, project_dir, monkeypatch,
):
    """Cancelling the task left the engine running beside the next one;
    the build is superseded through the compiler instead, and its task
    ends normally."""
    monkeypatch.setattr(session_module, "COMPILE_DEBOUNCE", 0.05)
    project_id = opened["id"]
    fake = _stand_in(client, project_id)
    session = server_main.SESSIONS[project_id]
    main = project_dir / "main.tex"
    state = session.documents["main.tex"]

    async def type_twice():
        text = main.read_text(encoding="utf-8") + "\nFirst.\n"
        main.write_text(text, encoding="utf-8")
        session.note_edit(main, text, None)
        session.schedule_compile()
        first = state.debounce
        while fake.ran == 0:
            await asyncio.sleep(0.01)
        text += "Second.\n"
        main.write_text(text, encoding="utf-8")
        session.note_edit(main, text, None)
        session.schedule_compile()
        await asyncio.wait_for(asyncio.shield(first), timeout=5)
        while fake.ran < 2 or state.in_flight:
            await asyncio.sleep(0.02)
        return first

    first = client.portal.call(type_twice)

    assert not first.cancelled()
    assert fake.killed == 1
    assert fake.ran == 2
