"""Per-project runtime state: the compiler, the agent, and who is listening.

One `ProjectSession` exists per open project. It owns the objects that must
not be duplicated -- a compile scheduler that serialises builds, an agent
holding a Claude session -- and the fan-out that lets several browser tabs
watch the same project.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from nexttex.agent import ProjectAgent
from nexttex.compile import CompileResult, CompileScheduler, Outcome, ProjectPaths
from nexttex.context import ProjectContext
from server.transcript import Transcript
from nexttex.project import Project

# How long an idle project keeps its Claude session alive. Each one is a
# node subprocess holding real memory, and a conversation resumes from disk
# anyway, so dropping it costs the user nothing but a moment's reconnect.
AGENT_IDLE_TIMEOUT = 30 * 60

# Typing settles, then we build.  This is only half the wait: the browser
# already holds a keystroke for ~250 ms before saving, and a compile takes
# about a second, so the number the user actually feels is the sum.  Keeping
# this at 0.45 puts that total under 1.8 s rather than well over two.
COMPILE_DEBOUNCE = 0.45


class Broadcaster:
    """Fan out one event stream to every connected browser tab."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=512)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    async def publish(self, event: dict) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A tab that has stopped reading must not stall the server
                # or block every other tab. Drop it; the client reconnects
                # and re-reads state.
                self._subscribers.discard(queue)


class ProjectSession:
    def __init__(self, project: Project, model: str | None = None):
        self.project = project
        self.context = ProjectContext(project.state_dir)
        self.transcript = Transcript(project.state_dir / "transcript.jsonl")
        self.events = Broadcaster()

        self.paths = ProjectPaths(
            root=project.root, main=project.main, build_dir=project.build_dir
        )
        self.compiler = CompileScheduler(self.paths)

        self.agent = ProjectAgent(
            project.root,
            project.state_dir,
            context_prompt=self.context.prompt_section,
            editor_state=lambda: self._editor_state,
            diagnostics=lambda: self._diagnostics,
            compile_now=self.compile,
            model=model or None,
        )

        self._editor_state: dict = {}
        self._diagnostics: list[dict] = []
        self.last_result: CompileResult | None = None

        # Files this server has just written, by mtime.  The watcher uses
        # this to tell the user's own save apart from an outside change; the
        # browser must not be told to reload a buffer it just sent us.
        self.recently_written: dict[str, int] = {}
        self._debounce: asyncio.Task | None = None
        self._agent_pump: asyncio.Task | None = None
        self._focus: Path | None = None

    # -- editor -----------------------------------------------------------
    def set_editor_state(self, state: dict) -> None:
        self._editor_state = state
        path = state.get("file")
        if path:
            try:
                self._focus = self.project.resolve(path)
            except (PermissionError, OSError):
                self._focus = None

    def as_client_dict(self, result: CompileResult) -> dict:
        """A build result with paths the browser can match against.

        The log gives absolute paths.  Everything the client holds -- the
        open file, the tabs, the tree -- is relative to the project root, so
        an absolute path here silently matches nothing and the error marks
        never appear beside the line that caused them.
        """
        payload = result.as_dict()
        payload["diagnostics"] = [
            {**item, "file": self.relative_or_none(item.get("file"))}
            for item in payload.get("diagnostics", [])
        ]
        payload.pop("pdf", None)   # a server path the browser cannot use
        return payload

    def relative_or_none(self, path: str | None) -> str | None:
        if not path:
            return None
        try:
            return self.project.relative(Path(path))
        except (ValueError, OSError):
            # A file outside the project -- a class or package from the TeX
            # tree.  Show its name rather than a path nothing can act on.
            return Path(path).name

    # -- compiling --------------------------------------------------------
    async def compile(self, force_full: bool = False) -> CompileResult:
        await self.events.publish({"type": "compile_start"})
        result = await self.compiler.build(focus=self._focus, force_full=force_full)
        payload = self.as_client_dict(result)
        # A superseded build carries no log.  Keeping its empty diagnostics
        # would clear the editor's error marks every time the user typed
        # during a compile, which is exactly when they are looking at them.
        if result.outcome is not Outcome.CANCELLED:
            self.last_result = result
            self._diagnostics = payload.get("diagnostics", [])
        await self.events.publish({"type": "compile_done", **payload})
        return result

    def schedule_compile(self) -> None:
        """Build once typing has settled, replacing any pending build."""
        if self._debounce is not None and not self._debounce.done():
            self._debounce.cancel()

        async def wait_then_build() -> None:
            try:
                await asyncio.sleep(COMPILE_DEBOUNCE)
            except asyncio.CancelledError:
                return
            await self.compile()

        self._debounce = asyncio.create_task(wait_then_build())

    def note_edit(
        self, path: Path, text: str | None = None, previous: str | None = None
    ) -> None:
        self.compiler.note_edit(path, text, previous)

    def mark_written(self, path: Path) -> None:
        try:
            self.recently_written[str(path.resolve())] = path.stat().st_mtime_ns
        except OSError:
            return
        # Only the most recent write of each file can still be echoed back,
        # and a session can run for weeks: keep the ledger bounded.
        while len(self.recently_written) > 256:
            self.recently_written.pop(next(iter(self.recently_written)))

    def is_own_write(self, path: Path) -> bool:
        try:
            key = str(path.resolve())
            return self.recently_written.get(key) == path.stat().st_mtime_ns
        except OSError:
            return False

    # -- agent ------------------------------------------------------------
    def start_agent_pump(self) -> None:
        """Forward the agent's event queue onto the project's broadcast."""
        if self._agent_pump is not None and not self._agent_pump.done():
            return

        async def pump() -> None:
            async for event in self.agent.events():
                # Recorded before it is broadcast, so the panel and the file
                # on disk always show the same conversation -- and so an
                # event that arrives while nobody is watching is still kept.
                event = self.transcript.record(event)
                await self.events.publish({"scope": "agent", **event})

        self._agent_pump = asyncio.create_task(pump())

    async def reap_idle_agent(self) -> None:
        if self.agent.busy:
            return
        if self.agent.idle_seconds > AGENT_IDLE_TIMEOUT:
            await self.agent.disconnect()

    async def close(self) -> None:
        for task in (self._debounce, self._agent_pump):
            if task is not None and not task.done():
                task.cancel()
        await self.agent.disconnect()
        await self.compiler.cancel()
        self.compiler.cleanup()
