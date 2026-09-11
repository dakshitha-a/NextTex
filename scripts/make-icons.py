#!/usr/bin/env python3
"""Redraw the application's mark everywhere it has to be a file.

Run when the mark changes; the output is committed, so an ordinary checkout
and an ordinary install never need this or Pillow.

    scripts/make-icons.py

It writes:

    frontend/public/icon.png    512 px, for the Linux .desktop file
    frontend/public/favicon.ico 16 to 256, for the Windows shortcut
    docs/logo.svg               the mark the README shows

and prints the data URI that belongs in `frontend/index.html`, which cannot
reference a file because the favicon has to be right before any request for
one could be answered.

There is one mark, and it is drawn in two ways for one reason.

`frontend/src/Logo.tsx` draws it live and transparent, taking `--ink` and
`--pen` from whichever theme is on.  That is the right drawing wherever the
application's own stylesheet is present, and it is the original: everything
here is measured off it.

Everywhere else the mark has to survive on a ground nobody controls: a
browser's tab strip, a desktop wallpaper, a taskbar, GitHub in either of its
themes.  A transparent page outline in `--ink` is invisible on half of
those.  So those surfaces get the same geometry on the application's own
outermost ground, `--surround`, with the dark theme's ink and pen.  That is
one mark rendered for an opaque tile, not a second mark.

The mark is nine tenths the size it is in the live drawing, and everything
scales with it, because the live mark is drawn edge to edge in its own slot
and the interface around it supplies the air.  A tile has to supply its own.
Nine tenths was arrived at by rendering the live drawing beside candidates
and looking: it is the largest that still leaves a margin, and the smallest
whose page outline survives 16 px, where it lands at eight tenths of a pixel
and antialiases to a legible hairline.

One number is a hair off the faithful scaling.  The backslash is 2.7 where
2.88 would be exact, because a light stroke on a dark ground blooms, and at
the exact weight it filled the page and turned the mark into a frame around
a violet bar.  That is an optical correction and not a second opinion about
the drawing.
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ModuleNotFoundError:  # pragma: no cover - a developer-only script
    sys.exit("this needs Pillow: .venv/bin/python scripts/make-icons.py")

ROOT = Path(__file__).resolve().parent.parent

# The palette is the application's own, from frontend/src/styles.css.  A
# fixed brand violet was tried and is wrong: #7B45A0 measures 2.8:1 against
# the dark rail, under the 3:1 a graphic needs.
GROUND = "#0A0C0B"   # --surround, dark
INK = "#E3E8E2"      # --ink, dark
PEN = "#C988E7"      # --pen, dark

# Everything below is in the same 32 unit box as Logo.tsx, so the two can be
# compared by reading them side by side.
BOX = 32.0
TILE_RADIUS = 7.0    # the same corner the app draws on its own surfaces

PAGE_X, PAGE_Y = 7.9, 4.3
PAGE_W, PAGE_H = 16.2, 23.4
PAGE_RADIUS = 1.8
PAGE_STROKE = 1.7

# The backslash, at the same fractions of the page it sits on as in the live
# drawing: it starts a quarter of the way in and finishes three quarters
# along, and it falls further than it travels, which is what makes it a
# backslash rather than a diagonal.
SLASH_FROM = (0.272, 0.231)
SLASH_TO = (0.728, 0.769)
SLASH_STROKE = 2.7

SUPERSAMPLE = 8
ICO_SIZES = (16, 32, 48, 64, 128, 256)


def slash_points() -> tuple[tuple[float, float], tuple[float, float]]:
    """The two ends of the stroke, in box units."""
    return (
        (PAGE_X + SLASH_FROM[0] * PAGE_W, PAGE_Y + SLASH_FROM[1] * PAGE_H),
        (PAGE_X + SLASH_TO[0] * PAGE_W, PAGE_Y + SLASH_TO[1] * PAGE_H),
    )


def draw(size: int) -> Image.Image:
    """The tile at `size` pixels, drawn large and reduced."""
    scale = size * SUPERSAMPLE / BOX
    px = size * SUPERSAMPLE
    image = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    pen = ImageDraw.Draw(image)

    def u(value: float) -> float:
        return value * scale

    pen.rounded_rectangle(
        (0, 0, px - 1, px - 1),
        radius=u(TILE_RADIUS),
        fill=GROUND,
    )
    pen.rounded_rectangle(
        (u(PAGE_X), u(PAGE_Y), u(PAGE_X + PAGE_W), u(PAGE_Y + PAGE_H)),
        radius=u(PAGE_RADIUS),
        outline=INK,
        width=max(1, round(u(PAGE_STROKE))),
    )

    # Pillow has no round cap, so the stroke is a line with a disc at each
    # end.  Without them the backslash ends in two flat edges at an angle,
    # which reads as broken rather than as drawn.
    (x0, y0), (x1, y1) = slash_points()
    width = max(1, round(u(SLASH_STROKE)))
    pen.line((u(x0), u(y0), u(x1), u(y1)), fill=PEN, width=width)
    for x, y in ((x0, y0), (x1, y1)):
        r = width / 2
        pen.ellipse((u(x) - r, u(y) - r, u(x) + r, u(y) + r), fill=PEN)

    return image.resize((size, size), Image.LANCZOS)


def svg() -> str:
    """The same tile, as vector, for the README and for the tab."""
    (x0, y0), (x1, y1) = slash_points()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" '
        f'viewBox="0 0 32 32" role="img" aria-label="NextTex">'
        f"<title>NextTex</title>"
        f'<rect width="32" height="32" rx="{TILE_RADIUS:g}" fill="{GROUND}"/>'
        f'<rect x="{PAGE_X:g}" y="{PAGE_Y:g}" width="{PAGE_W:g}" '
        f'height="{PAGE_H:g}" rx="{PAGE_RADIUS:g}" fill="none" '
        f'stroke="{INK}" stroke-width="{PAGE_STROKE:g}"/>'
        f'<path d="M{x0:.2f} {y0:.2f} L{x1:.2f} {y1:.2f}" fill="none" '
        f'stroke="{PEN}" stroke-width="{SLASH_STROKE:g}" '
        f'stroke-linecap="round"/>'
        f"</svg>"
    )


def data_uri(markup: str) -> str:
    """The favicon line for index.html.

    Only the characters that would confuse a URL are escaped, because an
    unescaped `#` truncates the document at the first colour and the failure
    is silent: the tab simply shows nothing. The markup keeps its double
    quotes and the attribute in `index.html` uses single ones, which is the
    only pairing that needs no escaping of either.
    """
    one_line = markup.replace('width="96" height="96" ', "")
    one_line = one_line.replace("<title>NextTex</title>", "")
    return one_line.replace("%", "%25").replace("#", "%23")


def main() -> None:
    public = ROOT / "frontend" / "public"
    public.mkdir(parents=True, exist_ok=True)

    png = public / "icon.png"
    draw(512).save(png)

    ico = public / "favicon.ico"
    largest = draw(max(ICO_SIZES))
    largest.save(ico, sizes=[(n, n) for n in ICO_SIZES])

    logo = ROOT / "docs" / "logo.svg"
    markup = svg()
    logo.write_text(markup + "\n", encoding="utf-8")

    for path in (png, ico, logo):
        print(f"  wrote {path.relative_to(ROOT)}")
    print()
    print("  frontend/index.html wants this, verbatim:")
    print(f"    <link rel=\"icon\" href='data:image/svg+xml,{data_uri(markup)}' />")


if __name__ == "__main__":
    main()
