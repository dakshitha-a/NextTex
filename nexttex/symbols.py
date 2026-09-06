"""What the project itself can complete.

Autocomplete for LaTeX is only useful if it knows *this* document: the
labels you have defined, the citation keys in your .bib, the figures you
have uploaded, and the macros your preamble declares.  A generic list of
commands is the least valuable part of it.

Scanning is cheap enough to do on demand -- a finished dissertation is a
couple of megabytes of .tex -- so this caches on the newest modification
time it saw rather than trying to watch anything.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

LABEL = re.compile(r"\\label\s*\{([^}]{1,120})\}")
NEWCOMMAND = re.compile(
    r"\\(?:new|renew|provide)command\*?\s*\{?\\([a-zA-Z@]+)\}?\s*"
    r"(?:\[(\d)\])?\s*(\{)"
)
NEWENV = re.compile(r"\\newenvironment\*?\s*\{([^}]+)\}")
DECLARE_OP = re.compile(r"\\DeclareMathOperator\*?\s*\{?\\([a-zA-Z@]+)\}?")
BIB_ENTRY = re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", re.MULTILINE)
BIB_FIELD = re.compile(r"^\s*(\w+)\s*=\s*[{\"](.*?)[}\"]\s*,?\s*$", re.MULTILINE)

TEX_SUFFIXES = {".tex", ".ltx", ".sty", ".cls"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".pdf", ".eps", ".svg"}

# Directories worth neither walking into nor completing from.  Pruned during
# the walk rather than filtered afterwards: on a thesis with a .git and a
# node_modules, descending into them and discarding the results is most of
# the cost of a scan.
IGNORED_DIRS = {".git", ".nexttex", "__pycache__", "node_modules", ".venv"}

# What a change to actually means the completions are out of date.  The
# build directory is excluded from the walk entirely, which is why this can
# include .pdf: figures are worth noticing, build/main.pdf is not -- and it
# is rewritten by every compile, which used to force a full rescan of the
# project every 1.6 seconds while somebody was typing.
STAMP_SUFFIXES = TEX_SUFFIXES | {".bib"} | IMAGE_SUFFIXES


def walk_project(
    root: Path, *, excluded=None, build_dir: Path | None = None
) -> list[Path]:
    """Every file in the project worth reading, in a stable order."""
    found: list[Path] = []
    for parent, dirnames, filenames in os.walk(root):
        here = Path(parent)
        dirnames[:] = sorted(
            name for name in dirnames
            if name not in IGNORED_DIRS
            and not (build_dir is not None and here / name == build_dir)
        )
        for name in sorted(filenames):
            path = here / name
            if excluded is not None and excluded(path):
                continue
            found.append(path)
    return found


@dataclass
class Symbols:
    labels: list[dict] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)
    images: list[str] = field(default_factory=list)
    texfiles: list[str] = field(default_factory=list)
    commands: list[dict] = field(default_factory=list)
    environments: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "labels": self.labels,
            "citations": self.citations,
            "images": self.images,
            "texfiles": self.texfiles,
            "commands": self.commands,
            "environments": self.environments,
        }


def _bib_entries(text: str) -> list[dict]:
    """Citation keys with enough detail to tell two papers apart."""
    entries: list[dict] = []
    for match in BIB_ENTRY.finditer(text):
        start = match.end()
        end = text.find("\n@", start)
        body = text[start : end if end > 0 else len(text)]
        fields = {
            name.lower(): value.strip()
            for name, value in BIB_FIELD.findall(body)
        }
        entries.append({
            "key": match.group(2),
            "type": match.group(1).lower(),
            "title": _clean(fields.get("title", "")),
            "author": _first_author(fields.get("author", "")),
            "year": fields.get("year", "") or fields.get("date", "")[:4],
        })
    return entries


def _clean(value: str) -> str:
    return re.sub(r"[{}\\]", "", value).strip()[:120]


def _balanced(text: str, start: int, limit: int = 400) -> str:
    """The contents of the brace group starting at `start`."""
    if start >= len(text) or text[start] != "{":
        return ""
    depth = 0
    for index in range(start, min(len(text), start + limit)):
        char = text[index]
        if char == "{" and text[index - 1 : index] != "\\":
            depth += 1
        elif char == "}" and text[index - 1 : index] != "\\":
            depth -= 1
            if depth == 0:
                return text[start + 1 : index]
    return ""


def _first_author(value: str) -> str:
    if not value:
        return ""
    first = value.split(" and ")[0]
    surname = first.split(",")[0] if "," in first else first.split()[-1]
    return _clean(surname)


def scan(
    root: Path,
    *,
    excluded=None,
    build_dir: Path | None = None,
    files: list[Path] | None = None,
) -> Symbols:
    """Everything in the project worth completing to.

    `files` is the walk the caller has already done, so the cache below can
    decide whether a rescan is needed and then perform it without walking
    the project a second time.
    """
    found = Symbols()
    seen_labels: set[str] = set()
    seen_commands: set[str] = set()

    if files is None:
        files = walk_project(root, excluded=excluded, build_dir=build_dir)
    for path in files:
        suffix = path.suffix.lower()
        if suffix not in STAMP_SUFFIXES:
            continue
        relative = str(path.relative_to(root))

        if suffix in IMAGE_SUFFIXES:
            found.images.append(relative)
            continue
        if suffix == ".bib":
            try:
                found.citations.extend(_bib_entries(path.read_text(
                    encoding="utf-8", errors="replace")))
            except OSError:
                pass
            continue
        if suffix not in TEX_SUFFIXES:
            continue

        if suffix in {".tex", ".ltx"}:
            found.texfiles.append(relative)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        for line_number, line in enumerate(text.splitlines(), start=1):
            for name in LABEL.findall(line):
                if name in seen_labels:
                    continue
                seen_labels.add(name)
                found.labels.append(
                    {"name": name, "file": relative, "line": line_number}
                )

        for match in NEWCOMMAND.finditer(text):
            name, arity = match.group(1), match.group(2)
            if name in seen_commands:
                continue
            seen_commands.add(name)
            found.commands.append({
                "name": name,
                "args": int(arity or 0),
                "file": relative,
                # The body, so a hover preview can expand the macro rather
                # than showing an error for the writer's own notation.
                "definition": _balanced(text, match.end(3) - 1),
            })
        for name in DECLARE_OP.findall(text):
            if name not in seen_commands:
                seen_commands.add(name)
                found.commands.append({"name": name, "args": 0, "file": relative})
        found.environments.extend(NEWENV.findall(text))

    found.environments = sorted(set(found.environments))
    return found


class SymbolCache:
    """One scan per change, not one per keystroke."""

    def __init__(self, root: Path):
        self.root = root
        self._stamp: float = -1.0
        self._value: Symbols | None = None

    def get(self, *, excluded=None, build_dir: Path | None = None) -> Symbols:
        """The project's symbols, rescanned only if something has changed.

        One walk answers both questions -- what changed, and what to read --
        so a hit costs a single pass over the source files and a miss costs
        no more walking than a hit.
        """
        files = walk_project(self.root, excluded=excluded, build_dir=build_dir)
        newest = 0.0
        for path in files:
            if path.suffix.lower() not in STAMP_SUFFIXES:
                continue
            try:
                newest = max(newest, path.stat().st_mtime)
            except OSError:
                continue
        if self._value is None or newest != self._stamp:
            self._value = scan(
                self.root, excluded=excluded, build_dir=build_dir, files=files,
            )
            self._stamp = newest
        return self._value
