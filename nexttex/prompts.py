r"""Reusable prompts: a `/` at the start of the composer names one.

A prompt is a Markdown file whose stem is its name.  Three ship with
NextTex, `review-friendly`, `review-critical` and `missing-citations`, so
a fresh project has them with no file; a project's own live in `prompts/` at its root, and
one there with the same stem as a built-in replaces it.  The roadmap
put them beside the distilled style guide, which is under `.nexttex/`;
that directory is never synced and `initialise` writes it into the
project's `.gitignore`, so a file there could not be shared through git,
which was the point.  `prompts/` at the root is what git sees.

A hyphen in the stem matches a space when typed, so `review-friendly.md`
is `/review friendly`.  Expansion happens once, in the ask route, before
either provider sees the turn: the file's text goes ahead of the prompt
in the context the model is given, and the prompt itself stays what the
writer typed, so the transcript on screen shows `/review friendly` and
not three paragraphs of instruction.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

#: Where a project keeps its own, relative to its root.
PROMPTS_DIR = "prompts"
#: What a stem may be: letters, digits and hyphens, so a name is a word or
#: two and never a path.
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,60}$")
BUILTIN_DIR = Path(__file__).parent / "prompts"
#: A prompt file is instruction, not a chapter; a cap keeps a mistaken
#: file from becoming the whole context.
MAX_CHARS = 20_000


@dataclass
class Prompt:
    name: str
    text: str
    source: str            # "builtin" or "project"

    @property
    def said(self) -> str:
        """The name as it is typed: hyphens as spaces."""
        return self.name.replace("-", " ")

    def as_dict(self) -> dict:
        first = next((line.strip() for line in self.text.splitlines() if line.strip()), "")
        return {
            "name": self.name,
            "said": self.said,
            "source": self.source,
            "text": self.text,
            "hint": hint(first),
        }


#: How long a hint may be before it is cut: a sentence's width.
HINT = 140


def hint(line: str) -> str:
    """The first line, for the menu's hint, cut to a sentence's width at a
    word and ended with an ellipsis, so it never stops inside a word."""
    if len(line) <= HINT:
        return line
    cut = line[:HINT].rsplit(" ", 1)[0].rstrip(" ,;:")
    return cut + "\u2026"


def _read(path: Path, source: str) -> Prompt | None:
    if path.suffix.lower() != ".md" or not NAME.match(path.stem):
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    text = text.strip()
    if not text:
        return None
    return Prompt(name=path.stem.lower(), text=text[:MAX_CHARS], source=source)


def builtin() -> list[Prompt]:
    found = [_read(path, "builtin") for path in sorted(BUILTIN_DIR.glob("*.md"))]
    return [prompt for prompt in found if prompt is not None]


def available(root: Path) -> list[Prompt]:
    """Every prompt this project has: its own over the built-ins, by name,
    sorted by name.  Only files directly in `prompts/`; a folder inside it
    is not walked."""
    by_name: dict[str, Prompt] = {prompt.name: prompt for prompt in builtin()}
    folder = root / PROMPTS_DIR
    if folder.is_dir():
        for path in sorted(folder.iterdir()):
            if not path.is_file():
                continue
            prompt = _read(path, "project")
            if prompt is not None:
                by_name[prompt.name] = prompt
    return [by_name[name] for name in sorted(by_name)]


def _normalise(words: str) -> str:
    return re.sub(r"[\s-]+", "-", words.strip().lower())


def expand(prompt: str, prompts: list[Prompt]) -> tuple[Prompt | None, str]:
    """The prompt a draft names, and what is left of the draft.

    A draft whose first line starts with `/` names a prompt by its first
    two words, or its first one; a hyphen and a space are the same
    character for the match, and case does not matter.  What follows the
    name on the first line and every later line is the writer's note,
    returned as the remainder.  A `/` that names nothing is left alone,
    so a line of LaTeX that happens to start with a slash still goes
    through.
    """
    stripped = prompt.lstrip()
    if not stripped.startswith("/"):
        return None, prompt
    first, newline, rest = stripped[1:].partition("\n")
    words = first.split()
    by_name = {p.name: p for p in prompts}
    for take in (2, 1):
        if len(words) < take:
            continue
        candidate = _normalise(" ".join(words[:take]))
        found = by_name.get(candidate)
        if found is not None:
            note_head = " ".join(words[take:])
            note = "\n".join(part for part in (note_head, rest if newline else "") if part).strip()
            return found, note
    return None, prompt


def instruction(found: Prompt, note: str) -> str:
    """What goes ahead of the prompt in the model's context."""
    if note:
        return f"{found.text}\n\nThe writer adds: {note}"
    return found.text
