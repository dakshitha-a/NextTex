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
import contextlib
import difflib
import logging
import re
import secrets
from pathlib import Path
from typing import Callable

from pycrdt import Doc, Map, Text

from nexttex.atomic import read_text, unique_name, write_atomically
from nexttex.history import slug_for
from nexttex.project import TEXT_SUFFIXES, Project

from . import persist

log = logging.getLogger("nexttex.collab")

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

# What a file id may look like.  Hex, because that is what this writes, and
# because anything that is not is a path waiting to happen -- these become
# file names under `.nexttex/collab/docs`, and the map they are keys of is
# written by other people.
_WELL_FORMED_ID = re.compile(r"[0-9a-f]{8,64}")

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


# How much text `difflib` is allowed to look at, character by character.
# `SequenceMatcher` is quadratic in the worst case, and on the whole of a
# fifty-kilobyte chapter that is not a figure of speech: appending one line
# to a chapter of the bench's synthetic thesis took **thirty-four seconds**
# before the trimming below existed. Past this, the comparison is done by
# line, which is both far cheaper and a better fit for LaTeX.
CHARWISE_LIMIT = 4096

# And past *this*, not at all: a replacement of a whole large file gets one
# splice. It is the honest answer anyway -- there is no useful correspondence
# between two versions of a file that differ everywhere.
LINEWISE_LIMIT = 400_000


def _spans_from(matcher, before_at, after_text, offsets_before, offsets_after):
    """Opcodes as (start, end, replacement), in the original coordinates."""
    spans = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        spans.append((
            before_at + offsets_before[i1],
            before_at + offsets_before[i2],
            after_text[offsets_after[j1]:offsets_after[j2]],
        ))
    # Applied back to front, so an earlier splice's indices are still valid
    # after a later one has been made.
    spans.reverse()
    return spans


def edits_for(before: str, after: str) -> list[tuple[int, int, str]]:
    """A short list of splices turning `before` into `after`.

    One splice is right for a keystroke and wrong for a `git pull` that
    changed three paragraphs of a long chapter: the single splice covering
    them would span everything in between, so a collaborator editing a fourth
    paragraph inside that span would lose it.

    The work is done on the *middle* only.  Trimming the common prefix and
    suffix is linear and, for the overwhelmingly common shapes -- a
    keystroke, an appended paragraph, a rewritten sentence -- leaves almost
    nothing behind to compare.  That matters more than it sounds: this runs
    on every write NextTex did not make, and `difflib` over the whole of a
    large chapter is quadratic.
    """
    if before == after:
        return []
    if not before or not after:
        return [(0, len(before), after)]

    start, end_before, replacement = minimal_edit(before, after)
    middle_before = before[start:end_before]
    if len(middle_before) + len(replacement) > LINEWISE_LIMIT:
        return [(start, end_before, replacement)]

    if len(middle_before) + len(replacement) <= CHARWISE_LIMIT:
        matcher = difflib.SequenceMatcher(
            None, middle_before, replacement, autojunk=False,
        )
        return _spans_from(
            matcher, start, replacement,
            list(range(len(middle_before) + 1)),
            list(range(len(replacement) + 1)),
        ) or [(start, end_before, replacement)]

    # By line. A few thousand lines is a comparison `difflib` is good at,
    # and a change to a chapter is a change to some of its lines.
    before_lines = middle_before.splitlines(keepends=True)
    after_lines = replacement.splitlines(keepends=True)
    before_offsets = [0]
    for line in before_lines:
        before_offsets.append(before_offsets[-1] + len(line))
    after_offsets = [0]
    for line in after_lines:
        after_offsets.append(after_offsets[-1] + len(line))

    matcher = difflib.SequenceMatcher(None, before_lines, after_lines, autojunk=False)
    return _spans_from(
        matcher, start, replacement, before_offsets, after_offsets,
    ) or [(start, end_before, replacement)]


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
        # path -> file_id, built on demand and thrown away whenever the
        # manifest moves.  See `file_id_for`.
        self._by_path: dict[str, str] | None = None

        # The three guards against a write loop.  See the module docstring.
        self._projecting: set[str] = set()
        #: True while a peer's update is being applied, so the watcher can
        #: tell a change made here from one made on somebody else's machine.
        #: A flag rather than the transaction's origin, because pycrdt's
        #: event does not carry one.
        self.applying_remote = False
        #: Files whose pending changes include at least one made here.  Only
        #: those get a version written when they are projected; see `_write`.
        self._authored: set[str] = set()
        #: What each file was called here, last time this machine looked.
        #: The manifest is the authority on a file's name, and following it
        #: means noticing when it has moved out from under what is on disk.
        self._named: dict[str, str] = {}
        #: Set when the manifest changes, cleared by the next flush.
        self._paths_moved = False
        self.last_projected: dict[str, str] = {}

        self._dirty: set[str] = set()
        # Files a peer proposed that this install will not write: a path that
        # leaves the project, or one of the control files.  Held so the
        # refusal is decided once rather than on every flush, and so it is
        # never retried -- a record naming `.git/hooks/pre-commit` will name
        # the same thing in 120 ms.
        self._refused: set[str] = set()
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

    @property
    def shared(self) -> bool:
        """Whether other installs hold this project too.

        Read from the file the peer network keeps rather than from the
        network object, because this is needed while a project is being
        opened -- before there is one -- and because it has to be true for a
        shared project whose peers are all offline.
        """
        return (self.project.state_dir / "collab" / "share.json").is_file()

    # --- identity ---------------------------------------------------------

    def file_id_for(self, relative: str) -> str | None:
        """The id a path is filed under, or None if it is not in the manifest.

        Backed by an index rather than a scan.  It reads like a lookup either
        way, which is what made the scan easy to leave in: `self.files` is a
        CRDT map, so `record.get("path")` is a call across the FFI boundary
        into Rust, and this is asked once per file while a project is being
        adopted -- quadratic, in the units that hurt.  On a thesis with two
        thousand files that alone was thirty milliseconds of every open, and
        it sat on the ingest path too, where it is reached for every write
        the watcher notices.

        The index is dropped whenever the manifest changes at all, from any
        cause, so a rename arriving from a collaborator invalidates it as
        surely as one made here.  Rebuilding is the scan that used to happen
        every time, now amortised over every lookup until the next change.

        Never call this from inside an observer: rebuilding reads the
        document, and an observer runs inside the transaction that fired it.
        """
        if self._by_path is None:
            self._by_path = paths = {}
            for file_id, record in self.files.items():
                if not record.get("trashed"):
                    # First wins, which is what the scan this replaces did.
                    paths.setdefault(record.get("path"), file_id)
        return self._by_path.get(relative)

    def path_for(self, file_id: str) -> str | None:
        record = self.files.get(file_id)
        return record.get("path") if record else None

    def _new_id(self, relative: str, adopting: bool = False) -> str:
        """The id a file gets the first time it is seen.

        Adopting a project NextTex already knows uses the slug its version
        log is keyed by, so an existing history stays attached to the file it
        belongs to with no migration step.

        Everything else gets random bytes, and the distinction matters.  The
        first version of this used the slug whenever *this* peer had not seen
        the path -- which is exactly the situation two collaborators are in
        when they both create `chapters/03.tex`.  They derived the same id
        from the same path, the two documents merged, and each of them ended
        up holding both chapters interleaved with nothing to say so.
        """
        if adopting:
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
        # Dropped rather than repaired: this runs inside the transaction that
        # fired it, where reading the document is not allowed.
        self._by_path = None
        # A file may have been renamed or deleted somewhere else.  Noted
        # here and acted on by the next flush, which is outside this
        # transaction: following it means touching the disk and the history,
        # and neither is allowed from in here.
        self._paths_moved = True
        self._persist("manifest", event.update)
        self._moved("manifest", event.update)
        self._schedule()

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

    def _log_path(self, name: str) -> Path:
        """Where a document's log lives, manifest included."""
        if name == "manifest":
            return self.root / "manifest.y"
        return self._text_path(name)

    def _text_path(self, file_id: str) -> Path:
        """Where a document's log lives.

        The id is checked rather than trusted.  It is a *key in a CRDT map*,
        and that map is written by every peer and by every authenticated
        browser through the manifest socket -- so "the name came off a URL and
        anything unrecognised is refused" was only true of a dictionary
        somebody else could fill in.  An id of `../../..` wrote outside the
        project, and created the directories on the way.
        """
        if not _WELL_FORMED_ID.fullmatch(file_id):
            raise ValueError(f"not a file id: {file_id[:40]!r}")
        return self.root / f"{file_id}.y"

    def body(self, file_id: str) -> Text | None:
        """The shared text of a file, opening its document if it is not open."""
        if file_id in self._body:
            return self._body[file_id]
        record = self.files.get(file_id)
        if record is None or record.get("kind") != "text":
            return None

        try:
            log = self._text_path(file_id)
        except ValueError:
            # An id that is not one. A manifest entry is written by other
            # people, so this is refused the way an unknown document is --
            # returning None -- rather than raised out of a socket handler.
            return None

        doc = Doc()
        had_a_log = persist.load(log, doc) >= 0
        text = _root(doc, "text", Text)

        self.texts[file_id] = doc
        self._body[file_id] = text
        self._subscriptions.append(doc.observe(self._watcher_for(file_id)))
        # What is on disk is the truth for a document being opened for the
        # first time; after that the document is.
        #
        # Except where the document exists elsewhere and merely has not
        # arrived, in which case seeding is actively dangerous.  A `.y` log
        # that is *present and unreadable* -- a sync tool's conflict copy,
        # one torn header -- would be re-seeded from disk as a fresh
        # insertion, and merging that with a peer who still has the original
        # produces every line of the file twice, silently.
        #
        # A log that was never there is a different matter: this document has
        # not existed here before, so building it from the file is exactly
        # right, and it is how the person who shares a project puts their own
        # work into it in the first place.
        if not str(text) and (not had_a_log or not self.shared):
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
            if not self.applying_remote:
                # Somebody at this keyboard, or this install's agent.  Noted
                # so that the projection knows whether it is writing this
                # install's own work or somebody else's; see `_write`.
                #
                # A flag rather than the transaction's origin, because
                # pycrdt's event does not carry one.
                self._authored.add(file_id)
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
            try:
                path = self._log_path(name)
            except ValueError:
                continue
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

        `shared` says whether other people hold this project too, because it
        changes what a missing file means -- see below.
        """
        shared = self.shared
        seen: set[str] = set()
        # Taken once. Asking `file_id_for` inside the loop would rebuild the
        # index on every iteration, because each file adopted changes the
        # manifest -- which is the quadratic cost this is here to avoid.
        known = {
            record.get("path")
            for record in self.files.values()
            if not record.get("trashed")
        }
        for relative, kind, size in self._walk():
            seen.add(relative)
            if relative in known:
                continue
            known.add(relative)
            # The tree has already decided what is editable text, using the
            # same rule the file list draws with. Asking it rather than
            # re-deriving from the suffix keeps the two from disagreeing
            # about a file -- which would show as an openable file with no
            # shared document behind it.
            textual = kind == "text" and size <= MAX_TEXT_BYTES
            self.files[self._new_id(relative, adopting=True)] = Map({
                "path": relative,
                "kind": "text" if textual else "blob",
                "size": size,
                "trashed": False,
            })

        # A file listed but no longer on disk was deleted while this peer was
        # not looking.  Marked rather than removed: a map delete concurrent
        # with an edit is ambiguous, and a flag is not.
        #
        # **Only for a project that is not shared.**  On a shared one, "the
        # manifest names a file this disk does not have" is the ordinary
        # state of a peer that has just joined, or of one that was killed
        # between a manifest record persisting and its projection landing.
        # Trashing them gossiped the deletion back to the person who had
        # shared the project, whose copy then stopped being written -- a
        # join could delete somebody else's chapters.
        if not shared:
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

    def untrash(self, original: str, relative: str, text: str | None) -> None:
        """A file coming back from the trash, under the id it had before.

        `file_id_for` skips trashed records, so an ordinary `ingest` would
        mint a *new* id for the same path and orphan the document -- and its
        history with it. Clearing the flag first is what keeps a restore a
        restore rather than a new file that happens to have the old name.

        `original` and `relative` differ when the old name had been taken
        and the file came back beside it.  This used to be told only the new
        name, which matched no trashed record at all, so a fresh id was
        minted after all: the original document stayed trashed for ever with
        a collaborator's offline edits sealed inside it, and that peer went
        on holding a stale file it could no longer write to.
        """
        for file_id, record in self.files.items():
            if record.get("path") == original and record.get("trashed"):
                record["trashed"] = False
                if relative != original:
                    record["path"] = relative
                break
        if text is not None:
            self.ingest(relative, text)

    def rename(self, old: str, new: str) -> None:
        """Follow a rename, keeping the document and everybody typing in it.

        A path is a *property* of a file here, so this is one write to one
        field.  Doing nothing instead was the worst bug in this feature: the
        manifest went on naming the old path, the watcher saw one file
        disappear and another appear and duly trashed the first and adopted
        the second, and the browser -- whose editor is bound to the original
        `Y.Text` -- carried on looking completely normal while nothing it
        typed reached the disk ever again. There is no autosave left to catch
        that, and on a shared project the trashing gossiped outwards.

        A folder move renames everything under it, for the same reason the
        editor's own buffer remap does: matching only the moved path itself
        leaves every file inside it pointing at a name that is gone.
        """
        prefix = f"{old}/"
        for file_id, record in list(self.files.items()):
            path = record.get("path") or ""
            if path == old:
                moved = new
            elif path.startswith(prefix):
                moved = f"{new}/{path[len(prefix):]}"
            else:
                continue
            record["path"] = moved
            # What was last written is still what is on disk; only its name
            # changed. Dropping this would make the next projection think the
            # file had moved on underneath it.
            if file_id in self.last_projected:
                self.last_projected[file_id] = self.last_projected[file_id]

    # --- disk -> document -------------------------------------------------

    def ingest(self, relative: str, after: str | None, *, by: str = "external",
               gone: bool = False) -> bool:
        """Fold what is now on disk into the shared document.

        Returns whether anything changed.  Every out-of-band writer comes
        through here: the file watcher, a restore from trash, an upload, a
        template, a restored version.

        **`after=None` means "nothing to say about this file", and only
        `gone=True` means it was deleted.**  Those were the same thing at
        first, and `read_text` returns None for a file it cannot *decode* as
        well as for one that is not there -- so every figure in the project
        was marked as deleted the moment it was rewritten, and a `.tex` with
        one stray latin-1 byte went the same way.  A trashed record stops
        being projected, so the file then quietly stopped being written for
        the rest of the session, and in a shared project the trashing
        gossiped to everybody else.
        """
        if after is None and not gone:
            return False
        if after is not None and not isinstance(after, str):
            # A figure, or a restored version of one. Binary files are
            # carried as blobs and have no shared text to fold anything into,
            # and handing bytes to a `Y.Text` raises from inside pycrdt with
            # a message about neither the file nor the caller.
            return False
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

        doc = self.texts.get(file_id)
        if doc is None:
            # `body` populates both maps together, so this is unreachable in
            # ordinary use -- but indexing straight into `texts` here meant a
            # KeyError rather than a no-op if it ever stopped being true, and
            # this is on the path every outside write takes.
            return False

        self._projecting.add(file_id)
        try:
            with doc.transaction(origin=FROM_DISK):
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

    def settle_paths(self) -> None:
        """Follow renames and deletions that were made somewhere else.

        A path is a *property* of a file in the manifest, so a rename is one
        field changing, which is what keeps everybody's editor pointed at the
        same document however often it is renamed.  What it does not do is
        move the file, and nothing here used to either.  So the other machine
        kept the old name with the old contents, the new name did not appear
        until somebody happened to type into that document, and then that
        machine had both -- with its history still filed under a name nothing
        would look up again.

        A deletion had the mirror of it.  The record is flagged, projection
        stops writing that file, and the file simply sits there: in the tree,
        written by nothing, with no trash entry and therefore no way for the
        person at that machine to put it back.  Worse, opening it in another
        editor made the watcher ingest a path whose record is trashed, and
        `file_id_for` skips trashed records, so that machine ended up with
        two documents for one path.

        Never called from inside the manifest's own transaction: it touches
        the disk and the history, and neither is allowed from in there.
        """
        if self._closed:
            return
        for file_id, record in list(self.files.items()):
            path = record.get("path") or ""
            if not path:
                continue
            was = self._named.get(file_id)
            if was is None:
                # First sight of this file. Nothing to follow yet; this is
                # the baseline the next change is measured against.
                self._named[file_id] = path
                continue
            if record.get("trashed"):
                if self._trash_locally(was):
                    self._named.pop(file_id, None)
            elif path != was:
                self._rename_locally(file_id, was, path)

    def _rename_locally(self, file_id: str, was: str, now_called: str) -> None:
        source = self.project.root / was
        try:
            target = self.project.resolve_for_write(now_called)
        except (PermissionError, OSError, ValueError):
            # The same fence the projection uses: a path proposed by whoever
            # is on the other end of the connection does not get to name
            # `.git/config` or a `latexmkrc`.
            return
        if not source.exists():
            self._named[file_id] = now_called
            return
        if target.exists():
            # This is not the disk the rename was made on.  The sender
            # refused a rename onto a name that was taken *there*, which says
            # nothing about here.  The manifest is the authority on what this
            # file is called, so whatever is in the way steps aside.
            with contextlib.suppress(OSError):
                target.rename(unique_name(target, "was here"))
            if target.exists():
                return   # left for the next flush rather than written over
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            source.rename(target)
        except OSError:
            return
        session = self.session
        if session is not None:
            # Without this the past stays filed under the old name, and the
            # file's whole history is unreachable from either name.
            session.history.note_move(was, now_called)
        self._named[file_id] = now_called

    def _trash_locally(self, was: str) -> bool:
        """Put a file somebody else deleted into this machine's own trash."""
        trash = getattr(self.session, "trash", None)
        try:
            target = self.project.resolve_for_write(was)
        except (PermissionError, OSError, ValueError):
            return False
        if not target.exists():
            return True
        if trash is None:
            return False
        try:
            trash.delete(target)
        except Exception:
            log.warning("could not follow a deletion into the trash: %s", was)
            return False
        return True

    def flush(self) -> None:
        """Write every changed document out, now.

        A file that could not be written **stays dirty**, and one that
        fails does not take the others with it.  The first version of this
        emptied the whole pending set before writing anything and caught only
        `OSError` -- so `write_atomically` raising `NotAFile` (a record whose
        path names a directory) lost every other pending write in the batch,
        the exception vanished into the event loop's handler because `_fire`
        is a timer callback, and nothing was ever retried because the set was
        already empty.
        """
        if self._paths_moved:
            self._paths_moved = False
            self.settle_paths()
        pending, self._dirty = self._dirty, set()
        failed: set[str] = set()
        for file_id in pending:
            try:
                self._write(file_id)
            except PermissionError as refusal:
                # The path fence, or the control-file rule beside it.  This
                # one is *not* retried: retrying is for a write that might
                # succeed later, and a record naming `../../.ssh/config` or
                # `.git/hooks/pre-commit` will name it just as much next
                # time.  Putting it back was an endless loop, once every
                # 120 ms, with the refusal swallowed by the timer callback
                # so nothing anywhere said a word.
                self._refused.add(file_id)
                log.warning("refused a shared file: %s", refusal)
            except Exception:
                # A read-only directory, a disk that filled up, a path that
                # is not a file. The document is still correct and still
                # shared; only this peer's copy of the file is behind, and
                # it is put back in the queue so the next write tries again.
                failed.add(file_id)
        if failed:
            self._dirty |= failed
            self._schedule()
        self._compact()

    def _write(self, file_id: str) -> None:
        # Taken first, and taken whatever happens below.  It says whether the
        # changes about to be projected include one made at this keyboard,
        # which is what decides whether this install writes a version for
        # them or waits to be told about somebody else's.
        authored = file_id in self._authored
        self._authored.discard(file_id)
        record = self.files.get(file_id)
        text = self._body.get(file_id)
        if record is None or text is None or record.get("trashed"):
            return
        if file_id in self._refused:
            return
        relative = record["path"]
        content = str(text)
        if self.last_projected.get(file_id) == content:
            return

        # `resolve_for_write` rather than `resolve`, because this path was
        # proposed by whoever is on the other end of the connection.  Staying
        # inside the project was never the whole question: `.git/config` is
        # inside the project, and a `core.fsmonitor` entry in it is a command
        # that runs on the next `git status`, which this app performs after
        # every build.  `latexmkrc` inside the project is Perl.
        path = self.project.resolve_for_write(relative)
        previous = read_text(path)
        self._projecting.add(file_id)
        try:
            write_atomically(path, content)
            self.last_projected[file_id] = content
            self._named[file_id] = relative
            session = self.session
            if session is not None:
                # The four things every write in this app has always done.
                # Skipping the first echoes; skipping the last two means the
                # page stops following a collaborator's typing, which is
                # most of the point of any of this.
                session.mark_written(path)
                if authored:
                    session.record_version(path, content, previous=previous)
                else:
                    # Not ours to record.  Every install projects the merged
                    # document to its own disk, and recording that wrote a
                    # version stamped with *this* install -- so a
                    # collaborator's paragraph entered your history under
                    # your name, and was then offered back to them as your
                    # work.  Nothing deduplicated it, because both the
                    # moment and the author differed, so a shared file's log
                    # grew by roughly one wrongly attributed entry per edit
                    # per person.
                    #
                    # The person who typed it records it; everybody else
                    # receives that record through history sync, which is
                    # what history sync is for.  It also makes "this
                    # install's own records" a set that means something,
                    # which is what the whole per-author scheme rests on.
                    #
                    # The contents are kept even so.  It is the same sha
                    # their line will name, so their version opens here with
                    # no round trip, and an orphan goes to the collector
                    # like any other.
                    session.history.blobs.put(content.encode("utf-8"))
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
