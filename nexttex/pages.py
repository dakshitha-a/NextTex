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

An origin of its own is also an origin with no storage: `localStorage`
throws in it, so a tracker's ticked boxes were gone on every reload, which
the writer reported on 1 November 2026. So a page's storage is kept here,
beside the page, under `pages/.state/`: serving a page puts its stored
keys into a `localStorage` of NextTex's own at the top of the page, and
every change the page makes is posted back through the one address its
policy lets it reach, with a key of the page's own in place of the cookie
it cannot have. What a reader ticks is there on the next load, from any
browser, for everyone who opens the page.
"""

from __future__ import annotations

import json
import re
import secrets
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
#: What a page may keep in its storage: a tracker's ticks and notes are
#: kilobytes, and the whole of it rides along with every serve.
MAX_STATE_BYTES = 256 * 1024
#: A page's storage and its key, beside the pages.
STATE_DIR = ".state"


def policy(origin: str, state_url: str | None = None) -> str:
    """Sent with every page, `origin` being the server's own, which the
    page may load KaTeX from and nothing else of; `state_url` the one
    address, the page's own storage route, it may post to.

    `sandbox` without `allow-same-origin` gives the page an origin of its
    own, which is what keeps it from NextTex. The KaTeX folder is named by
    its full address because a source with a path needs its origin, and
    because `'self'` would let a page load any of the interface's scripts.
    The storage route is named the same way, and without one, as the
    page check serves a page, nothing may be reached at all."""
    katex = f"{origin.rstrip('/')}/assets/katex/"
    # A source with a query would not parse, and the policy matches the
    # path alone, so the key goes in the request and not in the policy.
    reach = state_url.split("?")[0] if state_url else "'none'"
    return (
        "sandbox allow-scripts allow-popups; "
        "default-src 'none'; "
        f"script-src 'unsafe-inline' {katex}; "
        f"style-src 'unsafe-inline' {katex} https://fonts.googleapis.com; "
        f"font-src {katex} https://fonts.gstatic.com; "
        "img-src data:; "
        f"connect-src {reach}; "
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


#: The `localStorage` a page gets in place of the one its sandbox denies
#: it. Its keys arrive with the page; a change is posted to the page's
#: storage route at once, as a patch of the keys that changed, so two
#: readers of one tracker each keep what the other ticked, and changes
#: made while a post is in flight go together in the next. Whatever is
#: still waiting when the tab is hidden or closed goes with `keepalive`,
#: since a reader's last tick is the one a plain request would lose.
#: Without a route, as the page check serves a page, the storage lives
#: and dies with the document. `sessionStorage` is the tab's own and
#: keeps nothing.
STORAGE_SCRIPT = """<script>(function(){
var data=__STATE__,url=__URL__,patch={},wipe=false,inflight=false;
function send(final){if(!url||(inflight&&!final)||(!wipe&&!Object.keys(patch).length))return;
var body=JSON.stringify({set:patch,clear:wipe});patch={};wipe=false;inflight=true;
try{fetch(url,{method:"POST",headers:{"Content-Type":"text/plain"},body:body,keepalive:!!final})
.catch(function(){}).then(function(){inflight=false;send(false)})}catch(e){inflight=false}}
function storage(kept){var d=kept;var s={
getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},
setItem:function(k,v){k=String(k);v=String(v);d[k]=v;if(kept===data){patch[k]=v;send(false)}},
removeItem:function(k){k=String(k);delete d[k];if(kept===data){patch[k]=null;send(false)}},
clear:function(){for(var k in d)delete d[k];if(kept===data){patch={};wipe=true;send(false)}},
key:function(i){var keys=Object.keys(d);return i<keys.length?keys[i]:null}};
Object.defineProperty(s,"length",{get:function(){return Object.keys(d).length}});return s}
try{Object.defineProperty(window,"localStorage",{value:storage(data),configurable:true});
Object.defineProperty(window,"sessionStorage",{value:storage({}),configurable:true})}catch(e){}
addEventListener("pagehide",function(){send(true)});
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")send(true)});
})()</script>"""

_HEAD_TAG = re.compile(rb"<head\b[^>]*>", re.IGNORECASE)


def stored(body: bytes, state: dict, url: str | None) -> bytes:
    """`body` with its storage at the top, `state` being the keys the page
    kept and `url` where it posts its changes, key and all; with no `url`
    the storage lasts as long as the document. The script goes first in
    the head, before any script of the page's own, since the page reads
    its storage as soon as it runs; a page with no head gets it after its
    `<html>` or its doctype, where the parser opens a head for it. A
    `<` in a value is written as `\\u003c`, so no value can close the
    script, and the URL is a JSON string for the same reason."""
    text = json.dumps(state, ensure_ascii=False).replace("<", "\\u003c")
    address = json.dumps(url).replace("<", "\\u003c") if url else "null"
    # The address first, so a stored value that reads __URL__ stays a
    # value; and on one line, so the line a page check reports for a
    # script error is the line in the page as the agent wrote it.
    script = "".join(STORAGE_SCRIPT.splitlines()).replace("__URL__", address) \
        .replace("__STATE__", text).encode("utf-8")
    for pattern in (_HEAD_TAG, _HTML_TAG, _DOCTYPE):
        found = pattern.search(body)
        if found:
            return body[:found.end()] + script + body[found.end():]
    return script + body


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
        """A page, what the agent wrote for it, its storage and its key."""
        target = self.path(name)
        if target is None or not target.is_file():
            return False
        target.unlink()
        (self.root / SOURCE_DIR / f"{name}.html").unlink(missing_ok=True)
        for suffix in (".json", ".key"):
            (self.root / STATE_DIR / f"{name}{suffix}").unlink(missing_ok=True)
        return True

    def state(self, name: str) -> dict:
        """What a page has kept in its storage: string keys to strings."""
        target = self.path(name)
        if target is None:
            return {}
        try:
            kept = json.loads((self.root / STATE_DIR / f"{name}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return kept if isinstance(kept, dict) else {}

    def key(self, name: str) -> str | None:
        """The key a page posts its storage with, made the first time it
        is asked for and kept beside the storage. It stands in for the
        cookie the page's sandbox cannot send, and it opens nothing but
        this one page's storage. None for a name that is not a page's,
        or whose page is not there."""
        target = self.path(name)
        if target is None or not target.is_file():
            return None
        keyfile = self.root / STATE_DIR / f"{name}.key"
        try:
            return keyfile.read_text(encoding="utf-8").strip()
        except OSError:
            pass
        keyfile.parent.mkdir(parents=True, exist_ok=True)
        fresh = secrets.token_urlsafe(32)
        try:
            with open(keyfile, "x", encoding="utf-8") as handle:
                handle.write(fresh)
        except FileExistsError:
            # Two tabs opened the page in the same moment; the first key
            # written is the one both get.
            return keyfile.read_text(encoding="utf-8").strip()
        return fresh

    def merge_state(self, name: str, changes: dict, clear: bool = False) -> dict:
        """Apply what a page posted: `changes` maps keys to new strings, or
        to None for a key removed, after `clear` has emptied the storage;
        the storage as it is now comes back. A patch rather than the whole
        store, so two readers of one page each keep the other's changes.
        Over `MAX_STATE_BYTES` nothing is written and ValueError says so."""
        target = self.path(name)
        if target is None:
            raise ValueError("not a page")
        kept = {} if clear else self.state(name)
        for key, value in changes.items():
            if value is None:
                kept.pop(str(key), None)
            else:
                kept[str(key)] = str(value)
        data = json.dumps(kept, ensure_ascii=False).encode("utf-8")
        if len(data) > MAX_STATE_BYTES:
            raise ValueError(f"a page keeps at most {MAX_STATE_BYTES // 1024} KB")
        folder = self.root / STATE_DIR
        folder.mkdir(parents=True, exist_ok=True)
        temp = folder / f"{name}.json.tmp"
        temp.write_bytes(data)
        temp.replace(folder / f"{name}.json")
        return kept

