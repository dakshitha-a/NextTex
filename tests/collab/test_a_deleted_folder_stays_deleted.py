"""Files deleted on one machine stay deleted on the other.

Found in a shared thesis on 13 November 2026. Its owner renumbered four
chapter folders on dak-n4, and the figures came back at the old paths on
dak-n4 twice: once after the move, and again after they were deleted
through the trash. The `.tex` files did not come back. There were two
causes, one on each machine, and each has a test here.

On the machine that followed the deletion, the history asked the store
for the key of each file it moved into the trash. The record had just
been flagged as deleted while the file was still on disk, so
`_key_for_here` read it as a file the manifest had never adopted and
walked the whole tree. That walk gave a fresh record to every file whose
deletion had not been followed yet, `settle_paths` then found each of
those paths live and skipped them, and the fresh records told the first
machine to fetch the files back. The laptop's trash held one figure out
of ninety-three, and the manifest gained ninety-three new records at the
old paths in one update.
"""

from __future__ import annotations

import pytest

from .conftest import Peer, join_up, until

PDF = b"%PDF-1.5\n" + bytes(range(256)) * 20

FILES = {
    "main.tex": "\\input{chapters/old/old}\n",
    "chapters/old/old.tex": "The chapter.\n",
    "chapters/old/si.tex": "The supplement.\n",
    "intro.tex": "Intro.\n",
    "methods.tex": "Methods.\n",
    "results.tex": "Results.\n",
    "discussion.tex": "Discussion.\n",
    "appendix.tex": "Appendix.\n",
}
FIGURES = ["chapters/old/figures/a.pdf", "chapters/old/figures/b.pdf",
           "chapters/old/figures/c.pdf"]


def make(peer_root, files):
    made = Peer(peer_root, dict(files))
    for name in FIGURES if files else []:
        target = made.project.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(PDF)
    made.store.adopt()
    # As the session binds it: the history files a version under the
    # store's id for the path, which is where the walk came from.
    made.history.bind(made.store.key_for, made.store.records())
    return made


def live(peer: Peer, path: str) -> list[str]:
    return [
        file_id for file_id, record in peer.store.files.items()
        if record.get("path") == path and not record.get("trashed")
    ]


@pytest.mark.asyncio
async def test_a_deletion_followed_into_the_trash_adopts_nothing_back(tmp_path):
    alice = make(tmp_path / "alice", FILES).be("a" * 64)
    bob = make(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    gone = FIGURES + ["chapters/old/old.tex", "chapters/old/si.tex"]
    assert await until(
        lambda: all((bob.project.root / p).exists() for p in gone), 10.0
    ), "the join never delivered the chapter"
    # Bob has seen every path once, the baseline a deletion is followed
    # from, as a machine that has had the project open for a while has.
    bob.store.flush()

    # Alice deletes the chapter through her trash, as the delete route does.
    entry = alice.trash.delete(alice.project.root / "chapters/old")
    for file in entry.files:
        alice.store.note_gone(file.path)
    alice.store.flush()

    assert await until(
        lambda: not any((bob.project.root / p).exists() for p in gone), 10.0
    ), "bob did not follow every deletion: " + ", ".join(
        p for p in gone if (bob.project.root / p).exists()
    )
    for _ in range(3):
        bob.store.flush()
        alice.store.flush()
    for path in gone:
        assert live(bob, path) == [], f"bob re-adopted {path}"
        assert live(alice, path) == [], f"{path} came back to alice"
        assert not (alice.project.root / path).exists(), f"{path} is back on alice's disk"

    await alice.close()
    await bob.close()
