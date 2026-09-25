"""Per-project runtime state: the compiler, the agent, and who is listening.

One `ProjectSession` exists per open project. It owns the objects that must
not be duplicated -- a compile scheduler that serialises builds, an agent
holding a Claude session -- and the fan-out that lets several browser tabs
watch the same project.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
import logging
import re
import time
from pathlib import Path

from nexttex.explain import annotate, summarise
from nexttex.library import Library
from nexttex.providers import agent_for
from nexttex.compile import (
    BuildQueue, CompileResult, CompileScheduler, Outcome, ProjectPaths,
)
from nexttex.deps import DependencyGraph
from nexttex.context import ProjectContext
from nexttex.dictionary import GrammarIgnores, ProjectDictionary
from nexttex.atomic import read_text, write_atomically
from nexttex.config import Settings
from nexttex.history import History
from nexttex.scripts import ScriptRuns
from nexttex.symbols import SymbolCache
from nexttex.trash import Trash
from server.collab.peers import PeerNetwork
from server.collab.store import CollabStore
from server.collab.sync import SyncHub
from server.transcript import Transcript
from nexttex.project import (
    CONFIG_NAME, IGNORED_DIRS, PreviewList, Project, ProjectConfig,
    guess_document, is_ours, under_ignored_directory,
)

log = logging.getLogger("nexttex.session")

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

# How long after a version is written before the browser tabs are told.
# A tick of the watcher records a `git pull`'s forty files one after
# another, and the history panel wants one event for the lot.
HISTORY_EVENT_DELAY = 0.3

# And longer still for a document nobody is looking at.  A background
# preview does not need to join every typing pause; it needs to be right by
# the time somebody switches to it.
BACKGROUND_DEBOUNCE = 4.0


@dataclass
class DocumentState:
    """One previewed document, and everything that is true only of it.

    All of this was a single slot on the session, which was correct while a
    project had one document. Each field here is something two documents
    must not share: a jobname and a PDF, a scheduler with its own idea of
    whether the next build must be a full one, a build counter the client
    matches results against, and its own diagnostics.
    """

    path: str
    paths: ProjectPaths
    compiler: CompileScheduler
    build_id: int = 0
    #: The build currently running for this document, or 0. `build_id` says
    #: how many have started and `last_result` whether one has ever
    #: finished; neither says whether one is running *now*, which is what a
    #: browser that connected after `compile_start` went out has to be told.
    in_flight: int = 0
    last_result: CompileResult | None = None
    diagnostics: list[dict] = field(default_factory=list)
    debounce: asyncio.Task | None = None
    unsettled: bool = False


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


#: What a subscriber's queue receives instead of an event when the server
#: has given up on it.  The SSE generator ends its response on seeing this,
#: which is what makes the browser's EventSource reconnect.
CLOSED = object()


class Broadcaster:
    """Fan out one event stream to every connected browser tab."""

    def __init__(self, after: Callable[[dict], None] | None = None) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        #: Told about every event after it has gone out, so the session can
        #: react to what its own routes publish without each route having
        #: to remember to.
        self._after = after

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=512)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    @property
    def watchers(self) -> int:
        """How many browsers are holding this project's event stream open."""
        return len(self._subscribers)

    async def publish(self, event: dict) -> None:
        if self._after is not None:
            self._after(event)
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A tab that has stopped reading must not stall the server
                # or block every other tab.
                #
                # Dropping it from the set is not enough on its own, and the
                # comment that used to sit here claimed otherwise: the
                # generator is still reading that queue, so it would serve
                # 512 stale events and then keepalive on a queue nobody ever
                # writes to again.  EventSource never sees an error, so it
                # never reconnects, and the tab shows a frozen project for
                # as long as it stays open.  Emptying the queue and leaving
                # a sentinel ends the response instead, which is the event
                # the browser actually reacts to.
                self._subscribers.discard(queue)
                self._close(queue)

    @staticmethod
    def _close(queue: asyncio.Queue) -> None:
        while True:
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        try:
            queue.put_nowait(CLOSED)
        except asyncio.QueueFull:  # pragma: no cover -- just emptied
            pass


def spawn(coro, what: str) -> asyncio.Task | None:
    """Start a task nobody awaits, and make sure it cannot fail in silence.

    Without the callback, an exception in one of these is delivered when
    the task is garbage collected -- as a warning, on a thread nobody is
    reading, possibly minutes later and possibly never.  Every one of these
    tasks is doing something the interface depends on.

    Returns None when there is no loop to start it on.  That became
    reachable when writes stopped coming only from request handlers: a
    shared document is flushed on shutdown and from tests, on threads with
    no loop running, and `create_task` raising there would turn "the file
    was written" into "the file was written and then an exception".  The
    work skipped is always a rebuild or a broadcast -- worth having, never
    worth losing the write for.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        coro.close()
        log.debug("%s was skipped: no event loop is running", what)
        return None
    task = asyncio.create_task(coro)

    def done(finished: asyncio.Task) -> None:
        if finished.cancelled():
            return
        error = finished.exception()
        if error is not None:
            log.error("%s failed: %s: %s", what, type(error).__name__, error)

    task.add_done_callback(done)
    return task


def _said_before(event: dict) -> list[dict]:
    """An agent event, and anything the conversation should say first.

    A turn the writer stopped ends mid-sentence, and a reply that stops at
    "an alphabet of two d" reads as Claude's whole answer unless something
    says otherwise; every provider ends a stopped turn with a `done` whose
    subtype is `interrupted`, so a plain notice goes before it, recorded in
    the transcript like any other line, and a reload shows it too.
    """
    if event.get("type") == "done" and event.get("subtype") == "interrupted":
        return [{"type": "notice", "message": "Stopped."}, event]
    return [event]


class ProjectSession:
    def __init__(
        self,
        project: Project,
        model: str | None = None,
        provider: str = "claude",
        api_key: str = "",
        base_url: str = "",
        settings: Callable[[], Settings] | None = None,
    ):
        self.project = project
        #: The install's settings, asked for when a build needs them: the
        #: server hands in its live object, and a session built without
        #: one, as the tests do, reads the file.  Two builds read it, the
        #: latexmk rc switch and the shell-escape list, and both are
        #: answers a writer changes while the session is open.
        self.settings: Callable[[], Settings] = settings or Settings.load
        #: When a request last asked for this session.  A session can always
        #: be rebuilt from disk, so this is not state, it is a hint about
        #: whether holding it open is still earning its memory.
        self.touched = time.monotonic()
        #: Set once the project's folder has been found missing, and set
        #: while the session is being closed, so the folder going away
        #: during the close does not start a second one.
        self.root_lost = False
        self.closing = False
        #: What the server does when the folder is gone: closes this
        #: session and restarts the watcher.  Assigned by whoever opened it.
        self.on_root_lost: Callable[[], Awaitable[None]] | None = None
        self.context = ProjectContext(project.state_dir)
        self.transcript = Transcript(project.state_dir / "transcript.jsonl")
        self.history = History(project.state_dir / "history")
        self.symbols = SymbolCache(project.root)
        #: When the contents nothing refers to were last swept out of
        #: this project's history.  The reaper reads it; see COLLECT_EVERY.
        #:
        #: Negative infinity rather than 0.0, and the difference is not
        #: pedantry.  This is compared against `time.monotonic()`, whose
        #: zero is an arbitrary point -- the boot, on Linux -- so 0.0 is
        #: not "never", it is "when this machine started".  A server
        #: launched at login, which is how every install of this is set
        #: up, therefore swept nothing at all for its first hour of
        #: uptime.  A sentinel compared against a clock has to be a value
        #: that clock can never return.
        self.collected_at = float("-inf")
        self.trash = Trash(
            project.state_dir / "trash", self.history, project.root,
            # The trash writes versions straight onto the history rather
            # than through `record_version`, so it needs its own way of
            # saying whose install this is.  Unstamped means "written here"
            # to whoever receives it.
            identity=lambda: {"peer": self._peer_id(), "who": self._peer_name()},
        )
        self.library = Library(project.state_dir / "library")
        self.dictionary = ProjectDictionary(project.state_dir)
        self.grammar_ignores = GrammarIgnores(project.state_dir)
        self.events = Broadcaster(after=self._after_publish)
        #: The project's scripts, run from the source pane or by the agent,
        #: announced on the stream and remembered under `.nexttex/runs/`.
        #: Every run flushes the shared documents first: the disk trails
        #: the editor by the debounce, and the script the writer just
        #: edited has to be the one that runs.
        self.scripts = ScriptRuns(
            project.root, project.state_dir,
            # Looked up at publish time rather than bound here, so a test
            # that spies on the broadcaster sees these events too.
            lambda event: self.events.publish(event),
            before_run=lambda: self.collab.flush(),
        )
        #: The pending re-scan of the document graph, see `_after_publish`.
        self._rescan: asyncio.TimerHandle | None = None
        #: The loop this session lives on, so a version recorded on a
        #: worker thread can reach the event stream; None for a session a
        #: test builds with no loop running, which has no stream to reach.
        try:
            self._loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None
        self._history_nudge: asyncio.TimerHandle | None = None
        self._history_pending: set[str] = set()
        self.history.listen(self._history_changed)

        # One build at a time across the project, the document on screen
        # first -- see BuildQueue.
        self.queue = BuildQueue()
        # Skipping what the tree skips: without this the walk descends into
        # build/, .git/ and node_modules, which is both slow and wrong --
        # a .tex under build/ is output, not a document.
        self.deps = DependencyGraph(project.root, skip=self._not_the_writers)
        self.documents: dict[str, DocumentState] = {}
        # The strip as this install last had it.  A project opened here for
        # the first time inherits what an older toml called `main` and
        # `previews`; one with neither gets the best guess, which is nothing
        # at all for a folder with no document in it yet.
        self.previews = PreviewList(project.state_dir)
        #: Moves a route has started and not yet reconciled: the rename
        #: route puts its move here before it renames on disk, so any pass
        #: of `reconcile_documents` that runs in between reads the document
        #: as moving rather than gone. And one pass at a time.
        self.moving: dict[str, str] = {}
        self._reconciling = asyncio.Lock()
        remembered = self.previews.load()
        never_written = remembered is None
        if remembered is None:
            remembered = list(project.config.inherited_documents)
        for name in remembered:
            try:
                self._register(name)
            except (ValueError, OSError):
                # An entry pointing at a file that has since been deleted or
                # renamed must not stop the project opening.
                continue
        if not self.documents:
            guess = guess_document(project.root)
            if guess is not None:
                try:
                    self._register(guess)
                except (ValueError, OSError):
                    pass
        #: Which document the writer is looking at.  It goes first in the
        #: queue and waits the shorter debounce.  Empty while the project has
        #: no document.
        self.visible = next(iter(self.documents), "")
        if never_written or remembered != list(self.documents):
            self.previews.save(list(self.documents))

        # Which agent -- Claude, OpenAI, or none at all -- and a scripted
        # stand-in ahead of all three when a test asks for one, so the whole
        # interface can be driven without a model, an account or a network.
        self.agent = agent_for(
            provider,
            project.root,
            project.state_dir,
            # The project's own instructions, plus a fixed-length pointer to
            # the writer's collected papers when there are any.
            context_prompt=self._agent_context,
            has_voice=lambda: self.context.voice_summary.exists(),
            # What earlier conversations were told to keep.  The context
            # store owns it so both providers get the same text.
            remember=self.context.remember,
            editor_state=lambda: self._editor_state,
            diagnostics=lambda: self._diagnostics,
            compile_now=self.compile,
            documents=lambda: list(self.documents),
            run_script=lambda path: self.scripts.run(
                self.project.relative(path), by="agent",
            ),
            apply_edit=self.write_from_agent,
            on_edit=self.note_agent_edit,
            reveal=self.reveal_in_editor,
            show_page=self.show_page,
            model=model or None,
            api_key=api_key,
            base_url=base_url,
        )

        self._editor_state: dict = {}
        #: Documents with an edit waiting for the debounce to fire.
        self._dirty: set[str] = set()
        #: Whether the edits noted since the last build named no document
        #: at all, which is an answer, "nothing reads it", and not the
        #: silence an empty `_dirty` otherwise is.
        self._read_by_none = False

        # Files this server has just written, by mtime.  The watcher uses
        # this to tell the user's own save apart from an outside change; the
        # browser must not be told to reload a buffer it just sent us.
        self.recently_written: dict[str, int] = {}
        self._agent_pump: asyncio.Task | None = None
        self._focus: Path | None = None

        # The project as shared documents, with the files on disk as their
        # projection.  Built last because it reaches back into this session
        # for the four things a write has always done here -- suppress the
        # watcher, record a version, tell the compiler, schedule a build --
        # and all four have to exist first.
        self.collab = CollabStore(project, self)
        self.collab.adopt()
        # The history is keyed by the manifest's file ids, and the store is
        # what knows them: bound here, once the store exists, and a store
        # still keyed by path slug is migrated on the way.
        self.history.bind(self.collab.key_for, self.collab.records())
        self.sync = SyncHub(self.collab)
        #: The other installs this project is shared with, if any. Built
        #: here but not started: a project that has never been shared opens
        #: no sockets and contacts nothing.
        self.peers = PeerNetwork(self.collab, self.sync, self)

    def _not_the_writers(self, path: Path) -> bool:
        """Whether a file is output or machinery rather than the writing."""
        try:
            parts = path.relative_to(self.project.root.resolve()).parts
        except ValueError:
            return True
        if self.project.build_dir.name in parts:
            return True
        if any(part in IGNORED_DIRS or is_ours(part) for part in parts):
            return True
        return under_ignored_directory(self.project.root, Path(*parts))

    # -- documents ---------------------------------------------------------
    def _register(self, relative: str) -> DocumentState:
        """Give a document its own paths, scheduler and build counter."""
        target = self.project.resolve(relative)
        if not target.is_file():
            raise ValueError(f"no such file: {relative}")
        name = str(target.relative_to(self.project.root.resolve()))
        existing = self.documents.get(name)
        if existing is not None:
            return existing
        paths = ProjectPaths(
            root=self.project.root, main=target, build_dir=self.project.build_dir
        )
        # Jobnames are what keep two documents' output apart, and they come
        # from the stem -- so `intro.tex` and `chapters/intro.tex` would both
        # build to `intro.pdf`. Refused rather than worked around: a build
        # directory per document would move main.pdf and break every Makefile
        # pointed at it.
        for other in self.documents.values():
            if other.paths.jobname == paths.jobname:
                raise ValueError(
                    f"{other.path} already builds to {paths.jobname}.pdf -- "
                    "rename one of them"
                )
        state = DocumentState(
            path=name, paths=paths, compiler=self.scheduler_for(paths),
        )
        self.documents[name] = state
        return state

    def scheduler_for(self, paths: ProjectPaths) -> CompileScheduler:
        """A build scheduler wired to this project's choices and this
        machine's permissions.

        The rc switch is read here rather than carried down from the
        route, because a writer who turns it on wants their next build to
        have it, not their next restart; the engine and the shell-escape
        answer are asked for at each build for the same reason, through
        callables, since both change while the session is open.
        """
        return CompileScheduler(
            paths, allow_rc=self.settings().latexmk_rc,
            engine_setting=lambda: self.project.config.engine,
            shell_escape=self.shell_escape_state,
        )

    def shell_escape_state(self) -> str:
        """"off" when the project does not ask for shell escape, "asked"
        when it does and this machine has not allowed it for this project,
        "on" when both hold.  The project asks in its own `nexttex.toml`;
        the machine answers in `Settings.shell_escape_allowed`, where a
        project cannot bring the answer along."""
        if not self.project.config.shell_escape:
            return "off"
        if self.project.id in self.settings().shell_escape_allowed:
            return "on"
        return "asked"

    def document_for(self, name: str | None) -> DocumentState:
        """The named document, or the visible one when nothing is named.

        An empty name is what every caller written before several documents
        existed sends, and it used to mean the main document; the document
        on screen is what those callers were reaching for.  Raises
        `LookupError` when the project has no document at all, which the
        routes turn into a 404 that says so.
        """
        if name:
            state = self.documents.get(name)
            if state is not None:
                return state
        state = self.visible_document
        if state is None:
            raise LookupError("this project has no document to typeset yet")
        return state

    @property
    def visible_document(self) -> DocumentState | None:
        """The document in front, or the first registered, or None.

        There is no main document.  Every root `.tex` is a document, the one
        on screen is the one every unqualified request means, and a project
        with nothing in it yet has none.
        """
        state = self.documents.get(self.visible)
        if state is not None:
            return state
        return next(iter(self.documents.values()), None)

    @property
    def paths(self) -> ProjectPaths:
        """The visible document's, for the routes that only ever meant one."""
        return self.document_for(None).paths

    @property
    def compiler(self) -> CompileScheduler:
        return self.document_for(None).compiler

    @property
    def last_result(self) -> CompileResult | None:
        state = self.visible_document
        return state.last_result if state is not None else None

    @property
    def _diagnostics(self) -> list[dict]:
        """Everything wrong with the project, across every document.

        The agent asks for this, and an error in the supplementary
        information is an error in the project. Visible document first, so
        the most likely answer is at the top.
        """
        out: list[dict] = []
        for name in self._visible_first(self.documents):
            out.extend(self.documents[name].diagnostics)
        return out

    def _visible_first(self, names) -> list[str]:
        ordered = [name for name in self.documents if name in set(names)]
        ordered.sort(key=lambda name: name != self.visible)
        return ordered

    def _owns(self, state: DocumentState, path: Path | None) -> bool:
        """Does this document read that file?"""
        if path is None:
            return False
        relative = self.relative_or_none(str(path))
        return bool(relative) and relative in self.deps.reachable([state.path])

    async def register_preview(self, relative: str) -> DocumentState:
        """Start previewing another document in this project."""
        before = set(self.documents)
        state = self._register(relative)
        if state.path not in before:
            if not self.visible:
                self.visible = state.path
            self.previews.save(list(self.documents))
        await self._publish_documents()
        return state

    async def follow(self, relative: str) -> DocumentState:
        """The document a file belongs to, previewed and brought in front.

        This is what the editor calls when a `.tex` file comes to the front
        of its own strip.  A part previews the document that reads it, up
        the whole chain; a root previews itself, registering it if it was
        not on the strip.  Raises `LookupError` for a fragment nothing reads
        that cannot build on its own, and `ValueError` when the root would
        share a jobname with a document already registered.
        """
        name = str(self.project.resolve(relative).relative_to(self.project.root.resolve()))
        # A registered document is its own answer, however many other roots
        # happen to read it too: a writer who opened it wants to see it.
        if name in self.documents:
            self.visible = name
            return self.documents[name]
        prefer = self._visible_first(self.documents)
        root = self.deps.root_of(name, prefer=prefer)
        if root is None:
            raise LookupError(
                f"nothing reads {name} and it has no \\documentclass and "
                "\\begin{document} of its own, so there is nothing to preview"
            )
        if root in self.documents:
            self.visible = root
            return self.documents[root]
        state = await self.register_preview(root)
        self.visible = root
        return state

    async def unregister_preview(self, relative: str) -> None:
        name = str(self.project.resolve(relative).relative_to(self.project.root.resolve()))
        if name not in self.documents:
            return
        if len(self.documents) == 1:
            raise ValueError(
                "the last document stays on the strip; a preview with "
                "nothing in it would have no way to get anything back"
            )
        order = list(self.documents)
        state = self.documents.pop(name)
        await self._retire(state)
        self.previews.save(list(self.documents))
        if self.visible == name:
            # The neighbour on the left, the way a browser lands after
            # closing a tab, and the first when the first was closed.
            at = order.index(name)
            self.visible = order[at - 1] if at > 0 else order[1]
        await self._publish_documents()

    async def _retire(self, state: DocumentState) -> None:
        """Stop a document building and take its stand-in off disk."""
        if state.debounce is not None and not state.debounce.done():
            state.debounce.cancel()
        await state.compiler.cancel()
        state.compiler.cleanup()

    async def reconcile_documents(
        self,
        *,
        moved: dict[str, str] | None = None,
        gone: list[str] | tuple[str, ...] = (),
    ) -> None:
        """Keep the strip in step with the files it names.

        Nothing did.  A previewed `main.tex` renamed to `thesis.tex` left
        `documents` keyed by a path that no longer existed, with a scheduler
        that would build a missing file, `previews.json` naming the old
        path and the tab wearing the old name until the next open quietly
        dropped it; a deleted document stayed registered and its stale PDF
        went on being served.  Every path a change can arrive by comes
        through here: the rename and delete routes name what moved or
        went, the watcher's re-scan names nothing and the check against the
        disk finds it, and a peer's rename arrives through `note_moved`.

        A moved document, or one under a moved folder, is re-registered
        under its new name at the same place on the strip, visible if it
        was, and given a build so its page comes back without a keystroke.
        A gone one, or one whose file is no longer there, leaves; the
        "last document stays" refusal is for the writer's own close
        gesture and does not apply, so a strip whose only document was
        deleted becomes empty, which the pane already draws.  A move whose
        new name would share a jobname with another document on the strip
        cannot be registered, so it leaves too, and the notice says so:
        the strip silently staying put is the failure a writer cannot work
        out the cause of.  Nothing matched means nothing published, so a
        chapter's rename does not redraw every strip.

        One pass at a time, and every pass reads the moves a route has
        announced: the rename route renamed the file and then awaited, and
        a watcher-driven pass in that gap found the old name missing and
        dropped it, so the route's own pass had nothing to rename and the
        new name arrived at the end of the strip rather than in its place,
        a flake of the 24 September runs that was this race.
        """
        async with self._reconciling:
            await self._reconcile_documents({**self.moving, **(moved or {})}, gone)

    async def _reconcile_documents(
        self, moved: dict[str, str], gone: list[str] | tuple[str, ...],
    ) -> None:
        away = set(gone)

        def under(path: str, prefix: str) -> bool:
            return path == prefix or path.startswith(prefix + "/")

        def destination(path: str) -> str | None:
            for old, new in moved.items():
                if under(path, old):
                    return new + path[len(old):]
            return None

        order = list(self.documents)
        # What each document becomes: its own name, a new one, or nothing.
        fate: dict[str, str | None] = {}
        for name in order:
            target = destination(name)
            if target is not None:
                fate[name] = target
            elif any(under(name, g) for g in away):
                fate[name] = None
            elif not self.project.resolve(name).is_file():
                fate[name] = None
            else:
                fate[name] = name
        changed = any(fate[name] != name for name in order)
        if not changed:
            return

        renamed: dict[str, str] = {}
        notices: list[str] = []
        for name in order:
            if fate[name] == name:
                continue
            await self._retire(self.documents[name])
            # Out of the registry before any new name goes in: `_register`
            # checks jobnames against everything registered, so a same-stem
            # move, `main.tex` to `old/main.tex`, would collide with itself.
            self.documents.pop(name, None)
        for name in order:
            target = fate[name]
            if target is None or target == name:
                continue
            try:
                replacement = self._register(target)
            except (ValueError, OSError) as error:
                notices.append(str(error))
                continue
            renamed[name] = replacement.path
        # The strip in its old order, with each new name where the old
        # one was.
        self.documents = {
            renamed.get(name, name): self.documents[renamed.get(name, name)]
            for name in order
            if renamed.get(name, name) in self.documents
        }
        if self.visible in renamed:
            self.visible = renamed[self.visible]
        elif self.visible not in self.documents:
            # The nearest survivor on the left of where it was, the way
            # `unregister_preview` lands after closing a tab, else the first.
            at = order.index(self.visible) if self.visible in order else 0
            left = [renamed.get(n, n) for n in order[:at]]
            survivors = [n for n in reversed(left) if n in self.documents]
            self.visible = survivors[0] if survivors else next(iter(self.documents), "")
        self.previews.save(list(self.documents))
        await self._publish_documents(
            renamed=renamed, notice="; ".join(notices)
        )
        for new in renamed.values():
            spawn(self.compile(document=new), "rebuilding a renamed document")

    def note_moved(self, was: str, now: str) -> None:
        """A file moved by something other than the rename route: a peer.

        The route tells every tab itself; a peer's rename lands on disk
        through the collaboration store, which cannot await, so this
        spawns what the route does inline: the strip first, so a browser
        moves both strips in one write, then the tabs, then the tree.
        """
        async def follow() -> None:
            await self.reconcile_documents(moved={was: now})
            await self.events.publish({"type": "renamed", "from": was, "to": now})
            await self.events.publish(
                {"type": "files_changed", "paths": [now], "structural": True}
            )

        spawn(follow(), "following a peer's rename")

    def note_arrived(self, relative: str) -> None:
        """A file a peer sent has just been written here.

        The tree draws from events, and the watcher skips this install's
        own writes, so without this a figure that arrived from a
        collaborator was on disk and nowhere on screen until the next
        reload.
        """
        spawn(
            self.events.publish(
                {"type": "files_changed", "paths": [relative], "structural": True}
            ),
            "announcing a file a peer sent",
        )

    def note_root_lost(self) -> None:
        """The project's folder is gone from this disk.

        Deleted, moved, or on a drive that went away: the store cannot
        tell and does not need to.  What it needs is for nothing more to
        be written or published from here, and for the person at the
        keyboard to hear that this copy is gone rather than that the
        project is.  Every other collaborator's copy is untouched, and the
        registry row already says the folder is missing, so the browser is
        sent back to the list, where it can find the folder again or
        rejoin from the others.
        """
        if self.root_lost or self.closing:
            return
        self.root_lost = True
        log.warning(
            "the folder for %s is gone from this disk; closing the project. "
            "Other collaborators are unaffected.", self.project.root,
        )

        async def announce() -> None:
            await self.events.publish({
                "type": "root_lost",
                "name": self.project.config.name,
                "shared": bool(self.peers.share.share_id),
            })
            if self.on_root_lost is not None:
                await self.on_root_lost()

        spawn(announce(), "closing a project whose folder is gone")

    def note_comments(self) -> None:
        """A thread changed, from this install or a peer. Called inside the
        manifest's transaction, so it only enqueues."""
        spawn(self.events.publish({"type": "comments_changed"}), "announcing a comment")

    def note_clash(self, path: str, parted: str) -> None:
        """Two people made the same new file while apart, and the store has
        kept them as two (Q-009).  Said once, in the notices, on every
        machine, since each one's store parts them the same way."""
        message = (
            f"Two people made {path} while apart. One of them is now "
            f"{parted}; nothing was merged."
        )

        async def announce() -> None:
            await self.events.publish({"type": "file_notice", "message": message})
            await self.events.publish(
                {"type": "files_changed", "paths": [path, parted], "structural": True}
            )

        spawn(announce(), "announcing a file kept beside another")

    def note_trashed(self, was: str) -> None:
        """A file a peer deleted has just been moved into this trash, or
        one the watcher saw go has just been called deleted.

        The store cannot await, and the tree and the trash panel both
        draw from events: without these the file left the disk and
        nothing on screen said so.
        """
        async def announce() -> None:
            await self.events.publish({"type": "trash_changed"})
            # `gone` closes the tab, the way the delete route's event does.
            await self.events.publish(
                {"type": "files_changed", "paths": [was], "structural": True, "gone": [was]}
            )

        spawn(announce(), "announcing a peer's deletion")

    def _after_publish(self, event: dict) -> None:
        """Re-scan the documents when the files they are found among change.

        A `.tex` file made, uploaded, renamed, restored or written by the
        agent can be a new document, or can start or stop reading another,
        and until this the strip's `+` and the row menus learned that only
        when the project was next opened: the tutorial said NextTex finds
        documents for you, and it found them once.  Debounced, because a
        template load publishes one event per file and the scan reads every
        `.tex` nothing reads.
        """
        if event.get("type") != "files_changed":
            return
        paths = event.get("paths") or []
        # The project's own settings file, saved in the editor or changed
        # outside.  It was read once when the project opened, so `engine =
        # "xelatex"` typed into it did nothing until the next restart, and
        # the sheet went on showing the value from before the edit.
        if any(str(path) == CONFIG_NAME for path in paths):
            spawn(self.reload_config(), "re-reading nexttex.toml")
        if paths and not event.get("structural") and not any(
            str(path).lower().endswith((".tex", ".ltx")) for path in paths
        ):
            return
        loop = asyncio.get_running_loop()
        if self._rescan is not None:
            self._rescan.cancel()
        self._rescan = loop.call_later(
            0.3, lambda: spawn(self._publish_documents(), "re-scanning the documents")
        )

    async def reload_config(self) -> None:
        """Re-read `nexttex.toml` and tell every tab what it now says.

        The same event the settings sheet's own writes publish, so the
        sheet and the drawer learn of an edit made in the editor the way
        they learn of a switch flipped on the sheet.
        """
        self.project.config = await asyncio.to_thread(
            ProjectConfig.load, self.project.root
        )
        await self.events.publish({"type": "project_changed", **self.settings_payload()})

    def settings_payload(self) -> dict:
        """Everything `project_changed` carries: the previewed documents and
        the project's settings, with this machine's answer on shell escape.

        Carried in the event rather than looked up afterwards.  The browser
        used to answer this event by re-fetching `open`, the whole file
        tree and the whole transcript, to learn one string, which on a
        forty-file project with a long conversation is a real cost for a
        switch being flipped.
        """
        config = self.project.config
        return {
            "previews": list(self.documents),
            "visible": self.visible,
            "autocompile": config.autocompile,
            "markErrors": config.mark_errors,
            "markWarnings": config.mark_warnings,
            "engine": config.engine,
            "shellEscape": self.shell_escape_state(),
            "pageLimit": config.page_limit,
            "blind": config.blind,
            "pdfa": config.pdfa,
            "language": config.language,
        }

    def documents_payload(self) -> dict:
        """What can be previewed, what already is, and who reads what."""
        names = list(self.documents)
        return {
            "previews": names,
            "candidates": self.deps.standalone_candidates(names),
            "owners": self.deps.reverse(names),
            "visible": self.visible,
        }

    async def _publish_documents(self, *, renamed: dict[str, str] | None = None,
                                 notice: str = "") -> None:
        # Spawned from a timer, so it can land after `close`; a closed
        # session has nobody to tell and no store to open documents in.
        if self.closing:
            return
        self.deps.invalidate()
        # A document whose file has gone leaves here, which is the path an
        # outside `mv`, an `rm`, a `git checkout` or the agent's own shell
        # take: they reach this only as the watcher's `files_changed`.
        if renamed is None and any(
            not self.project.resolve(name).is_file() for name in self.documents
        ):
            await self.reconcile_documents()
            return
        payload = {"type": "previews_changed", **self.documents_payload()}
        if renamed:
            payload["renamed"] = renamed
        if notice:
            payload["notice"] = notice
        await self.events.publish(payload)

    # -- editor -----------------------------------------------------------
    def note_selection(self, selection: dict) -> None:
        """Fold a selection sent with a question into the editor state.

        The cursor is reported on a 400 ms debounce, which is right for
        something that changes on every keystroke and wrong for this: select
        a paragraph, click Send, and the question can beat the selection to
        the server. So the question carries its own copy and it lands here,
        where `editor_state` will find it.
        """
        state = dict(self._editor_state)
        state["selection"] = selection.get("text") or ""
        if selection.get("file"):
            state["file"] = selection["file"]
        if isinstance(selection.get("fromLine"), int):
            state["selectionFrom"] = selection["fromLine"]
        if isinstance(selection.get("toLine"), int):
            state["selectionTo"] = selection["toLine"]
        self.set_editor_state(state)

    def set_editor_state(self, state: dict) -> None:
        self._editor_state = state
        # Which preview tab is in front.  It builds first and waits the
        # shorter debounce, so the server has to be told when it changes.
        showing = state.get("preview")
        if showing and showing in self.documents:
            self.visible = showing
        path = state.get("file")
        if path:
            try:
                self._focus = self.project.resolve(path)
            except (PermissionError, OSError):
                self._focus = None

    def compile_snapshot(self) -> dict:
        """What a browser that has just connected has missed.

        `compile_start` is published to whoever is subscribed at that
        instant and there is no backlog, so a tab that opens a project and
        starts a build in the same breath regularly misses its own: the
        `EventSource` constructor returns before the connection exists, and
        the strip then said Ready for the whole of the first build.

        The same absence is the reason a lost `compile_done` latches the
        strip on Compiling for ever, which is the older half of the same
        bug. A flag raised by one event and lowered only by another needs a
        way to be *read* rather than only listened for, and this is it: the
        stream sends it as its first frame, so every connection and every
        reconnection begins by being told the truth.
        """
        return {
            "type": "compile_state",
            "documents": [
                {
                    "document": name,
                    "compiling": state.in_flight != 0,
                    "build": state.in_flight or state.build_id,
                    "everBuilt": state.last_result is not None,
                }
                for name, state in self.documents.items()
            ],
        }

    def peers_snapshot(self) -> dict:
        """The other thing a browser that has just connected has missed.

        `collab_peers` is published when sharing begins, when a peer
        arrives and when one goes, and the browser keeps what it hears in
        one place. It has no way to ask. So a tab whose `EventSource` was
        not connected at the moment `begin_sharing` published, and every
        tab that reloads a project that was already shared, believed the
        project was not shared at all: the People drawer offered no invite
        and the strip showed nobody, on a project with members in it.

        This is the same fault `compile_snapshot` above exists for, one
        flag along, and it has the same answer. A flag raised by an event
        and lowered by another needs a way to be read rather than only
        listened for, so the stream sends this as its second frame and
        every connection begins by being told the truth.

        `PeerNetwork.state` is a dictionary comprehension over the members
        already in memory, so this costs nothing worth measuring. Guarded
        for the same reason `_announce_peers` is: a stand-in session in the
        tests is not a `ProjectSession`.
        """
        peers = getattr(self, "peers", None)
        if peers is None:
            return {}
        return {"type": "collab_peers", **peers.state()}

    def as_client_dict(self, result: CompileResult, document: str = "") -> dict:
        """A build result with paths the browser can match against.

        The log gives absolute paths.  Everything the client holds -- the
        open file, the tabs, the tree -- is relative to the project root, so
        an absolute path here silently matches nothing and the error marks
        never appear beside the line that caused them.
        """
        payload = result.as_dict()
        payload["document"] = document or self.visible
        # Stamped on each diagnostic as well as on the payload: the client
        # merges the documents' diagnostics into one list, and without this
        # it could not tell whose a given error was when replacing them.
        payload["diagnostics"] = annotate([
            {**item, "file": self.relative_or_none(item.get("file")),
             "document": payload["document"]}
            for item in payload.get("diagnostics", [])
        ])
        # Where to start, in words, with no model involved.  A writer using
        # NextTex without an agent still gets told which error is the cause
        # and which are its consequences.
        payload["summary"] = summarise(payload["diagnostics"])
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
    async def compile(
        self, force_full: bool = False, document: str | None = None,
        settling: bool = False,
    ) -> CompileResult:
        """Build one document, and let it settle.

        Compile as you type is one engine pass, and one pass typesets
        against the last pass's `.aux`, `.bbl` and `.out`: wherever an
        edit changed what a reference, a citation or a page number says,
        that pass's page flow, and with it where the floats land, is one
        pass behind.  The engine says so in its log ("Label(s) may have
        changed. Rerun", "Some pages have been shifted"), and for a year
        nothing read it: the preview rested on the unconverged layout
        until the writer forced a whole build, which is how a figure sat
        on the wrong page until Rebuild everything.  So a fast pass that
        leaves the document unconverged is followed by one *settling*
        build, a full pass, after its own result has gone out: the preview
        shows the fast pass at once and the settled layout a moment
        later.  The settling build takes the same road as any other, the
        cancel and the queue, so a keystroke supersedes it; it never
        spawns a second, so a package that always asks for a rerun cannot
        loop; and it is spawned rather than awaited, so the route and the
        agent's tool get the fast result when it is ready.
        """
        state = self.document_for(document)
        # Every build carries an id, and its result carries the same one.
        # A cancelled build's result arrives *after* its replacement has
        # already started, so a client clearing "compiling" on any cancelled
        # result would clear it for the build that is still running -- which
        # under the status dot means a dot that breathes for ever.
        #
        # The counter is per document. A shared one would let a build of the
        # supplementary information invalidate the main document's pending
        # result, and main's dot would breathe for ever instead.
        state.build_id += 1
        build = state.build_id
        state.in_flight = build
        await self.events.publish(
            {"type": "compile_start", "build": build, "document": state.path,
             "settling": settling}
        )
        # Supersede any build of this same document *before* joining the
        # queue. A request that queued first would be waiting for a slot
        # held by the very build it means to replace, and neither would
        # ever finish.
        await state.compiler.cancel()
        # The scoping hint only means anything to the document that reads
        # the file it points at.
        focus = self._focus if self._owns(state, self._focus) else None
        async with self.queue.slot(priority=state.path == self.visible):
            result = await state.compiler.build(focus=focus, force_full=force_full)
        payload = self.as_client_dict(result, state.path)
        # A superseded build carries no log.  Keeping its empty diagnostics
        # would clear the editor's error marks every time the user typed
        # during a compile, which is exactly when they are looking at them.
        if result.outcome is not Outcome.CANCELLED:
            if result.scope != "full":
                self._keep_unopened(state, result, payload)
            state.last_result = result
            state.diagnostics = payload.get("diagnostics", [])
        # Only if this is still the build in flight: a superseded one
        # finishing must not say the newer one has stopped.
        if state.in_flight == build:
            state.in_flight = 0
        await self.events.publish(
            {"type": "compile_done", "build": build, "document": state.path,
             "settling": settling, **payload}
        )
        if self._unsettled_by(state, result, build, settling):
            spawn(
                self.compile(force_full=True, document=state.path, settling=True),
                "the settling build",
            )
        return result

    def _keep_unopened(
        self, state: DocumentState, result: CompileResult, payload: dict,
    ) -> None:
        """Keep what a scoped build could not see.

        A build scoped to one chapter through `\\includeonly` never opens
        the other chapters, so its log says nothing about them, and taking
        its list as the document's whole list made an error still in
        chapter one vanish from the gutter, the drawer and the strip the
        moment the writer typed in chapter two (Q-017).  So the diagnostics
        of every file this build did not open are carried over from the
        last list, until a build that opens them says otherwise.
        """
        opened = {
            self.relative_or_none(str(path))
            for path in (result.log.opened if result.log else ())
        }
        kept = [
            item for item in state.diagnostics
            if item.get("file") and item["file"] not in opened
        ]
        if not kept:
            return
        merged = kept + payload.get("diagnostics", [])
        payload["diagnostics"] = merged
        payload["errorCount"] = sum(1 for d in merged if d.get("severity") == "error")
        payload["warningCount"] = sum(1 for d in merged if d.get("severity") == "warning")
        payload["summary"] = summarise(merged)

    @staticmethod
    def _unsettled_by(
        state: DocumentState, result: CompileResult, build: int, settling: bool,
    ) -> bool:
        """Whether this build's document needs a settling build after it.

        Only a fast pass that finished, was not superseded (a newer build
        is in flight, and it will settle itself), compiled without error
        (a full pass of a broken document fixes nothing), and whose log
        asked for another run or left the citations or references in a
        state the scheduler has already marked for a full pass.
        """
        if settling or result.engine_pass != "fast" or result.outcome is not Outcome.OK:
            return False
        if state.in_flight not in (0, build):
            return False
        if result.log is not None and result.log.rerun_needed:
            return True
        return state.compiler.needs_full

    def schedule_compile(self) -> None:
        """Build once typing has settled, replacing any pending build.

        Gated here rather than in the editor because only two of its many
        callers are the writer's own keystrokes: the rest are the agent's
        edits, uploads, restores, template loads and the watcher's sightings
        of an outside write, and a switch called "compile as you type" that
        let those keep building would not be the switch it says it is.  The
        three paths that reach `compile()` directly -- the manual button,
        the agent's own compile tool, and the build on opening a project --
        are deliberately unaffected; none of them is "as you type".

        Which documents are built is decided by `note_edit`, which knows
        what was edited.  An empty set means nobody said -- an upload, a
        restore -- and everything registered is rebuilt.
        """
        if not self.project.config.autocompile:
            return
        if not self._dirty and self._read_by_none:
            # Every edit since the last build was to a file no document
            # reads, a Markdown note: nothing to build.
            self._read_by_none = False
            return
        self._read_by_none = False
        targets = self._visible_first(self._dirty or set(self.documents))
        self._dirty = set()

        for name in targets:
            state = self.documents[name]
            if state.debounce is not None and not state.debounce.done():
                state.debounce.cancel()
            delay = UNSETTLED_DEBOUNCE if state.unsettled else COMPILE_DEBOUNCE
            if name != self.visible:
                delay = max(delay, BACKGROUND_DEBOUNCE)
            state.debounce = spawn(
                self._wait_then_build(name, delay), "the debounced build"
            )

        # Told now rather than when the build starts.  Between a keystroke
        # and the build there is a second and a half in which the preview is
        # out of date and nothing on screen says so; with autocompile off
        # there is no build coming at all, and "out of date" is where the
        # document rests until the writer asks for one.
        spawn(
            self.events.publish(
                {"type": "compile_scheduled", "documents": targets}
            ),
            "publishing compile_scheduled",
        )

    async def _wait_then_build(self, name: str, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        await self.compile(document=name)

    def note_edit(
        self,
        path: Path,
        text: str | bytes | None = None,
        previous: str | bytes | None = None,
    ) -> None:
        """Tell the documents that read this file that it changed.

        This is where the rebuild policy lives. Editing a chapter rebuilds
        the document that includes it; editing the supplementary information
        rebuilds only that. `schedule_compile` then builds what is listed
        here, so the callers of it need no idea any of this happened.
        """
        relative = self.relative_or_none(str(path))
        if relative:
            self.deps.note_changed(relative)
            # Visible first, so the fallback for a `.tex` nobody reads yet,
            # which is the first document listed, is the one on screen.
            owners = self.deps.owners(relative, self._visible_first(self.documents))
        else:
            # Outside the project, so nothing can be said about who reads
            # it.  Rebuilding everything is the safe direction.
            owners = list(self.documents)
        self._dirty.update(owners)
        if not owners:
            self._read_by_none = True

        binary = isinstance(text, bytes) or isinstance(previous, bytes)
        for name in owners:
            state = self.documents.get(name)
            if state is None:
                continue
            if binary:
                # A figure rather than prose.  There is no half-finished
                # equation to wait for, and the honest answer for the build
                # is "rebuild everything" -- which is what None means to the
                # compiler, and is right anyway: a new figure changes the
                # layout of every page after it.
                state.unsettled = False
                state.compiler.note_edit(path, None, None)
            else:
                state.unsettled = text is not None and mid_construct(text)
                state.compiler.note_edit(path, text, previous)

    # -- version history ---------------------------------------------------
    def _history_changed(self, key: str) -> None:
        """A file's log gained a version; tell the tabs, a moment later.

        Hung off the history's own hook rather than `record_version`, for
        the reasons `PeerNetwork._teach_history` gives: the trash records
        straight onto the history, and a collaborator's lines absorbed
        through sync are versions this install's panel should show.  The
        panel used to learn of a version only from the next build, so a
        `.md` typed into showed nothing new until it was reopened.

        Recording runs on worker threads, so this hops to the loop first;
        and it is debounced, because an editing burst is one version and a
        `git pull` is forty files in one tick: one event naming every path,
        not one per file.
        """
        loop = self._loop
        if loop is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
            self._loop = loop
        if loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._nudge_history, key)
        except RuntimeError:
            pass

    def _nudge_history(self, key: str) -> None:
        self._history_pending.add(key)
        if self._history_nudge is not None:
            self._history_nudge.cancel()
        self._history_nudge = asyncio.get_running_loop().call_later(
            HISTORY_EVENT_DELAY, self._say_history_changed,
        )

    def _say_history_changed(self) -> None:
        self._history_nudge = None
        keys, self._history_pending = self._history_pending, set()
        paths = sorted(
            path for path in (self.history.path_of(key) for key in keys) if path
        )
        if not paths or self.closing:
            return
        spawn(
            self.events.publish({"type": "history_changed", "paths": paths}),
            "announcing new versions",
        )

    def _agent_context(self) -> str:
        parts = [self.context.prompt_section(), self.library.prompt_section()]
        return "\n\n".join(part for part in parts if part)

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
        # Stamped with this install's identity, so a collaborator receiving
        # it knows whose it was.  Empty for a project that has never been
        # shared, which is what every record written before any of this says
        # and what keeps an unshared project's log exactly as it was.
        self.history.record(
            relative, text, by=by, why=why, op=op, source=source,
            peer=self._peer_id(), who=self._peer_name(),
        )

    def _peer_id(self) -> str:
        """This install's identity, but only once the project is shared.

        An unshared project has no peers, so stamping every version with an
        id nobody will ever compare it against would be noise in a file
        people read.
        """
        peers = getattr(self, "peers", None)
        if peers is None or not peers.share.shared:
            return ""
        return peers.peer_id

    def _peer_name(self) -> str:
        peers = getattr(self, "peers", None)
        if peers is None or not peers.share.shared:
            return ""
        record = peers.share.members.get(peers.peer_id) or {}
        return str(record.get("name") or "")

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
        self._into_the_document(path, text)
        self.note_edit(path, text, previous)
        self.schedule_compile()
        self._note_context_written(path)
        spawn(
            self.events.publish({
                "type": "files_changed",
                "paths": [self.project.relative(path)],
                "byAgent": True,
            }),
            "announcing an agent edit",
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
        self._into_the_document(path, after)
        self.note_edit(path, after, before)
        self.schedule_compile()
        self._note_context_written(path)

    def _note_context_written(self, path: Path) -> None:
        """A distillation the agent wrote is news the context panel needs.

        `voice.md` and `style.md` land under `.nexttex/`, which the file
        watcher ignores by design, so nothing published `context_changed`
        and the panel's "read these now" marker stayed as it was computed
        when the panel last looked, on a summary that had just been
        rewritten.  Both agent write paths end here.
        """
        try:
            written = path.resolve()
            summaries = {
                self.context.style_summary.resolve(),
                self.context.voice_summary.resolve(),
            }
        except OSError:
            return
        if written in summaries:
            spawn(
                self.events.publish({"type": "context_changed"}),
                "announcing a rewritten summary",
            )

    def _into_the_document(self, path: Path, text: str | None) -> None:
        """Fold an agent's write into the shared document.

        The agent's tools write to disk, and `mark_written` then tells the
        watcher to ignore it -- correctly, because the watcher's job is to
        catch writes NextTex did not make.  But that also means the shared
        document would never hear about an agent edit, and every browser
        with the file open would sit on text the agent had already replaced.

        The version is recorded by the caller, before this, so the edit
        keeps its `by="claude"` and the transcript's undo chip still matches
        a version.  Ingesting sets the projection's echo guard, so this does
        not come back around and write the file a second time.
        """
        try:
            relative = self.project.relative(path)
        except (ValueError, OSError):
            return
        try:
            self.collab.ingest(relative, text, by="claude")
        except Exception:
            # A shared document that cannot take an edit must not stop the
            # agent finishing its turn; the file on disk is already right.
            #
            # Said out loud, though.  The visible consequence is that the
            # browser goes on showing text the agent has already replaced,
            # which reads to the writer as the agent having done nothing --
            # and in silence there was no way to tell that from a turn that
            # genuinely changed nothing.
            log.warning("could not fold the agent's edit to %s into the "
                        "shared document", relative, exc_info=True)

    def show_page(self, document: str, page: int) -> str:
        """Ask every open window to put a document's page in front.

        The agent's half of what a double-click on the page is for the
        writer: `goto` moves the editor, and nothing moved the preview,
        so an agent reviewing a long document could name a page and not
        show it.  The document has to be one on the strip, because the
        strip is what the pane can show; an empty name is the one in
        front.  Returns the document's path, or raises `LookupError`.
        """
        if document and document not in self.documents:
            raise LookupError(f"{document} is not a document on the preview strip")
        state = self.document_for(document or None)
        spawn(
            self.events.publish(
                {"type": "show_page", "document": state.path, "page": max(1, int(page))}
            ),
            "showing a page of the preview",
        )
        return state.path

    def reveal_in_editor(self, path: str, line: int) -> None:
        """Ask the open editor to show a line."""
        spawn(
            self.events.publish({"type": "reveal", "path": path, "line": line}),
            "revealing a line in the editor",
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
            async for arrived in self.agent.events():
                for event in _said_before(arrived):
                    await forward(event)

        async def forward(event: dict) -> None:
            # Recorded before it is broadcast, so the panel and the file
            # on disk always show the same conversation -- and so an
            # event that arrives while nobody is watching is still kept.
            # One unserialisable tool argument used to kill this task,
            # and with it every later event including `done`: the panel
            # then said Claude was thinking, forever.
            try:
                event = self.transcript.record(event)
            except Exception:
                # The transcript is the account of what was done to
                # somebody's dissertation.  It may not take the whole
                # turn down, which is why this is caught at all, but a
                # record that quietly stops recording is the one failure
                # here nobody would ever notice on their own.
                log.warning("the transcript did not record a %s event",
                            event.get("type", "?"), exc_info=True)
            try:
                await self.events.publish({"scope": "agent", **event})
            except asyncio.CancelledError:
                raise
            except Exception:
                return

        self._agent_pump = spawn(pump(), "the agent event pump")

    async def reap_idle_agent(self) -> None:
        if self.agent.busy:
            return
        if self.agent.idle_seconds > AGENT_IDLE_TIMEOUT:
            await self.agent.disconnect()

    def in_use(self) -> bool:
        """Whether anything is still relying on this session being open.

        A session can be rebuilt from disk on the next request, so evicting
        one is never a question of losing state.  It is a question of what
        would be interrupted, and four things would.  A browser holding the
        event stream, a browser holding an editing socket, an agent turn in
        flight, and a shared project, which is counted as in use whether or
        not a collaborator is connected this second: closing the peer network
        is what takes the project off the network, and somebody who was told
        they could reach it should be able to.
        """
        return bool(
            self.events.watchers
            or any(self.sync.rooms.values())
            or self.agent.busy
            or self.peers.share.share_id
        )

    async def close(self) -> None:
        self.closing = True
        # A re-scan the watcher armed is cancelled before the store closes,
        # not after: it fires 0.3 s after a file lands, and a session that
        # closed inside that window had it fire into a closed store, open
        # the new file's document there and subscribe to it, and that
        # subscription was then dropped by the garbage collector on
        # whatever thread ran next, which pycrdt says out loud.  The route
        # tests wrote a file and finished in under 0.3 s often enough for
        # the full suite to carry the warning for months.
        if self._rescan is not None:
            self._rescan.cancel()
            self._rescan = None
        # First, so anything still only in a document reaches the disk
        # before the project stops being open.
        await self.peers.close()
        self.sync.close()
        self.collab.close()
        if self._agent_pump is not None and not self._agent_pump.done():
            self._agent_pump.cancel()
        await self.agent.disconnect()
        await self.scripts.close()
        for state in list(self.documents.values()):
            await self._retire(state)
