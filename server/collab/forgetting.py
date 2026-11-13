"""Deleted records expire once every member has seen the deletion.

A shared project's record of a deleted file is a tombstone. It is what
tells a member who was away that the file went, so that their copy goes
too; without it, their NextTex finds a file with no record and adopts it
again. The NexusQC paper carried 2713 of them for 51 files on disk and
NX-TeraChem 2869 for 188, and every join sent them all.

So a tombstone is dropped once it has done its job, and then a grace
period later. Its job is done when every other member has held a copy of
the manifest that includes the deletion: this install notes, per member,
the last time that member's manifest state vector covered its own, which
it learns from the sync step 1 a link sends when it opens and every
`ACK_EVERY` seconds after. It also notes when it first saw each record
deleted. Both are this install's own clock, compared only with itself;
nothing here trusts another machine's time. A deletion seen at `seen` is
acknowledged by a member whose last covering state came at `acked >=
seen`, and when every member has acknowledged it the grace period starts.
`GRACE` is an undo window, not the safety: the acknowledgment is.

A member who never comes back holds every tombstone made after they left
for as long as they are a member. That is the safe default; removing them
from the share lets the rest expire.

When a record is gone, a dropped key in the manifest touches no file on any
disk: `CollabStore.settle_paths` follows only records that exist. The
history keeps the file's past under its old key, and `History.key_of` finds
it through its own map once the store no longer knows the path. What goes
is the history a later joiner would have been sent for the file, and the
link between a Trash restore and that past: the file comes back as a new
one.
"""

from __future__ import annotations

import json
from pathlib import Path

from nexttex.atomic import write_atomically

#: How long after every member has acknowledged a deletion its record is
#: kept, as a window in which a restore still finds the file's own record.
#: Chosen by Dakshitha on 13 November 2026.
GRACE = 30 * 24 * 3600.0

#: How often a live link offers its manifest state, so a member's
#: acknowledgment does not have to wait for the next reconnection.
ACK_EVERY = 600.0


def decide(
    trashed: set[str],
    members: set[str],
    seen: dict[str, float],
    cleared: dict[str, float],
    acked: dict[str, float],
    now: float,
    grace: float = GRACE,
) -> tuple[list[str], dict[str, float], dict[str, float]]:
    """Which deleted records to drop now, with the notes carried forward.

    `trashed` is every deleted record's id, `members` every other member
    whose acknowledgment counts. `seen` is when this install first saw each
    deletion, `cleared` when every member had acknowledged it, `acked` each
    member's last covering state. Pure, so it can be run against a real
    project without touching it. A record that is no longer deleted, a
    restore, loses its notes, so deleting it again starts its clock again.
    """
    seen = {k: v for k, v in seen.items() if k in trashed}
    cleared = {k: v for k, v in cleared.items() if k in trashed}
    for file_id in trashed:
        seen.setdefault(file_id, now)
    for file_id in trashed:
        if file_id in cleared:
            continue
        since = seen[file_id]
        if all(acked.get(member, -1.0) >= since for member in members):
            cleared[file_id] = now
    drop = sorted(f for f, at in cleared.items() if now - at >= grace)
    for file_id in drop:
        seen.pop(file_id, None)
        cleared.pop(file_id, None)
    return drop, seen, cleared


class Forgetting:
    """This install's notes on deletions and acknowledgments, kept beside
    the manifest as `forgetting.json`. Local: never shared, never synced."""

    def __init__(self, root: Path) -> None:
        self.path = root / "forgetting.json"
        self.seen: dict[str, float] = {}
        self.cleared: dict[str, float] = {}
        self.acked: dict[str, float] = {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        if isinstance(data, dict):
            for name in ("seen", "cleared", "acked"):
                part = data.get(name)
                if isinstance(part, dict):
                    setattr(self, name, {
                        str(k): float(v) for k, v in part.items()
                        if isinstance(v, (int, float))
                    })

    def save(self) -> None:
        try:
            write_atomically(self.path, json.dumps(
                {"seen": self.seen, "cleared": self.cleared, "acked": self.acked},
                indent=1, sort_keys=True,
            ), durable=False)
        except OSError:
            # Lost notes cost time, not safety: a deletion seen again is
            # seen later, and an acknowledgment is given again at the next
            # link.
            pass

    def acknowledged(self, member: str, now: float) -> None:
        if self.acked.get(member, -1.0) < now:
            self.acked[member] = now
            self.save()

    def due(self, trashed: set[str], members: set[str], now: float,
            grace: float = GRACE) -> list[str]:
        drop, seen, cleared = decide(
            trashed, members, self.seen, self.cleared, self.acked, now, grace,
        )
        if drop or seen != self.seen or cleared != self.cleared:
            self.seen, self.cleared = seen, cleared
            self.save()
        return drop
