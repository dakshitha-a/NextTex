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


class Transcript:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._buffer: list[str] = []
        self._counter = 0

    # -- writing -----------------------------------------------------------
    def _append(self, item: dict) -> None:
        item.setdefault("at", time.time() * 1000)
        try:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(item) + "\n")
        except OSError:
            pass

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
    def items(self) -> list[dict]:
        """The transcript, with decisions and reverts already applied."""
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []

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
