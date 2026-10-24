"""The icons a published page can wear in the browser's tab.

The writer asked on 24 October 2026 for pages to carry a favicon chosen
from a set, a tracker, a timer, an explanation, so a tab of several pages
says which is which. The agent names one when it publishes; a page that
brings its own `<link rel="icon">` keeps it.

Each glyph is drawn on the app's own icon grid, 16 units with a 1.5 stroke,
in white on a rounded square in the pen's violet, which the style guide
gives the agent alone: a page the agent made, recognisable as such on a
light tab strip and a dark one. The icon goes in as a data address, which
the browser loads for a tab whatever the page's policy says.
"""

from __future__ import annotations

import re
from urllib.parse import quote

#: Name, what it is for, and the glyph's strokes on a 16-unit grid.
ICONS: dict[str, tuple[str, str]] = {
    "page": ("anything else", '<path d="M4.5 2.5h5l2.5 2.5v8.5h-7.5z"/><path d="M9.5 2.5v2.5h2.5"/>'),
    "tracker": ("progress on several things", '<path d="M3 4.5h10M3 8h10M3 11.5h10" opacity=".4"/><path d="M3 4.5h8M3 8h4.5M3 11.5h6.5"/>'),
    "checklist": ("a list to tick off", '<path d="M2.5 4.5l1.2 1.2 2-2.2M2.5 10.5l1.2 1.2 2-2.2"/><path d="M8 4.5h5.5M8 10.5h5.5"/>'),
    "timer": ("a countdown or a schedule of steps", '<circle cx="8" cy="9" r="4.75"/><path d="M8 9V6.5M6.5 2.5h3M12 5l1-1"/>'),
    "explanation": ("an explanation or a walk-through", '<path d="M6 13.5h4M6.5 11.5h3"/><path d="M5.6 9.8a4.2 4.2 0 1 1 4.8 0c-.5.4-.9 1-.9 1.7h-3c0-.7-.4-1.3-.9-1.7z"/>'),
    "derivation": ("maths worked through", '<path d="M11.5 3.5h-7l4 4.5-4 4.5h7"/>'),
    "table": ("a table of numbers", '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M2.5 6.5h11M2.5 9.5h11M6.5 3.5v9"/>'),
    "chart": ("a chart of values", '<path d="M3 13h10"/><path d="M4.5 13V9M8 13V5M11.5 13V7.5"/>'),
    "plot": ("a plotted curve", '<path d="M3 2.5v10.5h10.5"/><path d="M4.5 11c2-5 3.5-6.5 5-4.5s2 1 3-3"/>'),
    "figure": ("a figure or a picture", '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><circle cx="6" cy="6.75" r="1"/><path d="M2.5 11.5l3.5-3 2.5 2 2-1.5 3 2.5"/>'),
    "report": ("a report or a write-up", '<path d="M4 2.5h8v11H4z"/><path d="M6 5.5h4M6 8h4M6 10.5h2.5"/>'),
    "comparison": ("two things side by side", '<rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/><path d="M3.75 6h1.5M10.75 6h1.5M3.75 8.5h1.5M10.75 8.5h1.5"/>'),
    "schedule": ("dates and deadlines", '<rect x="2.5" y="3.5" width="11" height="10" rx="1"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/><path d="M5 9h1.5M7.25 9h1.5M9.5 9h1.5M5 11.25h1.5"/>'),
    "notes": ("notes or a draft", '<path d="M10.5 2.5l3 3-7.5 7.5H3v-3z"/><path d="M9 4l3 3"/>'),
    "reading": ("a reading list or sources", '<path d="M8 4.5c-1.5-1-3.5-1.5-5.5-1.5v9c2 0 4 .5 5.5 1.5 1.5-1 3.5-1.5 5.5-1.5V3c-2 0-4 .5-5.5 1.5z"/><path d="M8 4.5v9"/>'),
}

DEFAULT = "page"
PEN = "#6F2998"


def svg(name: str) -> str:
    """The icon as an SVG document."""
    glyph = ICONS[name][1]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
        f'<rect width="16" height="16" rx="3.5" fill="{PEN}"/>'
        '<g transform="translate(2 2) scale(.75)" fill="none" stroke="#fff" stroke-width="1.7" '
        f'stroke-linecap="round" stroke-linejoin="round">{glyph}</g></svg>'
    )


def link(name: str) -> str:
    return f'<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,{quote(svg(name))}">'


_HAS_ICON = re.compile(r"<link\b[^>]*\brel\s*=\s*[\"']?(?:shortcut\s+)?icon\b", re.IGNORECASE)
_HEAD = re.compile(r"<head\b[^>]*>", re.IGNORECASE)
_HTML = re.compile(r"<html\b[^>]*>", re.IGNORECASE)
_DOCTYPE = re.compile(r"<!doctype[^>]*>", re.IGNORECASE)


def wear(html: str, name: str) -> str:
    """`html` with the icon `name` in its head, unless it has one of its own."""
    if _HAS_ICON.search(html):
        return html
    tag = link(name)
    for pattern in (_HEAD, _HTML, _DOCTYPE):
        found = pattern.search(html)
        if found:
            return html[:found.end()] + tag + html[found.end():]
    return tag + html


def choices() -> str:
    """The set, for the tool's description and for a name that is not one."""
    return "; ".join(f"{name} ({use})" for name, (use, _) in ICONS.items())
