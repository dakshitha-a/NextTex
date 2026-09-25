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
    # Shared, which is the only case two people can make one path apart:
    # `CollabStore.shared` reads this file.
    for peer in (alice, bob):
        marker = peer.project.state_dir / "collab" / "share.json"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("{}")
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
    # The manifests meet, then every document, the way a sync delivers them.
    for src, dst in ((alice, bob), (bob, alice)):
        dst.store.manifest.apply_update(src.store.manifest.get_update())
    for src, dst in ((alice, bob), (bob, alice)):
        for file_id, doc in list(src.store.texts.items()):
            dst.store.body(file_id)
            dst.store.texts[file_id].apply_update(doc.get_update())
    for _ in range(3):
        bob.store.flush(); alice.store.flush()
        await asyncio.sleep(0.3)
    for peer in (alice, bob):
        for name in ("chapters/03.tex", "chapters/03 (2).tex"):
            target = peer.project.root / name
            print(f"{peer.name}'s {name}:", repr(target.read_text() if target.exists() else None))
    await alice.close(); await bob.close()

import tempfile
asyncio.run(main(Path(tempfile.mkdtemp(prefix="nexttex-q009-"))))
