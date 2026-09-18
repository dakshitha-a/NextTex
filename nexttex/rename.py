r"""Every use of a label, a citation key or a macro, and renaming it.

Renaming `fig:overview` was a project-wide replace the writer had to
scope by hand, and a replace does not know the syntax: `fig:a` matches
inside `fig:ab`, and a name in a comment is rewritten as readily as one
in a `\ref`.  This knows the syntax.  A label is found in `\label{...}`
and in every reference command, comma lists included; a citation key in
the `@type{key,` line of a `.bib` and in every cite command with its
optional arguments; a macro in its definition and at every `\name` that
is not the head of a longer name.  A hit inside a comment is reported
as such and rewritten only when asked, because a commented-out paragraph
is somebody's note and may be meant to stay as it was.

The texts come from the same place the project search reads them, the
open documents first and the disk for the rest, and a rename goes back
through the same save as a typed edit, so every changed file gets a
version and the shared document is folded.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: What a label or a citation key may be: anything but braces, commas and
#: whitespace, which is what the argument list is split on.  A macro is
#: letters.  Bounded, since the name reaches a regular expression.
NAME = re.compile(r"^[^{}\s,%\\]{1,120}$")
MACRO = re.compile(r"^[A-Za-z]{1,80}$")

KINDS = ("label", "cite", "macro")

#: The commands whose braced argument is a comma list of labels, and of
#: citation keys.  Starred forms are taken by the pattern.
REF_COMMANDS = (
    "ref", "eqref", "pageref", "autoref", "cref", "Cref", "cpageref",
    "Cpageref", "nameref", "vref", "labelcref", "label",
)
CITE_COMMANDS = (
    "cite", "citep", "citet", "citealt", "citealp", "citeauthor", "citeyear",
    "citeyearpar", "parencite", "textcite", "autocite", "footcite", "smartcite",
    "supercite", "fullcite", "citetitle", "nocite", "Cite", "Parencite",
    "Textcite", "Autocite",
)
#: Where a macro is defined.  `\def\name` has no braces around the name.
DEFINITIONS = ("newcommand", "renewcommand", "providecommand", "DeclareMathOperator",
               "DeclareRobustCommand", "newcommandx", "NewDocumentCommand")


@dataclass
class Hit:
    path: str
    line: int          # 1-based
    column: int        # 1-based, of the name itself
    length: int
    text: str
    commented: bool

    def as_dict(self) -> dict:
        return {"path": self.path, "line": self.line, "column": self.column,
                "length": self.length, "text": self.text, "commented": self.commented}


def comment_starts(line: str) -> int | None:
    """The offset of the `%` that starts this line's comment, or None."""
    i = 0
    while i < len(line):
        c = line[i]
        if c == "\\":
            i += 2
            continue
        if c == "%":
            return i
        i += 1
    return None


def _list_command(commands: tuple[str, ...]) -> re.Pattern:
    names = "|".join(re.escape(c) for c in commands)
    # `\cmd*[opt][opt]{list}`: the optional arguments are what `\cite[p. 3]{a}`
    # puts before the keys.  The list itself is captured with its offset.
    return re.compile(r"\\(?:" + names + r")\*?\s*(?:\[[^\]\n]*\]\s*)*\{([^}\n]*)\}")


REF_CALL = _list_command(REF_COMMANDS)
CITE_CALL = _list_command(CITE_COMMANDS)
BIB_ENTRY = re.compile(r"@[A-Za-z]+\s*\{\s*([^,\s}]+)\s*,")


def _spans(kind: str, line: str, name: str, path: str) -> list[tuple[int, int]]:
    """Every `(start, end)` of the name on this line, by the syntax."""
    out: list[tuple[int, int]] = []
    if kind in ("label", "cite"):
        if kind == "cite" and path.lower().endswith(".bib"):
            for found in BIB_ENTRY.finditer(line):
                if found.group(1) == name:
                    out.append((found.start(1), found.end(1)))
            return out
        call = REF_CALL if kind == "label" else CITE_CALL
        for found in call.finditer(line):
            inside = found.group(1)
            at = found.start(1)
            cursor = 0
            for piece in inside.split(","):
                stripped = piece.strip()
                if stripped == name:
                    start = at + cursor + piece.index(stripped)
                    out.append((start, start + len(name)))
                cursor += len(piece) + 1
        return out
    # A macro: `\name` not followed by another letter, which is `\ab` not
    # being a use of `\a`.  The definition's braces make no difference.
    for found in re.finditer(r"\\" + re.escape(name) + r"(?![A-Za-z])", line):
        out.append((found.start() + 1, found.end()))
    return out


def references_to(texts: dict[str, str], kind: str, name: str) -> list[Hit]:
    """Every use of the name, in the order the paths were given."""
    hits: list[Hit] = []
    for path, text in texts.items():
        if kind in ("label", "macro") and path.lower().endswith(".bib"):
            continue
        for number, line in enumerate(text.split("\n"), start=1):
            spans = _spans(kind, line, name, path)
            if not spans:
                continue
            comment = comment_starts(line)
            for start, end in spans:
                hits.append(Hit(
                    path=path, line=number, column=start + 1, length=end - start,
                    text=line[:300], commented=comment is not None and start > comment,
                ))
    return hits


def rename(
    texts: dict[str, str], kind: str, name: str, to: str, *, comments: bool = False,
) -> dict[str, str]:
    """The files that change, with their new text.  Hits in comments are
    left alone unless `comments` is set."""
    changed: dict[str, str] = {}
    for path, text in texts.items():
        if kind in ("label", "macro") and path.lower().endswith(".bib"):
            continue
        lines = text.split("\n")
        touched = False
        for index, line in enumerate(lines):
            spans = _spans(kind, line, name, path)
            if not spans:
                continue
            comment = comment_starts(line)
            edited = line
            for start, end in reversed(spans):
                if not comments and comment is not None and start > comment:
                    continue
                edited = edited[:start] + to + edited[end:]
            if edited != line:
                lines[index] = edited
                touched = True
        if touched:
            changed[path] = "\n".join(lines)
    return changed


def valid(kind: str, name: str) -> bool:
    if kind not in KINDS:
        return False
    return bool((MACRO if kind == "macro" else NAME).match(name or ""))
