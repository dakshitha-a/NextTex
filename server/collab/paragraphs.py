"""Three texts made into one, a paragraph at a time.

Two copies of a file that changed apart used to be merged by the CRDT a
character at a time, which is right while both writers can see each other
type and wrong once they could not: two rewrites of one paragraph came back
as one paragraph that neither of them wrote. The paragraph is the unit a
writer thinks in, so it is the unit of conflict here, while the document
stays one flat text.

The rule, per paragraph, against the text both sides last agreed on:

- changed on one side only, that side's version is taken;
- changed the same way on both, it is taken once;
- new on both sides at one place, both are kept, one after the other,
  since neither replaces anything;
- changed differently on both, or changed on one and deleted on the other,
  both versions are kept between comment lines that name each author, so
  the file still compiles and a writer picks one.

A paragraph is a run of lines ended by a blank line, widened so that a
LaTeX environment, or a fenced block in Markdown, is never cut in two by a
blank line inside it. A file type with no comment syntax cannot carry the
marker lines, so there `commentless` is set, the text takes our side at
each conflict, and the caller keeps the other side's whole file beside it.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

#: The comment around a marker line, by suffix: an opening and a closing.
COMMENTS: dict[str, tuple[str, str]] = {
    **{s: ("% ", "") for s in (".tex", ".ltx", ".sty", ".cls", ".bib", ".bst")},
    **{s: ("# ", "") for s in (".py", ".toml", ".yaml", ".yml", ".cfg", ".mplstyle", ".gitignore")},
    ".md": ("<!-- ", " -->"),
}

#: The tag that ends every marker line, and what the editor finds them by:
#: `{nexttex-conflict 7f3a}` opens, `{nexttex-conflict 7f3a 1}` starts a
#: version, `{nexttex-conflict 7f3a end}` closes.
TAG = re.compile(r"\{nexttex-conflict ([0-9a-f]+)(?: (\d+|end))?\}")

_TEX = {".tex", ".ltx", ".sty", ".cls"}
#: Environments that hold a document's body rather than a piece of it, and
#: so never join their paragraphs into one.
WHOLE = {"document"}
_COMMENT = re.compile(r"(?<!\\)%.*")


@dataclass
class Result:
    text: str
    #: How many places kept two versions.
    conflicts: int = 0
    #: The file type has no comments, so our side was taken at each
    #: conflict and the caller should keep theirs whole beside it.
    commentless: bool = False
    #: The conflict ids written, in order.
    ids: list[str] = field(default_factory=list)


def comment_for(path: str) -> tuple[str, str] | None:
    name = path.rsplit("/", 1)[-1]
    if name == ".gitignore":
        return COMMENTS[".gitignore"]
    dot = name.rfind(".")
    return COMMENTS.get(name[dot:].lower()) if dot > 0 else None


def blocks(text: str, path: str = "") -> list[str]:
    """The text cut into paragraphs, each carrying the blank lines after
    it, so joining them gives the text back exactly."""
    lower = path.lower()
    tex = any(lower.endswith(s) for s in _TEX)
    markdown = lower.endswith(".md")
    out: list[str] = []
    current: list[str] = []
    open_envs: list[str] = []
    fenced = False
    ended = False                       # a blank line has been seen
    for line in text.splitlines(keepends=True):
        blank = not line.strip()
        if ended and not blank and not open_envs and not fenced:
            out.append("".join(current))
            current, ended = [], False
        current.append(line)
        if blank:
            ended = True
            continue
        if tex:
            code = _COMMENT.sub("", line)
            for match in re.finditer(r"\\(begin|end)\s*\{([^}]*)\}", code):
                if match.group(2) in WHOLE:
                    # The document itself: widening for it made the whole
                    # body one paragraph, so any clash kept two copies of
                    # the entire file.
                    continue
                if match.group(1) == "begin":
                    open_envs.append(match.group(2))
                elif match.group(2) in open_envs:
                    # Close the innermost of that name and anything left
                    # open inside it, so one missing \end cannot swallow the
                    # rest of the file.
                    while open_envs and open_envs.pop() != match.group(2):
                        pass
        elif markdown and line.lstrip().startswith("```"):
            fenced = not fenced
    if current:
        out.append("".join(current))
    return out


def _matches(base: list[str], side: list[str]) -> dict[int, int]:
    """Base index to side index, for blocks the side left as they were."""
    found: dict[int, int] = {}
    matcher = SequenceMatcher(None, base, side, autojunk=False)
    for tag, b0, b1, s0, _ in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(b1 - b0):
                found[b0 + offset] = s0 + offset
    return found


def _id(*parts: list[str]) -> str:
    digest = hashlib.sha1()
    for part in parts:
        digest.update("".join(part).encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()[:6]


def _paragraph_end(text: str) -> str:
    """A version ended by exactly one blank line, so a marker after it can
    never join two versions into one paragraph in the PDF."""
    stripped = text.rstrip("\n")
    return stripped + "\n\n" if stripped else ""


class _Writer:
    def __init__(self, ours_name: str, theirs_name: str, comment):
        self.ours_name = ours_name
        self.theirs_name = theirs_name
        self.comment = comment
        self.out: list[str] = []
        self.result = Result("")

    def line(self, text: str) -> str:
        opening, closing = self.comment
        return f"{opening}{text}{closing}\n"

    def conflict(self, base: list[str], ours: list[str], theirs: list[str]) -> None:
        # Blocks both sides agree on at either end sit outside the markers.
        head: list[str] = []
        while ours and theirs and ours[0] == theirs[0]:
            head.append(ours.pop(0))
            theirs.pop(0)
            if base:
                base = base[1:]
        tail: list[str] = []
        while ours and theirs and ours[-1] == theirs[-1]:
            tail.insert(0, ours.pop())
            theirs.pop()
            if base:
                base = base[:-1]
        self.out.extend(head)
        if not ours and not theirs:
            self.out.extend(tail)
            return
        if not base:
            # New on both sides at one place: neither replaces anything.
            self.out.extend(ours)
            self.out.extend(theirs)
            self.out.extend(tail)
            return
        self.result.conflicts += 1
        if self.comment is None:
            self.result.commentless = True
            self.out.extend(ours)
            self.out.extend(tail)
            return
        ident = _id(base, ours, theirs)
        self.result.ids.append(ident)
        ours_text, theirs_text = "".join(ours), "".join(theirs)
        many = len(base) > 1
        what = "these paragraphs" if many else "this paragraph"
        if not ours_text.strip() or not theirs_text.strip():
            head_line = f"NextTex: {what} was deleted in one version and changed in the other. Keep one."
            if many:
                head_line = head_line.replace(" was ", " were ", 1)
        else:
            head_line = f"NextTex: two versions of {what} were written apart. Keep one."
        if self.out and not "".join(self.out[-1:]).endswith("\n"):
            self.out.append("\n")
        self.out.append(self.line(f"{head_line} {{nexttex-conflict {ident}}}"))
        for number, (name, text) in enumerate(
            ((self.ours_name, ours_text), (self.theirs_name, theirs_text)), start=1
        ):
            label = f"Version from {name}" if text.strip() else f"Deleted in the version from {name}"
            self.out.append(self.line(f"{label} {{nexttex-conflict {ident} {number}}}"))
            self.out.append(_paragraph_end(text))
        self.out.append(self.line(f"End of the two versions {{nexttex-conflict {ident} end}}"))
        self.out.extend(tail)


def merge(base: str, ours: str, theirs: str, ours_name: str, theirs_name: str,
          path: str = "") -> Result:
    """Ours and theirs, both changed from base, as one text."""
    if ours == theirs or theirs == base:
        return Result(ours)
    if ours == base:
        return Result(theirs)
    b, o, t = blocks(base, path), blocks(ours, path), blocks(theirs, path)
    in_ours, in_theirs = _matches(b, o), _matches(b, t)
    writer = _Writer(ours_name, theirs_name, comment_for(path) if path else COMMENTS[".tex"])
    i = j = k = 0
    stable = [index for index in range(len(b)) if index in in_ours and index in in_theirs]
    for anchor in stable + [len(b)]:
        if anchor < len(b):
            jo, kt = in_ours[anchor], in_theirs[anchor]
            if jo < j or kt < k:
                continue
        else:
            jo, kt = len(o), len(t)
        chunk_b, chunk_o, chunk_t = b[i:anchor], o[j:jo], t[k:kt]
        if chunk_o == chunk_b:
            writer.out.extend(chunk_t)
        elif chunk_t == chunk_b or chunk_o == chunk_t:
            writer.out.extend(chunk_o)
        elif len(chunk_b) == len(chunk_o) == len(chunk_t):
            # Paragraphs edited in place: each one is its own question.
            for pb, po, pt in zip(chunk_b, chunk_o, chunk_t):
                if po == pb:
                    writer.out.append(pt)
                elif pt == pb or po == pt:
                    writer.out.append(po)
                else:
                    writer.conflict([pb], [po], [pt])
        else:
            writer.conflict(chunk_b, chunk_o, chunk_t)
        if anchor < len(b):
            writer.out.append(b[anchor])
        i, j, k = anchor + 1, jo + 1, kt + 1
    writer.result.text = "".join(writer.out)
    return writer.result
