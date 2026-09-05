"""Writing projects: what NextTex knows about a directory of LaTeX.

A project is any directory containing a main .tex file. NextTex does not own
it, does not move it, and does not require it to be laid out in any
particular way -- the dissertation this was built alongside is a git
repository with its own Makefile, and it must keep working exactly as it did
before it was ever opened here.

Everything NextTex adds lives in two places: an optional `nexttex.toml` at
the project root, which the user may commit, and a `.nexttex/` directory for
generated state, which they should not.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib  # type: ignore

CONFIG_NAME = "nexttex.toml"
STATE_DIR = ".nexttex"

# Where the registry of known projects lives.  Follows the XDG convention so
# it sits with a user's other application state rather than in their home
# directory root.
def state_home() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    return Path(base) / "nexttex"


# Files the editor should offer to open.  Anything else is treated as an
# asset: downloadable, referenceable from LaTeX, but not editable as text.
TEXT_SUFFIXES = {
    ".tex", ".ltx", ".sty", ".cls", ".bib", ".bst", ".md", ".txt",
    ".toml", ".yaml", ".yml", ".json", ".cfg", ".gitignore",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".eps"}

# Directories never worth showing in a file tree.  Build output is the big
# one: a LaTeX build directory mirrors the whole chapter tree in .aux files.
IGNORED_DIRS = {
    ".git", ".svn", "__pycache__", "node_modules", ".venv", "venv",
    ".ipynb_checkpoints", ".nexttex", ".DS_Store",
}

# Individual files that are NextTex's own machinery rather than the user's
# work. The preview stand-in in particular is written and rewritten on every
# scoped build; showing it would invite someone to edit it.
IGNORED_FILES = {".nexttex-preview.tex", ".DS_Store"}


@dataclass
class ProjectConfig:
    """The contents of nexttex.toml, with defaults for everything."""

    name: str = ""
    main: str = "main.tex"
    build_dir: str = "build"
    # A command the project defines for its own correctness checks -- the
    # dissertation uses this for its margin and reference verification.
    check_command: str = ""
    # Directories excluded from the tree beyond the built-in list.
    exclude: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, root: Path) -> "ProjectConfig":
        path = root / CONFIG_NAME
        if not path.exists():
            return cls(name=root.name, main=cls._guess_main(root))
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except Exception:
            # A malformed config must not make the project unopenable.
            return cls(name=root.name, main=cls._guess_main(root))
        section = data.get("project", data)
        return cls(
            name=section.get("name") or root.name,
            main=section.get("main") or cls._guess_main(root),
            build_dir=section.get("build_dir", "build"),
            check_command=section.get("check_command", ""),
            exclude=list(section.get("exclude", [])),
        )

    @staticmethod
    def _guess_main(root: Path) -> str:
        """Find the main file when the project has not said which it is.

        The main file is the one with `\\documentclass` and `\\begin{document}`;
        a project can contain many .tex files and only one of them compiles.
        Conventional names win ties.
        """
        candidates: list[tuple[int, str]] = []
        for path in sorted(root.rglob("*.tex")):
            if any(part in IGNORED_DIRS for part in path.parts):
                continue
            try:
                head = path.read_text(encoding="utf-8", errors="replace")[:4000]
            except OSError:
                continue
            if "\\documentclass" not in head:
                continue
            score = 0
            if "\\begin{document}" in head:
                score += 10
            if path.parent == root:
                score += 5
            if path.stem in {"main", "thesis", "dissertation", "paper", "report"}:
                score += 5
            candidates.append((score, str(path.relative_to(root))))
        if not candidates:
            return "main.tex"
        return max(candidates)[1]


@dataclass
class Project:
    root: Path
    config: ProjectConfig

    @classmethod
    def open(cls, root: Path | str) -> "Project":
        root = Path(root).expanduser().resolve()
        if not root.is_dir():
            raise FileNotFoundError(f"not a directory: {root}")
        return cls(root=root, config=ProjectConfig.load(root))

    @property
    def id(self) -> str:
        """A stable, filesystem-safe identifier derived from the path."""
        import hashlib
        return hashlib.sha256(str(self.root).encode()).hexdigest()[:12]

    @property
    def main(self) -> Path:
        return self.root / self.config.main

    @property
    def build_dir(self) -> Path:
        return self.root / self.config.build_dir

    @property
    def state_dir(self) -> Path:
        path = self.root / STATE_DIR
        path.mkdir(parents=True, exist_ok=True)
        return path

    # -- path safety ----------------------------------------------------
    def resolve(self, relative: str) -> Path:
        """Resolve a client-supplied path, refusing to leave the project.

        Every path from the browser goes through here.  `..` segments and
        absolute paths are the obvious attack; a symlink pointing outside
        the project is the one that is easy to forget, which is why this
        resolves fully before comparing rather than just normalising.
        """
        candidate = (self.root / relative).resolve()
        root = self.root.resolve()
        if candidate != root and root not in candidate.parents:
            raise PermissionError(f"path escapes the project: {relative}")
        return candidate

    def relative(self, path: Path) -> str:
        return str(Path(path).resolve().relative_to(self.root.resolve()))

    # -- the file tree --------------------------------------------------
    def _excluded(self, path: Path) -> bool:
        name = path.name
        if name in IGNORED_DIRS or name in IGNORED_FILES:
            return True
        if name in set(self.config.exclude):
            return True
        # The build directory is excluded by configuration rather than by
        # name, since a project can call it anything.
        try:
            if path.resolve() == self.build_dir.resolve():
                return True
        except OSError:
            pass
        return False

    def tree(self) -> dict:
        """The project's files, as a nested structure for the file tree."""

        def walk(directory: Path) -> list[dict]:
            entries: list[dict] = []
            try:
                children = sorted(
                    directory.iterdir(),
                    key=lambda p: (p.is_file(), p.name.lower()),
                )
            except OSError:
                return entries
            for child in children:
                if self._excluded(child):
                    continue
                if child.is_dir():
                    entries.append({
                        "name": child.name,
                        "path": self.relative(child),
                        "type": "dir",
                        "children": walk(child),
                    })
                else:
                    suffix = child.suffix.lower()
                    try:
                        size = child.stat().st_size
                    except OSError:
                        size = 0
                    entries.append({
                        "name": child.name,
                        "path": self.relative(child),
                        "type": "file",
                        "kind": (
                            "text" if suffix in TEXT_SUFFIXES
                            else "image" if suffix in IMAGE_SUFFIXES
                            else "binary"
                        ),
                        "size": size,
                    })
            return entries

        return {
            "name": self.config.name,
            "path": "",
            "type": "dir",
            "children": walk(self.root),
        }

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.config.name,
            "root": str(self.root),
            "main": self.config.main,
            "buildDir": self.config.build_dir,
            "checkCommand": self.config.check_command,
        }


# ---------------------------------------------------------------------------
# The registry of known projects.


@dataclass
class RegistryEntry:
    path: str
    name: str
    last_opened: float = 0.0


class Registry:
    """Which projects this NextTex instance knows about.

    Projects are registered, not imported: the registry stores a path and
    nothing else, so removing a project from NextTex never touches the files.
    """

    def __init__(self, path: Path | None = None):
        self.path = path or (state_home() / "projects.json")
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> list[RegistryEntry]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        return [RegistryEntry(**e) for e in raw if isinstance(e, dict) and "path" in e]

    def _write(self, entries: list[RegistryEntry]) -> None:
        # Written via a temporary file so an interrupted write cannot leave
        # the registry truncated and lose every project the user added.
        temp = self.path.with_suffix(".json.tmp")
        temp.write_text(
            json.dumps([asdict(e) for e in entries], indent=2), encoding="utf-8"
        )
        temp.replace(self.path)

    def list(self) -> list[dict]:
        entries = self._read()
        result = []
        for entry in sorted(entries, key=lambda e: -e.last_opened):
            exists = Path(entry.path).is_dir()
            result.append({
                "path": entry.path,
                "name": entry.name,
                "lastOpened": entry.last_opened,
                # A project whose directory has gone is shown, not silently
                # dropped: the user moved it, and should be told so.
                "missing": not exists,
                "id": Project.open(entry.path).id if exists else None,
            })
        return result

    def add(self, root: Path | str) -> Project:
        project = Project.open(root)
        entries = [e for e in self._read() if Path(e.path) != project.root]
        entries.append(RegistryEntry(
            path=str(project.root),
            name=project.config.name,
            last_opened=time.time(),
        ))
        self._write(entries)
        return project

    def remove(self, root: Path | str) -> None:
        target = Path(root).expanduser().resolve()
        self._write([e for e in self._read() if Path(e.path) != target])

    def touch(self, root: Path | str) -> None:
        target = Path(root).expanduser().resolve()
        entries = self._read()
        for entry in entries:
            if Path(entry.path) == target:
                entry.last_opened = time.time()
                self._write(entries)
                return

    def find(self, project_id: str) -> Project | None:
        for entry in self._read():
            root = Path(entry.path)
            if not root.is_dir():
                continue
            project = Project.open(root)
            if project.id == project_id:
                return project
        return None
