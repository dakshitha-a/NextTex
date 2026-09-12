"""What two NextTex installs say to each other.

A frame is a one-byte kind, a four-byte header length, a four-byte payload
length, a JSON header, and an optional binary payload.  Small and boring on
purpose: the interesting bytes are the Yjs updates inside it, and those
already have a format.

The `sync` and `aware` payloads are **byte-for-byte what the browser's
WebSocket carries**.  That is the property worth protecting: one codec, two
carriers.  A peer's update goes into the same `handle_sync_message` a tab's
does, and a fix to syncing is a fix in one place rather than two that drift.

Nothing here is encrypted, and nothing here needs to be.  The transport
underneath is QUIC over TLS to the peer's public key: it is already
authenticated and already end-to-end encrypted, including through the relays
that carry it when two peers cannot reach each other directly, which see
ciphertext and endpoint ids and nothing else.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field

MAX_FRAME = 64 * 1024 * 1024

#: And a much smaller one for the *header*, which is JSON and is parsed on
#: the event loop before anything has looked at what kind of frame this is.
#: Every header this protocol sends is a handful of short fields: a share
#: id, a document id, a name, a content address. The largest legitimate one
#: is a WELCOME carrying the member list, which is a few hundred bytes per
#: member. Sixty-four megabytes of it was one `json.loads` that stops the
#: whole install for seconds, from any member, at any time.
MAX_HEADER = 256 * 1024

# What a frame can be.
HELLO = 1            # who I am, and the invite I was given if I have one
WELCOME = 2          # you are a member; here is what I know
DENIED = 3           # you are not, and why
SYNC = 4             # a y-protocols sync message, for one document
AWARE = 5            # a y-protocols awareness message, for one document
BLOB_WANT = 6        # send me the bytes with this sha256
BLOB_HAVE = 7        # here they are
HIST_WANT = 8        # what have you got for this file after these moments
HIST_GIVE = 9        # these lines, and how far each author's past now reaches
HIST_NEW = 10        # I have written new lines for this file

#: An unknown kind falls off the end of the handler's chain without a word,
#: so a frame added here is safe to send to an install that predates it.


@dataclass
class Frame:
    kind: int
    header: dict = field(default_factory=dict)
    payload: bytes = b""

    def encode(self) -> bytes:
        head = json.dumps(self.header, separators=(",", ":")).encode("utf-8")
        return (
            struct.pack(">BII", self.kind, len(head), len(self.payload))
            + head
            + self.payload
        )

    @classmethod
    def decode(cls, raw: bytes) -> "Frame":
        if len(raw) < 9:
            raise ValueError("frame too short")
        kind, head_len, body_len = struct.unpack_from(">BII", raw, 0)
        if head_len + body_len + 9 != len(raw):
            raise ValueError("frame length does not match its header")
        if head_len > MAX_HEADER:
            raise ValueError("frame header too large")
        if body_len > MAX_FRAME:
            raise ValueError("frame too large")
        head = json.loads(raw[9:9 + head_len].decode("utf-8"))
        if not isinstance(head, dict):
            raise ValueError("frame header is not an object")
        return cls(kind, head, raw[9 + head_len:])


def hello(share_id: str, name: str, colour: str, address: str,
          secret: str = "") -> bytes:
    return Frame(HELLO, {
        "share": share_id, "name": name, "colour": colour,
        "address": address, "secret": secret,
    }).encode()


def welcome(share_id: str, members: dict) -> bytes:
    return Frame(WELCOME, {"share": share_id, "members": members}).encode()


def denied(reason: str) -> bytes:
    return Frame(DENIED, {"reason": reason}).encode()


def sync(doc_id: str, message: bytes) -> bytes:
    return Frame(SYNC, {"doc": doc_id}, message).encode()


def aware(doc_id: str, message: bytes) -> bytes:
    return Frame(AWARE, {"doc": doc_id}, message).encode()


def blob_want(sha: str) -> bytes:
    return Frame(BLOB_WANT, {"sha": sha}).encode()


def blob_have(sha: str, data: bytes) -> bytes:
    return Frame(BLOB_HAVE, {"sha": sha}, data).encode()


def hist_want(file_id: str, peer: str, since: dict) -> bytes:
    """Ask for a file's past, from a moment per author.

    `since` rather than the `cursor` this used to carry, and a new field
    rather than the old one reused: the receiving side reads `cursor` with
    `int(...)`, so a map arriving in it would take an older install's link
    down.  An install that does not understand `since` reads it as absent,
    treats the ask as "from the beginning", and sends one batch; absorbing
    is idempotent, so the cost of that is bytes rather than duplicates.
    """
    return Frame(HIST_WANT, {"file": file_id, "peer": peer, "since": since}).encode()


def hist_give(file_id: str, peer: str, reached: dict, lines: list[dict]) -> bytes:
    """Hand over lines, and say how far each author's past now reaches."""
    return Frame(
        HIST_GIVE,
        {"file": file_id, "peer": peer, "reached": reached, "lines": lines},
    ).encode()


def hist_give_by_index(file_id: str, peer: str, cursor: int, lines: list[dict]) -> bytes:
    """The old shape, for an install that asked in the old shape."""
    return Frame(
        HIST_GIVE,
        {"file": file_id, "peer": peer, "cursor": cursor, "lines": lines},
    ).encode()


def hist_new(file_id: str) -> bytes:
    """Say that this file has a past it did not have a moment ago.

    History used to be asked for once, when a connection opened, and never
    again -- so two people working together for a week watched each other
    type continuously and never saw one another's versions until somebody's
    laptop closed.
    """
    return Frame(HIST_NEW, {"file": file_id}).encode()
