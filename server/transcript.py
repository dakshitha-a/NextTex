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

# How many archived conversations a project keeps.  Deliberately generous,
# because these are the record of what an assistant did to somebody's
# dissertation and archiving renames rather than deletes on purpose.  But
# nothing removed one either, so a project that starts a new conversation
# every morning kept every morning it had ever had.
MAX_ARCHIVES = 50


class TranscriptError(Exception):
    """The record could not be filed away, and still holds what it held.

    Distinct from `None`, which means there was nothing to file: the route
    has to tell "you have no conversation to clear" from "your conversation
    is still here and I could not move it", because only the second is a
    reason to refuse.
    """


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
        """Cut the file down to what would ever be read back.

        This used to read the whole file, all twenty-four megabytes of it,
        and keep the last eight thousand lines.  Two things were wrong with
        that.  The read was the entire file rather than the part anybody
        ever looks at, on the event loop.  And a line count is not a size:
        every edit line holds the file before and after, so eight thousand
        of them can be larger than the threshold that triggered the
        compaction, and the next sixty-four appends would read the whole
        thing again, and the sixty-four after that.  Keeping exactly what
        `_tail` returns bounds the result in bytes instead, so compaction is
        guaranteed to make progress.
        """
        try:
            if self.path.stat().st_size < COMPACT_ABOVE_BYTES:
                return
        except OSError:
            return
        keep = self._tail()[-MAX_ITEMS * 2:]
        if not keep:
            return
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
        if not self.path.exists():
            self._buffer.clear()
            self._counter = 0
            self._appends = 0
            return None
        stamp = time.strftime("%Y%m%d-%H%M%S")
        target = self.path.with_name(f"transcript-{stamp}.jsonl")
        attempt = 2
        while target.exists():
            target = self.path.with_name(f"transcript-{stamp}-{attempt}.jsonl")
            attempt += 1
        # The rename first, and the in-memory record cleared only once it
        # has worked. It was the other way round, so a rename that failed
        # left the file where it was and the counters at zero: the panel
        # showed an empty conversation, the route reported success, and the
        # next thing said was appended to the end of the old file. `None`
        # meant both "there was nothing to file away" and "it would not go",
        # which the caller could not tell apart either.
        try:
            self.path.rename(target)
        except OSError as failure:
            raise TranscriptError(str(failure)) from failure
        self._buffer.clear()
        self._counter = 0
        self._appends = 0
        self._prune_archives()
        # The next append recreates the file, and `_tail` already copes with
        # it not being there in the meantime.
        return target.name

    def _prune_archives(self) -> None:
        """Keep the most recent archived conversations and no more.

        Sorted by name rather than by modification time, because the name
        carries the timestamp the archive was made at and the modification
        time does not survive copying a project from one machine to another.
        """
        try:
            archives = sorted(
                self.path.parent.glob("transcript-*.jsonl"), key=lambda old: old.name
            )
        except OSError:
            return
        for old in archives[:-MAX_ARCHIVES]:
            try:
                old.unlink()
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
            # The turn's plan is not part of the record of what was done to
            # the document, and recording it made that plain the hard way:
            # the panel draws it live from the same event and the transcript
            # replayed it as a tool row called `TodoWrite`, so a reload
            # turned the one readable thing about a long turn into protocol
            # noise. A rehearsal is not an action.
            if event.get("name") == "TodoWrite":
                return event
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
                # Which tool row this card belongs to. Kept in the record
                # as well as on the wire, because the panel is rebuilt from
                # the record on every reload and the pairing has to survive
                # that: without it the replay drew the command twice and
                # said "Ran" above a call that was denied.
                "toolId": event.get("toolId", ""),
                "headline": event.get("headline", ""),
                "detail": event.get("detail", ""),
                "consequence": event.get("consequence", ""),
                # Kept, and it was not.  This is the sentence saying which
                # rule put the card up, and the panel reads it back on
                # every reload, so a card was right until the writer
                # refreshed and silently reasonless afterwards.  It is the
                # one line on the card that distinguishes a gate the writer
                # chose from one they did not.
                "reason": event.get("reason", ""),
                # A card that arrives already answered carries its answer,
                # and this dropped it, which was the worst thing in the
                # record rather than the smallest.
                #
                # A decision normally arrives later, through
                # `note_decision`, when the browser answers.  Nobody
                # answers an automatic approval or a remembered rule, so
                # nothing ever wrote one down: the replay then found a card
                # with no decision, and it marks those as refused, on the
                # correct reasoning that a card still open when the window
                # closed can never be answered now.  So every action the
                # agent had taken without being asked came back after a
                # reload reading `Denied`.
                #
                # That is not a cosmetic bug. The whole case for the
                # positions that put up no cards is that the transcript is
                # the account of what was done, and the account was saying
                # the writer refused things that had actually happened.
                **({"decision": event["decision"]} if event.get("decision") else {}),
            })
        elif kind == "tool_done":
            # An amendment to the row already written, not a row of its
            # own: `items()` folds this onto the call it names, the way it
            # already does for a decision and a revert, so a duration
            # survives a reload without the transcript growing a second
            # entry per tool call.  Nothing is written for a call whose
            # duration is unknown, which is one whose start this process
            # never saw.
            if event.get("id") and event.get("ms") is not None:
                self._append({
                    "kind": "tool_ms",
                    "id": event["id"],
                    "ms": event["ms"],
                    "ok": bool(event.get("ok", True)),
                })
        elif kind in {"error", "notice"}:
            self._flush_text()
            # Two events, one item, and the tone is what tells them apart.
            # A `notice` is news and an `error` is a failure: the ten
            # minute permission timeout emits the first, saying NextTex
            # said no on the writer's behalf, and it used to reach neither
            # the transcript nor the panel, so a silent deny left no trace
            # anywhere.  Absent tone reads as "error", because every notice
            # written before this line existed came from an error.
            self._append({
                "kind": "notice",
                "text": event.get("message", ""),
                "tone": "error" if kind == "error" else "plain",
            })
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
            if kind == "tool_ms":
                target = index.get(item.get("id", ""))
                if target:
                    target["ms"] = item.get("ms")
                    target["ok"] = item.get("ok", True)
                continue
            items.append(item)
            if item.get("id"):
                index[item["id"]] = item
        return items[-MAX_ITEMS:]
