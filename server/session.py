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
from nexttex.compile import CompileResult, CompileScheduler, ProjectPaths
from nexttex.context import ProjectContext
from nexttex.project import Project

# How long an idle project keeps its Claude session alive. Each one is a
# node subprocess holding real memory, and a conversation resumes from disk
# anyway, so dropping it costs the user nothing but a moment's reconnect.
AGENT_IDLE_TIMEOUT = 30 * 60

# Typing settles, then we build. Long enough that a fast typist does not
# trigger a build mid-word; short enough to feel immediate.
COMPILE_DEBOUNCE = 0.8


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

    # -- compiling --------------------------------------------------------
    async def compile(self, force_full: bool = False) -> CompileResult:
        await self.events.publish({"type": "compile_start"})
        result = await self.compiler.build(focus=self._focus, force_full=force_full)
        self.last_result = result
        payload = result.as_dict()
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

    def note_edit(self, path: Path, text: str | None = None) -> None:
        self.compiler.note_edit(path, text)

    # -- agent ------------------------------------------------------------
    def start_agent_pump(self) -> None:
        """Forward the agent's event queue onto the project's broadcast."""
        if self._agent_pump is not None and not self._agent_pump.done():
            return

        async def pump() -> None:
            async for event in self.agent.events():
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
