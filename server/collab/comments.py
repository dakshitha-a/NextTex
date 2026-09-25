"""Comment threads on a project's text, kept in the shared manifest.

A thread is anchored to a range of one file's shared text by two Yjs
relative positions, encoded by the browser that made it from the same
document the server holds, so they move with every edit: typed here, typed
by a collaborator, or folded in from outside, since `ingest` applies a
minimal diff. pycrdt's `StickyIndex` reads what Yjs encodes (a position
made at index 13 of a text and then pushed along by an insertion reads 16
in both), which is what lets the server say where a thread now is without
a browser.

The threads live in one map on the manifest document, `comments`, beside
`files` and `meta`, so they travel to every peer and survive a restart
with nothing new: the manifest is already synced and persisted. One map
for the project rather than one per file is what lets the drawer list
every thread without opening every document. An install that predates
this receives the root and ignores it.

Each thread is a map: `file_id`, the two anchors, the `quote` it was made
on, the `line` it was last seen at, `created`, `resolved` (who and when,
or empty), and `messages`, an array, so two people replying at once both
land. A thread whose text has been deleted is **detached**, not lost: its
anchors meet, it keeps its quote and its last line, and it says so.
"""

from __future__ import annotations

import base64
import secrets
import time
from typing import Callable

from pycrdt import Array, Map, StickyIndex

#: The longest body a message may have, which is a page and then some. A
#: comment is a note on the text, and a peer is somebody else's program.
MAX_BODY = 20_000
MAX_QUOTE = 400


class CommentError(ValueError):
    """A request about a thread that cannot be met, said in a sentence."""


def _now() -> int:
    """Milliseconds, the unit the trash and the history write, so the
    browser reads every "when" the same way."""
    return int(time.time() * 1000)


def _decode(anchor: str) -> bytes | None:
    try:
        return base64.b64decode(anchor, validate=True)
    except (ValueError, TypeError):
        return None


def _line_at(text: str, byte_index: int) -> int:
    """The 1-based line of a byte offset, since pycrdt counts bytes."""
    return text.encode("utf-8")[:byte_index].count(b"\n") + 1


class Comments:
    """The threads of one project, on its collaboration store's manifest."""

    def __init__(self, store, who: Callable[[], dict]) -> None:
        #: The collaboration store: its manifest, `file_id_for`, `files`
        #: and `body`, which opens a file's shared text.
        self.store = store
        #: This install's author: {"name": ..., "peer": ...}.
        self.who = who

    @property
    def root(self) -> Map:
        return self.store.comments

    # --- reading ------------------------------------------------------------

    def where(self, thread: dict) -> dict:
        """Where a thread is now: its line, its range in the text as Yjs
        counts, and whether its text has gone."""
        file_id = thread.get("file_id") or ""
        record = self.store.files.get(file_id)
        out = {"path": (record or {}).get("path") or "", "line": thread.get("line") or 1,
               "detached": True}
        if record is None or record.get("trashed"):
            return out
        text = self.store.body(file_id)
        if text is None:
            return out
        start = _decode(thread.get("start") or "")
        end = _decode(thread.get("end") or "")
        # Empty is valid base64 for no bytes, and pycrdt panics on it.
        if not start or not end:
            return out
        try:
            at = StickyIndex.decode(start, text).get_index()
            to = StickyIndex.decode(end, text).get_index()
        except BaseException as error:
            # A position that names nothing in this document. A pycrdt
            # panic is a `BaseException`, not an `Exception`, and one from
            # an anchor a peer wrote went straight past `except Exception`
            # and took the drawer down (Q-008).
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                raise
            return out
        whole = str(text)
        if to > at and _still_quoted(whole, at, to, thread.get("quote")):
            out["line"] = _line_at(whole, at)
            out["detached"] = False
        return out

    def listing(self) -> list[dict]:
        """Every thread, as the drawer and the editor read it."""
        threads = []
        for thread_id, value in self.root.items():
            thread = _plain(value)
            thread["id"] = thread_id
            mine = self.who().get("peer") or ""
            for message in thread["messages"]:
                message["mine"] = bool(mine) and message.get("peer") == mine
            if thread["resolved"]:
                thread["resolved"]["mine"] = bool(mine) and thread["resolved"].get("peer") == mine
            thread.update(self.where(thread))
            threads.append(thread)
        threads.sort(key=lambda t: (t["path"], t["line"], t.get("created") or 0))
        return threads

    # --- writing ------------------------------------------------------------

    def create(self, relative: str, start: str, end: str, quote: str,
               line: int, body: str) -> str:
        file_id = self.store.file_id_for(relative)
        if file_id is None:
            raise CommentError(f"{relative} is not a file this project shares")
        if _decode(start) is None or _decode(end) is None:
            raise CommentError("the comment's place in the text could not be read")
        body = _clean(body)
        thread_id = "c" + secrets.token_hex(6)
        message = self._message(body)
        with self.store.manifest.transaction():
            self.root[thread_id] = Map({
                "file_id": file_id,
                "start": start,
                "end": end,
                "quote": quote[:MAX_QUOTE],
                "line": max(1, int(line)),
                "created": message["at"],
                "resolved": {},
                "messages": Array([message]),
            })
        return thread_id

    def reply(self, thread_id: str, body: str) -> None:
        thread = self._thread(thread_id)
        messages = thread.get("messages")
        if not isinstance(messages, Array):
            raise CommentError("that thread cannot take a reply")
        with self.store.manifest.transaction():
            messages.append(self._message(_clean(body)))

    def resolve(self, thread_id: str, resolved: bool) -> None:
        thread = self._thread(thread_id)
        who = self.who()
        with self.store.manifest.transaction():
            thread["resolved"] = (
                {"name": who.get("name") or "", "peer": who.get("peer") or "",
                 "at": _now()} if resolved else {}
            )

    def delete(self, thread_id: str) -> None:
        self._thread(thread_id)
        with self.store.manifest.transaction():
            del self.root[thread_id]

    def remember_line(self, thread_id: str, line: int) -> None:
        """Keep the line a thread was last seen at, for when its text goes."""
        thread = self.root.get(thread_id)
        if isinstance(thread, Map) and thread.get("line") != line:
            with self.store.manifest.transaction():
                thread["line"] = line

    # --- inside -------------------------------------------------------------

    def _thread(self, thread_id: str) -> Map:
        thread = self.root.get(thread_id)
        if not isinstance(thread, Map):
            raise CommentError("there is no such thread; somebody may have deleted it")
        return thread

    def _message(self, body: str) -> dict:
        who = self.who()
        return {
            "id": "m" + secrets.token_hex(6),
            "name": who.get("name") or "",
            "peer": who.get("peer") or "",
            "at": _now(),
            "body": body,
        }


def _clean(body: str) -> str:
    body = (body or "").strip()
    if not body:
        raise CommentError("a comment needs something in it")
    if len(body) > MAX_BODY:
        raise CommentError("that comment is longer than a comment should be")
    return body


def _still_quoted(whole: str, at: int, to: int, quote) -> bool:
    """Whether the range still holds something like the text it was on.

    An outside edit that replaces a paragraph is folded in as a character
    diff, which keeps the letters the old and new paragraphs happen to
    share, and a thread's two positions can land on a pair of them: the
    probe found one still attached to "ly" from "entirely" (Q-054). Typing
    the same change deletes the range, which detaches it. So a range that
    shares little with the quote counts as gone. A rewording keeps most of
    its letters and stays.
    """
    if not isinstance(quote, str) or len(quote) < 3:
        return True
    held = whole.encode("utf-8")[at:to].decode("utf-8", errors="replace")
    if len(quote) >= MAX_QUOTE:
        held = held[:len(quote)]
    return likeness(quote, held) >= 0.5


def likeness(one: str, two: str) -> float:
    """How alike two strings are, from 0 to 1: the Dice coefficient of
    their pairs of adjacent letters. `comment-anchors.ts` has the same
    function, so the drawer and the editor agree about a thread."""
    def pairs(text: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for i in range(len(text) - 1):
            counts[text[i:i + 2]] = counts.get(text[i:i + 2], 0) + 1
        return counts
    a, b = pairs(one), pairs(two)
    total = sum(a.values()) + sum(b.values())
    if not total:
        return 1.0 if one == two else 0.0
    shared = sum(min(count, b.get(pair, 0)) for pair, count in a.items())
    return 2 * shared / total


def _whole(value, default: int) -> int:
    """A count or a line from a peer, which may be anything."""
    try:
        return max(1, int(value))
    except (TypeError, ValueError, OverflowError):
        return default


def _words(value, limit: int) -> str:
    return value[:limit] if isinstance(value, str) else ("" if value is None else str(value)[:limit])


def _plain(value) -> dict:
    """A thread as plain data, whatever shape a peer sent it in.

    Held to the shapes and the limits this install's own routes keep,
    because a peer's thread arrives on the manifest without passing them:
    a `line` of text beside a number broke the listing's sort, and a body
    of any length was drawn (Q-008).
    """
    if isinstance(value, Map):
        data = value.to_py()
    elif isinstance(value, dict):
        data = dict(value)
    else:
        data = {}
    messages = data.get("messages")
    data["messages"] = [
        {**m, "body": _words(m.get("body"), MAX_BODY),
         "name": _words(m.get("name"), 200), "peer": _words(m.get("peer"), 200)}
        for m in (messages if isinstance(messages, list) else [])
        if isinstance(m, dict)
    ]
    if not isinstance(data.get("resolved"), dict):
        data["resolved"] = {}
    data["line"] = _whole(data.get("line"), 1)
    data["quote"] = _words(data.get("quote"), MAX_QUOTE)
    created = data.get("created")
    data["created"] = created if isinstance(created, (int, float)) else 0
    data["file_id"] = _words(data.get("file_id"), 64)
    return data


__all__ = ["Comments", "CommentError"]
