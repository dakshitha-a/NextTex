r"""Which labels and citation keys a project defines, and which it uses.

The submission check wants to know which labels nobody refers to and
which bibliography entries nobody cites; the bibliography check wants the
second of those while the writer types. Both are the same question asked
of the same text, so both ask here. The command families come from
`rename`, which already knows every `\ref` and `\cite` spelling with its
optional arguments and comma lists, so this is a third reader of those
patterns rather than a fourth copy of them.

A use inside a comment is not a use. A `\label` inside a comment is not
a definition either, so a commented-out figure does not make its label
look duplicated.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .rename import CITE_CALL, REF_CALL, comment_starts

LABEL = re.compile(r"\\label\s*\{([^}\n]*)\}")
#: `\label{` itself, which REF_CALL also matches since rename lists it
#: among the reference commands; `\labelcref{` is a reference and must
#: not be mistaken for it.
DEFINITION_HEAD = re.compile(r"\\label\s*\{")
#: `\nocite{*}` says every entry is wanted; no entry is uncited after it.
NOCITE_ALL = re.compile(r"\\nocite\s*\{\s*\*\s*\}")


@dataclass
class Where:
    """One place a name appears."""
    path: str
    line: int


@dataclass
class Usage:
    #: Every `\label{x}` definition, in the order met, so a duplicate is
    #: the second entry for the same name.
    definitions: dict[str, list[Where]] = field(default_factory=dict)
    referenced: set[str] = field(default_factory=set)
    cited: set[str] = field(default_factory=set)
    nocite_all: bool = False

    @property
    def duplicates(self) -> dict[str, list[Where]]:
        return {name: places for name, places in self.definitions.items() if len(places) > 1}

    @property
    def unused(self) -> dict[str, Where]:
        return {
            name: places[0] for name, places in self.definitions.items()
            if name not in self.referenced
        }


def _uncommented(line: str) -> str:
    cut = comment_starts(line)
    return line if cut is None else line[:cut]


def _names(inside: str) -> list[str]:
    return [piece.strip() for piece in inside.split(",") if piece.strip()]


def scan(texts: dict[str, str]) -> Usage:
    """Definitions and uses across every `.tex` text, by relative path."""
    out = Usage()
    for path, text in texts.items():
        if path.lower().endswith(".bib"):
            continue
        for number, raw in enumerate(text.split("\n"), start=1):
            line = _uncommented(raw)
            if "\\" not in line:
                continue
            for found in LABEL.finditer(line):
                for name in _names(found.group(1)):
                    out.definitions.setdefault(name, []).append(Where(path, number))
            for found in REF_CALL.finditer(line):
                # `\label` is in REF_COMMANDS so rename can find it; a
                # definition is not a reference to itself.
                if DEFINITION_HEAD.match(found.group(0)):
                    continue
                out.referenced.update(_names(found.group(1)))
            for found in CITE_CALL.finditer(line):
                out.cited.update(_names(found.group(1)))
            if NOCITE_ALL.search(line):
                out.nocite_all = True
    return out


def cited_keys(texts: dict[str, str]) -> set[str] | None:
    """The keys the documents cite, or None when `\\nocite{*}` makes every
    entry cited, which is what a caller that wants "uncited" needs to
    know before it lists anything."""
    found = scan(texts)
    return None if found.nocite_all else found.cited
