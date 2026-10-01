r"""The reply to the reviewers, written from the open comment threads.

A revision answers a list of points, and the points are usually the
comments co-authors and reviewers left on the text. Each open thread
becomes one `\point`: its first message as the point, the words it is
about as `\quoted`, where they are as `\source{file:line}`, which a
Ctrl-click in NextTex opens, and an empty `reply` for the answer; the
thread's other messages follow as a comment under the point, since they
are the discussion and not the reviewer's words.

A letter that exists is never rewritten: the new points go in before its
`\end{document}`, under a comment that says when, so a second press after
more comments adds those and leaves every answer already typed.
"""

from __future__ import annotations

import re
import time

#: LaTeX's special characters in text a person typed.
SPECIAL = {
    "\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "#": r"\#", "$": r"\$",
    "%": r"\%", "&": r"\&", "_": r"\_", "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}
END = re.compile(r"^\s*\\end\s*\{document\}", re.M)


def escape(text: str) -> str:
    """`text` as LaTeX prints it, every special character escaped and the
    lines joined, since a point is one paragraph."""
    flat = " ".join(line.strip() for line in str(text).splitlines() if line.strip())
    return "".join(SPECIAL.get(char, char) for char in flat)


def points(threads: list[dict]) -> str:
    """One `\\point` per thread, in the order given."""
    blocks: list[str] = []
    for thread in threads:
        messages = thread.get("messages") or []
        if not messages:
            continue
        first, rest = messages[0], messages[1:]
        lines = [f"\\point{{{escape(first.get('body', ''))}}}"]
        if thread.get("quote"):
            lines.append(f"\\quoted{{{escape(thread['quote'])}}}")
        if thread.get("path"):
            lines.append(f"\\source{{{thread['path']}:{int(thread.get('line') or 1)}}}")
        for message in rest:
            who = message.get("name") or "someone"
            lines.append(f"% {who}: {' '.join(str(message.get('body', '')).split())}")
        lines += ["\\begin{reply}", "", "\\end{reply}"]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def letter(existing: str | None, template: str, threads: list[dict], now: float | None = None) -> str:
    """The letter with the threads' points in: added before the existing
    letter's `\\end{document}`, or, with no letter yet, the template's
    example point replaced by them."""
    written = points(threads)
    stamp = time.strftime("%d %B %Y", time.localtime(now if now is not None else time.time()))
    block = f"% Points from the open comments, {stamp}.\n\n{written}\n\n"
    if existing is None:
        start = template.find("\\point{")
        end = template.find("\\end{reply}", start)
        if start != -1 and end != -1:
            return template[:start] + block + template[end + len("\\end{reply}"):].lstrip("\n")
        existing = template
    match = END.search(existing)
    if match is None:
        return existing.rstrip("\n") + "\n\n" + block
    return existing[:match.start()] + block + existing[match.start():]
