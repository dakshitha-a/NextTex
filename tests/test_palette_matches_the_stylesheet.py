"""The design document's palette and the stylesheet's, held together.

`docs/design.md` opens by saying that when it and the implementation
disagree, that is a bug in one of them, and to decide which rather than
letting them drift silently.  Its own palette section drifted anyway: a
commit updated the table and missed the prose two paragraphs below, so the
document said the pen was `#74408E` while the stylesheet said `#6F2998`, and
it said so for weeks.  Nothing could have noticed, which is why this exists.

Not a check that every colour in the document is in the stylesheet, because
the document legitimately names colours that are not NextTex's: NexusQC's
accent, the indigo every AI-built app reaches for, the one this app is
explicitly not.  So the rule is narrower and is the one that actually broke:
a colour the document presents as *ours*, by naming it beside a token, has
to be a colour the stylesheet sets.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

#: Colours the document names as somebody else's, on purpose.
NOT_OURS = {"#6e8cff", "#6366F1", "#FFFFFF", "#ffffff", "#000000"}

TOKENS = (
    "surround", "surface", "surface-2", "surface-3",
    "ink", "ink-2", "ink-3", "pen", "hint", "error", "warn", "ok",
)


def stylesheet_colours() -> set[str]:
    text = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
    return {value.lower() for value in re.findall(r"#[0-9A-Fa-f]{6}", text)}


def documented() -> list[tuple[int, str, str]]:
    """Every hex in the palette section, with the line and its context."""
    text = (ROOT / "docs" / "design.md").read_text(encoding="utf-8")
    section = text.split("## 2. Palette")[1].split("\n## ")[0]
    offset = text.index("## 2. Palette")
    before = text[:offset].count("\n")
    found = []
    for index, line in enumerate(section.split("\n")):
        for value in re.findall(r"#[0-9A-Fa-f]{6}", line):
            found.append((before + index + 1, value, line.strip()))
    return found


def test_the_palette_section_names_colours_the_stylesheet_actually_sets():
    ours = stylesheet_colours()
    strays = [
        (line, value, context)
        for line, value, context in documented()
        if value not in NOT_OURS and value.lower() not in ours
    ]
    assert not strays, "\n".join(
        f"design.md:{line} says {value}, which styles.css does not set: {context[:90]}"
        for line, value, context in strays
    )


@pytest.mark.parametrize("token", TOKENS)
def test_every_token_the_section_tabulates_is_in_the_stylesheet(token):
    """The other direction, and the cheaper half: a token renamed in the
    stylesheet leaves the table describing something that no longer exists."""
    text = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
    assert f"--{token}:" in text
