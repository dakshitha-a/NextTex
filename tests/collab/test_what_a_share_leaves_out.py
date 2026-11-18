"""A link out of the project is not shared, and a file that is not UTF-8
is shared as its bytes.

The writer's answers of 17 November 2026. A link into another repository
was recorded as text and refused when read, so a joiner got an empty file
of its name; the NexusQC paper's fifteen `refs/` links did that. A Latin-1
build log was recorded as text too, and arrived empty. Now a link out of
the project is left out of the manifest, and a record made for one before
is retired, which moves a peer's empty copy into its trash and leaves the
sharer's link alone. A file whose bytes are not UTF-8 is recorded as a
binary, and one recorded as text before is recorded again, so its bytes
reach every peer.
"""

import pytest
from pycrdt import Map

from .conftest import Peer, join_up, settle, until

LATIN = "caf\xe9 au lait, cr\xe8me br\xfbl\xe9e\n".encode("latin-1")


def live(peer: Peer, path: str) -> list[str]:
    return [
        file_id for file_id, record in peer.store.files.items()
        if record.get("path") == path and not record.get("trashed")
    ]


@pytest.mark.asyncio
async def test_a_link_out_of_the_project_never_reaches_a_joiner(tmp_path):
    elsewhere = tmp_path / "another-repository"
    elsewhere.mkdir()
    (elsewhere / "notes.md").write_text("Somebody else's notes.\n")
    (elsewhere / "inside").mkdir()
    (elsewhere / "inside" / "deep.tex").write_text("Deep.\n")
    alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    (alice.project.root / "refs").mkdir()
    (alice.project.root / "refs" / "notes.md").symlink_to(elsewhere / "notes.md")
    (alice.project.root / "linked").symlink_to(elsewhere / "inside")
    alice.store.adopt()
    assert live(alice, "refs/notes.md") == [] and live(alice, "linked/deep.tex") == []
    # The tree still lists them for the writer, marked.
    tree = alice.project.tree()
    refs = next(c for c in tree["children"] if c["name"] == "refs")
    assert refs["children"][0]["link"] == "outside"

    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: (bob.project.root / "main.tex").exists())
    await settle()
    assert not (bob.project.root / "refs" / "notes.md").exists()
    assert not (bob.project.root / "linked").exists()
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_a_record_an_older_nexttex_made_for_a_link_is_retired(tmp_path):
    elsewhere = tmp_path / "another-repository"
    elsewhere.mkdir()
    (elsewhere / "notes.md").write_text("Somebody else's notes.\n")
    alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: (bob.project.root / "main.tex").exists())
    # As an older NextTex recorded it: text, and an empty file at Bob's.
    (alice.project.root / "refs").mkdir()
    (alice.project.root / "refs" / "notes.md").symlink_to(elsewhere / "notes.md")
    alice.store.files["ab" * 16] = Map({
        "path": "refs/notes.md", "kind": "text", "size": 23, "trashed": False,
    })
    assert await until(lambda: bob.store.file_id_for("refs/notes.md") is not None)
    # The empty file a join wrote for it.
    (bob.project.root / "refs").mkdir(exist_ok=True)
    (bob.project.root / "refs" / "notes.md").write_text("")
    bob.store.flush()

    alice.store.adopt()
    alice.store.flush()
    assert await until(lambda: not (bob.project.root / "refs" / "notes.md").exists(), 10.0), (
        "bob kept the empty copy"
    )
    for _ in range(3):
        alice.store.flush()
        await settle()
    assert (alice.project.root / "refs" / "notes.md").is_symlink()
    assert (elsewhere / "notes.md").read_text() == "Somebody else's notes.\n"
    assert live(alice, "refs/notes.md") == []
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_a_latin_1_log_arrives_byte_for_byte(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    (alice.project.root / "build.log").write_bytes(LATIN)
    alice.store.adopt()
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    target = bob.project.root / "build.log"
    assert await until(lambda: target.exists() and target.read_bytes() == LATIN, 10.0)
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_a_log_recorded_as_text_before_is_sent_again_as_bytes(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "The chapter.\n"}).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: (bob.project.root / "main.tex").exists())
    # As an older NextTex recorded it: text, arriving at Bob empty.
    (alice.project.root / "build.log").write_bytes(LATIN)
    alice.store.files["cd" * 16] = Map({
        "path": "build.log", "kind": "text", "size": len(LATIN), "trashed": False,
    })
    target = bob.project.root / "build.log"
    assert await until(lambda: bob.store.file_id_for("build.log") is not None)
    # The empty file a join wrote for it.
    target.write_bytes(b"")
    bob.store.flush()

    alice.store.adopt()
    alice.store.flush()
    ok = await until(lambda: target.exists() and target.read_bytes() == LATIN, 15.0)
    assert ok, (
        "bob never got the bytes"
    )
    assert (alice.project.root / "build.log").read_bytes() == LATIN
    assert [alice.store.files[i]["kind"] for i in live(alice, "build.log")] == ["blob"]
    await bob.close()
    await alice.close()
