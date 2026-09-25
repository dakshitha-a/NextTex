"""Q-009: two peers make the same new path apart, then their documents meet.

Not a check: a review driver, run by hand from the repository root with
`.venv/bin/python e2e/review/q009_same_path.py`.  Each peer writes
`chapters/03.tex` on its own disk and ingests it, the way the watcher does
for a file made in another editor, by the agent or by a pull.  The two
manifests and the two documents are then exchanged, which is what a sync
does when the link comes back, and both disks are printed.  At the time of
the probe the ids were equal and both disks held both chapters, one after
the other, with nothing said to either person.
"""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pycrdt import Doc
from tests.collab.conftest import Peer
from server.collab import transport

async def main(tmp: Path):
    transport.HUB.clear()
    alice = Peer(tmp / "alice", {"main.tex": "The paper.\n"}).be("a" * 16)
    bob = Peer(tmp / "bob", {"main.tex": "The paper.\n"}).be("b" * 16)
    # Each writes chapters/03.tex while apart.
    for peer, text in ((alice, "Alice's chapter three.\n"), (bob, "Bob's chapter three.\n")):
        f = peer.project.root / "chapters" / "03.tex"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
        peer.store.ingest("chapters/03.tex", text)
    a_id = alice.store.file_id_for("chapters/03.tex"); b_id = bob.store.file_id_for("chapters/03.tex")
    print("ids", a_id, b_id)
    for peer in (alice, bob):
        peer.store.body(peer.store.file_id_for("chapters/03.tex"))
    a_text = alice.store.body(a_id); b_text = bob.store.body(b_id)
    a_doc, b_doc = alice.store.texts[a_id], bob.store.texts[b_id]
    print("before: alice", repr(str(a_text)), "bob", repr(str(b_text)))
    # The manifests and the two texts meet, the way a sync delivers them.
    for src, dst in ((alice, bob), (bob, alice)):
        dst.store.manifest.apply_update(src.store.manifest.get_update())

    ua, ub = a_doc.get_update(), b_doc.get_update()
    b_doc.apply_update(ua); a_doc.apply_update(ub)
    print("after sync: alice", repr(str(a_text)))
    print("after sync: bob  ", repr(str(b_text)))
    bob.store.flush(); alice.store.flush()
    await asyncio.sleep(0.5)
    print("bob's disk:  ", repr((bob.project.root / "chapters/03.tex").read_text()))
    print("alice's disk:", repr((alice.project.root / "chapters/03.tex").read_text()))
    await alice.close(); await bob.close()

import tempfile
asyncio.run(main(Path(tempfile.mkdtemp(prefix="nexttex-q009-"))))
