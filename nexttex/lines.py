"""Two questions about the lines of a text file, asked in several places.

Its own module rather than a function in `agent.py`, for the reason
`writing.py` and `modes.py` are their own modules: importing `agent.py`
pulls in the Claude SDK, which is six hundred milliseconds of pydantic model
building, and the scripted stand-in and the OpenAI agent both need these
names without it.

There is still one copy of `first_changed_line` in the browser, in
`frontend/src/store.ts`, because the editor needs the answer without a round
trip. That one cannot be shared and so it is tested against these exact
cases in `tests/test_agent_parity.py`, with a comment in each file naming
the other.
"""

from __future__ import annotations


def first_changed_line(before: str, after: str) -> int:
    """The first line where two versions of a file diverge, 1-based.

    Not a diff and not trying to be one.  It answers "where should the
    reader be looking", so for an append that is the first new line rather
    than the end of the old text, and for two identical texts it is line one
    rather than an error.
    """
    if before == after:
        return 1
    old = before.split("\n")
    new = after.split("\n")
    for index in range(min(len(old), len(new))):
        if old[index] != new[index]:
            return index + 1
    return min(len(old), len(new)) + 1


def document_ends_at(lines: list[str]) -> int | None:
    """The 1-based line of `\\end{document}`, if this file has one.

    Every tool that writes at a *place* rather than at a match has to refuse
    to put text after it, because text there is typeset by nothing: the edit
    appears to work, shows a diff, and changes no page.  A cursor left there
    is the ordinary case rather than a strange one, since it is the last
    line of a new project.
    """
    for index, line in enumerate(lines):
        if line.lstrip().startswith("\\end{document}"):
            return index + 1
    return None
