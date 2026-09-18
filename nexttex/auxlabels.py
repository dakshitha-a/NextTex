r"""What every label's number is, read from the build's `.aux` files.

The symbol scan knows where a label is defined, its file and line, and the
hover on a `\ref` said exactly that: "chapters/two.tex, line 4".  What the
writer wanted to know is what the reference will say, "Figure 3", and on
which page.  Every build writes that into the `.aux` files:

    \newlabel{fig:one}{{1}{1}{A box}{figure.1}{}}

is number, page, and under hyperref the caption and an anchor whose head
names the kind, `figure`, `section`, `equation`, `table`.  Without
hyperref there are only the first two.  cleveref writes a second entry
per label, `fig:one@cref`, in its own bracketed shape, which is skipped.
An `\include`d chapter's labels are in its own `.aux`, mirrored under the
build directory and pulled in by the main file's `\@input{...}` lines,
which are followed here.

Read from disk on every ask rather than cached: the files are small, they
change on every build, and the ask happens once per build when the editor
refetches the symbols.
"""

from __future__ import annotations

import re
from pathlib import Path

NEWLABEL = re.compile(r"\\newlabel\{([^}]*)\}\{")
AUX_INPUT = re.compile(r"\\@input\{([^}]*)\}")
#: The anchor hyperref writes, `figure.1`, `subsection.2.1`, `equation.1.3`,
#: `AMS.4`, `Item.2`.  The word before the first dot is the kind.
ANCHOR = re.compile(r"^([A-Za-z@]+)\.")
#: How many files one document's aux tree may pull in.  A thesis has forty;
#: a loop of `\@input`s, which nothing writes but a hand-edited file could,
#: would otherwise never end.
MAX_FILES = 500

#: What the hover says for each kind hyperref names.  A kind not listed is
#: shown by its number alone.
KIND_WORDS = {
    "figure": "Figure",
    "table": "Table",
    "equation": "Equation",
    "AMS": "Equation",
    "section": "Section",
    "subsection": "Section",
    "subsubsection": "Section",
    "chapter": "Chapter",
    "part": "Part",
    "appendix": "Appendix",
    "theorem": "Theorem",
    "lemma": "Lemma",
    "definition": "Definition",
    "proposition": "Proposition",
    "corollary": "Corollary",
    "example": "Example",
    "remark": "Remark",
    "algorithm": "Algorithm",
    "algocf": "Algorithm",
    "listing": "Listing",
    "lstlisting": "Listing",
    "Item": "Item",
    "footnote": "Footnote",
    "Hfootnote": "Footnote",
}


def _groups(text: str, start: int) -> list[str]:
    """The brace groups inside the argument that opens at `start`, each
    with its own braces removed, up to the brace that closes it.  Balanced
    rather than split on braces, since a caption can hold `\\emph{...}`."""
    out: list[str] = []
    depth = 0
    i = start + 1              # past the argument's own opening brace
    begin = -1
    while i < len(text):
        char = text[i]
        if char == "\\":
            i += 2
            continue
        if char == "{":
            if depth == 0:
                begin = i + 1
            depth += 1
        elif char == "}":
            if depth == 0:
                break          # the argument's closing brace
            depth -= 1
            if depth == 0:
                out.append(text[begin:i])
        elif depth == 0 and char == "\n":
            break
        i += 1
    return out


def _clean(value: str) -> str:
    """A number as it is printed: `\\relax` and `\\protect` are TeX's own
    noise, and a `\\numberline` or a `\\bgroup` around it likewise."""
    value = re.sub(r"\\(?:relax|protect|bgroup|egroup|ignorespaces)\s*", "", value)
    value = re.sub(r"\\numberline\s*\{([^}]*)\}", r"\1", value)
    return value.strip()


def parse(text: str) -> dict[str, dict]:
    """Every `\\newlabel` in one aux file, as `{name: {number, page, kind}}`."""
    found: dict[str, dict] = {}
    for match in NEWLABEL.finditer(text):
        name = match.group(1)
        if name.endswith("@cref") or not name:
            continue
        groups = _groups(text, match.end() - 1)
        if len(groups) < 2:
            continue
        number, page = _clean(groups[0]), _clean(groups[1])
        kind = ""
        if len(groups) >= 4:
            anchor = ANCHOR.match(groups[3].strip())
            if anchor:
                kind = anchor.group(1)
        found[name] = {"number": number, "page": page, "kind": kind}
    return found


def read(build_dir: Path, jobname: str) -> dict[str, dict]:
    """The labels of one document, from its aux file and every file that
    one pulls in.  Missing or unreadable files answer nothing; a build that
    has not happened yet is not an error."""
    found: dict[str, dict] = {}
    seen: set[Path] = set()
    queue = [build_dir / f"{jobname}.aux"]
    root = build_dir.resolve()
    while queue and len(seen) < MAX_FILES:
        path = queue.pop(0)
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        # Only files under the build directory: an `\@input` naming a path
        # outside it is not a chapter of this document.
        if root not in resolved.parents and resolved != root:
            continue
        try:
            text = resolved.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        found.update(parse(text))
        for inner in AUX_INPUT.findall(text):
            queue.append(build_dir / inner)
    return found


def describe(number: str, kind: str) -> str:
    """"Figure 3", or the bare number for a kind nothing here names."""
    word = KIND_WORDS.get(kind, "")
    return f"{word} {number}" if word else number
