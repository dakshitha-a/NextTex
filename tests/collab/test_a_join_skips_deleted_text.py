"""A join does not sync the text of files deleted before it.

The NexusQC paper's shared record held 2713 deleted files for 51 on disk,
and NX-TeraChem's 2869 for 188, so a join exchanged a sync step each way
for every one of them: 23,796 sync frames to join a 51-file paper. A
joiner never had a deleted file and has nothing to say about it. The text
of a file restored later is offered then, because a manifest change sends
the documents again and the restored one has not been offered yet.
History is still asked for, deleted files included, so a joiner can see
and restore a deleted file's past.
"""

import pytest

from .conftest import Peer, join_up, settle, until

GONE = [f"old/{n:02d}.tex" for n in range(30)]


@pytest.mark.asyncio
async def test_deleted_text_is_not_synced_and_a_restored_file_is(tmp_path):
    files = {"main.tex": "The chapter.\n"}
    files.update({path: f"Scratch {path}.\n" for path in GONE})
    alice = Peer(tmp_path / "alice", files).be("a" * 64)
    alice.store.adopt()
    for path in GONE:
        (alice.project.root / path).unlink()
        assert alice.store.note_gone(path)
    gone_ids = {fid for fid, r in alice.store.files.items() if r.get("trashed")}
    assert len(gone_ids) == len(GONE)

    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    main_id = alice.store.file_id_for("main.tex")
    assert await until(lambda: str(bob.store.body(main_id) or "") == "The chapter.\n")
    await settle()

    for peer in (alice, bob):
        for link in peer.network.links.values():
            offered = {d[len("text/"):] for d in link.offered if d.startswith("text/")}
            assert main_id in offered
            assert not offered & gone_ids, "a deleted file's text was offered"
            asked = {d[len("hist/"):] for d in link.offered if d.startswith("hist/")}
            assert gone_ids <= asked or peer is alice, "a deleted file's history was not asked for"

    back = alice.store.file_id_for("main.tex")  # unchanged, for contrast
    alice.store.untrash(GONE[0], GONE[0], "Back again.\n")
    restored = alice.store.file_id_for(GONE[0])
    assert restored in gone_ids and back == main_id
    assert await until(lambda: str(bob.store.body(restored) or "") == "Back again.\n"), (
        "a file restored after the join never reached the joiner"
    )
    await bob.close()
    await alice.close()
