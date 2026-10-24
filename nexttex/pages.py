"""Pages the agent publishes, kept with the project's state and served by
NextTex.

The writer asked on 23 October 2026 for the agent to publish a page, a
table to send a co-author or a summary to read on a phone. A Claude Code
session outside NextTex has a tool for that; the SDK session NextTex runs
does not, and claude.ai has no public way in. So a page is an HTML file
here, under the project's state folder rather than the writing, so it
travels with neither the manuscript nor its git history, and the server
serves it behind its own sign-in.

A page is the model's HTML, and the model reads files other people wrote,
so it is served as a stranger's page would be: in a sandbox with an opaque
origin, so its scripts cannot read NextTex's cookie or call its API, and
with nothing allowed to load from anywhere but itself and Google's fonts.
"""

from __future__ import annotations

import re
from pathlib import Path

PAGES_DIR = "pages"
#: What the agent wrote, before `page_parts.fill`, beside the served copy:
#: reading a page back and changing one string should not deal in the
#: megabyte of base64 a figure becomes.
SOURCE_DIR = ".source"

#: A page's name is its address: lower-case words joined by hyphens.
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

#: Big enough for a long report with its tables, small enough that one
#: page cannot fill the disk.
MAX_BYTES = 2 * 1024 * 1024


def policy(origin: str) -> str:
    """Sent with every page, `origin` being the server's own, which the
    page may load KaTeX from and nothing else of.

    `sandbox` without `allow-same-origin` gives the page an origin of its
    own, which is what keeps it from NextTex. The KaTeX folder is named by
    its full address because a source with a path needs its origin, and
    because `'self'` would let a page load any of the interface's scripts."""
    katex = f"{origin.rstrip('/')}/assets/katex/"
    return (
        "sandbox allow-scripts allow-popups; "
        "default-src 'none'; "
        f"script-src 'unsafe-inline' {katex}; "
        f"style-src 'unsafe-inline' {katex} https://fonts.googleapis.com; "
        f"font-src {katex} https://fonts.gstatic.com; "
        "img-src data:; "
        "connect-src 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'self'"
    )


#: Where a page is told the theme the writer's NextTex is in.
_HTML_TAG = re.compile(rb"<html\b[^>]*>", re.IGNORECASE)
_DOCTYPE = re.compile(rb"<!doctype[^>]*>", re.IGNORECASE)
_HAS_THEME = re.compile(rb"\bdata-theme\s*=", re.IGNORECASE)


def themed(body: bytes, theme: str) -> bytes:
    """A page with `data-theme` on its root, so it can follow the theme of
    the NextTex that opened it: the writer asked on 24 October 2026 for a
    page opened from a dark NextTex to be dark. A page's sandbox cannot
    read NextTex's own setting, so Open says it in the address and this
    writes it where a page's styles can see it. A page that set its own
    theme keeps it, and an unknown theme changes nothing."""
    if theme not in ("light", "dark"):
        return body
    tag = _HTML_TAG.search(body)
    if tag is not None:
        if _HAS_THEME.search(tag.group(0)):
            return body
        end = tag.end() - 1
        return body[:end] + f' data-theme="{theme}"'.encode() + body[end:]
    # No <html> of its own: one after the doctype, never before it, since
    # anything ahead of the doctype puts the page in quirks mode.
    opening = f'<html data-theme="{theme}">'.encode()
    doctype = _DOCTYPE.search(body)
    if doctype is not None:
        return body[:doctype.end()] + opening + body[doctype.end():]
    return opening + body


def clean_name(name: str) -> str:
    """A name made safe for an address, or "" when nothing is left."""
    text = re.sub(r"[^a-z0-9]+", "-", str(name).strip().lower()).strip("-")
    return text[:64].strip("-")


class Pages:
    """The pages of one project."""

    def __init__(self, state_dir: Path):
        self.root = state_dir / PAGES_DIR

    def path(self, name: str) -> Path | None:
        """Where a page lives, or None for a name that is not one."""
        if not NAME.fullmatch(name or ""):
            return None
        return self.root / f"{name}.html"

    def save(self, name: str, html: str, served: str | None = None) -> str:
        """Write a page, replacing one of the same name; return its name.

        `html` is what the agent wrote and `served` what is served, the
        same text with its parts filled in; without `served` they are one."""
        clean = clean_name(name)
        if not clean:
            raise ValueError("a page needs a name made of letters, digits and hyphens")
        source = str(html).encode("utf-8")
        data = source if served is None else str(served).encode("utf-8")
        if len(data) > MAX_BYTES:
            raise ValueError(f"a page is at most {MAX_BYTES // (1024 * 1024)} MB, figures included")
        (self.root / SOURCE_DIR).mkdir(parents=True, exist_ok=True)
        for target, body in ((self.root / SOURCE_DIR / f"{clean}.html", source),
                             (self.root / f"{clean}.html", data)):
            temp = target.with_suffix(".html.tmp")
            temp.write_bytes(body)
            temp.replace(target)
        return clean

    def source(self, name: str) -> str | None:
        """What the agent wrote for a page, or the page itself when it was
        published before the two were kept apart."""
        target = self.path(name)
        if target is None:
            return None
        for candidate in (self.root / SOURCE_DIR / f"{name}.html", target):
            if candidate.is_file():
                return candidate.read_text(encoding="utf-8", errors="replace")
        return None

    def list(self) -> list[dict]:
        """Every page, newest first."""
        if not self.root.is_dir():
            return []
        found = []
        for entry in self.root.glob("*.html"):
            if not NAME.fullmatch(entry.stem):
                continue
            stat = entry.stat()
            found.append({"name": entry.stem, "bytes": stat.st_size, "modified": stat.st_mtime})
        return sorted(found, key=lambda page: page["modified"], reverse=True)

    def read(self, name: str) -> bytes | None:
        target = self.path(name)
        if target is None or not target.is_file():
            return None
        return target.read_bytes()

    def delete(self, name: str) -> bool:
        target = self.path(name)
        if target is None or not target.is_file():
            return False
        target.unlink()
        (self.root / SOURCE_DIR / f"{name}.html").unlink(missing_ok=True)
        return True

