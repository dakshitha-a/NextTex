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
last day, then an hour apart for a week, a day apart for a month, a week
apart beyond -- but never dropping a version somebody labelled, one the
agent made, or a deletion or a restore.  Those are the ones people come
looking for.

The file format follows `server/transcript.py`: append-only JSONL, `at` in
float milliseconds, tolerant reads that skip a corrupt line rather than
losing the file, and atomic writes through a sibling temp file.
"""

from __future__ import annotations

import hashlib
import json
import time
import zlib
from dataclasses import dataclass
from pathlib import Path

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
            return sha
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name + ".tmp")
        temp.write_bytes(zlib.compress(data, 6))
        temp.replace(target)
        return sha

    def get(self, sha: str) -> bytes | None:
        try:
            return zlib.decompress(self.path_for(sha).read_bytes())
        except (OSError, zlib.error):
            return None

    def has(self, sha: str) -> bool:
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
        temp = self.paths_file.with_suffix(".json.tmp")
        try:
            temp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            temp.replace(self.paths_file)
        except OSError:
            pass
        self._paths_cache = (self._stamp(self.paths_file), data)

    def _remember_path(self, relative_path: str) -> str:
        slug = slug_for(relative_path)
        paths = self._paths()
        entry = paths.get(slug)
        if entry is None or entry.get("path") != relative_path:
            paths[slug] = {"path": relative_path, "aliases": (entry or {}).get("aliases", [])}
            self._write_paths(paths)
        return slug

    def note_rename(self, old_path: str, new_path: str) -> None:
        """Carry a file's history across a rename.

        The log is keyed by the old path, so rather than rewriting it the new
        path's slug is pointed at the same log file and the old name kept as
        an alias -- a rename costs one small JSON write and no blobs.
        """
        old_slug, new_slug = slug_for(old_path), slug_for(new_path)
        if old_slug == new_slug:
            return
        source = self.log_dir / f"{old_slug}.jsonl"
        if not source.exists():
            return
        target = self.log_dir / f"{new_slug}.jsonl"
        try:
            if target.exists():
                # Both names have a past; keep the older one and append.
                with target.open("a", encoding="utf-8") as handle:
                    handle.write(source.read_text(encoding="utf-8"))
                source.unlink()
            else:
                source.replace(target)
        except OSError:
            return
        self._log_cache.pop(source.name, None)
        self._log_cache.pop(target.name, None)
        paths = self._paths()
        aliases = (paths.get(old_slug) or {}).get("aliases", [])
        paths.pop(old_slug, None)
        paths[new_slug] = {
            "path": new_path,
            "aliases": sorted(set(aliases + [old_path])),
        }
        self._write_paths(paths)

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
            # A fresh list, because callers slice and append to it; the
            # Version objects themselves are only ever mutated by
            # `set_label`, which drops the entry afterwards.
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
        target = self._log_path(relative_path)
        temp = target.with_name(target.name + ".tmp")
        try:
            temp.write_text(
                "".join(json.dumps(v.as_dict()) + "\n" for v in versions),
                encoding="utf-8",
            )
            temp.replace(target)
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
    ) -> Version | None:
        """Note what a file contains now. Returns the version, or None.

        None means there was nothing to record: identical content, or no
        content at all.
        """
        if text is None:
            return None
        data = text.encode("utf-8") if isinstance(text, str) else text
        sha = hashlib.sha256(data).hexdigest()

        existing = self.versions(relative_path)
        if existing and existing[-1].sha == sha and op == "edit":
            return None   # nothing changed since the last version

        self.blobs.put(data)
        self._remember_path(relative_path)
        version = Version(
            at=now_ms(), sha=sha, bytes=len(data), by=by, why=why, op=op,
            label=label, source=source,
        )

        # One editing burst is one version.  Never across authors: what the
        # agent changed has to stay separable from what the writer did.
        previous = existing[-1] if existing else None
        coalesce = (
            previous is not None
            and previous.by == by
            # Two browser windows are both "you", and merging them meant the
            # one that saved second replaced the other's version -- so the
            # paragraph it overwrote was gone from the history as well as
            # from the file.  A burst only collapses within one window.
            and previous.source == source
            and previous.op == "edit" == op
            and previous.label is None
            and (version.at - previous.at) < COALESCE_SECONDS * 1000
        )
        kept = existing[:-1] if coalesce else existing
        kept.append(version)
        self._write_log(relative_path, self._thin(kept))
        return version

    def set_label(self, relative_path: str, sha: str, label: str | None) -> bool:
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
        """Drop a file's history entirely. Blobs go on the next collection."""
        log = self._log_path(relative_path)
        self._log_cache.pop(log.name, None)
        try:
            log.unlink(missing_ok=True)
        except OSError:
            pass
        paths = self._paths()
        if paths.pop(slug_for(relative_path), None) is not None:
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
