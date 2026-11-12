"""A join waits for what the sharer can send, not for what it once recorded.

The joiner's wait held out until every text record with a recorded size had
a non-empty body. The size is written once, at adoption, and some files
the sharer holds as text it never reads: a link that leads out of the
project, which `Project.resolve` refuses, a file that is not UTF-8, or one
emptied since. The laptop waited the whole deadline on every attempt to
join a paper whose `refs/` held fifteen links into another repository, and
on every attempt at a folder of applications with one Latin-1 build log,
and was told the connection had gone quiet.
"""

import pytest

from server import main as server_main

from .conftest import Peer, join_up, settle, until


@pytest.mark.asyncio
async def test_a_link_out_of_the_project_does_not_stall_the_join(tmp_path):
    elsewhere = tmp_path / "another-repository"
    elsewhere.mkdir()
    (elsewhere / "notes.md").write_text("Somebody else's notes.\n")

    alice = Peer(tmp_path / "alice", {
        "main.tex": "The chapter.\n",
        "latin.log": "",
        "emptied.tex": "Text that is about to go.\n",
    }).be("a" * 64)
    (alice.project.root / "refs").mkdir()
    (alice.project.root / "refs" / "notes.md").symlink_to(elsewhere / "notes.md")
    (alice.project.root / "latin.log").write_bytes("caf\xe9 au lait\n".encode("latin-1"))
    alice.store.adopt()
    # Recorded with its size, then emptied before anybody joined.
    (alice.project.root / "emptied.tex").write_text("")
    assert alice.store.files[alice.store.file_id_for("refs/notes.md")]["kind"] == "text"

    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    bob.store.holding = True
    await join_up(alice, bob)

    reason = await server_main._wait_for_the_project(bob.store, seconds=10)

    assert reason == "", reason
    main_id = bob.store.file_id_for("main.tex")
    assert str(bob.store.body(main_id)) == "The chapter.\n"
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_an_edit_from_a_joiner_never_writes_through_the_link(tmp_path):
    """The joiner now holds an empty document where the sharer has a link
    into another repository. Typing into it there must not reach that
    repository: the sharer's projection resolves the path first, and a
    path that leaves the project is refused."""
    elsewhere = tmp_path / "another-repository"
    elsewhere.mkdir()
    (elsewhere / "notes.md").write_text("Somebody else's notes.\n")
    alice = Peer(tmp_path / "alice").be("a" * 64)
    (alice.project.root / "refs").mkdir()
    (alice.project.root / "refs" / "notes.md").symlink_to(elsewhere / "notes.md")
    alice.store.adopt()
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: bob.store.file_id_for("refs/notes.md") is not None)

    file_id = bob.store.file_id_for("refs/notes.md")
    text = bob.store.body(file_id)
    with text.doc.transaction():
        text += "Typed on the laptop.\n"
    alice_id = alice.store.file_id_for("refs/notes.md")
    assert await until(lambda: "Typed on the laptop" in str(alice.store.body(alice_id))), (
        "the edit never reached the sharer, so nothing here was tested"
    )
    alice.store.flush()
    await settle()

    assert (elsewhere / "notes.md").read_text() == "Somebody else's notes.\n"
    assert (alice.project.root / "refs" / "notes.md").is_symlink()
    await bob.close()
    await alice.close()


@pytest.mark.asyncio
async def test_what_never_came_is_named(tmp_path):
    """When the wait does run out, it says which files it was waiting for,
    which tells a slow link from a file the other end cannot send."""

    class Store:
        files = {"x": {"path": "chapters/one.tex", "kind": "text", "size": 9, "trashed": False}}
        answered: set = set()

        def body(self, file_id):
            return ""

    reason = await server_main._wait_for_the_project(Store(), seconds=0.3)

    assert "chapters/one.tex" in reason, reason
