"""Keeping a CRDT document on disk, between one run of the server and the next.

A Yjs document is a log of updates, and merging two of them is the same
operation whether they arrived a millisecond apart over a socket or a week
apart from a file.  So persistence here is the simplest thing that is also
correct: append every update as it happens, and read them all back on open.

That log grows forever, which is the one thing it must not do.  A document
whose updates outweigh a snapshot of itself several times over is compacted:
the whole thing is squashed into a single update and rewritten.  The ratio is
deliberately generous.  Compaction is the expensive operation and an editing
session is a long run of tiny appends, so paying for a rewrite every few
hundred keystrokes would be worse than carrying some slack.

The file format is a sequence of `[4-byte big-endian length][update]` records
with a short magic header, which makes a truncated tail -- a machine that lost
power mid-append -- recoverable rather than fatal: everything up to the last
complete record is still a valid document, because every prefix of an update
log is.

None of this is git, and none of it is the version history in
`nexttex/history.py`.  That records what a *file* said, for a person to read;
this records what the *document* is, for a machine to merge.
"""

from __future__ import annotations

import struct
from pathlib import Path

from pycrdt import Doc

from nexttex.atomic import write_atomically

MAGIC = b"NTXY\x01"
HEADER = len(MAGIC)

# Compact once the appended updates are this many times the size of a
# snapshot.  Higher than it looks like it should be, on purpose: see above.
COMPACT_RATIO = 8

# Below this, a log is never worth compacting whatever the ratio says --
# eight times nothing is still nothing.
COMPACT_FLOOR = 64 * 1024


def load(path: Path, doc: Doc) -> int:
    """Apply everything in `path` to `doc`. Returns the bytes read, or -1.

    **-1 means there was no log at all**, and it is a different thing from 0,
    which means there was one and nothing could be read out of it.  The
    caller has to tell them apart: a document with no log has never existed
    here and can safely be built from the file on disk, while one whose log
    is unreadable is a document that *does* exist somewhere -- possibly on
    another person's machine -- and rebuilding it from disk would merge as a
    second, independent copy of every line.
    """
    try:
        blob = path.read_bytes()
    except OSError:
        return -1
    if len(blob) < HEADER or not blob.startswith(MAGIC):
        return 0

    offset = HEADER
    total = len(blob)
    while offset + 4 <= total:
        (length,) = struct.unpack_from(">I", blob, offset)
        offset += 4
        if length == 0 or offset + length > total:
            # A torn write at the end of the file.  Everything before it is
            # a complete document; this record never finished being made.
            break
        try:
            doc.apply_update(blob[offset:offset + length])
        except Exception:
            # One corrupt record must not cost the whole document, and the
            # ones after it may still apply -- Yjs updates are unordered.
            pass
        offset += length
    return offset


def append(path: Path, update: bytes) -> None:
    """Add one update to the log, creating it if it is not there yet."""
    if not update:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    record = struct.pack(">I", len(update)) + update
    exists = path.exists()
    with open(path, "ab") as handle:
        if not exists:
            handle.write(MAGIC)
        handle.write(record)


def snapshot(path: Path, doc: Doc) -> None:
    """Replace the log with a single update carrying the whole document."""
    update = doc.get_update()
    write_atomically(path, MAGIC + struct.pack(">I", len(update)) + update)


def should_compact(path: Path, doc: Doc) -> bool:
    try:
        size = path.stat().st_size
    except OSError:
        return False
    if size < COMPACT_FLOOR:
        return False
    return size > COMPACT_RATIO * max(1, len(doc.get_update()))
