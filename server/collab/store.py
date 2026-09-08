"""The project as a set of CRDT documents, and the files on disk as their shadow.

NextTex used to answer "two people are editing this file" by refusing the
second one.  A save carried a hash of what the browser last agreed the file
said, and a save whose hash had moved on was rejected and offered back as a
banner.  That is the right answer when the two writers are the same person in
two tabs and one of them is stale.  It is the wrong answer when they are two
people, both right, both typing now.

So the file is a CRDT, and what is on disk is a projection of it.  Every
project is backed this way, shared or not: one code path rather than two, and
the day two tabs stopped being able to destroy each other was worth having on
its own.

## The shape

**One document per text file**, plus a manifest listing them.  Not one
document for the whole project, which is the obvious choice and the wrong
one: a two-megabyte thesis with a year of tombstones behind it would be a
multi-megabyte download every time the project opened, and the browser needs
the files it has open, not all forty.  It also means a remote cursor decodes
against the document it was made in, which is what `y-codemirror.next`
requires and would otherwise have to be worked around.

**Keyed by file id, never by path.**  Rename `intro.tex` to `ch1.tex` on one
peer while somebody is typing into it on another, and the text has to land in
the same document regardless.  Paths are a *property* of a file here, not its
name.  For a project NextTex has seen before, that id is
`history.slug_for(path)` -- the same sha16 the version log is already keyed by
-- so an existing project's whole history stays attached with no migration at
all.

**Text or binary is decided once, when the file is first seen.**  The
tempting rule is to demote anything over a couple of megabytes to a blob, and
it is a trap: one peer pasting a huge table would flip the kind and delete
the shared text while another peer's keystrokes were still landing in it.

## The two directions, and the loop between them

`ingest` takes what is now on disk and folds it into the document.  `project`
takes what the document says and writes it to disk.  Run carelessly, those
two make a loop: a write triggers the watcher, the watcher ingests, the
ingest triggers a projection, the projection writes.

Three things stop it, and all three are needed.

1. **A projection is idempotent by construction.**  `ingest` diffs, so
   ingesting text a file already holds produces no operations at all.
2. **`_projecting` marks the file while its own write is in flight**, because
   the watcher's 120 ms granularity is wider than the gap between writing a
   file and hearing about it.
3. **`last_projected` remembers the exact string this peer last wrote**, and
   an ingest of precisely that string is dropped as an echo.  This is the one
   that catches the case the other two miss: a write that lands, is noticed,
   and comes back after the flag has already been cleared.

## Attribution

An edit that arrives through `ingest` has no author -- it is a diff against a
file, and the file does not say who wrote it.  So the agent does *not* write
to disk and let the watcher find it; it writes into the document directly,
with its own origin, and keeps the attribution the transcript's undo chip
depends on.  `ingest` is for genuinely external writers -- `git pull`, an
editor in another terminal -- and records those as such.
"""

from __future__ import annotations

import asyncio
import difflib
import secrets
from pathlib import Path
from typing import Callable

from pycrdt import Doc, Map, Text

from nexttex.atomic import read_text, write_atomically
from nexttex.history import slug_for
from nexttex.project import TEXT_SUFFIXES, Project

from . import persist

# How long a change sits in the document before it is written out.  The
# editor's own debounce was 250 ms and went over HTTP; this one is local and
# only has to coalesce a burst of keystrokes into one write, so it can be
# shorter without costing anything.
PROJECT_DEBOUNCE = 0.12

# A text file bigger than this is carried as a blob rather than as a shared
# document.  A CRDT costs per character, and a generated `.bbl` or a pasted
# data table is not something two people co-edit a line of.  Applied when a
# file is first seen and never again -- see the note above about mode
# switches.
MAX_TEXT_BYTES = 2 * 1024 * 1024

# Origins.  Every transaction carries one so the projection can tell an edit
# that came *from* disk from one that has to go *to* it.
FROM_DISK = "disk"
FROM_AGENT = "agent"


def minimal_edit(before: str, after: str) -> tuple[int, int, str]:
    """(start, end, replacement) -- the smallest single splice turning one
    string into the other.

    Trimming the common prefix and suffix rather than replacing the whole
    text is what keeps a `git pull` from destroying a collaborator's
    concurrent typing everywhere in the file except the part that actually
    changed.
    """
    if before == after:
        return (0, 0, "")
    start = 0
    limit = min(len(before), len(after))
    while start < limit and before[start] == after[start]:
        start += 1
    end_before, end_after = len(before), len(after)
    while (
        end_before > start
        and end_after > start
        and before[end_before - 1] == after[end_after - 1]
    ):
        end_before -= 1
        end_after -= 1
    return (start, end_before, after[start:end_after])


def edits_for(before: str, after: str) -> list[tuple[int, int, str]]:
    """A short list of splices turning `before` into `after`.

    One splice is right for a keystroke and wrong for a `git pull` that
    changed three paragraphs in a long chapter: the single splice covering
    them would span everything in between, so a collaborator editing a
    fourth paragraph inside that span would lose it.  `difflib` finds the
    changed runs; anything it cannot help with falls back to one splice.
    """
    if before == after:
        return []
    if not before or not after:
        return [(0, len(before), after)]

    matcher = difflib.SequenceMatcher(None, before, after, autojunk=False)
    spans = [
        (i1, i2, after[j1:j2])
        for tag, i1, i2, j1, j2 in matcher.get_opcodes()
        if tag != "equal"
    ]
    # Applied back to front, so an earlier splice's indices are still valid
    # after a later one has been made.
    spans.reverse()
    return spans or [minimal_edit(before, after)]


def _root(doc: Doc, name: str, kind):
    """A document's root container, created if this document has none.

    `doc[name]` is not enough.  A root that arrived in an update -- which is
    every root in a document read back from disk -- comes out of `doc[name]`
    as None rather than as the container it is, and nothing raises.  The
    typed accessor answers properly, and assigning is still what creates one.
    """
    if name in doc:
        return doc.get(name, type=kind)
    doc[name] = made = kind()
    return made


class CollabStore:
    """Every shared document belonging to one project.

    Owned by a `ProjectSession`, and reaches back into it for the four things
    a write has always done here: suppress the watcher, record a version,
    tell the compiler, and schedule a build.  Going through those rather than
    around them is what makes a collaborator's typing move the PDF.
    """

    def __init__(self, project: Project, session=None) -> None:
        self.project = project
        self.session = session
        self.root = project.state_dir / "collab" / "docs"

        self.manifest = Doc()

        self.texts: dict[str, Doc] = {}
        self._body: dict[str, Text] = {}
        self._subscriptions: list = []

        # The three guards against a write loop.  See the module docstring.
        self._projecting: set[str] = set()
        self.last_projected: dict[str, str] = {}

        self._dirty: set[str] = set()
        # Documents whose log has grown since it was last considered for
        # compaction.  Not compacted where it is noticed: that needs to read
        # the document, and it is noticed from inside a transaction.
        self._grown: set[str] = set()
        self._timer: asyncio.TimerHandle | None = None
        self._closed = False
        # Told whenever a document moves, with the update that moved it.
        # A list rather than one slot: the browsers watching this project and
        # the peers syncing with it both need to hear, and neither should
        # have to know the other exists.
        self.listeners: list[Callable[[str, bytes], None]] = []

        self._load_manifest()

    # --- identity ---------------------------------------------------------

    def file_id_for(self, relative: str) -> str | None:
        for file_id, record in self.files.items():
            if record.get("path") == relative and not record.get("trashed"):
                return file_id
        return None

    def path_for(self, file_id: str) -> str | None:
        record = self.files.get(file_id)
        return record.get("path") if record else None

    def _new_id(self, relative: str) -> str:
        """The id a file gets the first time it is seen.

        A project NextTex already knows takes the slug its version log is
        keyed by, so the history a writer already has stays attached to the
        file it belongs to without a migration step.  A genuinely new file
        gets random bytes, because two peers creating a file at the same
        path at the same moment must not collide on one document.
        """
        slug = slug_for(relative)
        if slug not in self.files:
            return slug
        return secrets.token_hex(8)

    # --- loading ----------------------------------------------------------

    def _load_manifest(self) -> None:
        """Read the manifest back, then take typed handles to its roots.

        The order matters, and so does `Doc.get(..., type=...)`.  A root type
        that arrived through `apply_update` rather than through assignment
        cannot be reached with `doc["files"]` -- that returns **None**,
        silently, with no error anywhere -- so a document loaded from disk
        looks empty to any code that indexes it.  Ask for the type and the
        same document answers correctly.
        """
        persist.load(self.root / "manifest.y", self.manifest)
        self.files = _root(self.manifest, "files", Map)
        self.meta = _root(self.manifest, "meta", Map)
        self._subscriptions.append(
            self.manifest.observe(self._manifest_changed)
        )

    def _manifest_changed(self, event) -> None:
        self._persist("manifest", event.update)
        self._moved("manifest", event.update)

    def _moved(self, doc_id: str, update: bytes) -> None:
        """Tell everyone watching. Runs inside the transaction that made the
        change, so a listener must only enqueue -- never read the document,
        and never block."""
        for listener in list(self.listeners):
            try:
                listener(doc_id, update)
            except Exception:
                # One deaf listener must not stop the others hearing.
                pass

    def document(self, doc_id: str):
        """The document a socket asked for, by the name it uses.

        `manifest` or `text/<file id>`, and nothing else -- the name comes
        off a URL, so anything not recognised is refused rather than
        guessed at.
        """
        if doc_id == "manifest":
            return self.manifest
        if doc_id.startswith("text/"):
            file_id = doc_id[len("text/"):]
            if self.body(file_id) is None:
                return None
            return self.texts.get(file_id)
        return None

    def _text_path(self, file_id: str) -> Path:
        return self.root / f"{file_id}.y"

    def body(self, file_id: str) -> Text | None:
        """The shared text of a file, opening its document if it is not open."""
        if file_id in self._body:
            return self._body[file_id]
        record = self.files.get(file_id)
        if record is None or record.get("kind") != "text":
            return None

        doc = Doc()
        persist.load(self._text_path(file_id), doc)
        text = _root(doc, "text", Text)

        self.texts[file_id] = doc
        self._body[file_id] = text
        self._subscriptions.append(doc.observe(self._watcher_for(file_id)))
        # What is on disk is the truth for a document being opened for the
        # first time; after that the document is.
        if not str(text):
            on_disk = self._read(record["path"])
            if on_disk:
                with doc.transaction(origin=FROM_DISK):
                    text += on_disk
                self.last_projected[file_id] = on_disk
        else:
            self.last_projected.setdefault(file_id, str(text))
        return text

    def _watcher_for(self, file_id: str) -> Callable:
        def observed(event) -> None:
            if self._closed:
                return
            self._persist(file_id, event.update)
            self._moved(f"text/{file_id}", event.update)
            # A change that came from disk is already on disk.
            if file_id in self._projecting:
                return
            self._dirty.add(file_id)
            self._schedule()

        return observed

    def _persist(self, name: str, update: bytes) -> None:
        """Add one update to a document's log.

        Called from inside the transaction that produced it, which is the
        constraint that shapes this: **nothing here may read the document.**
        pycrdt refuses a nested transaction -- `str(text)` and
        `doc.get_update()` both need one -- and the error it raises,
        "Already mutably borrowed", arrives from underneath an observer with
        no indication of which of them asked.

        So the update is handed in rather than derived, and compaction, which
        does have to read the document, waits for `_compact` on a path where
        no transaction is open.
        """
        try:
            persist.append(self.root / f"{name}.y", update)
        except OSError:
            pass
        self._grown.add(name)

    def _compact(self) -> None:
        """Squash any log that has outgrown a snapshot of its document.

        Only ever called with no transaction open -- see `_persist`.
        """
        pending, self._grown = self._grown, set()
        for name in pending:
            doc = self.manifest if name == "manifest" else self.texts.get(name)
            if doc is None:
                continue
            path = self.root / f"{name}.y"
            try:
                if persist.should_compact(path, doc):
                    persist.snapshot(path, doc)
            except OSError:
                pass

    # --- adopting the files that are there --------------------------------

    def adopt(self) -> None:
        """Bring every file in the project into the manifest.

        Run when a project is opened.  Idempotent: a file already listed is
        left exactly as it is, including its id, so opening a project twice
        does not renumber anything.
        """
        seen: set[str] = set()
        for relative, kind, size in self._walk():
            seen.add(relative)
            if self.file_id_for(relative) is not None:
                continue
            # The tree has already decided what is editable text, using the
            # same rule the file list draws with. Asking it rather than
            # re-deriving from the suffix keeps the two from disagreeing
            # about a file -- which would show as an openable file with no
            # shared document behind it.
            textual = kind == "text" and size <= MAX_TEXT_BYTES
            self.files[self._new_id(relative)] = Map({
                "path": relative,
                "kind": "text" if textual else "blob",
                "size": size,
                "trashed": False,
            })

        # A file listed but no longer there was deleted while this peer was
        # not looking.  Marked rather than removed: a map delete concurrent
        # with an edit is ambiguous, and a flag is not.
        for file_id, record in list(self.files.items()):
            if record.get("trashed"):
                continue
            if record.get("path") not in seen:
                record["trashed"] = True

    def _walk(self) -> list[tuple[str, str, int]]:
        """Every file in the project, as (path, kind, size)."""
        found: list[tuple[str, str, int]] = []

        def descend(node: dict) -> None:
            for child in node.get("children") or []:
                if child.get("type") == "dir":
                    descend(child)
                else:
                    found.append((
                        child["path"],
                        child.get("kind", "binary"),
                        int(child.get("size") or 0),
                    ))

        descend(self.project.tree())
        return found

    def _read(self, relative: str) -> str:
        try:
            return read_text(self.project.resolve(relative)) or ""
        except (OSError, ValueError):
            return ""

    # --- disk -> document -------------------------------------------------

    def ingest(self, relative: str, after: str | None, *, by: str = "external") -> bool:
        """Fold what is now on disk into the shared document.

        Returns whether anything changed.  `after` of None means the file is
        gone.  Every out-of-band writer comes through here: the file watcher,
        a restore from trash, an upload, a template.
        """
        adopted = False
        file_id = self.file_id_for(relative)
        if file_id is None:
            if after is None:
                return False
            # A file that appeared while we were not looking -- created in
            # another terminal, or arriving in a `git pull`.
            self.adopt()
            file_id = self.file_id_for(relative)
            if file_id is None:
                return False
            adopted = True
            # Opening it seeds the document from disk, so the diff below
            # will rightly find nothing to do. The manifest still gained a
            # file, which is the change worth reporting.
            self.body(file_id)

        if after is None:
            record = self.files.get(file_id)
            if record is not None and not record.get("trashed"):
                record["trashed"] = True
                return True
            return False

        # The echo guard.  This exact string is what we last wrote, so this
        # is our own write coming back around the loop.
        if self.last_projected.get(file_id) == after:
            return adopted

        text = self.body(file_id)
        if text is None:
            return False

        before = str(text)
        spans = edits_for(before, after)
        if not spans:
            return adopted

        self._projecting.add(file_id)
        try:
            with self.texts[file_id].transaction(origin=FROM_DISK):
                for start, end, replacement in spans:
                    if end > start:
                        del text[start:end]
                    if replacement:
                        text.insert(start, replacement)
        finally:
            self._projecting.discard(file_id)

        self.last_projected[file_id] = after
        return True

    # --- document -> disk -------------------------------------------------

    def _schedule(self) -> None:
        """Arrange for the changed documents to be written out shortly.

        This is reached from inside a transaction -- an observer is what
        marks a document dirty -- so it must not write anything itself.
        `_write` reads the document, and pycrdt refuses the nested
        transaction that needs, with an "Already mutably borrowed" raised
        from underneath the observer and no clue as to which of them asked.
        Even the fallback for "there is no event loop" has to stay hands
        off: a caller with no loop is a test driving the store directly, and
        it can say `flush()` when it means it.
        """
        if self._timer is not None or self._closed:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._timer = loop.call_later(PROJECT_DEBOUNCE, self._fire)

    def _fire(self) -> None:
        self._timer = None
        self.flush()

    def flush(self) -> None:
        """Write every changed document out, now."""
        pending, self._dirty = self._dirty, set()
        for file_id in pending:
            try:
                self._write(file_id)
            except OSError:
                # A read-only directory, or a disk that filled up.  The
                # document is still correct and still shared; only this
                # peer's copy of the file is behind.
                pass
        self._compact()

    def _write(self, file_id: str) -> None:
        record = self.files.get(file_id)
        text = self._body.get(file_id)
        if record is None or text is None or record.get("trashed"):
            return
        relative = record["path"]
        content = str(text)
        if self.last_projected.get(file_id) == content:
            return

        path = self.project.resolve(relative)
        previous = read_text(path)
        self._projecting.add(file_id)
        try:
            write_atomically(path, content)
            self.last_projected[file_id] = content
            session = self.session
            if session is not None:
                # The four things every write in this app has always done.
                # Skipping the first echoes; skipping the last two means the
                # page stops following a collaborator's typing, which is
                # most of the point of any of this.
                session.mark_written(path)
                session.record_version(path, content, previous=previous)
                session.note_edit(path, content, previous)
                session.schedule_compile()
        finally:
            self._projecting.discard(file_id)

    # --- shutting down ----------------------------------------------------

    def close(self) -> None:
        self.flush()
        self._closed = True
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        self.listeners.clear()
        for subscription in self._subscriptions:
            try:
                subscription.drop()
            except Exception:
                pass
        self._subscriptions.clear()
