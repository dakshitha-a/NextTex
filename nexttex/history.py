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

import hashlib
import json
import re
import threading
import time
import zlib
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
    """A filesystem-safe name for a project-relative path."""
    return hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:16]


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
                if blob.name in keep or blob.name.endswith(".tmp"):
                    continue
                try:
                    if blob.stat().st_mtime > cutoff:
                        continue
                    blob.unlink()
                    removed += 1
                except OSError:
                    pass
        return removed


class History:
    """Every version of every file in one project."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.blobs = BlobStore(self.root / "blobs")
        self.log_dir = self.root / "log"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.paths_file = self.root / "paths.json"
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
        stamp = self._stamp(self.paths_file)
        if self._paths_cache is not None and self._paths_cache[0] == stamp:
            return self._paths_cache[1]
        try:
            data = json.loads(self.paths_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        self._paths_cache = (stamp, data)
        return data

    def _write_paths(self, data: dict) -> None:
        try:
            write_atomically(self.paths_file, json.dumps(data, indent=2))
        except OSError:
            # The cache is not updated on failure.  It used to be, which
            # paired the new data with the old file's stamp and left the
            # process serving something that was never written, with no way
            # to notice.
            self._paths_cache = None
            return
        self._paths_cache = (self._stamp(self.paths_file), data)

    def _remember_path(self, relative_path: str) -> str:
        slug = slug_for(relative_path)
        paths = self._paths()
        entry = paths.get(slug)
        if entry is None or entry.get("path") != relative_path:
            kept = entry or {}
            paths[slug] = {
                "path": relative_path,
                "aliases": kept.get("aliases", []),
                # Carried, not dropped.  This is the floor a purge left
                # behind, and losing it would let a collaborator hand back
                # the history that was cleared.
                "purged_before": kept.get("purged_before", {}),
            }
            self._write_paths(paths)
        return slug

    def purged_before(self, relative_path: str) -> dict:
        """Per author, the moment before which this file's past was cleared.

        Per author rather than one number for the file, because it is
        compared against an incoming record's `at` and those are stamped by
        whichever machine wrote them.  One floor taken across everybody
        would be whatever the furthest-ahead clock in the project said, and
        a collaborator with an accurate clock would then have their next
        records dropped on arrival until real time caught up.
        """
        entry = self._paths().get(slug_for(relative_path)) or {}
        floors = entry.get("purged_before")
        return dict(floors) if isinstance(floors, dict) else {}

    def note_rename(self, old_path: str, new_path: str) -> None:
        """Carry a file's history across a rename.

        The log is keyed by the old path, so where the new name has no past
        of its own the log file is simply renamed and the old name kept as
        an alias -- a rename costs one small JSON write and no blobs.
        """
        old_slug, new_slug = slug_for(old_path), slug_for(new_path)
        if old_slug == new_slug:
            return
        with self._lock:
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
                    merged = self.versions(old_path) + self.versions(new_path)
                    merged.sort(key=lambda version: version.at)
                    self._write_log(new_path, self._thin(merged))
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

    def path_of(self, slug: str) -> str:
        return (self._paths().get(slug) or {}).get("path", "")

    # -- reading -----------------------------------------------------------
    def _log_path(self, relative_path: str) -> Path:
        return self.log_dir / f"{slug_for(relative_path)}.jsonl"

    def versions(self, relative_path: str) -> list[Version]:
        """Every kept version of one file, oldest first."""
        log = self._log_path(relative_path)
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
            slug = log.stem
            path = (paths.get(slug) or {}).get("path", slug)
            for version in self.versions(path) if path != slug else []:
                entries.append({"path": path, **version.as_dict()})
        entries.sort(key=lambda item: item["at"], reverse=True)
        return entries[:limit]

    # -- writing -----------------------------------------------------------
    def _write_log(self, relative_path: str, versions: list[Version]) -> None:
        """Replace one file's log. Callers hold `_lock` across read and write."""
        target = self._log_path(relative_path)
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
        if text is None:
            return None
        data = text.encode("utf-8") if isinstance(text, str) else text
        sha = hashlib.sha256(data).hexdigest()

        with self._lock:
            existing = self.versions(relative_path)
            if existing and existing[-1].sha == sha and op in ("edit", "replace", "import"):
                return None   # nothing changed since the last version

            self.blobs.put(data)
            self._remember_path(relative_path)
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
            self._write_log(relative_path, self._thin(kept))
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
        me = me or self.me
        with self._lock:
            floors = self.purged_before(relative_path)
            existing = self.versions(relative_path)
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
                key = (version.sha, round(version.at), author)
                if key in known:
                    continue
                existing.append(version)
                known.add(key)
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
            self._remember_path(relative_path)
            self._write_log(relative_path, kept)
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
        """
        with self._lock:
            floors = self.purged_before(relative_path)
            for version in self.versions(relative_path):
                author = self.author_of(version)
                if version.at > floors.get(author, 0.0):
                    floors[author] = version.at
            log = self._log_path(relative_path)
            self._log_cache.pop(log.name, None)
            try:
                log.unlink(missing_ok=True)
            except OSError:
                pass
            paths = self._paths()
            entry = paths.get(slug_for(relative_path)) or {}
            paths[slug_for(relative_path)] = {
                "path": relative_path,
                "aliases": entry.get("aliases", []),
                "purged_before": floors,
            }
            self._write_paths(paths)

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
