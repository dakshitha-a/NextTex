r"""Every figure and table of a document, in the order the reader meets them.

The Sections drawer's second list. Each entry is a figure or a table
environment at the top level, `figure`, `table`, their starred and
wrapped and sideways forms, found by walking the document from its own
file through every `\input`, `\include` and `\subfile` in the order they
appear, so the list is the reader's order and not the file tree's.

An entry carries what the source says, its file, its line, its caption
and its labels; what the last build says, its number and page, from the
`.aux` files `auxlabels` reads; how often the document refers to it,
summed over its labels from `usage`; and, when the last PDF's
`pdfimages -list` has exactly one picture on the entry's page and the
entry draws one, the picture's resolution. `pdfimages` names no file, so
a page with two pictures says nothing about either.
"""

from __future__ import annotations

import re
from posixpath import normpath

from .rename import comment_starts
from .symbols import CAPTION, INCLUDEGRAPHICS, _balanced, environment_index
from .usage import scan

#: The environments a list of figures and tables lists, each a figure or
#: a table. A `subfigure` is a part of a figure and not an entry.
TOP = {
    "figure": "figure", "figure*": "figure", "wrapfigure": "figure",
    "sidewaysfigure": "figure", "SCfigure": "figure",
    "table": "table", "table*": "table", "wraptable": "table",
    "sidewaystable": "table", "longtable": "table",
}
INPUT = re.compile(r"\\(?:input|include|subfile)\s*\{([^{}]+)\}")
LABEL = re.compile(r"\\label\s*\{([^{}]+)\}")
#: Under this a picture is drawn at screen resolution; the submission
#: check's own threshold.
LOW_PPI = 150


def _uncommented(text: str) -> str:
    """`text` with each line's comment blanked, lengths kept."""
    lines = text.split("\n")
    for index, line in enumerate(lines):
        cut = comment_starts(line)
        if cut is not None:
            lines[index] = line[:cut] + " " * (len(line) - cut)
    return "\n".join(lines)


def _plain(raw: str) -> str:
    """A caption as words: references and labels out, a command's
    argument kept and its name dropped, maths kept as its letters."""
    text = re.sub(r"~?\\(?:label|cite\w*|ref|eqref|cref|Cref|autoref)\s*\{[^{}]*\}", "", raw)
    for _ in range(4):
        text = re.sub(r"\\[A-Za-z]+\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}", r"\1", text)
    text = re.sub(r"\\[A-Za-z]+\*?", "", text)
    text = re.sub(r"[{}$~]", " ", text).replace("\\", "")
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:])", r"\1", text)


def _resolve(name: str, here: str, texts: dict[str, str]) -> str | None:
    """The project path an `\\input` names: from the project's top, as TeX
    reads it, with or without `.tex`."""
    name = name.strip()
    for candidate in (name, f"{name}.tex"):
        path = normpath(candidate).lstrip("./")
        if path in texts:
            return path
    return None


def _walk(path: str, texts: dict[str, str], seen: set[str], out: list[dict]) -> None:
    if path in seen or path not in texts:
        return
    seen.add(path)
    text = texts[path]
    clean = _uncommented(text)
    events: list[tuple[int, str, object]] = []
    index = environment_index(clean)
    for entry in index:
        kind = TOP.get(entry["name"])
        if kind is None:
            continue
        # Inside another listed environment, a table in a figure, is part
        # of that one.
        if any(
            other is not entry and other["name"] in TOP
            and other["inner_start"] <= entry["start"] < other["inner_end"]
            for other in index
        ):
            continue
        events.append((entry["start"], "env", (kind, entry)))
    for match in INPUT.finditer(clean):
        events.append((match.start(), "input", match.group(1)))
    for _, what, item in sorted(events, key=lambda event: event[0]):
        if what == "input":
            child = _resolve(item, path, texts)
            if child:
                _walk(child, texts, seen, out)
            continue
        kind, entry = item
        inner = clean[entry["inner_start"]:entry["inner_end"]]
        caption = CAPTION.search(inner)
        out.append({
            "kind": kind,
            "env": entry["name"],
            "file": path,
            "line": text.count("\n", 0, entry["start"]) + 1,
            "caption": _plain(_balanced(inner, caption.end() - 1, limit=1200))[:300] if caption else "",
            "labels": [name.strip() for name in LABEL.findall(inner)],
            "graphics": [
                _balanced(inner, found.end() - 1, limit=300).strip()
                for found in INCLUDEGRAPHICS.finditer(inner)
            ],
        })


def _pictures(rows: list[dict[str, str]]) -> dict[int, list[int]]:
    """The resolution of every picture `pdfimages -list` found, by page."""
    by_page: dict[int, list[int]] = {}
    for row in rows:
        if row.get("type") != "image":
            continue
        try:
            page = int(row["page"])
            ppi = min(int(row["x-ppi"]), int(row["y-ppi"]))
        except (KeyError, ValueError):
            continue
        by_page.setdefault(page, []).append(ppi)
    return by_page


def listing(
    texts: dict[str, str],
    document: str,
    numbers: dict[str, dict] | None = None,
    image_rows: list[dict[str, str]] | None = None,
) -> list[dict]:
    """Every figure and table `document` reaches, in reading order.

    `texts` is every `.tex` in the project, path to text; `numbers` is what
    `auxlabels.read` gives for the document's last build; `image_rows` is
    its PDF's `pdfimages -list`, as `submit._image_rows` parses it."""
    tex = {path: body for path, body in texts.items() if path.lower().endswith(".tex")}
    entries: list[dict] = []
    _walk(document, tex, set(), entries)
    usage = scan(tex)
    numbers = numbers or {}
    pictures = _pictures(image_rows or [])
    for entry in entries:
        known = next((numbers[name] for name in entry["labels"] if name in numbers), None)
        entry["number"] = known["number"] if known else None
        try:
            entry["page"] = int(known["page"]) if known else None
        except ValueError:
            entry["page"] = None
        entry["refs"] = sum(usage.uses.get(name, 0) for name in entry["labels"])
        entry["ppi"] = None
        entry["shared"] = False
        if entry["page"] is not None and entry["graphics"]:
            on_page = pictures.get(entry["page"], [])
            if len(on_page) == 1 and len(entry["graphics"]) == 1:
                entry["ppi"] = on_page[0]
            elif len(on_page) > 1:
                entry["shared"] = True
    return entries
