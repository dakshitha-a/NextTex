"""Per-project runtime state: the compiler, the agent, and who is listening.

One `ProjectSession` exists per open project. It owns the objects that must
not be duplicated -- a compile scheduler that serialises builds, an agent
holding a Claude session -- and the fan-out that lets several browser tabs
watch the same project.
"""

from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path

from nexttex.agent import ProjectAgent
from nexttex.scripted_agent import ScriptedAgent, scripted_name
from nexttex.compile import CompileResult, CompileScheduler, Outcome, ProjectPaths
from nexttex.context import ProjectContext
from nexttex.atomic import read_text, write_atomically
from nexttex.history import History
from nexttex.symbols import SymbolCache
from nexttex.trash import Trash
from server.transcript import Transcript
from nexttex.project import Project

# How long an idle project keeps its Claude session alive. Each one is a
# node subprocess holding real memory, and a conversation resumes from disk
# anyway, so dropping it costs the user nothing but a moment's reconnect.
AGENT_IDLE_TIMEOUT = 30 * 60

# Typing settles, then we build.  The browser already holds a keystroke for
# ~250 ms before saving, so what the writer feels is this plus that plus the
# compile -- about two seconds, which is what they asked for.
COMPILE_DEBOUNCE = 1.6

# Longer, when the file looks like it is in the middle of something.  A
# half-typed equation is not an error, and reporting it as one while the
# writer is still typing it is the most irritating thing a preview can do.
UNSETTLED_DEBOUNCE = 4.0


MATH_DELIMITER = re.compile(r"(?<!\\)\$")
BEGIN = re.compile(r"\\begin\s*\{([^}]+)\}")
END = re.compile(r"\\end\s*\{([^}]+)\}")


def mid_construct(text: str) -> bool:
    """Does this file look like somebody is halfway through typing something?

    An odd number of dollar signs, or a \\begin without its \\end, means the
    next build will report errors the writer already knows about and is in
    the middle of fixing.  Waiting a little longer is kinder than telling
    them.
    """
    # Only the body: a package's braces in the preamble are not the
    # writer's unfinished work, and \end{document} has no \begin to match.
    body = text.split("\\begin{document}", 1)[-1]
    body = body.rsplit("\\end{document}", 1)[0]
    if len(MATH_DELIMITER.findall(body)) % 2:
        return True
    opened, closed = BEGIN.findall(body), END.findall(body)
    if len(opened) != len(closed):
        return True
    return sorted(opened) != sorted(closed)


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
        self.history = History(project.state_dir / "history")
        self.symbols = SymbolCache(project.root)
        self.trash = Trash(project.state_dir / "trash", self.history, project.root)
        self.events = Broadcaster()

        self.paths = ProjectPaths(
            root=project.root, main=project.main, build_dir=project.build_dir
        )
        self.compiler = CompileScheduler(self.paths)

        # A scripted stand-in when one is asked for, so the whole agent
        # interface can be driven by a test without a model, an account or
        # a network.  Unreachable in an ordinary run.
        agent_class = ScriptedAgent if scripted_name() else ProjectAgent
        self.agent = agent_class(
            project.root,
            project.state_dir,
            context_prompt=self.context.prompt_section,
            has_voice=lambda: self.context.voice_summary.exists(),
            editor_state=lambda: self._editor_state,
            diagnostics=lambda: self._diagnostics,
            compile_now=self.compile,
            apply_edit=self.write_from_agent,
            on_edit=self.note_agent_edit,
            reveal=self.reveal_in_editor,
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
        self._unsettled = False
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
        delay = UNSETTLED_DEBOUNCE if self._unsettled else COMPILE_DEBOUNCE

        async def wait_then_build() -> None:
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return
            await self.compile()

        self._debounce = asyncio.create_task(wait_then_build())

    def note_edit(
        self,
        path: Path,
        text: str | bytes | None = None,
        previous: str | bytes | None = None,
    ) -> None:
        if isinstance(text, bytes) or isinstance(previous, bytes):
            # A figure rather than prose.  There is no half-finished
            # equation to wait for, and the honest answer for the build is
            # "rebuild everything" -- which is what None means to the
            # compiler, and is right anyway: a new figure changes the
            # layout of every page after it.
            self._unsettled = False
            self.compiler.note_edit(path, None, None)
            return
        self._unsettled = text is not None and mid_construct(text)
        self.compiler.note_edit(path, text, previous)

    async def set_main(self, relative_path: str) -> None:
        """Point the build at a different file.

        The scheduler holds the paths it was built with, and the jobname
        comes from the main file's stem, so both are rebuilt rather than
        mutated -- the alternative is a compiler writing chapter.pdf while
        the PDF route serves main.pdf.
        """
        self.project.config.main = relative_path
        self.project.config.save(self.project.root)
        # Whatever is building now is building the old main file into the
        # old jobname.  Left running it writes into the same build
        # directory as its replacement, and nothing holds a reference to
        # stop it -- so it is stopped here, before the swap.
        outgoing = self.compiler
        if self._debounce is not None:
            self._debounce.cancel()
            self._debounce = None
        await outgoing.cancel()
        self.paths = ProjectPaths(
            root=self.project.root,
            main=self.project.main,
            build_dir=self.project.build_dir,
        )
        self.compiler = CompileScheduler(self.paths)

    # -- version history ---------------------------------------------------
    def record_version(
        self,
        path: Path,
        text: str | bytes | None,
        *,
        by: str = "you",
        why: str = "",
        op: str = "edit",
        previous: str | bytes | None = None,
        source: str = "",
    ) -> None:
        """Note a file's contents, before the next thing changes them.

        `previous` seeds the file's history the first time NextTex sees it:
        without it, the state a chapter was in before this app ever touched
        it would be the one state nobody could get back to.
        """
        try:
            relative = self.project.relative(path)
        except (ValueError, OSError):
            return
        if previous is not None and not self.history.versions(relative):
            # Recorded as a creation, not an edit, so the next save cannot
            # coalesce it away: this is the one state of the file that
            # existed before NextTex, and it has to stay reachable.
            self.history.record(
                relative, previous, by="you", op="create",
                why="as it was when NextTex first saw it",
            )
        self.history.record(relative, text, by=by, why=why, op=op, source=source)

    def write_from_agent(self, path: Path, text: str) -> None:
        """A write made by one of the agent's own tools.

        The same path as an HTTP save: atomic, recorded as ours so the
        watcher does not echo it back at the editor, and followed by a
        rebuild.  Anything less and the pane would go stale under an edit
        the user just watched arrive.
        """
        previous = read_text(path)
        write_atomically(path, text)
        self.mark_written(path)
        self.record_version(
            path, text, by="claude", why=self.agent.current_why(), previous=previous,
        )
        self.note_edit(path, text, previous)
        self.schedule_compile()
        asyncio.create_task(
            self.events.publish({
                "type": "files_changed",
                "paths": [self.project.relative(path)],
                "byAgent": True,
            })
        )

    def note_agent_edit(self, path: Path, before: str | None, after: str | None) -> None:
        """An edit the SDK made directly, without going through this class.

        Write, Edit and MultiEdit write to disk themselves, so this is the
        only place those edits can be versioned or trigger a rebuild.
        """
        self.mark_written(path)
        self.record_version(
            path, after, by="claude", why=self.agent.current_why(), previous=before,
        )
        self.note_edit(path, after, before)
        self.schedule_compile()

    def reveal_in_editor(self, path: str, line: int) -> None:
        """Ask the open editor to show a line."""
        asyncio.create_task(
            self.events.publish({"type": "reveal", "path": path, "line": line})
        )

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
                # One unserialisable tool argument used to kill this task,
                # and with it every later event including `done`: the panel
                # then said Claude was thinking, forever.
                try:
                    event = self.transcript.record(event)
                except Exception:
                    pass
                try:
                    await self.events.publish({"scope": "agent", **event})
                except asyncio.CancelledError:
                    raise
                except Exception:
                    continue

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
