r"""Every heading of a document, in the order the reader meets them.

The Sections drawer's third list, Typeset: the whole document's outline,
where Sections is the file in the editor's. It is found the way the
figures list is found, by walking the document from its own file through
every `\input`, `\include` and `\subfile` in the order they appear, so a
thesis kept as one file per chapter is listed whole, in the reader's
order.

Each heading carries what the source says, its kind, level, title, file
and line, and what the last build says: its number and page, read from
the document's contents lines, which every build writes to its `.aux`

    \contentsline {section}{\numberline {1}Introduction}{3}{section.1}%

as kind, number, title, page and, under hyperref, an anchor. The source's
headings and the `.toc`'s lines are paired in order by kind, since a
starred heading is in the source and not the `.toc`, and an
`\addcontentsline` is in the `.toc` and not among the headings.
"""

from __future__ import annotations

import re
from pathlib import Path

from .figures import INPUT, _plain, _resolve, _uncommented, macros_of
from .symbols import _balanced

#: The levels of the sectioning commands, as the outline in the editor
#: has them.
LEVELS = {
    "part": 0, "chapter": 1, "section": 2, "subsection": 3,
    "subsubsection": 4, "paragraph": 5,
}
HEADING = re.compile(r"\\(part|chapter|section|subsection|subsubsection|paragraph)(\*?)\s*(?:\[[^\]]*\])?\s*(?=\{)")
CONTENTSLINE = re.compile(r"\\contentsline\s*\{(\w+)\}")
NUMBERLINE = re.compile(r"\\numberline\s*\{([^{}]*)\}")
#: How far ahead in the `.toc` a heading looks for its line before it is
#: taken to have none: a heading the build has not reached yet, or one
#: whose kind the class renames.
LOOKAHEAD = 6


def _title(raw: str, macros: dict[str, str] | None = None) -> str:
    """A heading as words, with its inline maths as the page sets it:
    `CH$_4$` is "CH₄", not "CH _4"."""
    return _plain(raw, macros)


#: A macro of one argument whose body is a sectioning command on that
#: argument, `\\newcommand{\\backmatter}[1]{\\section*{#1}...}`.
WRAPPER = re.compile(r"\\(?:new|renew|provide)command\*?\s*\{?\\([A-Za-z]+)\}?\s*\[1\]\s*(?=\{)")
WRAPPED = re.compile(r"\\(part|chapter|section|subsection|subsubsection|paragraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{\s*#1\s*\}")


def heading_macros(texts: dict[str, str]) -> dict[str, tuple[str, bool]]:
    """The project's own macros that make a heading of their argument, by
    name, with the kind of heading and whether it is starred. A class or a
    template gives its back matter a command of its own, and the Typeset
    list did not know those were headings."""
    found: dict[str, tuple[str, bool]] = {}
    for body in texts.values():
        clean = _uncommented(body)
        for match in WRAPPER.finditer(clean):
            inside = WRAPPED.search(_balanced(clean, match.end(), limit=2000))
            if inside and match.group(1) not in found:
                found[match.group(1)] = (inside.group(1), bool(inside.group(2)))
    return found


def _walk(
    path: str, texts: dict[str, str], seen: set[str], out: list[dict],
    macros: dict[str, str] | None = None, wrappers: dict[str, tuple[str, bool]] | None = None,
) -> None:
    if path in seen or path not in texts:
        return
    seen.add(path)
    macros = macros or {}
    wrappers = wrappers or {}
    text = texts[path]
    clean = _uncommented(text)
    events: list[tuple[int, str, object]] = []
    for match in HEADING.finditer(clean):
        events.append((match.start(), "heading", (match.group(1), bool(match.group(2)), match)))
    if wrappers:
        made = re.compile(r"\\(" + "|".join(map(re.escape, wrappers)) + r")(?![A-Za-z])\s*(?=\{)")
        for match in made.finditer(clean):
            kind, starred = wrappers[match.group(1)]
            events.append((match.start(), "heading", (kind, starred, match)))
    for match in INPUT.finditer(clean):
        events.append((match.start(), "input", match.group(1)))
    for _, what, item in sorted(events, key=lambda event: event[0]):
        if what == "input":
            child = _resolve(item, path, texts, macros)
            if child:
                _walk(child, texts, seen, out, macros, wrappers)
            continue
        kind, starred, match = item
        # Read whole, however long: a title cut at a limit read as empty.
        title = _title(_balanced(clean, match.end(), limit=len(clean)), macros)[:200]
        out.append({
            "kind": kind,
            "level": LEVELS[kind],
            "starred": starred,
            "title": title or "(untitled)",
            "file": path,
            "line": text.count("\n", 0, match.start()) + 1,
        })


def contents(text: str) -> list[dict]:
    """The lines of a `.toc`: kind, number, title, page and anchor."""
    found: list[dict] = []
    for match in CONTENTSLINE.finditer(text):
        groups: list[str] = []
        at = match.end()
        for _ in range(3):
            while at < len(text) and text[at] in " \t\n":
                at += 1
            if at >= len(text) or text[at] != "{":
                break
            body = _balanced(text, at, limit=2000)
            groups.append(body)
            at += len(body) + 2
        if len(groups) < 2:
            continue
        entry, page = groups[0], groups[1]
        anchor = groups[2] if len(groups) > 2 else ""
        number = NUMBERLINE.search(entry)
        title = NUMBERLINE.sub("", entry)
        found.append({
            "kind": match.group(1),
            "number": number.group(1).strip() if number else None,
            "title": _title(title),
            "page": page.strip(),
            "anchor": anchor.strip() or None,
        })
    return found


def listing(texts: dict[str, str], document: str, toc: str = "") -> list[dict]:
    """Every heading `document` reaches, in reading order, with the last
    build's number and page where its `.toc` has them.

    `texts` is every `.tex` in the project, path to text; `toc` is the
    text of the document's `.toc`, empty before any build."""
    tex = {path: body for path, body in texts.items() if path.lower().endswith(".tex")}
    # Macros and heading commands may be defined in a package the project
    # keeps beside its files.
    sources = {
        path: body for path, body in texts.items() if path.lower().endswith((".tex", ".sty", ".cls"))
    }
    macros = macros_of(sources)
    headings: list[dict] = []
    _walk(document, tex, set(), headings, macros, heading_macros(sources))
    lines = contents(toc)
    at = 0
    for heading in headings:
        heading["number"] = None
        heading["page"] = None
        # Paired by kind and title first, so a starred heading that adds
        # its own contents line takes that line, and kind alone after,
        # since a heading's short form goes to the contents and its long
        # form is the source's. A starred heading takes only a line of its
        # own title: pairing by kind alone gave a numbered heading the
        # line of a starred one before it, and every heading after it the
        # number and page of the one before.
        window = range(at, min(len(lines), at + LOOKAHEAD))
        same = _folded(heading["title"])
        found = next((ahead for ahead in window if lines[ahead]["kind"] == heading["kind"]
                      and _folded(lines[ahead]["title"]) == same), None)
        if found is None and not heading["starred"]:
            found = next((ahead for ahead in window if lines[ahead]["kind"] == heading["kind"]
                          and lines[ahead]["number"] is not None), None)
            if found is None:
                found = next((ahead for ahead in window if lines[ahead]["kind"] == heading["kind"]), None)
        if found is None:
            continue
        line = lines[found]
        heading["number"] = line["number"]
        try:
            heading["page"] = int(line["page"])
        except ValueError:
            heading["page"] = None
        at = found + 1
    return headings


def _folded(title: str) -> str:
    """A title reduced to its letters and digits, for pairing a heading
    with its contents line."""
    return "".join(char for char in title.lower() if char.isalnum())


WRITEFILE = re.compile(r"\\@writefile\s*\{toc\}\s*(?=\{)")
AUX_INPUT = re.compile(r"\\@input\{([^}]*)\}")
#: How many aux files one document may pull in, as `auxlabels` allows.
MAX_FILES = 500


def read_toc(build_dir: Path, jobname: str) -> str:
    """The document's contents lines as its last build wrote them, or
    nothing when there has been no build.

    Read from the `.aux` files rather than the `.toc`: LaTeX writes a
    `.toc` only for a document that typesets its own table of contents,
    and every build writes the same lines into the `.aux` as
    `\\@writefile{toc}{...}`, an `\\include`d chapter's into its own,
    pulled in where its `\\@input` stands, which is followed in place so
    the lines keep the reader's order."""
    root = build_dir.resolve()
    seen: set[Path] = set()
    lines: list[str] = []

    def read(path: Path) -> None:
        if len(seen) >= MAX_FILES:
            return
        try:
            resolved = path.resolve()
        except OSError:
            return
        if resolved in seen or (root not in resolved.parents and resolved != root):
            return
        seen.add(resolved)
        try:
            text = resolved.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        events = [(m.start(), "toc", m) for m in WRITEFILE.finditer(text)]
        events += [(m.start(), "input", m) for m in AUX_INPUT.finditer(text)]
        for _, what, match in sorted(events, key=lambda event: event[0]):
            if what == "input":
                read(build_dir / match.group(1))
            else:
                lines.append(_balanced(text, match.end(), limit=4000))

    read(build_dir / f"{jobname}.aux")
    return "\n".join(lines)
