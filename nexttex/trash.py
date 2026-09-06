"""Deleted files, kept until somebody says otherwise.

Deleting a chapter is the one action in a writing app that cannot be taken
back by pressing undo, so it is not really a delete: the file's contents go
into the history's blob store, an entry is written here, and only then does
the working copy go away.  Restoring puts it back.

Nothing is ever cleaned up automatically.  A trash that empties itself after
thirty days is a trash that loses the thing you went looking for on day
thirty-one; the writer empties it, one entry at a time or all at once.

A deleted *directory* is one entry listing every file beneath it, so
restoring brings the folder back whole rather than as a scatter of files.

The payload is **moved**, not copied.  `.nexttex/` is inside the project, so
a rename is on the same filesystem and therefore instant whatever the size:
deleting a figures folder holding two hundred megabytes of PDFs must not
freeze the server while it compresses them, and restoring it must not do
the same again.  Text files still get a final version recorded in their own
history first, because that is cheap and it keeps the timeline honest.
"""

from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path

from .atomic import unique_name, write_atomically
from .history import History

# Names that are never carried into the trash: they are regenerated, and
# keeping them would make an entry ten times its useful size.
SKIP_DIRS = {".git", "__pycache__", ".nexttex", "node_modules"}

# Above this, a file's text is not worth a final version -- it is a figure
# or a dataset, and the trash keeps its bytes anyway.
MAX_TEXT_VERSION_BYTES = 2_000_000


@dataclass
class TrashedFile:
    path: str
    bytes: int

    def as_dict(self) -> dict:
        return {"path": self.path, "bytes": self.bytes}


@dataclass
class TrashEntry:
    id: str
    at: float
    by: str
    path: str
    kind: str                       # "file" or "dir"
    files: list[TrashedFile] = field(default_factory=list)
    dirs: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "at": self.at,
            "by": self.by,
            "path": self.path,
            "name": self.path.rsplit("/", 1)[-1],
            "kind": self.kind,
            "files": [f.as_dict() for f in self.files],
            "dirs": self.dirs,
            "count": len(self.files),
            "bytes": sum(f.bytes for f in self.files),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TrashEntry":
        return cls(
            id=str(data.get("id") or ""),
            at=float(data.get("at") or 0.0),
            by=str(data.get("by") or "you"),
            path=str(data.get("path") or ""),
            kind=str(data.get("kind") or "file"),
            files=[
                TrashedFile(
                    path=str(item.get("path") or ""),
                    bytes=int(item.get("bytes") or 0),
                )
                for item in (data.get("files") or [])
            ],
            dirs=[str(item) for item in (data.get("dirs") or [])],
        )


class Trash:
    """What has been deleted from one project, and how to get it back."""

    def __init__(self, root: Path, history: History, project_root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.log = self.root / "entries.jsonl"
        self.history = history
        self.project_root = project_root

    # -- reading -----------------------------------------------------------
    def entries(self) -> list[TrashEntry]:
        try:
            lines = self.log.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        out: list[TrashEntry] = []
        for line in lines:
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if data.get("removed"):
                out = [entry for entry in out if entry.id != data.get("id")]
                continue
            out.append(TrashEntry.from_dict(data))
        out.sort(key=lambda entry: entry.at, reverse=True)
        return out

    def find(self, entry_id: str) -> TrashEntry | None:
        return next((e for e in self.entries() if e.id == entry_id), None)

    def payload_of(self, entry: TrashEntry) -> Path:
        """Where a deleted file or folder is actually sitting."""
        return self.root / entry.id / Path(entry.path).name

    # -- writing -----------------------------------------------------------
    def _append(self, item: dict) -> None:
        try:
            with self.log.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(item) + "\n")
        except OSError:
            pass

    def _rewrite(self, entries: list[TrashEntry]) -> None:
        temp = self.log.with_name(self.log.name + ".tmp")
        try:
            temp.write_text(
                "".join(json.dumps(entry.as_dict()) + "\n" for entry in entries),
                encoding="utf-8",
            )
            temp.replace(self.log)
        except OSError:
            pass

    def delete(self, target: Path, *, by: str = "you") -> TrashEntry:
        """Take a file or directory out of the project, keeping everything."""
        root = self.project_root.resolve()
        relative = str(target.resolve().relative_to(root))
        members = self._members(target)

        files: list[TrashedFile] = []
        for member in members:
            try:
                size = member.stat().st_size
            except OSError:
                continue
            member_relative = str(member.resolve().relative_to(root))
            files.append(TrashedFile(member_relative, size))
            # A deletion is a version in its own right, so a text file's own
            # history ends with the state it was in when it went.
            if size <= MAX_TEXT_VERSION_BYTES:
                try:
                    self.history.record(
                        member_relative,
                        member.read_text(encoding="utf-8"),
                        by=by, why="deleted", op="delete",
                    )
                except (OSError, UnicodeDecodeError):
                    pass   # an image has no text history, only its bytes

        dirs: list[str] = []
        if target.is_dir():
            dirs = [
                str(path.resolve().relative_to(root))
                for path in sorted(target.rglob("*"))
                if path.is_dir() and not any(part in SKIP_DIRS for part in path.parts)
            ]

        entry = TrashEntry(
            # The timestamp alone is not unique: deleting two files in one
            # keystroke put them in the same millisecond, and purging one
            # then took the other with it.
            id=f"t{int(time.time() * 1000):x}{secrets.token_hex(3)}",
            at=time.time() * 1000,
            by=by,
            path=relative,
            kind="dir" if target.is_dir() else "file",
            files=files,
            dirs=dirs,
        )

        # Move rather than copy: same filesystem, so this is instant however
        # large the folder is, and it preserves everything about the files.
        holding = self.root / entry.id
        holding.mkdir(parents=True, exist_ok=True)
        try:
            target.rename(holding / target.name)
        except OSError:
            import shutil

            shutil.move(str(target), str(holding / target.name))
        self._append(entry.as_dict())
        return entry

    def restore(self, entry_id: str) -> dict:
        """Put a deleted file or folder back where it came from."""
        entry = self.find(entry_id)
        if entry is None:
            raise FileNotFoundError("no such trash entry")
        payload = self.payload_of(entry)
        if not payload.exists():
            raise FileNotFoundError("what was deleted is no longer in the trash")

        target = self.project_root / entry.path
        renamed = ""
        if target.exists():
            # Something is there now.  Put the old one beside it rather than
            # over it, and say which name it came back under.
            target = self._free_name(target)
            renamed = str(target.relative_to(self.project_root))
        target.parent.mkdir(parents=True, exist_ok=True)
        payload.rename(target)

        restored = [
            str((target / Path(file.path).relative_to(entry.path)).relative_to(
                self.project_root))
            if entry.kind == "dir"
            else str(target.relative_to(self.project_root))
            for file in entry.files
        ]
        for relative in restored:
            back = self.project_root / relative
            try:
                if back.stat().st_size <= MAX_TEXT_VERSION_BYTES:
                    self.history.record(
                        relative, back.read_text(encoding="utf-8"),
                        by="you", why="restored from the trash", op="restore",
                    )
            except (OSError, UnicodeDecodeError):
                pass

        try:
            (self.root / entry.id).rmdir()
        except OSError:
            pass
        self._append({"id": entry.id, "removed": True, "at": time.time() * 1000})
        return {"restored": restored, "renamed": renamed, "path": entry.path}

    def purge(self, entry_id: str) -> bool:
        """Delete one entry for good, and the history of what it held."""
        import shutil

        entry = self.find(entry_id)
        if entry is None:
            return False
        shutil.rmtree(self.root / entry.id, ignore_errors=True)
        self._forget(entry)
        self._append({"id": entry.id, "removed": True, "at": time.time() * 1000})
        self._rewrite(self.entries())
        return True

    def empty(self) -> int:
        import shutil

        entries = self.entries()
        for entry in entries:
            shutil.rmtree(self.root / entry.id, ignore_errors=True)
            self._forget(entry)
        self._rewrite([])
        return len(entries)

    # -- helpers -----------------------------------------------------------
    def _forget(self, entry: TrashEntry) -> None:
        """Drop the version history of what this entry held.

        Only where nothing lives at that path now.  History is keyed by
        path, so deleting `chapters/03.tex`, writing a new file under the
        same name for a week and then emptying the trash used to unlink the
        new file's entire history along with the old one's.
        """
        for file in entry.files:
            if not (self.project_root / file.path).exists():
                self.history.forget(file.path)

    @staticmethod
    def _members(target: Path) -> list[Path]:
        if target.is_file() and not target.is_symlink():
            return [target]
        found: list[Path] = []
        for path in sorted(target.rglob("*")):
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            # A symlink is followed by is_file(), and resolve() below would
            # then record its *target's* path -- a file that still exists,
            # whose history a purge would forget and whose relative path a
            # restore could not reconstruct.  The link travels with the
            # folder either way; it is simply not listed as a member.
            if path.is_file() and not path.is_symlink():
                found.append(path)
        return found

    @staticmethod
    def _free_name(target: Path) -> Path:
        return unique_name(target, "restored")
