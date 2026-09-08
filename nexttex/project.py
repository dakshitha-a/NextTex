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
def instance_name() -> str:
    """Which install this is, when a machine carries more than one.

    Empty is the ordinary case and the ordinary directory.  A name -- set
    by `install.sh --instance` -- moves the whole state directory aside, so
    a development copy and the copy somebody actually writes in do not
    share a port, a token or a project list.  Validated as a single path
    segment: a name is a label, never a way out of the directory.
    """
    name = os.environ.get("NEXTTEX_INSTANCE", "").strip()
    return name if re.fullmatch(r"[A-Za-z0-9_-]{1,32}", name) else ""


def state_home() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    name = instance_name()
    return Path(base) / (f"nexttex-{name}" if name else "nexttex")


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
IGNORED_FILES = {".DS_Store"}

#: Files whose *name begins* with one of these is ours too.  A prefix rather
#: than a fixed name because the preview stand-in is now named after the
#: document it stands in for, and a project may have several.
IGNORED_PREFIXES = (".nexttex-preview",)


def is_ours(name: str) -> bool:
    """Whether a file is NextTex's own machinery rather than the writer's."""
    return name in IGNORED_FILES or name.startswith(IGNORED_PREFIXES)


# Files inside a project that are instructions to a program rather than part
# of the writing, and that some program runs without anybody asking it to.
#
# A project is not always the writer's own work.  It can be cloned, it can
# arrive from a template, and since collaboration it can be *sent*: a peer
# proposes a path and a body, and the receiving install writes it.  The path
# fence above stops that leaving the project, and for a .tex file that is the
# whole story.  For these it is not:
#
#   .git/config       a `core.fsmonitor` value is a command, and it runs on
#                     the next `git status` -- which this app runs after
#                     every build.  No LaTeX pass needed.
#   .git/hooks/*      the same, on the next commit.
#   latexmkrc         arbitrary Perl, read from the working directory on
#                     every full build.  `-norc` now refuses to read it, but
#                     a writer running latexmk in a terminal has no such
#                     protection.
#   Makefile          arbitrary shell, for the writer who types `make`.
#   .envrc            arbitrary shell, on entering the directory, for anyone
#                     with direnv.
#   .claude/          settings the agent SDK loads, and settings may declare
#                     hooks, and a hook is a command.
#   .nexttex/         this app's own record: the trash ledger names where a
#                     restore puts things, and the history is what an undo
#                     comes out of.
#
# Not in this list, deliberately: `nexttex.toml`, because two people working
# on one document want the same main file, and the dangerous half of it is
# fixed by validating what it says rather than by refusing to receive it;
# `.gitignore`, which is shared and harmless; and `CLAUDE.md`, which steers
# the agent but is no more able to than any chapter it reads, since the
# permission fence is a PreToolUse hook and the SDK documents that as running
# for every call whatever the settings say.
CONTROL_DIRS = {".git", ".nexttex", ".claude"}
CONTROL_FILES = {
    "latexmkrc", ".latexmkrc",
    "Makefile", "makefile", "GNUmakefile",
    ".envrc",
}


def is_control_path(relative: str | Path) -> bool:
    """Whether this path inside a project is one of the above.

    Takes a path already known to be inside the project.  Callers that start
    from something a peer or a browser said should use
    `Project.resolve_for_write`, which resolves first: a symlink is how you
    would otherwise reach `.git/config` by a name that does not mention it.
    """
    parts = Path(relative).parts
    if not parts:
        return False
    return bool(CONTROL_DIRS.intersection(parts)) or parts[-1] in CONTROL_FILES


def _toml(value: str) -> str:
    """A TOML basic string.  Project names are typed by people, and a quote
    in one used to produce a file the parser then silently discarded --
    taking the project's main file with it."""
    escaped = (
        str(value)
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\t", "\\t")
    )
    return f'"{escaped}"'


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
    #: Documents previewed alongside the main one, as project-relative
    #: paths.  A dissertation and its supplementary information are two
    #: documents in one folder, and neither includes the other; before this
    #: the only way to build the second was to make it the main file and
    #: then change it back.  `main` is always previewable and is never
    #: listed here.
    previews: list[str] = field(default_factory=list)

    # Three switches the writer sets from the settings card.  Per project
    # rather than per browser: whether a document compiles as you type is a
    # fact about the document -- a 40-file dissertation takes nineteen
    # seconds to build and a one-page note takes one -- not about the
    # machine it is being read on.
    autocompile: bool = True
    mark_errors: bool = True
    # Off by default.  chktex is right often enough to be worth reading and
    # wrong often enough that marking every finding in the text is noise
    # while writing; the drawer keeps all of them either way.
    mark_warnings: bool = False

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
            previews=list(section.get("previews", [])),
            autocompile=bool(section.get("autocompile", True)),
            mark_errors=bool(section.get("mark_errors", True)),
            mark_warnings=bool(section.get("mark_warnings", False)),
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


    def save(self, root: Path) -> None:
        """Write nexttex.toml.

        Every field this class knows about is written, and only those: a key
        somebody added by hand that NextTex has never heard of does not
        survive.  The docstring here used to claim otherwise, which was the
        more dangerous kind of wrong -- it read as a guarantee, and the
        first field added after it would have been silently erased the next
        time a settings switch was toggled.
        """
        lines = [
            "# NextTex reads this when the project is opened.",
            "[project]",
            f"name = {_toml(self.name)}",
            f"main = {_toml(self.main)}",
            f"build_dir = {_toml(self.build_dir)}",
            # Written whether or not they are true.  The optional fields
            # below are omitted when falsy, which is right for a string or a
            # list and wrong for a switch: `autocompile = false` would be
            # dropped on every save and the setting would never stick.
            f"autocompile = {str(self.autocompile).lower()}",
            f"mark_errors = {str(self.mark_errors).lower()}",
            f"mark_warnings = {str(self.mark_warnings).lower()}",
        ]
        if self.check_command:
            lines.append(f"check_command = {_toml(self.check_command)}")
        if self.exclude:
            listed = ", ".join(_toml(item) for item in self.exclude)
            lines.append(f"exclude = [{listed}]")
        if self.previews:
            listed = ", ".join(_toml(item) for item in self.previews)
            lines.append(f"previews = [{listed}]")
        target = root / CONFIG_NAME
        temp = target.with_name(target.name + ".tmp")
        temp.write_text("\n".join(lines) + "\n", encoding="utf-8")
        temp.replace(target)


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
        return id_for(self.root)

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
        # A .gitignore of "*" ignores everything here including itself, no
        # matter what the project's own .gitignore says.  Without it, a
        # project whose .gitignore predates NextTex would have every version
        # blob and every deleted file swept into its next commit.
        ignore = path / ".gitignore"
        if not ignore.exists():
            try:
                ignore.write_text("*\n", encoding="utf-8")
            except OSError:
                pass
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

    def resolve_for_write(self, relative: str) -> Path:
        """`resolve`, and then refuse the files that are instructions.

        For writes whose path was proposed by somebody other than the person
        at the keyboard: a collaborating peer, or an upload.  Resolving first
        matters, because a symlink is how `.git/config` gets written under a
        name that does not say `.git`.
        """
        target = self.resolve(relative)
        if is_control_path(target.relative_to(self.root.resolve())):
            raise PermissionError(f"not a file this project accepts: {relative}")
        return target

    def relative(self, path: Path) -> str:
        return str(Path(path).resolve().relative_to(self.root.resolve()))

    def _relative_below(self, path: Path) -> str:
        """The relative path of something reached by walking from the root.

        No resolve: the caller built this path by stepping down from
        `self.root`, which is already absolute, and following a symlinked
        chapter directory to wherever it points would name the file
        something the file tree cannot open.
        """
        try:
            return str(path.relative_to(self.root))
        except ValueError:
            return self.relative(path)

    # -- the file tree --------------------------------------------------
    def _excluded(self, path: Path) -> bool:
        name = path.name
        if name in IGNORED_DIRS or is_ours(name):
            return True
        if name in set(self.config.exclude):
            return True
        # The build directory is excluded by configuration rather than by
        # name, since a project can call it anything.  Compared as built
        # rather than as resolved: both sides descend from the same root, so
        # resolving them was four `realpath` calls per entry in the tree.
        if path == self.build_dir:
            return True
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
                        "path": self._relative_below(child),
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
                        "path": self._relative_below(child),
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
            "autocompile": self.config.autocompile,
            "markErrors": self.config.mark_errors,
            "markWarnings": self.config.mark_warnings,
        }


# ---------------------------------------------------------------------------
# The registry of known projects.


@dataclass
class RegistryEntry:
    path: str
    name: str
    last_opened: float = 0.0


def id_for(root: Path | str) -> str:
    """The identifier of the project at a path, without opening it.

    Opening one reads its config, and a project with no `nexttex.toml` then
    guesses its main file -- which walks the whole tree reading the first
    four kilobytes of every .tex it finds.  The project list did that for
    every project on the screen, and again for every entry it stepped past
    while looking one up by id.
    """
    import hashlib

    return hashlib.sha256(
        str(Path(root).expanduser().resolve()).encode()
    ).hexdigest()[:12]


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
        # Only the fields this version knows about.  A registry written by
        # a newer NextTex carries keys we have never heard of, and passing
        # those to the dataclass would raise -- taking down the project
        # list, which is the first thing every screen reads.
        known = {field for field in RegistryEntry.__dataclass_fields__}
        entries = []
        for item in raw:
            if not isinstance(item, dict) or "path" not in item:
                continue
            fields = {k: v for k, v in item.items() if k in known}
            fields.setdefault("name", Path(str(fields["path"])).name)
            try:
                entries.append(RegistryEntry(**fields))
            except (TypeError, ValueError):
                continue
        return entries

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
                # Identified whether or not the folder is still there.  This
                # used to be null for a missing project, which meant the one
                # thing you can still usefully do with a dead entry --
                # remove it, or say where the folder went -- was the one
                # thing with no id to address it by, and the Remove button
                # quietly did nothing.  A registry entry is a path, and it
                # has an identity even when nothing is at the end of it.
                "id": id_for(entry.path),
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

    def relocate(self, old: Path | str, new: Path | str) -> Project:
        """Point an existing entry at a different folder.

        The project is opened first and the registry written only if that
        succeeds, so a move that turns out to be wrong leaves the list
        exactly as it was rather than dropping an entry on the way.

        The entry keeps when it was last opened: the folder moved, the
        project did not become a new one, and the list is ordered by when
        each was last worked on.
        """
        project = Project.open(new)
        target = Path(old).expanduser().resolve()
        kept, when = [], None
        for entry in self._read():
            here = Path(entry.path)
            if here == target:
                when = entry.last_opened
                continue
            # An entry already pointing at the destination is replaced by
            # this one rather than duplicated: two entries at one path share
            # an id, and the second would shadow the first everywhere.
            if here == project.root:
                continue
            kept.append(entry)
        kept.append(RegistryEntry(
            path=str(project.root),
            name=project.config.name,
            last_opened=time.time() if when is None else when,
        ))
        self._write(kept)
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

    def path_for(self, project_id: str) -> Path | None:
        """Where an entry points, without needing anything to be there.

        `find` opens the project and so cannot answer for one whose folder
        has been moved or deleted -- which is exactly when a caller needs to
        know the path, to drop the entry or to repoint it.
        """
        for entry in self._read():
            if id_for(entry.path) == project_id:
                return Path(entry.path)
        return None

    def find(self, project_id: str) -> Project | None:
        for entry in self._read():
            root = Path(entry.path)
            if not root.is_dir():
                continue
            if id_for(root) == project_id:
                return Project.open(root)
        return None
