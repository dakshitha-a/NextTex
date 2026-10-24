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

#: A page's name is its address: lower-case words joined by hyphens.
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

#: Big enough for a long report with its tables, small enough that one
#: page cannot fill the disk.
MAX_BYTES = 2 * 1024 * 1024

#: Sent with every page. `sandbox` without `allow-same-origin` gives the
#: page an origin of its own, which is what keeps it from NextTex.
POLICY = (
    "sandbox allow-scripts allow-popups; "
    "default-src 'none'; "
    "script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; "
    "img-src data:; "
    "connect-src 'none'; "
    "form-action 'none'; "
    "frame-ancestors 'self'"
)


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

    def save(self, name: str, html: str) -> str:
        """Write a page, replacing one of the same name; return its name."""
        clean = clean_name(name)
        if not clean:
            raise ValueError("a page needs a name made of letters, digits and hyphens")
        data = str(html).encode("utf-8")
        if len(data) > MAX_BYTES:
            raise ValueError(f"a page is at most {MAX_BYTES // (1024 * 1024)} MB")
        self.root.mkdir(parents=True, exist_ok=True)
        target = self.root / f"{clean}.html"
        temp = target.with_suffix(".html.tmp")
        temp.write_bytes(data)
        temp.replace(target)
        return clean

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
        return True

