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


# R-025 and R-026. The sign-in page is server-rendered, because it has to
# draw before the bundle is authorised, and its palette is a copy written
# out by hand. A copy drifts, and this one had: the recovery command was
# drawn in the dimmest ink on the darkest ground, at 4.16:1 against the 4.5
# that twelve-pixel text needs, and the app's own answer to that exact
# pairing, `.nx-on-surround`, cannot reach a page that has no way to import
# the stylesheet.


def block_of(text: str, selector: str) -> dict:
    start = text.index(selector)
    body = text[start:text.index("}", start)]
    return {name: value.lower()
            for name, value in re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})", body)}


def sign_in_page() -> str:
    from server.main import _sign_in_page

    return _sign_in_page()


def sign_in_blocks() -> dict:
    """The two `:root` blocks out of the page, as {theme: {name: hex}}."""
    page = sign_in_page()
    style = page[page.index("<style>"):page.index("</style>")]
    dark, _, light = style.partition("@media (prefers-color-scheme: light)")
    reading = lambda part: {name: value.lower() for name, value
                            in re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})", part)}
    return {"dark": reading(dark), "light": reading(light)}


def channel(hex_value: str, index: int) -> float:
    value = int(hex_value[1 + index * 2:3 + index * 2], 16) / 255
    return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4


def ratio(one: str, two: str) -> float:
    def luminance(value):
        return (0.2126 * channel(value, 0) + 0.7152 * channel(value, 1)
                + 0.0722 * channel(value, 2))

    a, b = sorted((luminance(one), luminance(two)), reverse=True)
    return (a + 0.05) / (b + 0.05)


def test_the_sign_in_page_uses_the_apps_own_colours():
    """Every value it writes out by hand is the one styles.css names for
    that theme. A copy is allowed; a copy that has drifted is not."""
    sheet_text = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
    sheet = {
        "light": block_of(sheet_text, ".nx-theme-light {"),
        "dark": block_of(sheet_text, ".nx-theme-dark {"),
    }
    blocks = sign_in_blocks()

    wrong = []
    for theme, tokens in blocks.items():
        for name, value in tokens.items():
            expected = sheet[theme].get(name)
            if expected and value != expected:
                wrong.append(f"--{name} in {theme}: page {value}, sheet {expected}")
    assert wrong == [], "\n".join(wrong)


def test_the_recovery_command_is_readable_on_the_ground_it_sits_on():
    """It is `pre > code` on --surround at 12px, which is small text, so it
    needs 4.5:1. --ink-3 measured 4.16 there in light, which is the same
    pairing to two decimal places that `docs/testing.md` records being found
    on the projects screen and fixed by stepping the ink up rather than by
    certifying it."""
    blocks = sign_in_blocks()
    page = sign_in_page()

    assert "pre code" in page, "the recovery command takes whatever ink it inherits"
    for theme in ("light", "dark"):
        ink = blocks[theme]["ink-2"]
        ground = blocks[theme]["surround"]
        assert ratio(ink, ground) >= 4.5, (
            f"--ink-2 on --surround in {theme} is {ratio(ink, ground):.2f}:1"
        )


def test_the_front_door_says_what_language_it_is_in():
    """There was no `<html>` element at all, so the browser synthesised one
    with no `lang`, and a screen reader announced the first page a new
    writer meets in whatever language their machine defaults to.
    `frontend/index.html` has carried `lang="en"` all along; it is only this
    page, the one that greets somebody who has not signed in yet, that did
    not."""
    page = sign_in_page()

    assert "<html lang=en>" in page
    assert page.rstrip().endswith("</html>")
