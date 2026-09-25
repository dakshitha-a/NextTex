"""Q-008: a comment thread written by a peer, in a shape this install did not.

Not a check: a review driver, run by hand from the repository root with
`.venv/bin/python e2e/review/q008_comment_shape.py`.  Two threads land on
the shared manifest the way a peer's sync puts them there, straight into
the map: one as this install would write it, and one whose `line` is text.
The listing the Comments drawer reads is then asked for, twice: once with
anchors that are not base64 at all, which the code treats as detached and
keeps the peer's `line` as it came, and once with an empty anchor, which
is valid base64 for no bytes.
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pycrdt import Map, Array
from tests.collab.conftest import Peer
from server.collab.comments import Comments

peer = Peer(Path(tempfile.mkdtemp(prefix="nexttex-q008-")) / "alice",
            {"main.tex": "One line.\nTwo lines.\n"})
file_id = peer.store.file_id_for("main.tex")
root = peer.store.comments
comments = Comments(peer.store, lambda: {"name": "Alice", "peer": "me"})
for label, anchor in (("anchors that are not base64", "!!"), ("an empty anchor", "")):
    with peer.store.manifest.transaction():
        for key in list(root.keys()):
            del root[key]
        for thread_id, line in (("c000000000001", 2), ("c000000000002", "two")):
            root[thread_id] = Map({
                "file_id": file_id, "start": anchor, "end": anchor, "quote": "x",
                "line": line, "created": 1.0,
                "messages": Array([Map({"body": "A comment " * 3000, "peer": "p"})]),
            })
    try:
        listing = comments.listing()
        print(label + ":", len(listing), "threads, longest body",
              max(len(m.get("body", "")) for t in listing for m in t["messages"]))
    except BaseException as error:
        print(label + ": the listing raised", type(error).__name__, str(error)[:80])
peer.store.close()
