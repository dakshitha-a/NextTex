"""What a file used to be.

Every write NextTex knows about is recorded here before the new text lands,
so a writer can look at what a chapter said an hour ago, and put it back.
This is not a replacement for git: it is the thing you want when you deleted
a paragraph forty minutes ago and cannot remember what it said, at a moment
when committing was the last thing on your mind.

Three ideas hold it up.

**Content addressing.** A version is a sha256 of the file's bytes, and the
bytes are stored once under that name, zlib-compressed.  Saving a file back
to a state it has been in before costs nothing, and neither does a save that
changed nothing.

**One log per file.** Versions are listed per file because that is how they
are asked for -- "what did this chapter look like" -- and because it makes a
deleted file's history a single path to carry into the trash rather than a
query across a shared history.

**Coalescing, then thinning.** An editing burst is one version, not one per
autosave.  Old versions are thinned as they age, keeping everything from the
last day, then an hour apart for a week, a day apart for three months, a
week apart beyond -- but never dropping a version somebody labelled, one the
agent made, or a creation, deletion, restore, undo or redo.  Those are the
ones people come looking for.

**One author extends one sequence.**  A version carries the peer that wrote
it, and no install ever writes a line under another install's name.  That is
what lets a collaborator ask for "everything of yours after this moment"
rather than "everything you have that I do not", which would re-offer every
record thinning had just dropped, for ever.  `record` therefore forces `at`
strictly above the newest record from the *same* author, so that moment is
always a real boundary and never a tie.

The file format follows `server/transcript.py`: one JSON object per line,
`at` in float milliseconds, tolerant reads that skip a corrupt line rather
than losing the file, and writes that go all the way onto the disk.  The log
is rewritten in full on every change rather than appended to -- coalescing
replaces the last line and thinning takes lines out of the middle -- which
is why every mutation here holds `_lock` across the read, the change and the
write, and why none of them may await anything in between.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
import threading
import time
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .atomic import write_atomically

# An editing burst by one author collapses into a single version.
COALESCE_SECONDS = 90.0

# Retention. Everything newer than the first is kept; after that only the
# newest version in each bucket survives.
KEEP_ALL_HOURS = 24
HOURLY_DAYS = 7
DAILY_DAYS = 90

# A version of these kinds is never thinned away.  "orphan" is text that
# only ever existed in a window that has since closed: there is no file on
# disk holding it, so this is the only copy there will ever be.
PERMANENT_OPS = {"delete", "restore", "create", "undo", "redo", "orphan"}

# A blob younger than this is not collected, so garbage collection cannot
# race a record that has written its content but not yet its log line.
GC_GRACE_SECONDS = 3600.0

#: A blob's name is the sha256 of its contents and can be nothing else.  It
#: is joined straight onto a directory, and it reaches `get` from a query
#: string, so it is checked rather than trusted.
_IS_SHA = re.compile(r"[0-9a-f]{64}")


def now_ms() -> float:
    return time.time() * 1000


def slug_for(relative_path: str) -> str:
    """A filesystem-safe name for a project-relative path.

    The key a file's log is filed under when nothing better is known:
    an unshared History with no store bound, and the id the collaboration
    manifest mints for a path whose slug is free, so the two agree on
    every file that was never renamed onto a trashed name.
    """
    return hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:16]


#: What the store writes into `format` once a history is keyed by file id.
FORMAT = "2"


@dataclass
class Version:
    at: float
    sha: str
    bytes: int
    by: str            # "you" or "claude"
    why: str = ""
    op: str = "edit"   # edit | create | delete | restore | undo | redo | orphan
    label: str | None = None
    # Which window a save came from.  Two browser tabs are both "you", and
    # coalescing merged them -- so the tab that saved second replaced the
    # other one's version and its paragraph was gone from the history too.
    # Never shown; it exists only to keep bursts apart.
    source: str = ""
    # Which *install* made it.  Empty means this one, which is what every
    # record written before collaboration existed says -- so an old log
    # reads back correctly without being migrated.  `by` is unchanged and
    # still means the role, "you" or "claude", now relative to `peer`.
    peer: str = ""
    # The name that peer went by at the time.  Kept beside the id rather
    # than looked up, because somebody who leaves a project should not turn
    # into a hexadecimal string in the history of what they wrote.
    who: str = ""

    def as_dict(self) -> dict:
        return {
            "at": self.at,
            "sha": self.sha,
            "bytes": self.bytes,
            "by": self.by,
            "why": self.why,
            "op": self.op,
            "label": self.label,
            "source": self.source,
            "peer": self.peer,
            "who": self.who,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Version":
        return cls(
            at=float(data.get("at") or 0.0),
            sha=str(data.get("sha") or ""),
            bytes=int(data.get("bytes") or 0),
            by=str(data.get("by") or "you"),
            why=str(data.get("why") or ""),
            op=str(data.get("op") or "edit"),
            label=data.get("label") or None,
            source=str(data.get("source") or ""),
            peer=str(data.get("peer") or ""),
            who=str(data.get("who") or ""),
        )

    @property
    def permanent(self) -> bool:
        return bool(self.label) or self.by == "claude" or self.op in PERMANENT_OPS


class BlobStore:
    """Content-addressed storage for file contents.

    Shared between the history and the trash, so a deleted file's versions
    and its final contents are the same bytes on disk.
    """

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, sha: str) -> Path:
        return self.root / sha[:2] / sha

    def put(self, data: bytes) -> str:
        sha = hashlib.sha256(data).hexdigest()
        target = self.path_for(sha)
        if target.exists():
            # Touched rather than left alone.  A blob whose last referring
            # line was thinned away is unreferenced and waiting to be swept;
            # re-referencing it here without moving its mtime meant the
            # sweep could take it in the moment between this line and the
            # log line that is about to name it, leaving a version pointing
            # at nothing.  The grace window is what protects that gap, and
            # it is keyed on mtime, so the mtime has to move.
            try:
                target.touch()
            except OSError:
                pass
            return sha
        write_atomically(target, zlib.compress(data, 6))
        return sha

    def get(self, sha: str) -> bytes | None:
        if not _IS_SHA.fullmatch(sha or ""):
            return None
        target = self.path_for(sha)
        try:
            return zlib.decompress(target.read_bytes())
        except OSError:
            return None
        except zlib.error:
            # Not a blob any more.  This is what a power loss used to leave
            # behind before these writes were flushed: a file of the right
            # name and the right length, full of zeroes.  `put` short
            # circuits on a name that exists, so leaving it would make that
            # version unopenable for ever with no way back.  Dropping it
            # costs the version, which is already lost, and lets the next
            # save of the same content write it properly.
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
            return None

    def has(self, sha: str) -> bool:
        if not _IS_SHA.fullmatch(sha or ""):
            return False
        return self.path_for(sha).is_file()

    def collect(self, keep: set[str]) -> int:
        """Delete blobs nothing refers to. Returns how many went."""
        removed = 0
        cutoff = time.time() - GC_GRACE_SECONDS
        for shard in self.root.iterdir():
            if not shard.is_dir():
                continue
            for blob in shard.iterdir():
                if blob.name in keep:
                    continue
                try:
                    if blob.stat().st_mtime > cutoff:
                        continue
                    blob.unlink()
                    removed += 1
                except OSError:
                    pass
            # An emptied shard is an empty directory for ever otherwise, and
            # the walk above pays for it on every collection from now on.
            # `rmdir` refuses a directory with anything in it, so this needs
            # no check of its own.
            with contextlib.suppress(OSError):
                shard.rmdir()
        return removed


class History:
    """Every version of every file in one project."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.blobs = BlobStore(self.root / "blobs")
        self.log_dir = self.root / "log"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        #: The map from key to path, aliases and purge floors.  `paths.json`
        #: keyed it by path slug; `files.json` keys it by the collaboration
        #: file id, which is what every log is named after once `format`
        #: says so.  A history nobody has migrated still reads and writes
        #: the old file under slug keys, so the bench and a bare test see
        #: exactly what they saw.
        self.paths_file = self.root / "paths.json"
        self.files_file = self.root / "files.json"
        self.format_file = self.root / "format"
        #: Answers the key a path is filed under, when a store is bound:
        #: the live record's id, the trashed one's, or a fresh mint.  None
        #: until `bind`, and then the map and the slug stand in.
        self.key_for: Callable[[str], str | None] | None = None
        # A file's log, parsed, kept against the log's own mtime and size.
        # `record` runs on every autosave -- a quarter second after typing
        # stops -- and it reads the whole log, thins it and rewrites it.  On
        # a file with four hundred versions that was two full JSON parses
        # per keystroke burst, on the event loop.
        self._log_cache: dict[str, tuple[tuple[int, int], list[Version]]] = {}
        self._paths_cache: tuple[tuple[int, int], dict] | None = None
        #: Held across the read, the change and the write of a log, because
        #: every change here rewrites the whole file.  A peer's lines
        #: arriving while a save was in flight used to be a lost update:
        #: both sides had read the same list and the second write won.
        #: Reentrant because `note_move` calls `note_rename` and `record`
        #: calls `versions`.  Nothing under it may await.
        self._lock = threading.RLock()
        #: This install's peer id, or "" while the project is not shared.
        #: A record with no `peer` was written here, so the two name the
        #: same author and every comparison has to say so -- a shared
        #: project's log holds both, the empty ones from before it was
        #: shared and the stamped ones from after.
        self.me: str = ""
        #: Called with a file's path when its log gains something.  Hung
        #: here rather than on the session because the trash records
        #: straight onto this object, and because taking somebody else's
        #: lines has to say so as much as writing our own does -- a relaying
        #: install that stayed quiet would leave a file that only reaches
        #: the project through it syncing on reconnection alone.
        self.on_change: Callable[[str], None] | None = None

    # -- keys --------------------------------------------------------------
    @property
    def migrated(self) -> bool:
        try:
            return self.format_file.read_text(encoding="utf-8").strip() == FORMAT
        except OSError:
            return False

    @property
    def _map_file(self) -> Path:
        return self.files_file if self.migrated else self.paths_file

    def key_of(self, relative_path: str) -> str:
        """The key a path's log is filed under.

        The bound store first, which knows the file id and can mint one
        for a path it has not adopted yet; then this history's own map,
        which knows the key of a path that has since been renamed away
        under it; then the path's slug, which is the key an unbound
        history has always used and what the store mints for a free path.

        Never called under `_lock` from a worker thread: the store's
        resolver runs on the event loop, and the loop may be about to
        take this lock itself.  Every path-facing method resolves its key
        first and locks after.
        """
        resolver = self.key_for
        if resolver is not None:
            key = resolver(relative_path)
            if key:
                return key
        paths = self._paths()
        for key, entry in paths.items():
            if entry.get("path") == relative_path:
                return key
        slug = slug_for(relative_path)
        held = paths.get(slug)
        if held is not None and held.get("path") not in ("", relative_path):
            # The slug is another file's key now: the file that was born
            # under this name and has since been renamed away.  A question
            # about the old name is a question about nothing, and must not
            # answer with that file's past.
            return hashlib.sha256(f"gone:{relative_path}".encode("utf-8")).hexdigest()[:16]
        return slug

    def bind(self, key_for: Callable[[str], str | None],
             records: "list[tuple[str, str, bool]] | None" = None) -> None:
        """Take the store's idea of what a file is called, and migrate
        a history still keyed by path slug to its ids."""
        self.key_for = key_for
        if records is not None:
            self.migrate(records)

    def _changed(self, key: str) -> None:
        listener = self.on_change
        if listener is None:
            return
        try:
            listener(key)
        except Exception:
            # Failing to tell anybody must never cost the version that was
            # just written, which is on disk by the time this runs.
            pass

    def author_of(self, version: Version) -> str:
        """Whose sequence this version belongs to."""
        return version.peer or self.me

    # -- the path map ------------------------------------------------------
    @staticmethod
    def _stamp(path: Path) -> tuple[int, int]:
        try:
            stat = path.stat()
        except OSError:
            return (0, 0)
        return (stat.st_mtime_ns, stat.st_size)

    def _paths(self) -> dict:
        target = self._map_file
        stamp = self._stamp(target)
        if self._paths_cache is not None and self._paths_cache[0] == (target.name, stamp):
            return self._paths_cache[1]
        try:
            data = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        self._paths_cache = ((target.name, stamp), data)
        return data

    def _write_paths(self, data: dict) -> None:
        target = self._map_file
        try:
            write_atomically(target, json.dumps(data, indent=2))
        except OSError:
            # The cache is not updated on failure.  It used to be, which
            # paired the new data with the old file's stamp and left the
            # process serving something that was never written, with no way
            # to notice.
            self._paths_cache = None
            return
        self._paths_cache = ((target.name, self._stamp(target)), data)

    def _remember(self, key: str, relative_path: str) -> str:
        paths = self._paths()
        entry = paths.get(key)
        if entry is None or entry.get("path") != relative_path:
            kept = entry or {}
            paths[key] = {
                "path": relative_path,
                "aliases": kept.get("aliases", []),
                # Carried, not dropped.  This is the floor a purge left
                # behind, and losing it would let a collaborator hand back
                # the history that was cleared.
                "purged_before": kept.get("purged_before", {}),
            }
            self._write_paths(paths)
        return key

    def _remember_path(self, relative_path: str) -> str:
        return self._remember(self.key_of(relative_path), relative_path)

    def purged_before(self, relative_path: str) -> dict:
        """Per author, the moment before which this file's past was cleared.

        Per author rather than one number for the file, because it is
        compared against an incoming record's `at` and those are stamped by
        whichever machine wrote them.  One floor taken across everybody
        would be whatever the furthest-ahead clock in the project said, and
        a collaborator with an accurate clock would then have their next
        records dropped on arrival until real time caught up.
        """
        return self.purged_before_of(self.key_of(relative_path))

    def purged_before_of(self, key: str) -> dict:
        entry = self._paths().get(key) or {}
        floors = entry.get("purged_before")
        return dict(floors) if isinstance(floors, dict) else {}

    def note_rename(self, old_path: str, new_path: str) -> None:
        """Carry a file's history across a rename.

        The log is keyed by the old path, so where the new name has no past
        of its own the log file is simply renamed and the old name kept as
        an alias -- a rename costs one small JSON write and no blobs.
        """
        with self._lock:
            old_key = self.key_of(old_path)
            new_key = self.key_of(new_path)
            if old_key == new_key:
                # The key is the file's own, as it is once a store is
                # bound, so a rename is a path update and no log moves.
                self.rename_key(old_key, old_path, new_path)
                return
            old_slug, new_slug = old_key, new_key
            source = self.log_dir / f"{old_slug}.jsonl"
            if not source.exists():
                return
            target = self.log_dir / f"{new_slug}.jsonl"
            try:
                if target.exists():
                    # Both names have a past.  Merged and put back in order
                    # rather than one file's text appended onto the other's,
                    # which is what this did and which left the log out of
                    # order on disk -- and everything downstream reads it as
                    # a sequence.  A source log left without a trailing
                    # newline by an earlier crash also used to take two
                    # records with it, by joining them onto one line.
                    merged = self.versions_of(old_key) + self.versions_of(new_key)
                    merged.sort(key=lambda version: version.at)
                    self._write_log_of(new_key, self._thin(merged))
                    self._log_cache.pop(source.name, None)
                    source.unlink()
                else:
                    source.replace(target)
                    self._log_cache.pop(source.name, None)
                    self._log_cache.pop(target.name, None)
            except OSError:
                return
            paths = self._paths()
            was = paths.get(old_slug) or {}
            there = paths.get(new_slug) or {}
            # Both names' floors, and both names' aliases.  Taking only the
            # old entry's threw away whatever the new name already knew
            # about itself, including the point its own history was cleared
            # at, which is the one thing that must not be forgotten.
            floors = dict(there.get("purged_before") or {})
            for author, at in (was.get("purged_before") or {}).items():
                if at > floors.get(author, 0.0):
                    floors[author] = at
            aliases = was.get("aliases", []) + there.get("aliases", []) + [old_path]
            paths.pop(old_slug, None)
            paths[new_slug] = {
                "path": new_path,
                "aliases": sorted(set(aliases)),
                "purged_before": floors,
            }
            self._write_paths(paths)

    def rename_key(self, key: str, old_path: str, new_path: str) -> None:
        """A file is now called something else; its log stays where it is."""
        with self._lock:
            paths = self._paths()
            entry = dict(paths.get(key) or {})
            aliases = list(entry.get("aliases", []))
            if old_path and old_path != new_path and old_path not in aliases:
                aliases.append(old_path)
            paths[key] = {
                "path": new_path,
                "aliases": sorted(set(aliases)),
                "purged_before": entry.get("purged_before", {}),
            }
            self._write_paths(paths)

    def note_move(self, old_path: str, new_path: str) -> None:
        """Carry history across a rename that may be of a whole folder.

        `note_rename` is keyed by one path, so moving a directory used to
        re-slug the directory itself -- which has no log -- and leave every
        file inside it with its history filed under a path that no longer
        exists.  The history was still on disk but nothing could find it,
        which reads to the writer as a folder move destroying the past.

        The recorded paths are the authority here rather than the disk: the
        files have already been moved by the time this runs.
        """
        with self._lock:
            self.note_rename(old_path, new_path)
            prefix = f"{old_path}/"
            inside = [
                entry.get("path", "")
                for entry in self._paths().values()
                if entry.get("path", "").startswith(prefix)
            ]
            for path in inside:
                self.note_rename(path, f"{new_path}/{path[len(prefix):]}")

    def path_of(self, key: str) -> str:
        return (self._paths().get(key) or {}).get("path", "")

    # -- reading -----------------------------------------------------------
    def _log_path(self, relative_path: str) -> Path:
        return self._log_path_of(self.key_of(relative_path))

    def _log_path_of(self, key: str) -> Path:
        return self.log_dir / f"{key}.jsonl"

    def versions(self, relative_path: str) -> list[Version]:
        """Every kept version of one file, oldest first."""
        return self.versions_of(self.key_of(relative_path))

    def versions_of(self, key: str) -> list[Version]:
        """Every kept version of the file filed under `key`, oldest first."""
        log = self._log_path_of(key)
        stamp = self._stamp(log)
        cached = self._log_cache.get(log.name)
        if cached is not None and cached[0] == stamp:
            # Moved to the end, so eviction below drops the least recently
            # *used* rather than the first one ever read.  Without this the
            # timeline, which touches every log in the project, evicted the
            # file being typed into on every call.
            self._log_cache[log.name] = self._log_cache.pop(log.name)
            # A fresh list, because callers slice and append to it.  The
            # Version objects are shared with the cache, and `set_label`
            # mutates them in place and writes them back in the same
            # breath, which is the only reason that is safe.
            return list(cached[1])
        try:
            lines = log.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        out: list[Version] = []
        for line in lines:
            try:
                out.append(Version.from_dict(json.loads(line)))
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
        # Sorted here rather than trusted from the file.  Everything
        # downstream reads this as a sequence -- `record` takes the last
        # entry as the previous version, thinning keeps the last of each
        # bucket, a collaborator asks for everything after a moment -- and
        # a rename onto a name that already had a past used to append one
        # log to the other and leave the result out of order on disk.  This
        # also repairs any log already in that state, the first time it is
        # read.
        out.sort(key=lambda version: version.at)
        self._log_cache[log.name] = (stamp, list(out))
        # A session can touch many files; the cache is not a leak waiting
        # to happen.
        while len(self._log_cache) > 128:
            self._log_cache.pop(next(iter(self._log_cache)))
        return out

    def bytes_of(self, relative_path: str, sha: str) -> bytes | None:
        """One version's exact bytes, if it is still on disk.

        A figure is a version like any other -- the blob store has always
        kept arbitrary bytes perfectly -- but `content` below decodes with
        `errors="replace"`, which is right for showing an old draft in a
        text editor and destroys a PNG: every byte that is not valid UTF-8
        becomes U+FFFD, and nothing re-encodes back to what it was.  A
        restore or a download of a binary version has to come through here.
        """
        known = {version.sha for version in self.versions(relative_path)}
        if sha not in known:
            return None
        return self.blobs.get(sha)

    def have(self, relative_path: str) -> set[str]:
        """Which of this file's versions have their contents on this disk.

        A collaborator's version arrives as a line and its contents come
        when somebody asks for them, so a version that is listed is not
        necessarily one that can be opened -- and if its author has since
        thinned that record away and swept the contents, it never will be.
        The panel says so rather than offering a restore that cannot work.
        """
        return {
            version.sha
            for version in self.versions(relative_path)
            if self.blobs.has(version.sha)
        }

    def content(self, relative_path: str, sha: str) -> str | None:
        """One version's text, if it is still on disk."""
        data = self.bytes_of(relative_path, sha)
        if data is None:
            return None
        return data.decode("utf-8", errors="replace")

    def timeline(self, limit: int = 100) -> list[dict]:
        """Recent versions across every file, newest first."""
        entries: list[dict] = []
        paths = self._paths()
        for log in self.log_dir.glob("*.jsonl"):
            key = log.stem
            path = (paths.get(key) or {}).get("path", "")
            if not path:
                continue
            for version in self.versions_of(key):
                entries.append({"path": path, **version.as_dict()})
        entries.sort(key=lambda item: item["at"], reverse=True)
        return entries[:limit]

    # -- writing -----------------------------------------------------------
    def _write_log(self, relative_path: str, versions: list[Version]) -> None:
        """Replace one file's log. Callers hold `_lock` across read and write."""
        self._write_log_of(self.key_of(relative_path), versions)

    def _write_log_of(self, key: str, versions: list[Version]) -> None:
        target = self._log_path_of(key)
        try:
            write_atomically(
                target,
                "".join(json.dumps(v.as_dict()) + "\n" for v in versions),
            )
        except OSError:
            self._log_cache.pop(target.name, None)
            return
        self._log_cache[target.name] = (self._stamp(target), list(versions))

    def record(
        self,
        relative_path: str,
        text: str | bytes | None,
        *,
        by: str = "you",
        why: str = "",
        op: str = "edit",
        label: str | None = None,
        source: str = "",
        peer: str = "",
        who: str = "",
    ) -> Version | None:
        """Note what a file contains now. Returns the version, or None.

        None means there was nothing to record: identical content, or no
        content at all.
        """
        return self.record_of(
            self.key_of(relative_path), relative_path, text,
            by=by, why=why, op=op, label=label, source=source, peer=peer, who=who,
        )

    def record_of(
        self,
        key: str,
        relative_path: str,
        text: str | bytes | None,
        *,
        by: str = "you",
        why: str = "",
        op: str = "edit",
        label: str | None = None,
        source: str = "",
        peer: str = "",
        who: str = "",
    ) -> Version | None:
        """`record`, for a caller that already knows the file's key: the
        trash, restoring a file whose name has since been taken."""
        if text is None:
            return None
        data = text.encode("utf-8") if isinstance(text, str) else text
        sha = hashlib.sha256(data).hexdigest()

        with self._lock:
            existing = self.versions_of(key)
            if existing and existing[-1].sha == sha and op in ("edit", "replace", "import"):
                return None   # nothing changed since the last version

            self.blobs.put(data)
            self._remember(key, relative_path)
            # Strictly above the newest record by this same author, so that
            # "everything of yours after this moment" is always a real
            # boundary.  Two saves inside one millisecond used to land on
            # the same `at`, and a clock stepping backwards used to write
            # records that went backwards with it.
            #
            # Scoped to this author deliberately.  Taken over every record,
            # a collaborator whose clock runs fast would drag this machine's
            # timestamps hours forward and they would stay there.
            floor = max(
                (v.at for v in existing if (v.peer or peer) == peer),
                default=0.0,
            )
            at = now_ms()
            if at <= floor:
                # A whole millisecond rather than an epsilon: absorbing a
                # peer's lines rounds `at` to the millisecond when it asks
                # whether it already holds a record, so anything finer than
                # that would read as the same version twice.
                at = floor + 1.0
            version = Version(
                at=at, sha=sha, bytes=len(data), by=by, why=why, op=op,
                label=label, source=source, peer=peer, who=who,
            )

            # One editing burst is one version.  Never across authors: what
            # the agent changed has to stay separable from what the writer
            # did.
            previous = existing[-1] if existing else None
            coalesce = (
                previous is not None
                and previous.by == by
                # And never across installs. Two collaborators are both
                # "you" on their own machines, so without this the peer
                # whose edit arrived second would replace the other's
                # version and the paragraph it overwrote would be gone from
                # the history too -- the same bug `source` was added for,
                # one machine further out.
                and previous.peer == peer
                # Two browser windows are both "you", and merging them meant
                # the one that saved second replaced the other's version --
                # so the paragraph it overwrote was gone from the history as
                # well as from the file.  A burst only collapses within one
                # window.
                and previous.source == source
                # "replace" is deliberately excluded, which is the whole
                # reason it is not just an edit.  Two uploads of the same
                # figure a minute apart are both "you" and both inside this
                # window, so coalescing them dropped the version holding the
                # *original* figure -- the one version a replaced file's
                # history exists for -- and kept the intermediate.
                and previous.op == "edit" == op
                and previous.label is None
                and (version.at - previous.at) < COALESCE_SECONDS * 1000
            )
            kept = existing[:-1] if coalesce else existing
            kept.append(version)
            self._write_log_of(key, self._thin(kept))
            self._changed(key)
            return version

    def absorb(
        self, relative_path: str, lines: list[dict], *, me: str = "",
    ) -> list[Version]:
        """Take lines written elsewhere into one file's log.

        Returns the versions that were actually new and survived thinning,
        so a caller can go and fetch the contents of the ones worth having
        before somebody asks for them.

        The contents these name are not here yet.  A collaborator's version
        arrives readable in the list and not yet openable, which is the
        right way round: almost nobody opens almost any old version, and a
        peer's whole past would otherwise be a download before the first
        keystroke.
        """
        return self.absorb_into(self.key_of(relative_path), relative_path, lines, me=me)

    def absorb_into(
        self, key: str, relative_path: str, lines: list[dict], *, me: str = "",
    ) -> list[Version]:
        """`absorb`, for the wire, which speaks in file ids."""
        me = me or self.me
        with self._lock:
            floors = self.purged_before_of(key)
            existing = self.versions_of(key)
            known = {(v.sha, round(v.at), self.author_of(v)) for v in existing}
            added: list[Version] = []
            for raw in lines:
                try:
                    version = Version.from_dict(raw)
                except (TypeError, ValueError):
                    continue
                if not version.sha or version.at <= 0:
                    continue
                author = version.peer
                # Nobody but this install extends this install's own
                # sequence.  An unstamped line is malformed, because
                # everything that offers a line stamps it on the way out;
                # and a line stamped with our own id is either that same
                # mistake or a member signing their work with our name,
                # which we would then pass on to everybody else as ours and
                # which would push every other machine's idea of how much
                # of "ours" it holds past the end of what we wrote.
                if not author or author == me:
                    continue
                # Cleared history does not come back.  The floor is per
                # author precisely so this comparison only ever puts one
                # machine's clock against its own.
                if version.at <= floors.get(author, 0.0):
                    continue
                seen = (version.sha, round(version.at), author)
                if seen in known:
                    continue
                existing.append(version)
                known.add(seen)
                added.append(version)
            if not added:
                return []
            # In time order, so the panel reads as one story rather than as
            # this machine's followed by everybody else's.
            existing.sort(key=lambda v: v.at)
            kept = self._thin(existing)
            # Thinned on the way in.  It used to write straight past this,
            # so a chapter a co-author owns and you never open grew on your
            # disk for ever.  Safe now in a way it was not before: a mark
            # that only moves forward means that once these are thinned
            # away the author will not offer them again.
            self._remember(key, relative_path)
            self._write_log_of(key, kept)
            self._changed(key)
            return [version for version in added if version in kept]

    def split_at_delete(self, old_path: str, new_path: str) -> int:
        """Move a file's past, up to its deletion, under a different name.

        A restore whose original name has been taken comes back as
        something else, and its history cannot simply be renamed across:
        history is keyed by path, so the log at the old name holds the
        deleted file's past *and* the past of whatever took the name after
        it.  Renaming would hand one file's history to another.

        So it is cut at the last deletion, which is always there because a
        deletion is never thinned away, and only what came before it
        travels.
        """
        with self._lock:
            versions = self.versions(old_path)
            cut = -1
            for index, version in enumerate(versions):
                if version.op == "delete":
                    cut = index
            if cut < 0:
                return 0
            moving, staying = versions[:cut + 1], versions[cut + 1:]
            arriving = self.versions(new_path) + moving
            arriving.sort(key=lambda v: v.at)
            self._remember_path(new_path)
            self._write_log(new_path, self._thin(arriving))
            if staying:
                self._write_log(old_path, staying)
            else:
                log = self._log_path(old_path)
                self._log_cache.pop(log.name, None)
                try:
                    log.unlink(missing_ok=True)
                except OSError:
                    pass
            return len(moving)

    def set_label(self, relative_path: str, sha: str, label: str | None) -> bool:
        """Name a version, or clear its name. A label is never thinned away.

        Keyed by content, so a file saved back to a state it has been in
        before has two versions a label cannot tell apart, and both take it.
        That is deliberate rather than overlooked: the caller has nothing
        else to name one by, and labelling *one* of two identical versions
        would leave the other looking unnamed while holding exactly the same
        text.  Clearing works the same way round.
        """
        with self._lock:
            versions = self.versions(relative_path)
            found = False
            for version in versions:
                if version.sha == sha:
                    version.label = label or None
                    found = True
            if found:
                self._write_log(relative_path, versions)
            return found

    # -- retention ---------------------------------------------------------
    @staticmethod
    def _bucket(version: Version, now: float) -> tuple:
        """Which retention bucket a version falls in.

        Versions sharing a bucket are the same to us, so only the newest of
        them survives.
        """
        age_hours = (now - version.at) / 3_600_000
        stamp = version.at / 1000
        if age_hours <= KEEP_ALL_HOURS:
            return ("all", version.at)                       # everything
        if age_hours <= HOURLY_DAYS * 24:
            return ("hour", int(stamp // 3600))
        if age_hours <= DAILY_DAYS * 24:
            return ("day", int(stamp // 86400))
        return ("week", int(stamp // 604800))

    def _thin(self, versions: list[Version]) -> list[Version]:
        if len(versions) < 3:
            return versions
        now = now_ms()
        keep: dict[tuple, Version] = {}
        permanent: list[Version] = []
        for version in versions:
            if version.permanent:
                permanent.append(version)
                continue
            keep[self._bucket(version, now)] = version   # newest in the bucket wins
        survivors = list(keep.values()) + permanent
        # The first and last are always worth keeping: the oldest is where
        # the file came from, and the newest is what it is now.
        for edge in (versions[0], versions[-1]):
            if edge not in survivors:
                survivors.append(edge)
        survivors.sort(key=lambda v: v.at)
        return survivors

    # -- housekeeping ------------------------------------------------------
    def referenced(self) -> set[str]:
        """Every sha any log still points at."""
        shas: set[str] = set()
        for log in self.log_dir.glob("*.jsonl"):
            try:
                for line in log.read_text(encoding="utf-8").splitlines():
                    try:
                        shas.add(json.loads(line).get("sha", ""))
                    except (json.JSONDecodeError, AttributeError):
                        continue
            except OSError:
                continue
        shas.discard("")
        return shas

    def forget(self, relative_path: str) -> None:
        """Drop a file's history, and remember how far it was dropped.

        Blobs go on the next collection.  The `paths.json` entry stays,
        because it carries the floor: a collaborator still holding these
        records would otherwise hand every one of them straight back the
        next time the two machines spoke, and the button would have been a
        lie.  Nothing is sent to say the history was cleared -- one
        person's decision about their own disk must not reach into anybody
        else's -- so refusing them on the way in is the whole mechanism.

        The key is resolved before the lock is taken.  Emptying the trash
        runs this from a worker thread, and a bound resolver answers from
        the event loop; holding the lock while waiting on the loop would
        deadlock the moment the loop itself asked to record a version.
        """
        key = self.key_of(relative_path)
        with self._lock:
            floors = self.purged_before_of(key)
            for version in self.versions_of(key):
                author = self.author_of(version)
                if version.at > floors.get(author, 0.0):
                    floors[author] = version.at
            log = self._log_path_of(key)
            self._log_cache.pop(log.name, None)
            try:
                log.unlink(missing_ok=True)
            except OSError:
                pass
            paths = self._paths()
            entry = paths.get(key) or {}
            paths[key] = {
                "path": relative_path,
                "aliases": entry.get("aliases", []),
                "purged_before": floors,
            }
            self._write_paths(paths)

    # -- migration -----------------------------------------------------------
    def migrate(self, records: "list[tuple[str, str, bool]]") -> bool:
        """Move a history keyed by path slug onto the manifest's file ids.

        `records` is every manifest record as `(id, path, trashed)`, the
        trashed ones in the order they were trashed where that is known.
        Returns True when a migration ran.

        The invariant this rests on: under the old scheme every record's
        log lives at the slug of its *current* path, because `note_move`
        kept it there, and the target is the record's id.  So the move is
        "every record's log, from its path slug to its id", and not, as it
        first looked, "only the records whose id is not their slug": a file
        renamed to `old.tex` has its log at `slug("old.tex")` while a new
        `main.tex`, minted a random id because the old file still held
        `slug("main.tex")`, writes its versions there, and the naive rule
        would have handed the first file the second file's past.

        Two phases through `log/.migrating/`, because of that cycle: one
        record's target is another's source.  Every source is copied
        aside first, every target is built from the copies, the targets
        are moved into place, stale sources go, and only then are
        `files.json` and `format` written and `paths.json` and the
        staging directory removed.  Interrupted anywhere, a rerun starts
        from the copies it finds and ends in the same place; run on a
        migrated store it does nothing.

        Where several records share one path, one live and any number
        trashed, the shared source log is cut at its `delete` lines, the
        cut `split_at_delete` made, and the segments go to the trashed
        records in the order given with the tail to the live one.
        """
        if self.migrated:
            return False
        with self._lock:
            legacy = {}
            try:
                legacy = json.loads(self.paths_file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                legacy = {}
            if not isinstance(legacy, dict):
                legacy = {}

            staging = self.log_dir / ".migrating"
            sources = staging / "src"
            sources.mkdir(parents=True, exist_ok=True)

            by_path: dict[str, list[tuple[str, bool]]] = {}
            for file_id, path, trashed in records:
                if file_id and path:
                    by_path.setdefault(path, []).append((file_id, bool(trashed)))

            def read_lines(log: Path) -> list[Version]:
                try:
                    raw = log.read_text(encoding="utf-8").splitlines()
                except OSError:
                    return []
                out: list[Version] = []
                for line in raw:
                    try:
                        out.append(Version.from_dict(json.loads(line)))
                    except (json.JSONDecodeError, TypeError, ValueError):
                        continue
                out.sort(key=lambda version: version.at)
                return out

            def staged_source(slug: str) -> Path | None:
                copy = sources / f"{slug}.jsonl"
                if copy.exists():
                    return copy
                original = self.log_dir / f"{slug}.jsonl"
                if not original.exists():
                    return None
                try:
                    copy.write_bytes(original.read_bytes())
                except OSError:
                    return None
                return copy

            # Phase one: every target, built from copies of the sources.
            new_map: dict[str, dict] = {}
            targets: dict[str, list[Version]] = {}
            handled: set[str] = set()
            for path, recs in by_path.items():
                slug = slug_for(path)
                handled.add(slug)
                entry = legacy.get(slug) if isinstance(legacy.get(slug), dict) else {}
                copy = staged_source(slug)
                versions = read_lines(copy) if copy else []
                trashed = [file_id for file_id, gone in recs if gone]
                live = [file_id for file_id, gone in recs if not gone]
                segments: dict[str, list[Version]] = {}
                if len(recs) == 1:
                    segments[recs[0][0]] = versions
                else:
                    pieces: list[list[Version]] = []
                    current: list[Version] = []
                    for version in versions:
                        current.append(version)
                        if version.op == "delete":
                            pieces.append(current)
                            current = []
                    tail = current
                    for index, file_id in enumerate(trashed):
                        segments[file_id] = pieces[index] if index < len(pieces) else []
                    leftover = [v for piece in pieces[len(trashed):] for v in piece] + tail
                    if live:
                        segments[live[0]] = leftover
                        for extra in live[1:]:
                            segments[extra] = []
                    elif trashed:
                        segments[trashed[-1]] = segments.get(trashed[-1], []) + leftover
                for file_id, lines in segments.items():
                    targets[file_id] = lines
                    new_map[file_id] = {
                        "path": path,
                        "aliases": list(entry.get("aliases", [])),
                        "purged_before": dict(entry.get("purged_before", {})),
                    }
            # Entries with no record: a forgotten file carrying its floors,
            # or a log for a path the manifest never adopted.  Kept under
            # their slug, which is what their key was and still is.
            for slug, entry in legacy.items():
                if slug in handled or not isinstance(entry, dict):
                    continue
                new_map[slug] = entry
                copy = staged_source(slug)
                if copy is not None:
                    targets[slug] = read_lines(copy)
            for log in self.log_dir.glob("*.jsonl"):
                if log.stem not in handled and log.stem not in targets:
                    copy = staged_source(log.stem)
                    if copy is not None:
                        targets[log.stem] = read_lines(copy)

            # Phase two: targets into place, stale sources away, then the
            # map and the marker, and only then the old files.
            for file_id, lines in targets.items():
                staged = staging / f"{file_id}.jsonl"
                staged.write_text(
                    "".join(json.dumps(v.as_dict()) + "\n" for v in lines), encoding="utf-8",
                )
            for file_id in targets:
                (staging / f"{file_id}.jsonl").replace(self.log_dir / f"{file_id}.jsonl")
            for slug in handled:
                if slug not in targets:
                    try:
                        (self.log_dir / f"{slug}.jsonl").unlink(missing_ok=True)
                    except OSError:
                        pass
            self._log_cache.clear()
            write_atomically(self.files_file, json.dumps(new_map, indent=2))
            write_atomically(self.format_file, FORMAT)
            self._paths_cache = None
            try:
                self.paths_file.unlink(missing_ok=True)
            except OSError:
                pass
            for copy in sources.glob("*.jsonl"):
                try:
                    copy.unlink()
                except OSError:
                    pass
            for leftover in (sources, staging):
                try:
                    leftover.rmdir()
                except OSError:
                    pass
            return True

    def collect(self, also_keep: set[str] | None = None) -> int:
        return self.blobs.collect(self.referenced() | (also_keep or set()))

    def size(self) -> int:
        """Bytes on disk, for anyone who wants to know what this costs."""
        total = 0
        for path in self.root.rglob("*"):
            try:
                if path.is_file():
                    total += path.stat().st_size
            except OSError:
                continue
        return total
