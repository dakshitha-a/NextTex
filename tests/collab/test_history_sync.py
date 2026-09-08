"""What a file used to say, shared between installs.

Two things are being defended.

That a collaborator's versions arrive **attributed to them** -- a record
with no peer means "written here", so an unstamped line landing on your disk
would claim you wrote it.

And that syncing does not fight local thinning.  `_thin` drops old versions
on a retention schedule; a peer comparing sets would read those gaps as
things to send, send them, watch them thinned again, and do that for ever.
Cursors only move forward, so a dropped record is never asked for twice.
"""

import asyncio
import os

import pytest

os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from nexttex.history import History                              # noqa: E402
from nexttex.project import Project                              # noqa: E402
from server.collab import history_sync, transport                # noqa: E402
from server.collab.peers import PeerNetwork                      # noqa: E402
from server.collab.store import CollabStore                      # noqa: E402


@pytest.fixture(autouse=True)
def _clean_hub():
    transport.HUB.clear()
    yield
    transport.HUB.clear()


# --- the pieces ------------------------------------------------------------


def test_an_unstamped_line_is_stamped_on_the_way_out(tmp_path):
    """Every record written before collaboration existed has no peer, and
    means "here". Sent unstamped, a colleague would file the lot as theirs."""
    history = History(tmp_path / "h")
    # Two saves a moment apart are one version -- an editing burst coalesces
    # -- so what is asserted here is the stamping, not the count.
    history.record("main.tex", "one\n")
    history.record("main.tex", "two\n")

    lines, reached = history_sync.mine(history, "main.tex", "a" * 64, 0)
    assert lines and reached == len(lines)
    assert {line["peer"] for line in lines} == {"a" * 64}
    # And the log on this disk is untouched: the stamp is applied to the
    # copy that leaves, not to what is stored.
    assert all(v.peer == "" for v in history.versions("main.tex"))


def test_only_this_installs_own_lines_are_offered(tmp_path):
    """A peer's own log is a sequence only it extends, which is what makes a
    single number enough to say where the other has got to."""
    history = History(tmp_path / "h")
    history.record("main.tex", "mine\n", peer="a" * 64)
    history.record("main.tex", "theirs\n", peer="b" * 64)

    lines, _ = history_sync.mine(history, "main.tex", "a" * 64, 0)
    assert [line["sha"] for line in lines] == [
        v.sha for v in history.versions("main.tex") if v.peer == "a" * 64
    ]


def test_absorbing_is_idempotent(tmp_path):
    history = History(tmp_path / "h")
    history.record("main.tex", "ours\n")
    lines = [
        {"at": 1000.0, "sha": "a" * 64, "bytes": 4, "by": "you",
         "op": "edit", "peer": "b" * 64, "who": "Bob"},
    ]
    assert history_sync.absorb(history, "main.tex", lines) == 1
    assert history_sync.absorb(history, "main.tex", lines) == 0
    assert len(history.versions("main.tex")) == 2


def test_absorbed_lines_are_in_time_order(tmp_path):
    """So the panel reads as one story rather than as this machine's log
    followed by everybody else's."""
    history = History(tmp_path / "h")
    history.record("main.tex", "second\n")
    at = history.versions("main.tex")[0].at
    history_sync.absorb(history, "main.tex", [
        {"at": at - 5000, "sha": "b" * 64, "bytes": 1, "by": "you",
         "op": "edit", "peer": "b" * 64, "who": "Bob"},
    ])
    times = [v.at for v in history.versions("main.tex")]
    assert times == sorted(times)


def test_a_cursor_never_goes_backwards(tmp_path):
    """The property that stops thinning and syncing fighting."""
    cursors = history_sync.Cursors(tmp_path)
    cursors.advance("b" * 64, "file1", 10)
    cursors.advance("b" * 64, "file1", 4)
    assert cursors.at("b" * 64, "file1") == 10


def test_cursors_survive_a_restart(tmp_path):
    cursors = history_sync.Cursors(tmp_path)
    cursors.advance("b" * 64, "file1", 7)
    assert history_sync.Cursors(tmp_path).at("b" * 64, "file1") == 7


def test_thinning_does_not_make_a_record_come_back(tmp_path):
    """Three rounds of the exchange after a thin, with the cursor where it
    would be. A set difference would re-offer the dropped lines every time."""
    history = History(tmp_path / "h")
    for n in range(6):
        history.record("main.tex", f"draft {n}\n", peer="a" * 64)
    total = len(history.versions("main.tex"))

    # The other peer has taken everything so far.
    cursors = history_sync.Cursors(tmp_path)
    cursors.advance("a" * 64, "file1", total)

    # Some of them are thinned away here.
    kept = history.versions("main.tex")[2:]
    history._write_log("main.tex", kept)

    for _ in range(3):
        lines, reached = history_sync.mine(
            history, "main.tex", "a" * 64, cursors.at("a" * 64, "file1"),
        )
        assert lines == [], "a thinned record was offered again"
        cursors.advance("a" * 64, "file1", reached)
    assert len(history.versions("main.tex")) == len(kept)


# --- between two peers -----------------------------------------------------


class Peer:
    def __init__(self, root, text):
        root.mkdir()
        (root / "main.tex").write_text(text)
        self.project = Project.open(root)
        self.store = CollabStore(self.project)
        self.store.adopt()
        self.history = History(self.project.state_dir / "history")
        self.network = PeerNetwork(self.store, session=self)


@pytest.mark.asyncio
async def test_a_collaborators_versions_arrive_with_their_name(tmp_path):
    alice = Peer(tmp_path / "alice", "The chapter.\n")
    bob = Peer(tmp_path / "bob", "")
    alice.network._me = "a" * 64
    bob.network._me = "b" * 64

    alice.history.record("main.tex", "an earlier draft\n", who="Alice")
    alice.history.record("main.tex", "The chapter.\n", who="Alice")

    alice.network.begin_sharing("Alice")
    await alice.network.start()
    for file_id, record in alice.store.files.items():
        if record.get("kind") == "text":
            alice.store.body(file_id)

    assert await bob.network.join(alice.network.invite(), "Bob") == ""
    await asyncio.sleep(1.0)

    versions = bob.history.versions("main.tex")
    assert versions, "no history arrived"
    assert all(v.peer == "a" * 64 for v in versions)
    assert {v.who for v in versions} == {"Alice"}

    await alice.network.close()
    await bob.network.close()
    alice.store.close()
    bob.store.close()


@pytest.mark.asyncio
async def test_history_is_not_sent_twice(tmp_path):
    alice = Peer(tmp_path / "alice", "The chapter.\n")
    bob = Peer(tmp_path / "bob", "")
    alice.network._me = "a" * 64
    bob.network._me = "b" * 64
    for n in range(4):
        alice.history.record("main.tex", f"draft {n}\n", who="Alice")

    alice.network.begin_sharing("Alice")
    await alice.network.start()
    for file_id, record in alice.store.files.items():
        if record.get("kind") == "text":
            alice.store.body(file_id)
    await bob.network.join(alice.network.invite(), "Bob")
    await asyncio.sleep(1.0)

    before = len(bob.history.versions("main.tex"))
    # Everything offered again, as a reconnection would.
    for link in bob.network.links.values():
        link.offered.clear()
        await link.send_documents()
    await asyncio.sleep(0.8)

    assert len(bob.history.versions("main.tex")) == before

    await alice.network.close()
    await bob.network.close()
    alice.store.close()
    bob.store.close()
