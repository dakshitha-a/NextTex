"""What two NextTex installs say to each other.

A frame is a one-byte kind, a four-byte big-endian length, a JSON header, and
an optional binary payload.  Small and boring on purpose: the interesting
bytes are the Yjs updates inside it, and those already have a format.

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

# What a frame can be.
HELLO = 1            # who I am, and the invite I was given if I have one
WELCOME = 2          # you are a member; here is what I know
DENIED = 3           # you are not, and why
SYNC = 4             # a y-protocols sync message, for one document
AWARE = 5            # a y-protocols awareness message, for one document
BLOB_WANT = 6        # send me the bytes with this sha256
BLOB_HAVE = 7        # here they are
HIST_WANT = 8        # what have you recorded for this file since index N
HIST_GIVE = 9        # these lines


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
        if head_len > MAX_FRAME or body_len > MAX_FRAME:
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


def hist_want(file_id: str, peer: str, cursor: int) -> bytes:
    return Frame(HIST_WANT, {"file": file_id, "peer": peer, "cursor": cursor}).encode()


def hist_give(file_id: str, peer: str, cursor: int, lines: list[dict]) -> bytes:
    return Frame(
        HIST_GIVE,
        {"file": file_id, "peer": peer, "cursor": cursor, "lines": lines},
    ).encode()
