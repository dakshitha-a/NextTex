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

import re
from dataclasses import dataclass, field
from pathlib import Path

LABEL = re.compile(r"\\label\s*\{([^}]{1,120})\}")
NEWCOMMAND = re.compile(
    r"\\(?:new|renew|provide)command\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?"
)
NEWENV = re.compile(r"\\newenvironment\*?\s*\{([^}]+)\}")
DECLARE_OP = re.compile(r"\\DeclareMathOperator\*?\s*\{?\\([a-zA-Z@]+)\}?")
BIB_ENTRY = re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", re.MULTILINE)
BIB_FIELD = re.compile(r"^\s*(\w+)\s*=\s*[{\"](.*?)[}\"]\s*,?\s*$", re.MULTILINE)

TEX_SUFFIXES = {".tex", ".ltx", ".sty", ".cls"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".pdf", ".eps", ".svg"}


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


def _first_author(value: str) -> str:
    if not value:
        return ""
    first = value.split(" and ")[0]
    surname = first.split(",")[0] if "," in first else first.split()[-1]
    return _clean(surname)


def scan(root: Path, *, excluded=None, build_dir: Path | None = None) -> Symbols:
    """Everything in the project worth completing to."""
    found = Symbols()
    seen_labels: set[str] = set()
    seen_commands: set[str] = set()

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        parts = set(path.parts)
        if parts & {".git", ".nexttex", "__pycache__", "node_modules"}:
            continue
        if build_dir is not None and build_dir in path.parents:
            continue
        if excluded is not None and excluded(path):
            continue

        suffix = path.suffix.lower()
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

        for name, arity in NEWCOMMAND.findall(text):
            if name in seen_commands:
                continue
            seen_commands.add(name)
            found.commands.append(
                {"name": name, "args": int(arity or 0), "file": relative}
            )
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

    def _newest(self) -> float:
        newest = 0.0
        for path in self.root.rglob("*"):
            if path.suffix.lower() not in TEX_SUFFIXES | {".bib"} | IMAGE_SUFFIXES:
                continue
            if {".git", ".nexttex"} & set(path.parts):
                continue
            try:
                newest = max(newest, path.stat().st_mtime)
            except OSError:
                continue
        return newest

    def get(self, *, excluded=None, build_dir: Path | None = None) -> Symbols:
        stamp = self._newest()
        if self._value is None or stamp != self._stamp:
            self._value = scan(self.root, excluded=excluded, build_dir=build_dir)
            self._stamp = stamp
        return self._value
