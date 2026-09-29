"""One install with two shared projects is reachable in both.

Each shared project used to bind a network endpoint of its own under the
install's one key. Dialled by key, which is how members find each other
once an invite's addresses have gone stale, only one of them answered,
and a collaborator of the other project was told "that is not this
project" and backed off. In the loopback the second project's listener
simply replaced the first's.
"""

import pytest

from server.collab import peers as peers_module
from server.collab import transport

from .conftest import Peer, join_up, settle, until


@pytest.fixture(autouse=True)
def _quick(monkeypatch):
    monkeypatch.setattr(peers_module, "BACKOFF", [0.2])


@pytest.mark.asyncio
async def test_both_projects_of_one_install_take_their_collaborators_back(tmp_path):
    thesis = Peer(tmp_path / "thesis", {"main.tex": "Thesis.\n"}).be("a" * 64)
    paper = Peer(tmp_path / "paper", {"main.tex": "Paper.\n"}).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    carol = Peer(tmp_path / "carol", {}).be("c" * 64)
    await join_up(thesis, bob)
    await join_up(paper, carol, guest_name="Carol")
    bob.open_documents()
    carol.open_documents()

    def body(peer):
        return str(peer.store.body(peer.store.file_id_for("main.tex")))

    assert await until(lambda: body(bob) == "Thesis.\n" and body(carol) == "Paper.\n")
    # Every link drops, and each side dials the other again by key.
    await transport.HUB.cut()
    await settle(0.3)
    edit = thesis.store.file_id_for("main.tex")
    thesis.store.rewrite(edit, "Thesis, chapter one.\n")
    edit = paper.store.file_id_for("main.tex")
    paper.store.rewrite(edit, "Paper, abstract.\n")
    assert await until(lambda: body(bob) == "Thesis, chapter one.\n", 10.0), body(bob)
    assert await until(lambda: body(carol) == "Paper, abstract.\n", 10.0), body(carol)
    for peer in (thesis, paper, bob, carol):
        await peer.close()


@pytest.mark.asyncio
async def test_an_invite_to_the_first_project_is_answered_by_the_first(tmp_path):
    """With both projects listening, an invite names one of them; the
    joiner has only the invite and cannot be dialled back first."""
    thesis = Peer(tmp_path / "thesis", {"main.tex": "Thesis.\n"}).be("a" * 64)
    paper = Peer(tmp_path / "paper", {"main.tex": "Paper.\n"}).be("a" * 64)
    thesis.network.begin_sharing("Alice")
    await thesis.network.start()
    thesis.open_documents()
    paper.network.begin_sharing("Alice")
    await paper.network.start()
    paper.open_documents()
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    refused = await bob.network.join(thesis.network.invite(), "Bob")
    assert refused == ""
    bob.open_documents()
    await settle(0.5)
    assert bob.network.last_error == "", bob.network.last_error
    assert await until(lambda: (bob.project.root / "main.tex").exists()
                       and (bob.project.root / "main.tex").read_text() == "Thesis.\n", 10.0)
    for peer in (thesis, paper, bob):
        await peer.close()
