"""What each peer and this install last agreed a document said.

A paragraph merge needs three texts: this side's, the other side's, and
the one both held before they parted. The CRDT keeps the first two and not
the third, so it is written down here, per peer and per document, at the
moments the two are known to agree: a peer's state vector arrives, and it
names exactly what this install holds.

A checkpoint is the document's whole state as an update, which pycrdt can
rebuild a document from, and the peer's changes since are asked for
against its state vector, so the other side's text is that rebuilt
document with their changes applied. Peers in step hold the same state,
so a blob is kept once per content hash and the index points at it.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from nexttex.atomic import write_atomically

log = logging.getLogger("nexttex.collab")


def read_uint(data: bytes, at: int) -> tuple[int, int]:
    """A lib0 variable-length unsigned integer, and where the next begins."""
    value = shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, at
        shift += 7


def state_of(vector: bytes) -> dict[int, int]:
    """A Yjs state vector as client to clock, so two can be compared
    whatever order their entries were written in."""
    try:
        count, at = read_uint(vector, 0)
        out: dict[int, int] = {}
        for _ in range(count):
            client, at = read_uint(vector, at)
            clock, at = read_uint(vector, at)
            if clock:
                out[client] = clock
        return out
    except IndexError:
        return {}


class Agreed:
    def __init__(self, root: Path) -> None:
        self.dir = root / "agreed"
        self.index_path = self.dir / "index.json"
        #: peer id to document id to content hash.
        self.index: dict[str, dict[str, str]] = {}
        try:
            data = json.loads(self.index_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                self.index = {
                    str(peer): {str(d): str(h) for d, h in docs.items()}
                    for peer, docs in data.items() if isinstance(docs, dict)
                }
        except (OSError, json.JSONDecodeError, AttributeError):
            pass

    def get(self, peer: str, doc_id: str) -> bytes | None:
        digest = self.index.get(peer, {}).get(doc_id)
        if not digest:
            return None
        try:
            return (self.dir / f"{digest}.y").read_bytes()
        except OSError:
            return None

    def save(self, peer: str, doc_id: str, state: bytes) -> bool:
        """Note a state agreed with a peer; whether it is a new one."""
        digest = hashlib.sha256(state).hexdigest()[:32]
        if self.index.get(peer, {}).get(doc_id) == digest:
            return False
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            blob = self.dir / f"{digest}.y"
            if not blob.exists():
                write_atomically(blob, state)
        except OSError:
            log.warning("could not keep what %s agreed on for %s", peer[:8], doc_id)
            return False
        self.index.setdefault(peer, {})[doc_id] = digest
        self._write()
        return True

    def keep_only(self, peers: set[str], doc_ids: set[str]) -> None:
        """Forget peers who are gone and documents that are, and the blobs
        nothing points at any more."""
        changed = False
        for peer in list(self.index):
            if peer not in peers:
                del self.index[peer]
                changed = True
                continue
            for doc_id in list(self.index[peer]):
                if doc_id not in doc_ids:
                    del self.index[peer][doc_id]
                    changed = True
        if changed:
            self._write()

    def _write(self) -> None:
        try:
            write_atomically(self.index_path, json.dumps(self.index, indent=1))
        except OSError:
            return
        live = {digest for docs in self.index.values() for digest in docs.values()}
        try:
            for blob in self.dir.glob("*.y"):
                if blob.stem not in live:
                    blob.unlink(missing_ok=True)
        except OSError:
            pass
