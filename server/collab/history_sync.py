"""One file's past, moving between installs.

What is shared is *what exists*.  How deep a past each machine keeps is its
own business, because retention is a decision about a disk and disks are
local: two collaborators holding different depths of one file's history is
correct rather than a fault.  That principle is not in question here.  What
was wrong was everything built on top of it.

## What to ask for

"Everything you have that I do not" oscillates for ever.  `History._thin`
drops old versions on a retention schedule, a peer comparing sets reads those
gaps as things it should send, it sends them, the other peer thins them
again, and the two of them do that until somebody notices the logs growing.

So the question is "what have you recorded **after this moment**", and each
install keeps a *mark* per author per file saying where that moment is.  A
mark only ever moves forward, so a record that thinning has dropped is never
asked for again -- and, unlike the position in a list this used to be, no
amount of local thinning can move what a moment refers to.

The old scheme counted into `[v for v in versions if v.peer == them]`, which
is a list `record` rewrites, and thins, on every save.  When it shrank below
the number a peer was holding, the slice came back empty and everything after
it was skipped in silence.  Worse than running off the end was thinning from
the *middle*: later records slid down into ground the peer had already passed,
and were skipped while the records on either side of them arrived normally.

## Per author, not per link

A record's author is a property of the record and travels with it, so a peer
can pass on what it holds from somebody else.  That matters more than it
sounds: collaborators in different time zones are rarely online at the same
moment, and without relaying, two people who only ever meet a third never
exchange a single version.

Two rules keep relaying from becoming the oscillation this design exists to
avoid.  Nobody offers a peer that peer's own records -- checked by the sender,
so that a lost marks file on the asking side cannot defeat it.  And
`History.absorb` refuses any line claiming to be authored here, which is the
same rule from the other end, and is also what stops a member signing their
work with somebody else's name.

One consequence worth stating rather than hiding: with relaying, a third
install inherits the *depth* the relaying one kept, for anything older than
its own mark.  That is depth-is-local applied one hop out, and it is the same
answer as before.

## Migration

The marks live in a new file.  The old one held positions, and a position
read as a moment is a moment in 1970, so rather than reason about that the
old file is simply left alone and every author starts from the beginning
once.  Absorbing is idempotent, so the cost is one re-send of what both
machines already have.
"""

from __future__ import annotations

import json
from pathlib import Path

from nexttex.atomic import write_atomically
from nexttex.history import History

#: A file with a year of history behind it would otherwise arrive as a single
#: enormous message on the first connection of the day.
BATCH = 200


class Marks:
    """How far into each author's past this install has got, per file."""

    def __init__(self, root: Path) -> None:
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / "history-marks.json"
        self.marks: dict[str, dict[str, float]] = {}
        self._dirty = False
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        if isinstance(data, dict):
            for author, files in data.items():
                if not isinstance(files, dict):
                    continue
                self.marks[str(author)] = {
                    str(file_id): float(at)
                    for file_id, at in files.items()
                    if isinstance(at, (int, float))
                }

    def at(self, author: str, file_id: str) -> float:
        return float(self.marks.get(author, {}).get(file_id, 0.0))

    def since(self, file_id: str) -> dict[str, float]:
        """Every author we hold anything of for this file, and how far.

        An author absent from this is one we have nothing from, which the
        other side reads as "send me all of theirs".  So the first ask, when
        we know of nobody, is an empty map and asks for everything -- which
        is why nothing has to work out the author list in advance.
        """
        return {
            author: files[file_id]
            for author, files in self.marks.items()
            if file_id in files
        }

    def advance(self, author: str, file_id: str, to: float) -> bool:
        """Move a mark forward. Never backwards, and say whether it moved.

        A mark that could go back is a mark that can ask for a thinned
        record again, and the answer would be the same gap for ever.  The
        return value is what stops a paging loop: nothing moved means there
        is nothing more to ask for, whatever the other side said.
        """
        if not author or to <= self.at(author, file_id):
            return False
        self.marks.setdefault(author, {})[file_id] = to
        self._dirty = True
        return True

    def save(self) -> None:
        """Write the marks out, if anything moved.

        Called on a timer rather than per frame.  It used to flush the file
        and its directory on the event loop once for every batch of lines
        absorbed, which is a real fsync per network frame.
        """
        if not self._dirty:
            return
        self._dirty = False
        try:
            write_atomically(self.path, json.dumps(self.marks))
        except OSError:
            self._dirty = True


def offer(
    history: History,
    relative: str,
    me: str,
    requester: str,
    since: dict[str, float],
) -> tuple[list[dict], dict[str, float]]:
    """Everything held for one file that the requester has not got.

    Returns the lines, and per author the latest moment actually sent, which
    is where the requester's mark moves to.  Only authors that appear in the
    lines appear there, so a mark never moves past something not delivered.

    A record with no `peer` was written here before this project was shared,
    and is stamped with `me` on the way out.  A record that *has* one keeps
    it: stamping everything with this install's id would file every relayed
    line under the relay, which is the one mistake that would key the whole
    scheme on the wrong author.
    """
    candidates: list[tuple[float, str, object]] = []
    for version in history.versions(relative):
        author = version.peer or me
        if not author or author == requester:
            # Never their own records back.  Checked here rather than
            # trusted to their marks, because a marks file that was lost or
            # never written would otherwise ask for them, take them, and
            # start the retention argument this design exists to prevent.
            continue
        if version.at <= since.get(author, 0.0):
            continue
        candidates.append((version.at, author, version))
    candidates.sort(key=lambda item: (item[0], item[1]))

    lines: list[dict] = []
    reached: dict[str, float] = {}
    previous: tuple[float, str] | None = None
    for at, author, version in candidates:
        here = (at, author)
        if len(lines) >= BATCH and here != previous:
            # A tie is never split across the boundary.  The mark moves to
            # the last moment sent, so a record sharing that moment with one
            # that went would be skipped on the next ask and never sent at
            # all.  `record` keeps an author's moments apart, but a log
            # written before it did may still hold ties.
            break
        record = version.as_dict()
        record["peer"] = author
        lines.append(record)
        if at > reached.get(author, 0.0):
            reached[author] = at
        previous = here
    return lines, reached


def mine(
    history: History, relative: str, me: str, after: int,
) -> tuple[list[dict], int]:
    """The old shape: this install's own lines, counted from a position.

    Kept only to answer an install that still asks in the old shape, which
    would otherwise take a map where it expects a number.  It carries the
    defect this module was rewritten to fix -- the list it counts into is one
    thinning shortens -- and there is no way to answer that question better
    than the question allows.
    """
    lines: list[dict] = []
    ours = [v for v in history.versions(relative) if (v.peer or me) == me]
    for version in ours[after:after + BATCH]:
        record = version.as_dict()
        record["peer"] = me
        lines.append(record)
    return lines, min(len(ours), after + BATCH)
