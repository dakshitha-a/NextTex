"""A comment on a paragraph, then that paragraph changed outside NextTex.

Not a check: a review driver, run by hand from the repository root with
`.venv/bin/python e2e/review/q054_comment_outside_edit.py`.  A thread is
made on a sentence the way the editor makes one, with sticky positions in
the shared text.  The file is then rewritten on disk, as another editor or
a pull would, three ways: the sentence kept with text added around it, the
sentence reworded, and the whole paragraph replaced.  After each, the
listing the Comments drawer reads is printed.
"""
import base64, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pycrdt import StickyIndex, Assoc
from tests.collab.conftest import Peer
from server.collab.comments import Comments

TEXT = "First paragraph.\n\nThe method converges quickly on every test case.\n\nLast.\n"
peer = Peer(Path(tempfile.mkdtemp(prefix="nexttex-q054-")) / "alice", {"main.tex": TEXT})
file_id = peer.store.file_id_for("main.tex")
text = peer.store.body(file_id)
quote = "converges quickly"
at = TEXT.encode().index(quote.encode())
enc = lambda i, a: base64.b64encode(StickyIndex.new(text, i, a).encode()).decode()
comments = Comments(peer.store, lambda: {"name": "Alice", "peer": "me"})
comments.create("main.tex", enc(at, Assoc.AFTER), enc(at + len(quote), Assoc.BEFORE),
                quote, 3, "Is this true for the stiff cases?")

def show(label):
    t = comments.listing()[0]
    whole = str(peer.store.body(file_id))
    a = StickyIndex.decode(base64.b64decode(t["start"]), text).get_index()
    b = StickyIndex.decode(base64.b64decode(t["end"]), text).get_index()
    covers = whole.encode()[a:b].decode(errors="replace")
    print(f"{label}: line={t['line']} detached={t['detached']} covers={covers!r}")

show("as made")
for label, new in (
    ("text added before it", "A new opening.\n\n" + TEXT),
    ("the sentence reworded", TEXT.replace("converges quickly", "converges slowly")),
    ("the paragraph replaced", "First paragraph.\n\nAn entirely different paragraph.\n\nLast.\n"),
):
    current = str(peer.store.body(file_id))
    base = new if label != "text added before it" else new
    (peer.project.root / "main.tex").write_text(new)
    peer.store.ingest("main.tex", new)
    show(label)
    TEXT = new
peer.store.close()
