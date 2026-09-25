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
import time
from dataclasses import dataclass

import regex as _regex

#: Long enough for anything a person types.  Not a defence against a
#: pattern that backtracks: `(a|aa)+$` is eight characters.
MAX_PATTERN = 200

#: How long one search or one replace may spend matching, in seconds.
#:
#: A pattern is written by whoever holds the keyboard, and one that
#: backtracks exponentially runs for minutes on a line of thirty letters.
#: Python's `re` has no limit and holds the interpreter lock while it
#: matches, so running it in a thread did not help: one search stopped the
#: whole install, every tab and every collaborator, until it finished.  A
#: pattern search therefore goes through the `regex` package, which takes a
#: timeout and, with `concurrent=True`, lets go of the lock while it
#: matches.  A literal search stays on `re`: an escaped string cannot
#: backtrack.
TIME_LIMIT = 2.0

_TOO_LONG = (
    "That pattern took too long, so the search stopped. A repeat inside a "
    "repeat, such as (a+)+, can run for minutes on one line; try a simpler "
    "pattern."
)

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
    if not regex:
        return re.compile(re.escape(query), 0 if case else re.IGNORECASE)
    try:
        return _regex.compile(query, 0 if case else _regex.IGNORECASE)
    except _regex.error as error:
        raise SearchError(f"That is not a pattern: {error}") from error


def _limited(pattern) -> bool:
    """Whether matching with `pattern` needs the clock."""
    return isinstance(pattern, _regex.Pattern)


def _left(deadline: float) -> float:
    """What remains of the time limit, or a `SearchError` if nothing does."""
    left = deadline - time.monotonic()
    if left <= 0:
        raise SearchError(_TOO_LONG)
    return left


def find(texts: dict[str, str], pattern) -> tuple[list[Hit], bool]:
    """Every match, in the order the paths were given, and whether it filled up.

    One hit per match rather than one per line: a writer replacing
    `\\cite` with `\\citep` wants to know there are three on the line, and
    the count in the confirmation is the number that will change.
    """
    hits: list[Hit] = []
    limited = _limited(pattern)
    deadline = time.monotonic() + TIME_LIMIT
    for path, text in texts.items():
        for number, line in enumerate(text.split("\n"), start=1):
            if limited:
                try:
                    # The whole line is matched inside the call, so the
                    # list is what takes the time and what the limit covers.
                    matches = list(pattern.finditer(
                        line, timeout=_left(deadline), concurrent=True,
                    ))
                except TimeoutError:
                    raise SearchError(_TOO_LONG) from None
            else:
                matches = pattern.finditer(line)
            for found in matches:
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


def replace(text: str, pattern, replacement: str, *, regex: bool = False,
            deadline: float | None = None) -> tuple[str, int]:
    """The text with every match replaced, and how many there were.

    The replacement goes through a function rather than being handed to
    `re.sub` as a string, because `re.sub` reads backslash escapes in the
    replacement and a LaTeX writer's replacement is mostly backslashes:
    replacing `\\cite` with `\\citep` raises "bad escape \\c" and replacing
    it with `\\1` would quietly substitute a group.  With regex on, `\\1`
    is what the writer meant, so the match expands it and a bad reference
    is reported rather than raised into the request.

    `deadline` is a `time.monotonic()` reading shared by every file of one
    replace, so the limit covers the whole replace rather than each file.
    """
    limited = _limited(pattern)
    if deadline is None:
        deadline = time.monotonic() + TIME_LIMIT
    count = 0
    out: list[str] = []
    for line in text.split("\n"):
        if regex:
            def swap(found, _replacement=replacement):
                try:
                    return found.expand(_replacement)
                except (re.error, _regex.error, IndexError) as error:
                    raise SearchError(
                        f"That replacement does not work with that pattern: "
                        f"{error}"
                    ) from error
        else:
            def swap(found, _replacement=replacement):
                return _replacement
        if limited:
            try:
                new, changed = pattern.subn(
                    swap, line, timeout=_left(deadline), concurrent=True,
                )
            except TimeoutError:
                raise SearchError(_TOO_LONG) from None
        else:
            new, changed = pattern.subn(swap, line)
        count += changed
        out.append(new)
    return "\n".join(out), count
