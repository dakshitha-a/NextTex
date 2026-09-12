"""Finding a string across a whole project, and replacing it.

The editor has always had find and replace inside one file, from
CodeMirror, and nothing at all across the project: a writer renaming a
label or a command opened every chapter and pressed Ctrl-F in each of
them.  This is the arithmetic behind the route that answers that, kept
here rather than in `server/main.py` so it can be tested without a server
and run off the loop without dragging a request with it.

Line by line rather than over the whole file.  A pattern cannot then span
a line break, which is the right answer for LaTeX anyway (a paragraph is
one line and a command never is), and it is what makes a hit a place
somebody can be sent to: a file, a line, a column.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Long enough for anything a person types, short enough that a pattern
#: whose backtracking is exponential in its own length cannot be built.
MAX_PATTERN = 200

#: A search that matches thousands of lines is not an answer anybody reads,
#: and sending them all is a megabyte of JSON for a panel showing twenty.
MAX_HITS = 500

#: A matched line is shown as context, not as the file.  A minified figure
#: or a base64 blob in a `.tex` is one line and megabytes long.
MAX_LINE = 300


class SearchError(ValueError):
    """A pattern or a replacement the caller got wrong."""


@dataclass
class Hit:
    path: str
    line: int
    column: int
    #: How much of the line matched. Sent because with a pattern the panel
    #: cannot work it out from the query, and marking the match inside the
    #: line is the difference between reading a result and reading a line.
    length: int
    text: str

    def as_dict(self) -> dict:
        return {"path": self.path, "line": self.line, "column": self.column,
                "length": self.length, "text": self.text}


def compile_pattern(query: str, *, regex: bool = False, case: bool = False):
    """The pattern to search for, or a `SearchError` saying why not.

    `case` is *sensitive*, matching the way the editor's own find panel
    labels it, so the default is a search that ignores case.
    """
    if not query:
        raise SearchError("There is nothing to search for.")
    if len(query) > MAX_PATTERN:
        raise SearchError(
            f"A pattern is limited to {MAX_PATTERN} characters, and this is "
            f"{len(query)}."
        )
    flags = 0 if case else re.IGNORECASE
    try:
        return re.compile(query if regex else re.escape(query), flags)
    except re.error as error:
        raise SearchError(f"That is not a pattern: {error}") from error


def find(texts: dict[str, str], pattern) -> tuple[list[Hit], bool]:
    """Every match, in the order the paths were given, and whether it filled up.

    One hit per match rather than one per line: a writer replacing
    `\\cite` with `\\citep` wants to know there are three on the line, and
    the count in the confirmation is the number that will change.
    """
    hits: list[Hit] = []
    for path, text in texts.items():
        for number, line in enumerate(text.split("\n"), start=1):
            for found in pattern.finditer(line):
                if len(hits) >= MAX_HITS:
                    return hits, True
                hits.append(Hit(
                    path=path,
                    line=number,
                    column=found.start() + 1,
                    length=found.end() - found.start(),
                    text=line[:MAX_LINE],
                ))
    return hits, False


def replace(text: str, pattern, replacement: str, *, regex: bool = False
            ) -> tuple[str, int]:
    """The text with every match replaced, and how many there were.

    The replacement goes through a function rather than being handed to
    `re.sub` as a string, because `re.sub` reads backslash escapes in the
    replacement and a LaTeX writer's replacement is mostly backslashes:
    replacing `\\cite` with `\\citep` raises "bad escape \\c" and replacing
    it with `\\1` would quietly substitute a group.  With regex on, `\\1`
    is what the writer meant, so the match expands it and a bad reference
    is reported rather than raised into the request.
    """
    count = 0
    out: list[str] = []
    for line in text.split("\n"):
        if regex:
            def swap(found, _replacement=replacement):
                try:
                    return found.expand(_replacement)
                except (re.error, IndexError) as error:
                    raise SearchError(
                        f"That replacement does not work with that pattern: "
                        f"{error}"
                    ) from error
        else:
            def swap(found, _replacement=replacement):
                return _replacement
        new, changed = pattern.subn(swap, line)
        count += changed
        out.append(new)
    return "\n".join(out), count
