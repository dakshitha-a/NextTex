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

from .project import ignored_directory

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

# Directories worth neither walking into nor completing from are pruned
# during the walk rather than filtered afterwards: on a thesis with a .git
# and a node_modules, descending into them and discarding the results is
# most of the cost of a scan.  The rule is the project's own, so the scan
# and the file tree agree about what is machinery.

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
            if not ignored_directory(here / name)
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
    #: Which English each document says it is written in, by file, from
    #: its babel or polyglossia options: "british" or "american".  A file
    #: that says nothing is absent.  The spell checker reads it so a
    #: British thesis is checked as British for everyone who opens it
    #: without anybody setting anything.
    english: dict[str, str] = field(default_factory=dict)
    #: The main language a document's preamble declares, when it is one
    #: NextTex can spell in other than English: "de", "fr", "es" or "pt",
    #: with the line that said so. The project's Spelling language row
    #: offers it; it is a suggestion, since a chapter has no preamble and
    #: the setting is the project's.
    languages: dict[str, dict] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "labels": self.labels,
            "citations": self.citations,
            "images": self.images,
            "texfiles": self.texfiles,
            "commands": self.commands,
            "environments": self.environments,
            "english": self.english,
            "languages": self.languages,
        }


# The language a preamble declares.  babel takes its options on
# \usepackage and, since 3.9, on \babelprovide; polyglossia names a
# variant.  The last language listed is babel's main one, which is why the
# options are read in order and the last match wins.
BABEL = re.compile(r"\\usepackage\s*\[([^\]]*)\]\s*\{babel\}")
POLYGLOSSIA = re.compile(
    r"\\set(?:main|default)language\s*(?:\[([^\]]*)\])?\s*\{([a-zA-Z]+)\}"
)
BRITISH_NAMES = {"british", "ukenglish", "australian", "newzealand", "uk", "en-gb", "en-au", "en-nz"}
AMERICAN_NAMES = {"american", "usenglish", "english", "canadian", "us", "en-us", "en-ca"}


def english_of(text: str) -> str | None:
    """"british" or "american" as the preamble says, or None if it does not.

    Only the preamble, since a chapter has none; and only English: a
    document in French says nothing about which English its quotations
    should be checked against.
    """
    head = text.split("\\begin{document}", 1)[0]
    found: str | None = None
    for match in BABEL.finditer(head):
        for option in match.group(1).split(","):
            name = option.strip().split("=")[-1].strip().lower()
            if name in BRITISH_NAMES:
                found = "british"
            elif name in AMERICAN_NAMES:
                found = "american"
    for match in POLYGLOSSIA.finditer(head):
        options, language = match.group(1) or "", match.group(2).lower()
        if language not in {"english", "british", "american", "australian", "usenglish", "ukenglish"}:
            continue
        variant = ""
        for option in options.split(","):
            key, _, value = option.partition("=")
            if key.strip().lower() == "variant":
                variant = value.strip().lower()
        if variant in BRITISH_NAMES or language in {"british", "australian", "ukenglish"}:
            found = "british"
        elif (
            variant in AMERICAN_NAMES
            or language in {"american", "usenglish"}
            or (language == "english" and not variant)
        ):
            # polyglossia's plain `english` is American, as babel's is.
            found = "american"
    return found


#: babel's and polyglossia's names for the four languages the spelling
#: lists cover, as the code `nexttex/dictionaries.py` fetches.
LANGUAGE_NAMES = {
    "german": "de", "ngerman": "de", "austrian": "de", "naustrian": "de",
    "swissgerman": "de", "nswissgerman": "de",
    "french": "fr", "francais": "fr", "acadian": "fr", "canadien": "fr",
    "spanish": "es", "spanishmx": "es",
    "portuguese": "pt", "portuges": "pt", "brazilian": "pt", "brazil": "pt",
}
ENGLISH_NAMES = BRITISH_NAMES | AMERICAN_NAMES | {"english", "british", "american"}


def language_of(text: str) -> dict | None:
    """The main language the preamble declares, when it is German,
    French, Spanish or Portuguese: `{"code": "de", "line": "..."}` with
    the line that said so. None for English or for nothing said.

    babel's main language is the last it lists, so the last match wins;
    polyglossia names it with \\setmainlanguage, or \\setdefaultlanguage.
    """
    head = text.split("\\begin{document}", 1)[0]
    found: tuple[int, str, str] | None = None
    for match in BABEL.finditer(head):
        for option in match.group(1).split(","):
            name = option.strip().split("=")[-1].strip().lower()
            if name in LANGUAGE_NAMES:
                found = (match.start(), LANGUAGE_NAMES[name], match.group(0))
            elif name in ENGLISH_NAMES:
                found = (match.start(), "", match.group(0))
    for match in POLYGLOSSIA.finditer(head):
        name = match.group(2).lower()
        if name in LANGUAGE_NAMES:
            candidate = (match.start(), LANGUAGE_NAMES[name], match.group(0))
        elif name in ENGLISH_NAMES:
            candidate = (match.start(), "", match.group(0))
        else:
            continue
        if found is None or candidate[0] >= found[0]:
            found = candidate
    if not found or not found[1]:
        return None
    return {"code": found[1], "line": " ".join(found[2].split())}


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
            # The hover card draws the whole entry: everyone who wrote it,
            # where it appeared, and its DOI in a face that says "literal".
            "authors": _authors(fields.get("author", "")),
            "venue": _clean(fields.get("journal", "") or fields.get("booktitle", "")
                            or fields.get("publisher", "")),
            "doi": _clean(fields.get("doi", "")),
        })
    return entries


def _authors(value: str) -> str:
    """Every author as surname, first to last, or the first three and how
    many more: enough to recognise the paper, short enough for a card."""
    if not value:
        return ""
    names = [part.strip() for part in value.split(" and ") if part.strip()]
    surnames = [
        _clean(name.split(",")[0] if "," in name else name.split()[-1])
        for name in names
    ]
    if len(surnames) > 3:
        return ", ".join(surnames[:3]) + f" and {len(surnames) - 3} more"
    return ", ".join(surnames)


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


#: The environments a label can sit in that a reference card can draw:
#: a figure's graphic, a table's body, an equation's maths.  A label
#: elsewhere (a section, an item) carries no `env`.
FIGURE_ENVS = {"figure", "figure*", "subfigure", "wrapfigure"}
TABLE_ENVS = {"table", "table*", "subtable", "wraptable"}
MATH_ENVS = {
    "equation", "equation*", "align", "align*", "gather", "gather*",
    "multline", "multline*", "flalign", "flalign*", "alignat", "alignat*",
    "eqnarray", "eqnarray*",
}
LABEL_ENVS = FIGURE_ENVS | TABLE_ENVS | MATH_ENVS
TABULAR_ENVS = ("tabular", "tabular*", "tabularx", "longtable")
ENV_EDGE = re.compile(r"\\(begin|end)\s*\{([A-Za-z@]+\*?)\}")
INCLUDEGRAPHICS = re.compile(r"\\includegraphics\s*(?:\[[^\]]*\])?\s*\{")
CAPTION = re.compile(r"\\caption\s*(?:\[[^\]]*\])?\s*\{")
#: Past this many characters a body is cut and says so: a table of a
#: thousand rows is not a card.
BODY_LIMIT = 4000


def environment_index(text: str) -> list[dict]:
    """Every balanced environment in a file, innermost last.

    One pass over the `\\begin` and `\\end` edges with a stack; an `\\end`
    with no matching `\\begin` is dropped, and a `\\begin` never closed
    is dropped too, so an unfinished draft indexes what it can rather
    than nothing.  Each entry carries the name, where the `\\begin` starts,
    where its group ends (the inner text's start), where the `\\end`
    starts (the inner text's end) and where the `\\end` group ends."""
    stack: list[tuple[str, int, int]] = []
    found: list[dict] = []
    for match in ENV_EDGE.finditer(text):
        edge, name = match.group(1), match.group(2)
        if edge == "begin":
            stack.append((name, match.start(), match.end()))
            continue
        # The nearest open environment of that name; anything opened
        # after it and never closed is dropped.
        for depth in range(len(stack) - 1, -1, -1):
            if stack[depth][0] == name:
                open_name, start, inner_start = stack[depth]
                del stack[depth:]
                found.append({
                    "name": open_name, "start": start, "inner_start": inner_start,
                    "inner_end": match.start(), "end": match.end(),
                })
                break
    found.sort(key=lambda entry: entry["start"])
    return found


def _innermost(index: list[dict], position: int, names: set[str]) -> dict | None:
    """The innermost environment among `names` holding `position`."""
    best: dict | None = None
    for entry in index:
        if entry["name"] not in names:
            continue
        if entry["inner_start"] <= position < entry["inner_end"]:
            if best is None or entry["start"] >= best["start"]:
                best = entry
    return best


def _cut(body: str) -> tuple[str, bool]:
    if len(body) > BODY_LIMIT:
        return body[:BODY_LIMIT], True
    return body, False


def environment_facts(text: str, position: int, index: list[dict] | None = None) -> dict:
    """What a reference card can draw for a label at `position`.

    `env` is the innermost figure, table or maths environment holding the
    label, or absent; a figure adds `graphic` (the first
    `\\includegraphics` path in it) and `caption`; a table adds `caption`
    and `body` (its inner `tabular`, `tabular*`, `tabularx` or
    `longtable`, the environment included); a maths environment adds
    `body` (its inner text).  A body past `BODY_LIMIT` characters is cut
    and says `bodyCut`."""
    if index is None:
        index = environment_index(text)
    entry = _innermost(index, position, LABEL_ENVS)
    if entry is None:
        return {}
    facts: dict = {"env": entry["name"]}
    inner = text[entry["inner_start"]:entry["inner_end"]]
    if entry["name"] in FIGURE_ENVS or entry["name"] in TABLE_ENVS:
        caption = CAPTION.search(inner)
        if caption:
            facts["caption"] = _balanced(inner, caption.end() - 1, limit=1200).strip()
    if entry["name"] in FIGURE_ENVS:
        graphic = INCLUDEGRAPHICS.search(inner)
        if graphic:
            facts["graphic"] = _balanced(inner, graphic.end() - 1).strip()
    elif entry["name"] in TABLE_ENVS:
        tabular = next(
            (e for e in index
             if e["name"] in TABULAR_ENVS
             and entry["inner_start"] <= e["start"] and e["end"] <= entry["inner_end"]),
            None,
        )
        if tabular is not None:
            body, cut = _cut(text[tabular["start"]:tabular["end"]])
            facts["body"] = body
            if cut:
                facts["bodyCut"] = True
    else:
        body, cut = _cut(inner.strip())
        facts["body"] = body
        if cut:
            facts["bodyCut"] = True
    return facts


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

        if suffix in {".tex", ".ltx"}:
            english = english_of(text)
            if english:
                found.english[relative] = english
            language = language_of(text)
            if language:
                found.languages[relative] = language

        # Labels by position rather than by line, so each can say which
        # environment it sits in; the line number is counted on the way.
        index: list[dict] | None = None
        line_number = 1
        counted_to = 0
        for match in LABEL.finditer(text):
            name = match.group(1)
            line_number += text.count("\n", counted_to, match.start())
            counted_to = match.start()
            if name in seen_labels:
                continue
            seen_labels.add(name)
            if index is None:
                index = environment_index(text)
            found.labels.append({
                "name": name, "file": relative, "line": line_number,
                **environment_facts(text, match.start(), index),
            })

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
        self._stamp: tuple = ()
        self._value: Symbols | None = None

    def get(self, *, excluded=None, build_dir: Path | None = None) -> Symbols:
        """The project's symbols, rescanned only if something has changed.

        One walk answers both questions -- what changed, and what to read --
        so a hit costs a single pass over the source files and a miss costs
        no more walking than a hit.
        """
        files = walk_project(self.root, excluded=excluded, build_dir=build_dir)
        newest = 0.0
        names: list[str] = []
        for path in files:
            if path.suffix.lower() not in STAMP_SUFFIXES:
                continue
            try:
                newest = max(newest, path.stat().st_mtime)
            except OSError:
                continue
            names.append(str(path))
        # The newest time alone did not move when a file that was not the
        # newest was deleted, so everything it defined stayed in completion
        # and the hover cards until some other file was touched (Q-018). The
        # set of files is part of the stamp too, so a deletion, or a rename,
        # is a change.
        stamp = (newest, len(names), hash(tuple(sorted(names))))
        if self._value is None or stamp != self._stamp:
            self._value = scan(
                self.root, excluded=excluded, build_dir=build_dir, files=files,
            )
            self._stamp = stamp
        return self._value
