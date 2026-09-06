"""The record of what was done to the document, kept on disk.

The model's own memory of a conversation survives a restart -- the SDK
resumes it by session id -- so if the panel did not, the agent would talk
about "the sentence I added earlier" into a window showing nothing.  Worse,
the transcript is the audit trail of what an assistant did to a doctoral
dissertation: every edit with its diff, every reverted edit, every command
that was allowed or refused.  That is not session state.

Streamed text is coalesced here rather than stored delta by delta: a turn
produces hundreds of fragments and one paragraph.
"""

from __future__ import annotations

import json
import secrets
import time
from pathlib import Path

# Enough to scroll back through a few weeks of work without the file
# growing without bound.
MAX_ITEMS = 4000

# How much of the file's end is read when the panel is rebuilt.  Every edit
# stores the whole file before and after, so a hundred edits to a chapter is
# ten megabytes -- and this used to read all of it, parse all of it, and
# then keep the last four thousand lines.
TAIL_BYTES = 4_000_000

# Above this the file is rewritten down to what `items()` would return.
# Checked on append, which is cheap: one stat.
COMPACT_ABOVE_BYTES = 24_000_000


class Transcript:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._buffer: list[str] = []
        self._counter = 0
        self._appends = 0

    # -- writing -----------------------------------------------------------
    def _append(self, item: dict) -> None:
        item.setdefault("at", time.time() * 1000)
        try:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(item, default=str) + "\n")
        except (OSError, TypeError, ValueError):
            # A tool argument that will not serialise must not cost the
            # record of everything after it; `default=str` handles almost
            # all of them, and the rest are dropped rather than fatal.
            return
        self._appends += 1
        if self._appends % 64 == 0:
            self._compact_if_large()

    def _compact_if_large(self) -> None:
        """Cut the file down to what would ever be read back."""
        try:
            if self.path.stat().st_size < COMPACT_ABOVE_BYTES:
                return
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return
        keep = lines[-MAX_ITEMS * 2:]
        temp = self.path.with_name(self.path.name + ".tmp")
        try:
            temp.write_text("\n".join(keep) + "\n", encoding="utf-8")
            temp.replace(self.path)
        except OSError:
            temp.unlink(missing_ok=True)

    def archive(self) -> str | None:
        """Set this conversation aside and start an empty one.

        Renamed rather than deleted.  The transcript is the record of what
        an assistant did to somebody's dissertation -- every edit with its
        diff, every command allowed or refused -- and starting a new
        conversation is not a reason to lose it.

        The buffer is flushed into the outgoing file first, so a half-
        streamed paragraph ends up in the conversation it belongs to rather
        than at the top of the new one.
        """
        self._flush_text()
        self._buffer.clear()
        self._counter = 0
        self._appends = 0
        if not self.path.exists():
            return None
        stamp = time.strftime("%Y%m%d-%H%M%S")
        target = self.path.with_name(f"transcript-{stamp}.jsonl")
        attempt = 2
        while target.exists():
            target = self.path.with_name(f"transcript-{stamp}-{attempt}.jsonl")
            attempt += 1
        try:
            self.path.rename(target)
        except OSError:
            return None
        # The next append recreates the file, and `_tail` already copes with
        # it not being there in the meantime.
        return target.name

    def _flush_text(self) -> None:
        if not self._buffer:
            return
        text = "".join(self._buffer)
        self._buffer.clear()
        if text.strip():
            self._append({"kind": "claude", "text": text})

    def record(self, event: dict) -> dict:
        """Note one event, and hand it back (possibly with an id added)."""
        kind = event.get("type")

        if kind == "turn_start":
            self._flush_text()
            self._append({"kind": "user", "text": event.get("prompt", "")})
        elif kind == "text":
            self._buffer.append(event.get("text", ""))
        elif kind in {"text_end", "done"}:
            self._flush_text()
        elif kind == "tool_use":
            self._flush_text()
            self._append({
                "kind": "tool",
                "id": event.get("id", ""),
                "name": event.get("name", ""),
                "input": event.get("input") or {},
            })
        elif kind == "edit":
            self._counter += 1
            # Unique across restarts, not just within one process: an undo
            # recorded against an id has to still mean this edit tomorrow.
            event["id"] = (
                event.get("id")
                or f"edit-{int(time.time() * 1000)}-{secrets.token_hex(3)}"
            )
            self._append({
                "kind": "edit",
                "id": event["id"],
                "path": event.get("path", ""),
                "before": event.get("before", ""),
                "after": event.get("after", ""),
            })
        elif kind == "permission":
            self._flush_text()
            self._append({
                "kind": "permission",
                "id": event.get("id", ""),
                "tool": event.get("tool", ""),
                "rule": event.get("rule", ""),
                "headline": event.get("headline", ""),
                "detail": event.get("detail", ""),
                "consequence": event.get("consequence", ""),
            })
        elif kind == "error":
            self._flush_text()
            self._append({"kind": "notice", "text": event.get("message", "")})
        return event

    def note_decision(self, request_id: str, decision: str) -> None:
        self._append({"kind": "decision", "id": request_id, "decision": decision})

    def note_revert(self, edit_id: str, state: str) -> None:
        self._append({"kind": "edit_state", "id": edit_id, "state": state})

    # -- reading -----------------------------------------------------------
    def _tail(self) -> list[str]:
        """The end of the file, without reading the beginning of it."""
        try:
            with self.path.open("rb") as handle:
                handle.seek(0, 2)
                size = handle.tell()
                handle.seek(max(0, size - TAIL_BYTES))
                data = handle.read()
        except OSError:
            return []
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()
        # The first line is a fragment unless the read started at the top.
        if size > TAIL_BYTES and lines:
            lines = lines[1:]
        return lines

    def items(self) -> list[dict]:
        """The transcript, with decisions and reverts already applied."""
        lines = self._tail()

        items: list[dict] = []
        index: dict[str, dict] = {}
        for line in lines[-MAX_ITEMS * 2:]:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = item.get("kind")
            if kind == "decision":
                target = index.get(item.get("id", ""))
                if target:
                    target["decision"] = item.get("decision")
                continue
            if kind == "edit_state":
                target = index.get(item.get("id", ""))
                if target:
                    target["state"] = item.get("state")
                continue
            items.append(item)
            if item.get("id"):
                index[item["id"]] = item
        return items[-MAX_ITEMS:]
