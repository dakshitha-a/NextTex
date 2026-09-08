"""Sharing what a file used to say.

The working tree is a CRDT.  The version history is not, and should not be:
`.nexttex/history` is already an append-only log per file plus
content-addressed blobs, and the union of two peers' logs is the correct
merge.  A CRDT would add tombstones and ordering machinery to something that
already has the only property that matters.

## Why cursors rather than a set difference

The obvious design is "tell me what you have that I do not", and it
oscillates for ever.  `History._thin` drops old versions on a retention
schedule -- everything from the last day, hourly for a week, daily for three
months -- and a peer comparing sets sees those gaps as things it should
send.  It sends them, the other peer thins them again, and the two of them
do that until somebody notices the logs growing.

Every record has exactly one author, so each peer's contribution to a file's
log is a sequence that only that peer extends.  A cursor per (peer, file)
therefore says everything: send me what you have written since number N.  It
only moves forward, so a record that thinning has dropped is never asked for
again, and thinning stays what it should be -- a local decision about a
local disk.  Two collaborators may keep different depths of the same file's
history, and that is correct rather than a bug.

## The empty peer

A record with no `peer` means "written here", which is what every record
made before any of this existed says.  So a line is stamped with this
install's id **on the way out**: without that, a colleague's history would
arrive on your disk claiming that you wrote all of it.
"""

from __future__ import annotations

import json
from pathlib import Path

from nexttex.atomic import write_atomically
from nexttex.history import Version

# Never send more than this in one frame. A file with a year of history
# behind it would otherwise arrive as a single enormous message on the first
# connection of the day.
BATCH = 200


class Cursors:
    """How much of each peer's history this install already has."""

    def __init__(self, root: Path) -> None:
        self.path = root / "history-cursors.json"
        self.marks: dict[str, dict[str, int]] = {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self.marks = {str(k): dict(v) for k, v in data.items()}
        except (OSError, json.JSONDecodeError, AttributeError, TypeError):
            self.marks = {}

    def at(self, peer: str, file_id: str) -> int:
        return int(self.marks.get(peer, {}).get(file_id, 0))

    def advance(self, peer: str, file_id: str, to: int) -> None:
        """Move a cursor forward. Never backwards -- a cursor that could go
        back is a cursor that can ask for a thinned record again."""
        current = self.at(peer, file_id)
        if to <= current:
            return
        self.marks.setdefault(peer, {})[file_id] = to
        self.save()

    def save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            write_atomically(self.path, json.dumps(self.marks, indent=2))
        except OSError:
            pass


def mine(history, relative: str, me: str, after: int) -> tuple[list[dict], int]:
    """This install's own lines for a file, from `after` onwards.

    Returns the lines and the index they end at.  A record with an empty
    `peer` is stamped with `me` before it leaves: it was written here, and a
    colleague receiving it unstamped would file it as their own.
    """
    lines: list[dict] = []
    versions = history.versions(relative)
    ours = [v for v in versions if (v.peer or me) == me]
    for version in ours[after:after + BATCH]:
        record = version.as_dict()
        record["peer"] = me
        lines.append(record)
    return lines, min(len(ours), after + BATCH)


def absorb(history, relative: str, lines: list[dict]) -> int:
    """Take a peer's lines into this file's log. Returns how many were new.

    The blobs they refer to are not here yet, so a version arrives readable
    in the list and not yet openable; `blobs.py` fetches the contents on
    demand, which is the right way round -- almost nobody opens almost any
    old version, and a peer's whole history would otherwise be a download
    before the first keystroke.
    """
    existing = history.versions(relative)
    known = {(v.sha, round(v.at), v.peer) for v in existing}
    added = 0
    for raw in lines:
        try:
            version = Version.from_dict(raw)
        except (TypeError, ValueError):
            continue
        if not version.sha:
            continue
        if (version.sha, round(version.at), version.peer) in known:
            continue
        existing.append(version)
        known.add((version.sha, round(version.at), version.peer))
        added += 1

    if added:
        # In time order, so the panel reads as one story rather than as
        # this machine's followed by everybody else's.
        existing.sort(key=lambda v: v.at)
        history._write_log(relative, existing)
    return added
