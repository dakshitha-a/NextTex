"""A comment whose text was replaced outside NextTex is shown as detached.

A thread on "converges quickly" survives small outside edits well: text
added above moves it, a rewording keeps it on the new words. But when
another editor or a pull replaces the whole paragraph, the fold into the
shared text is a character diff, which keeps the letters the old and new
paragraphs happen to share, and the thread's two positions land on those.
The probe (Q-054) found it left attached to "ly" from "entirely", with its
old quote, where typing the same change in the editor detaches it.
"""

import base64

import pytest
from pycrdt import Assoc, StickyIndex

from server.collab.comments import Comments

from .conftest import Peer

TEXT = "First paragraph.\n\nThe method converges quickly on every test case.\n\nLast.\n"
QUOTE = "converges quickly"


@pytest.mark.parametrize("new, detached", [
    ("A new opening.\n\n" + TEXT, False),
    (TEXT.replace("converges quickly", "converges slowly"), False),
    ("First paragraph.\n\nAn entirely different paragraph.\n\nLast.\n", True),
], ids=["text added before it", "reworded", "paragraph replaced"])
def test_an_outside_edit_moves_keeps_or_detaches_a_thread(tmp_path, new, detached):
    peer = Peer(tmp_path / "alice", {"main.tex": TEXT})
    file_id = peer.store.file_id_for("main.tex")
    text = peer.store.body(file_id)
    at = TEXT.encode().index(QUOTE.encode())

    def anchor(index, assoc):
        return base64.b64encode(StickyIndex.new(text, index, assoc).encode()).decode()

    comments = Comments(peer.store, lambda: {"name": "Alice", "peer": "me"})
    comments.create("main.tex", anchor(at, Assoc.AFTER),
                    anchor(at + len(QUOTE), Assoc.BEFORE), QUOTE, 3, "Stiff cases?")
    told = []
    peer.note_comments = lambda: told.append(True)
    (peer.project.root / "main.tex").write_text(new)
    peer.store.ingest("main.tex", new)
    [thread] = comments.listing()
    assert thread["detached"] is detached
    # The drawer reads threads again only when told, and an outside edit
    # changes no thread, so the fold tells it.
    assert told
    peer.store.close()
