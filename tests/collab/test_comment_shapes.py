"""A peer's comment thread of any shape leaves the Comments drawer working.

Comments live on the shared manifest, and a peer's changes to it are
applied as they arrive, without the checks this install's own routes make.
The probe (Q-008) put threads there the way a sync would and asked for the
listing the drawer reads: a `line` that was text beside one that was a
number raised `TypeError` in the sort, and an empty anchor, valid base64
for no bytes, made pycrdt panic, which is a `BaseException` and went
straight past the `except Exception` written around exactly that call.
Either way the drawer failed for everyone on the project, and it is the
only place to delete the thread that broke it.
"""

import pytest
from pycrdt import Array, Map

from server.collab.comments import MAX_BODY, MAX_QUOTE, Comments

from .conftest import Peer


def put(peer: Peer, threads: dict) -> Comments:
    root = peer.store.comments
    with peer.store.manifest.transaction():
        for thread_id, fields in threads.items():
            root[thread_id] = Map(fields)
    return Comments(peer.store, lambda: {"name": "Alice", "peer": "me"})


def thread(file_id, **overrides):
    fields = {
        "file_id": file_id, "start": "!!", "end": "!!", "quote": "x",
        "line": 2, "created": 1.0,
        "messages": Array([Map({"body": "A comment.", "peer": "p"})]),
    }
    fields.update(overrides)
    return fields


@pytest.mark.parametrize("anchor", ["!!", ""], ids=["not base64", "empty"])
def test_a_listing_survives_anchors_and_lines_of_the_wrong_shape(tmp_path, anchor):
    peer = Peer(tmp_path / "alice", {"main.tex": "One line.\nTwo lines.\n"})
    file_id = peer.store.file_id_for("main.tex")
    comments = put(peer, {
        "c000000000001": thread(file_id, start=anchor, end=anchor, line=2),
        "c000000000002": thread(file_id, start=anchor, end=anchor, line="two"),
    })
    listing = comments.listing()
    assert len(listing) == 2
    assert all(t["detached"] for t in listing)
    assert all(isinstance(t["line"], int) and t["line"] >= 1 for t in listing)
    peer.store.close()


def test_a_peers_comment_is_held_to_the_local_limits(tmp_path):
    peer = Peer(tmp_path / "alice", {"main.tex": "One line.\n"})
    file_id = peer.store.file_id_for("main.tex")
    comments = put(peer, {"c000000000003": thread(
        file_id, quote="q" * 5000,
        messages=Array([Map({"body": "A comment " * 3000, "peer": 7})]),
    )})
    [listed] = comments.listing()
    assert len(listed["messages"][0]["body"]) <= MAX_BODY
    assert len(listed["quote"]) <= MAX_QUOTE
    assert isinstance(listed["messages"][0]["peer"], str)
    peer.store.close()
