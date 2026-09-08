"""Two installs, sharing one project, with no network in the room.

Everything here runs on the loopback transport: two `PeerNetwork`s in one
process, dialling each other through a hub of queues.  That is the only way
these can be tested at all -- `NEXTTEX_INSTANCE` cannot give you two peers
inside one pytest process, because `server/main.py` builds its settings and
registry at import time.

The two things being defended are the ones that fail silently.

**Admission.**  A brand-new invitee is not a member yet, so the invite is the
only way in and it must be exactly one way in: once, for this share, and
never again.

**Convergence.**  Two peers edit the same file while they cannot see each
other, then can.  Nobody is refused and nothing is lost.  A merge that went
wrong here would not raise; it would quietly duplicate a paragraph on every
machine at once.
"""

import asyncio
import os

import pytest

os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from nexttex.project import Project                              # noqa: E402
from server.collab import transport                              # noqa: E402
from server.collab.peers import PeerNetwork                      # noqa: E402
from server.collab.store import CollabStore                      # noqa: E402


@pytest.fixture(autouse=True)
def _clean_hub():
    transport.HUB.clear()
    yield
    transport.HUB.clear()


def make_project(tmp_path, name: str, text: str = "The shared chapter.\n") -> Project:
    root = tmp_path / name
    root.mkdir()
    (root / "main.tex").write_text(text)
    return Project.open(root)


class Peer:
    """One install: its documents, and its side of the network."""

    def __init__(self, project: Project, identity: str):
        self.project = project
        self.store = CollabStore(project)
        self.store.adopt()
        self.network = PeerNetwork(self.store)
        self.network._me = identity

    async def close(self):
        await self.network.close()
        self.store.close()

    def body(self, relative="main.tex"):
        return self.store.body(self.store.file_id_for(relative))

    def text(self, relative="main.tex") -> str:
        body = self.body(relative)
        return str(body) if body is not None else ""


async def settle(seconds: float = 0.4) -> None:
    """Let the queues drain. Everything here is local, so this is short."""
    await asyncio.sleep(seconds)


# --- sharing ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_sharing_makes_this_peer_a_member(tmp_path):
    alice = Peer(make_project(tmp_path, "alice"), "a" * 64)
    alice.network.begin_sharing("Alice")
    assert alice.network.share.shared
    assert alice.network.share.allows("a" * 64)
    await alice.close()


@pytest.mark.asyncio
async def test_sharing_twice_does_not_mint_a_second_share(tmp_path):
    alice = Peer(make_project(tmp_path, "alice"), "a" * 64)
    alice.network.begin_sharing("Alice")
    first = alice.network.share.share_id
    alice.network.begin_sharing("Alice")
    assert alice.network.share.share_id == first
    await alice.close()


@pytest.mark.asyncio
async def test_the_share_survives_a_restart(tmp_path):
    project = make_project(tmp_path, "alice")
    alice = Peer(project, "a" * 64)
    alice.network.begin_sharing("Alice")
    share_id = alice.network.share.share_id
    await alice.close()

    again = Peer(project, "a" * 64)
    assert again.network.share.share_id == share_id
    assert again.network.share.allows("a" * 64)
    await again.close()


# --- joining ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_invite_lets_a_stranger_in_once(tmp_path):
    alice = Peer(make_project(tmp_path, "alice"), "a" * 64)
    bob = Peer(make_project(tmp_path, "bob", ""), "b" * 64)

    alice.network.begin_sharing("Alice")
    await alice.network.start()
    invite = alice.network.invite()

    assert await bob.network.join(invite, "Bob") == ""
    await settle()

    # Alice now knows Bob, by the id the transport authenticated rather than
    # by anything Bob said about himself.
    assert alice.network.share.allows("b" * 64)
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_the_same_invite_cannot_be_used_twice(tmp_path):
    alice = Peer(make_project(tmp_path, "alice"), "a" * 64)
    bob = Peer(make_project(tmp_path, "bob", ""), "b" * 64)
    carol = Peer(make_project(tmp_path, "carol", ""), "c" * 64)

    alice.network.begin_sharing("Alice")
    await alice.network.start()
    invite = alice.network.invite()

    await bob.network.join(invite, "Bob")
    await settle()
    await carol.network.join(invite, "Carol")
    await settle()

    assert alice.network.share.allows("b" * 64)
    assert not alice.network.share.allows("c" * 64)
    for peer in (alice, bob, carol):
        await peer.close()


@pytest.mark.asyncio
async def test_a_stranger_with_no_invite_is_refused(tmp_path):
    alice = Peer(make_project(tmp_path, "alice"), "a" * 64)
    mallory = Peer(make_project(tmp_path, "mallory", ""), "m" * 64)

    alice.network.begin_sharing("Alice")
    await alice.network.start()

    from server.collab.peers import _unwrap, _wrap

    payload = _unwrap(alice.network.invite())
    payload["secret"] = "not-a-real-secret"
    assert await mallory.network.join(_wrap(payload), "Mallory") == ""
    await settle()

    assert not alice.network.share.allows("m" * 64)
    assert mallory.text() == ""       # and got nothing
    await alice.close()
    await mallory.close()


@pytest.mark.asyncio
async def test_an_invite_for_another_project_is_refused(tmp_path):
    alice = Peer(make_project(tmp_path, "alice"), "a" * 64)
    bob = Peer(make_project(tmp_path, "bob", ""), "b" * 64)

    alice.network.begin_sharing("Alice")
    await alice.network.start()

    from server.collab.peers import _unwrap, _wrap

    payload = _unwrap(alice.network.invite())
    payload["share"] = "0" * 32
    await bob.network.join(_wrap(payload), "Bob")
    await settle()

    assert not alice.network.share.allows("b" * 64)
    await alice.close()
    await bob.close()


# --- the documents ---------------------------------------------------------


async def joined(tmp_path):
    """Alice sharing, Bob joined, both settled."""
    alice = Peer(make_project(tmp_path, "alice"), "a" * 64)
    bob = Peer(make_project(tmp_path, "bob", ""), "b" * 64)
    alice.network.begin_sharing("Alice")
    await alice.network.start()
    alice.body()                       # open the document before offering it
    await bob.network.join(alice.network.invite(), "Bob")
    await settle(0.6)
    return alice, bob


@pytest.mark.asyncio
async def test_a_joiner_receives_the_project(tmp_path):
    alice, bob = await joined(tmp_path)
    assert bob.store.file_id_for("main.tex") is not None
    assert bob.text() == "The shared chapter.\n"
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_joiner_starts_empty_so_nothing_is_duplicated(tmp_path):
    """The Yjs footgun this design could have walked into.

    Two documents built independently from identical text merge into *both*
    copies -- every line twice -- and nothing raises. The joiner therefore
    starts from nothing and receives the whole state.
    """
    alice, bob = await joined(tmp_path)
    assert bob.text().count("The shared chapter.") == 1
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_typing_on_one_peer_reaches_the_other(tmp_path):
    alice, bob = await joined(tmp_path)
    alice.body().insert(0, "% Alice wrote this\n")
    await settle()
    assert "% Alice wrote this" in bob.text()
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_it_reaches_the_other_peers_disk(tmp_path):
    alice, bob = await joined(tmp_path)
    alice.body().insert(0, "% Alice wrote this\n")
    await settle()
    bob.store.flush()
    assert "% Alice wrote this" in (bob.project.root / "main.tex").read_text()
    await alice.close()
    await bob.close()


# --- being apart, and coming back -----------------------------------------


@pytest.mark.asyncio
async def test_both_peers_keep_their_work_across_a_partition(tmp_path):
    """The one the whole feature is for.

    Bob shuts his laptop on a train. Both of them write. He opens it again.
    Neither is refused, neither loses anything, and both hold the same text.
    """
    alice, bob = await joined(tmp_path)

    await transport.HUB.sever()
    alice.body().insert(0, "% written while apart, by Alice\n")
    bob.body().insert(len(bob.text()), "% written while apart, by Bob\n")
    await settle()

    # Genuinely apart: neither has heard the other.
    assert "by Bob" not in alice.text()
    assert "by Alice" not in bob.text()

    await transport.HUB.heal()
    await settle(0.8)

    for peer in (alice, bob):
        assert "% written while apart, by Alice" in peer.text()
        assert "% written while apart, by Bob" in peer.text()
    assert alice.text() == bob.text()

    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_the_two_peers_files_agree_after_healing(tmp_path):
    alice, bob = await joined(tmp_path)
    await transport.HUB.sever()
    alice.body().insert(0, "% Alice\n")
    bob.body().insert(len(bob.text()), "% Bob\n")
    await settle()
    await transport.HUB.heal()
    await settle(0.8)

    alice.store.flush()
    bob.store.flush()
    assert (alice.project.root / "main.tex").read_text() == \
        (bob.project.root / "main.tex").read_text()
    await alice.close()
    await bob.close()


# --- removal ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_removing_a_peer_disconnects_it(tmp_path):
    alice, bob = await joined(tmp_path)
    assert alice.network.share.allows("b" * 64)

    alice.network.remove("b" * 64)
    await settle()

    assert not alice.network.share.allows("b" * 64)
    assert "b" * 64 not in alice.network.links
    await alice.close()
    await bob.close()


@pytest.mark.asyncio
async def test_a_removed_peer_keeps_what_it_already_had(tmp_path):
    """Stated as a test because it is a promise the interface makes: removal
    disconnects, it does not retract."""
    alice, bob = await joined(tmp_path)
    alice.body().insert(0, "% before the removal\n")
    await settle()

    alice.network.remove("b" * 64)
    await settle()

    assert "% before the removal" in bob.text()
    await alice.close()
    await bob.close()


# --- what the interface is told --------------------------------------------


@pytest.mark.asyncio
async def test_the_state_names_the_members(tmp_path):
    alice, bob = await joined(tmp_path)
    state = alice.network.state()
    assert state["shared"] is True
    assert state["me"] == "a" * 64
    peers = {member["peer"] for member in state["members"]}
    assert peers == {"a" * 64, "b" * 64}
    await alice.close()
    await bob.close()
