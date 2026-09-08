"""Per-project runtime state: the compiler, the agent, and who is listening.

One `ProjectSession` exists per open project. It owns the objects that must
not be duplicated -- a compile scheduler that serialises builds, an agent
holding a Claude session -- and the fan-out that lets several browser tabs
watch the same project.
"""

from __future__ import annotations

import asyncio
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
from nexttex.dictionary import ProjectDictionary
from nexttex.atomic import read_text, write_atomically
from nexttex.config import Settings
from nexttex.history import History
from nexttex.symbols import SymbolCache
from nexttex.trash import Trash
from server.collab.peers import PeerNetwork
from server.collab.store import CollabStore
from server.collab.sync import SyncHub
from server.transcript import Transcript
from nexttex.project import IGNORED_DIRS, Project, is_ours

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


class ProjectSession:
    def __init__(
        self,
        project: Project,
        model: str | None = None,
        provider: str = "claude",
        api_key: str = "",
    ):
        self.project = project
        self.context = ProjectContext(project.state_dir)
        self.transcript = Transcript(project.state_dir / "transcript.jsonl")
        self.history = History(project.state_dir / "history")
        self.symbols = SymbolCache(project.root)
        self.trash = Trash(project.state_dir / "trash", self.history, project.root)
        self.library = Library(project.state_dir / "library")
        self.dictionary = ProjectDictionary(project.state_dir)
        self.events = Broadcaster()

        # One build at a time across the project, the document on screen
        # first -- see BuildQueue.
        self.queue = BuildQueue()
        # Skipping what the tree skips: without this the walk descends into
        # build/, .git/ and node_modules, which is both slow and wrong --
        # a .tex under build/ is output, not a document.
        self.deps = DependencyGraph(project.root, skip=self._not_the_writers)
        self.documents: dict[str, DocumentState] = {}
        main = self._register(project.config.main)
        #: Which document the writer is looking at.  It goes first in the
        #: queue and waits the shorter debounce.
        self.visible = main.path
        for extra in list(project.config.previews):
            try:
                self._register(extra)
            except (ValueError, OSError):
                # A previews entry pointing at a file that has since been
                # deleted or renamed must not stop the project opening.
                continue

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
            apply_edit=self.write_from_agent,
            on_edit=self.note_agent_edit,
            reveal=self.reveal_in_editor,
            model=model or None,
            api_key=api_key,
        )

        self._editor_state: dict = {}
        #: Documents with an edit waiting for the debounce to fire.
        self._dirty: set[str] = set()

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
        return any(part in IGNORED_DIRS or is_ours(part) for part in parts)

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
            path=name, paths=paths,
            # Read here rather than carried down from the route, because a
            # writer who turns it on wants their next build to have it, not
            # their next restart.
            compiler=CompileScheduler(paths, allow_rc=Settings.load().latexmk_rc),
        )
        self.documents[name] = state
        return state

    def document_for(self, name: str | None) -> DocumentState:
        """The named document, or the main one when nothing is named.

        An empty name is what every caller written before this existed
        sends, and it means what it always meant.
        """
        if name:
            state = self.documents.get(name)
            if state is not None:
                return state
        return self.main_document

    @property
    def main_document(self) -> DocumentState:
        # Insertion order: main is registered first and stays first, which
        # is also the order the preview tabs are drawn in.
        return next(iter(self.documents.values()))

    @property
    def paths(self) -> ProjectPaths:
        """The main document's, for the routes that only ever meant that."""
        return self.main_document.paths

    @property
    def compiler(self) -> CompileScheduler:
        return self.main_document.compiler

    @property
    def last_result(self) -> CompileResult | None:
        return self.main_document.last_result

    @property
    def _diagnostics(self) -> list[dict]:
        """Everything wrong with the project, not just with its main file.

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
        state = self._register(relative)
        if state.path != self.main_document.path:
            listed = self.project.config.previews
            if state.path not in listed:
                listed.append(state.path)
                self.project.config.save(self.project.root)
        await self._publish_documents()
        return state

    async def unregister_preview(self, relative: str) -> None:
        name = str(self.project.resolve(relative).relative_to(self.project.root.resolve()))
        if name == self.main_document.path:
            raise ValueError("the main document is always previewed")
        state = self.documents.pop(name, None)
        if state is None:
            return
        await self._retire(state)
        if name in self.project.config.previews:
            self.project.config.previews.remove(name)
            self.project.config.save(self.project.root)
        if self.visible == name:
            self.visible = self.main_document.path
        await self._publish_documents()

    async def _retire(self, state: DocumentState) -> None:
        """Stop a document building and take its stand-in off disk."""
        if state.debounce is not None and not state.debounce.done():
            state.debounce.cancel()
        await state.compiler.cancel()
        state.compiler.cleanup()

    def documents_payload(self) -> dict:
        """What can be previewed, what already is, and who reads what."""
        names = list(self.documents)
        return {
            "previews": names,
            "candidates": self.deps.standalone_candidates(names),
            "owners": self.deps.reverse(names),
            "main": self.main_document.path,
        }

    async def _publish_documents(self) -> None:
        self.deps.invalidate()
        await self.events.publish(
            {"type": "previews_changed", **self.documents_payload()}
        )

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

    def as_client_dict(self, result: CompileResult, document: str = "") -> dict:
        """A build result with paths the browser can match against.

        The log gives absolute paths.  Everything the client holds -- the
        open file, the tabs, the tree -- is relative to the project root, so
        an absolute path here silently matches nothing and the error marks
        never appear beside the line that caused them.
        """
        payload = result.as_dict()
        payload["document"] = document or self.main_document.path
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
        self, force_full: bool = False, document: str | None = None
    ) -> CompileResult:
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
        await self.events.publish(
            {"type": "compile_start", "build": build, "document": state.path}
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
            state.last_result = result
            state.diagnostics = payload.get("diagnostics", [])
        await self.events.publish(
            {"type": "compile_done", "build": build, "document": state.path, **payload}
        )
        return result

    def schedule_compile(self) -> None:
        """Build once typing has settled, replacing any pending build.

        Gated here rather than in the editor because only two of the twelve
        callers are the writer's own keystrokes: the rest are the agent's
        edits, uploads, restores and template loads, and a switch called
        "compile as you type" that let those keep building would not be the
        switch it says it is.  The three paths that reach `compile()`
        directly -- the manual button, the agent's own compile tool, and
        the build on opening a project -- are deliberately unaffected;
        none of them is "as you type".

        Which documents are built is decided by `note_edit`, which knows
        what was edited.  An empty set means nobody said -- an upload, a
        restore -- and everything registered is rebuilt.
        """
        if not self.project.config.autocompile:
            return
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
        here, so the twelve callers of it need no idea any of this happened.
        """
        relative = self.relative_or_none(str(path))
        if relative:
            self.deps.note_changed(relative)
            owners = self.deps.owners(relative, list(self.documents))
        else:
            # Outside the project, so nothing can be said about who reads
            # it.  Rebuilding everything is the safe direction.
            owners = list(self.documents)
        self._dirty.update(owners)

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

    async def set_main(self, relative_path: str) -> None:
        """Point the project at a different main document.

        This used to tear the one scheduler down and build another, because
        the jobname comes from the main file's stem and a compiler writing
        chapter.pdf while the PDF route served main.pdf was the hazard to
        avoid. Every document has its own scheduler and its own PDF now, and
        the route names which one it wants, so the swap is a reordering
        rather than a rebuild.
        """
        outgoing = self.main_document.path
        self.project.config.main = relative_path
        state = self._register(relative_path)
        # Main is first, and first is the order the preview tabs are drawn
        # in.
        self.documents = {
            state.path: state,
            **{k: v for k, v in self.documents.items() if k != state.path},
        }
        # Main is previewed by definition, so it does not also need listing.
        if state.path in self.project.config.previews:
            self.project.config.previews.remove(state.path)
        # The document that was main stays only if somebody asked for it.
        # Anything else would make `previews` mean something other than
        # "explicitly requested", and leave tabs accumulating quietly.
        if outgoing != state.path and outgoing not in self.project.config.previews:
            leaving = self.documents.pop(outgoing, None)
            if leaving is not None:
                await self._retire(leaving)
        self.project.config.save(self.project.root)
        if self.visible not in self.documents:
            self.visible = state.path
        await self._publish_documents()

    # -- version history ---------------------------------------------------
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
            pass

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

        self._agent_pump = spawn(pump(), "the agent event pump")

    async def reap_idle_agent(self) -> None:
        if self.agent.busy:
            return
        if self.agent.idle_seconds > AGENT_IDLE_TIMEOUT:
            await self.agent.disconnect()

    async def close(self) -> None:
        # First, so anything still only in a document reaches the disk
        # before the project stops being open.
        await self.peers.close()
        self.sync.close()
        self.collab.close()
        if self._agent_pump is not None and not self._agent_pump.done():
            self._agent_pump.cancel()
        await self.agent.disconnect()
        for state in list(self.documents.values()):
            await self._retire(state)
