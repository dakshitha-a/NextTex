"""Joining a project, the whole way through.

Two installs, an invite, and a folder that starts empty and ends up holding
somebody else's paper.  The pieces are tested apart from each other
elsewhere; this is the one that would catch them being wired together
wrongly -- a join that appears to succeed and leaves an empty folder, or one
that arrives with every line of the file twice.
"""

import asyncio
import os

import pytest

os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from nexttex.project import Project                              # noqa: E402
from server.collab import transport                              # noqa: E402
from server.collab.peers import PeerNetwork                      # noqa: E402
from server.collab.store import CollabStore                      # noqa: E402

PAPER = """\\documentclass{article}
\\begin{document}

The opening paragraph of a paper somebody else wrote.

\\end{document}
"""


@pytest.fixture(autouse=True)
def _clean_hub():
    transport.HUB.clear()
    yield
    transport.HUB.clear()


async def sharing_peer(tmp_path):
    root = tmp_path / "theirs"
    root.mkdir()
    (root / "main.tex").write_text(PAPER)
    (root / "chapters").mkdir()
    (root / "chapters" / "one.tex").write_text("The first chapter.\n")

    store = CollabStore(Project.open(root))
    store.adopt()
    network = PeerNetwork(store)
    network._me = "a" * 64
    network.begin_sharing("The other person")
    await network.start()
    # Open them, so there is something to offer.
    for file_id, record in store.files.items():
        if record.get("kind") == "text":
            store.body(file_id)
    return store, network


@pytest.mark.asyncio
async def test_a_join_brings_the_whole_project(tmp_path):
    theirs, their_network = await sharing_peer(tmp_path)
    invite = their_network.invite()

    mine = tmp_path / "mine"
    mine.mkdir()
    store = CollabStore(Project.open(mine))
    network = PeerNetwork(store)
    network._me = "b" * 64

    assert await network.join(invite, "Me") == ""
    await asyncio.sleep(1.0)
    store.flush()

    assert (mine / "main.tex").read_text() == PAPER
    assert (mine / "chapters" / "one.tex").read_text() == "The first chapter.\n"

    await network.close()
    store.close()
    await their_network.close()
    theirs.close()


@pytest.mark.asyncio
async def test_nothing_arrives_twice(tmp_path):
    """The Yjs footgun: two documents built independently from the same text
    merge into *both* copies, and nothing raises."""
    theirs, their_network = await sharing_peer(tmp_path)
    mine = tmp_path / "mine"
    mine.mkdir()
    store = CollabStore(Project.open(mine))
    network = PeerNetwork(store)
    network._me = "b" * 64

    await network.join(their_network.invite(), "Me")
    await asyncio.sleep(1.0)
    store.flush()

    text = (mine / "main.tex").read_text()
    assert text.count("\\begin{document}") == 1
    assert text.count("The opening paragraph") == 1

    await network.close()
    store.close()
    await their_network.close()
    theirs.close()


@pytest.mark.asyncio
async def test_after_joining_the_two_stay_in_step(tmp_path):
    theirs, their_network = await sharing_peer(tmp_path)
    mine = tmp_path / "mine"
    mine.mkdir()
    store = CollabStore(Project.open(mine))
    network = PeerNetwork(store)
    network._me = "b" * 64
    await network.join(their_network.invite(), "Me")
    await asyncio.sleep(1.0)

    # They write; I see it.
    theirs.body(theirs.file_id_for("main.tex")).insert(0, "% from them\n")
    await asyncio.sleep(0.5)
    assert "% from them" in str(store.body(store.file_id_for("main.tex")))

    # I write; they see it.
    store.body(store.file_id_for("main.tex")).insert(0, "% from me\n")
    await asyncio.sleep(0.5)
    assert "% from me" in str(theirs.body(theirs.file_id_for("main.tex")))

    await network.close()
    store.close()
    await their_network.close()
    theirs.close()


@pytest.mark.asyncio
async def test_a_file_made_after_joining_reaches_the_other(tmp_path):
    theirs, their_network = await sharing_peer(tmp_path)
    mine = tmp_path / "mine"
    mine.mkdir()
    store = CollabStore(Project.open(mine))
    network = PeerNetwork(store)
    network._me = "b" * 64
    await network.join(their_network.invite(), "Me")
    await asyncio.sleep(1.0)

    (theirs.project.root / "chapters" / "two.tex").write_text("A new chapter.\n")
    theirs.ingest("chapters/two.tex", "A new chapter.\n")
    await asyncio.sleep(0.8)

    assert store.file_id_for("chapters/two.tex") is not None
    store.flush()
    assert (mine / "chapters" / "two.tex").read_text() == "A new chapter.\n"

    await network.close()
    store.close()
    await their_network.close()
    theirs.close()
