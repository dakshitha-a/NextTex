#!/usr/bin/env python3
"""Keep the guide's Contents index in step with its headings.

The index is a nested list of every `##` and `###` heading, each a link to
the heading's GitHub anchor.  Typed by hand it would drift the first time a
heading was renamed, so it is generated: run with no arguments to rewrite
the block in place, or with `--check` to say whether the block in the file
is the one the headings call for, which is what the documents test asks.

It kept the README's index until the README was redesigned on 1 October
2026.  The README is now short enough for GitHub's own outline button, and
its long sections, with the need for an index, moved to `docs/guide.md`.
The file keeps its name so the documents that cite it stay right.

The block starts at a line reading `**Contents**` and ends at the first
`## ` heading after it.  Headings inside fenced code blocks are not
headings, which matters because a TOML comment in the guide starts with
`#`.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DOCUMENT = Path(__file__).resolve().parent.parent / "docs" / "guide.md"
MARKER = "**Contents**"


def slug(text: str) -> str:
    """GitHub's anchor for a heading: lowercase, punctuation dropped,
    spaces to hyphens.  Backticks go, their contents stay."""
    text = text.strip().lower().replace("`", "")
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def headings(text: str) -> list[tuple[int, str]]:
    """Every `##` and `###` heading as (level, title), fences skipped."""
    found: list[tuple[int, str]] = []
    fenced = False
    for line in text.splitlines():
        if line.startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            continue
        match = re.match(r"^(##|###) (.+?)\s*$", line)
        if match:
            found.append((len(match.group(1)), match.group(2)))
    return found


def index_block(text: str) -> str:
    lines = [MARKER, ""]
    for level, title in headings(text):
        indent = "  " * (level - 2)
        lines.append(f"{indent}- [{title}](#{slug(title)})")
    return "\n".join(lines) + "\n"


def split(text: str) -> tuple[str, str, str]:
    """The text before the block, the block, and the text after it."""
    start = text.index(MARKER + "\n")
    after = text.index("\n## ", start)
    return text[:start], text[start:after + 1], text[after + 1:]


def current(text: str) -> str:
    return split(text)[1]


def wanted(text: str) -> str:
    return index_block(text) + "\n"


def main(argv: list[str]) -> int:
    text = DOCUMENT.read_text(encoding="utf-8")
    if MARKER + "\n" not in text:
        print(f"{DOCUMENT} has no {MARKER} block", file=sys.stderr)
        return 2
    before, block, after = split(text)
    fresh = wanted(text)
    if "--check" in argv:
        if block == fresh:
            print("the guide's index is current")
            return 0
        print("the guide's index is behind its headings; run scripts/readme_index.py",
              file=sys.stderr)
        return 1
    DOCUMENT.write_text(before + fresh + after, encoding="utf-8")
    print("the guide's index has been rewritten")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
