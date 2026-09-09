"""What a file used to say, shared between installs.

Two things are being defended.

That a collaborator's versions arrive **attributed to them** -- a record
with no peer means "written here", so an unstamped line landing on your disk
would claim you wrote it.

And that syncing does not fight local thinning.  `_thin` drops old versions
on a retention schedule; a peer comparing sets would read those gaps as
things to send, send them, watch them thinned again, and do that for ever.
A mark only moves forward, so a dropped record is never asked for twice.

The mark is a moment rather than a position in a list, which is the whole of
what changed.  A position counts into a list thinning takes entries out of, so
the two slid apart and everything that fell into the gap was skipped in
silence.  A moment is a moment whatever the list does to itself.
"""

import asyncio
import os

import pytest

os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from nexttex.history import History, now_ms                      # noqa: E402
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

    lines, reached = history_sync.offer(
        history, "main.tex", "a" * 64, "b" * 64, {},
    )
    assert lines
    assert {line["peer"] for line in lines} == {"a" * 64}
    assert reached == {"a" * 64: max(line["at"] for line in lines)}
    # And the log on this disk is untouched: the stamp is applied to the
    # copy that leaves, not to what is stored.
    assert all(v.peer == "" for v in history.versions("main.tex"))


def test_a_relaying_peer_offers_what_it_holds_for_others(tmp_path):
    """The opposite of what this used to assert, and deliberately.

    Offering only our own records means two collaborators who are never
    online at the same moment never exchange a single version, however long
    the project runs.  A record's author travels with the record, so passing
    on somebody else's costs nothing and is exact.
    """
    history = History(tmp_path / "h")
    history.me = "a" * 64
    history.record("main.tex", "mine\n", peer="a" * 64)
    history.absorb("main.tex", [
        {"at": now_ms(), "sha": "c" * 64, "bytes": 1, "peer": "c" * 64},
    ])

    lines, reached = history_sync.offer(
        history, "main.tex", "a" * 64, "b" * 64, {},
    )
    assert {line["peer"] for line in lines} == {"a" * 64, "c" * 64}
    assert set(reached) == {"a" * 64, "c" * 64}


def test_a_peer_is_never_offered_its_own_records(tmp_path):
    """Checked by the sender, so a lost marks file cannot defeat it.

    Relaying means we hold records somebody else wrote.  Handing those back
    to their author, who has since thinned them, is the retention argument
    this whole design exists to avoid.
    """
    history = History(tmp_path / "h")
    history.me = "a" * 64
    history.record("main.tex", "mine\n", peer="a" * 64)
    history.absorb("main.tex", [
        {"at": now_ms(), "sha": "c" * 64, "bytes": 1, "peer": "c" * 64},
    ])

    lines, _ = history_sync.offer(
        history, "main.tex", "a" * 64, "c" * 64, {},
    )
    assert {line["peer"] for line in lines} == {"a" * 64}


def test_absorbing_is_idempotent(tmp_path):
    history = History(tmp_path / "h")
    history.record("main.tex", "ours\n")
    lines = [
        {"at": 1000.0, "sha": "a" * 64, "bytes": 4, "by": "you",
         "op": "edit", "peer": "b" * 64, "who": "Bob"},
    ]
    assert len(history.absorb("main.tex", lines)) == 1
    assert history.absorb("main.tex", lines) == []
    assert len(history.versions("main.tex")) == 2


def test_absorbed_lines_are_in_time_order(tmp_path):
    """So the panel reads as one story rather than as this machine's log
    followed by everybody else's."""
    history = History(tmp_path / "h")
    history.record("main.tex", "second\n")
    at = history.versions("main.tex")[0].at
    history.absorb("main.tex", [
        {"at": at - 5000, "sha": "b" * 64, "bytes": 1, "by": "you",
         "op": "edit", "peer": "b" * 64, "who": "Bob"},
    ])
    times = [v.at for v in history.versions("main.tex")]
    assert times == sorted(times)


def test_a_mark_never_goes_backwards(tmp_path):
    """The property that stops thinning and syncing fighting."""
    marks = history_sync.Marks(tmp_path)
    assert marks.advance("b" * 64, "file1", 10.0) is True
    assert marks.advance("b" * 64, "file1", 4.0) is False
    assert marks.at("b" * 64, "file1") == 10.0


def test_marks_survive_a_restart(tmp_path):
    marks = history_sync.Marks(tmp_path)
    marks.advance("b" * 64, "file1", 7.0)
    marks.save()
    assert history_sync.Marks(tmp_path).at("b" * 64, "file1") == 7.0


def test_a_mark_is_kept_per_author_and_per_file(tmp_path):
    """An author missing from the ask is one we have nothing from, which is
    read as "send me all of theirs" -- so the first ask needs no author list
    and the second one is exact."""
    marks = history_sync.Marks(tmp_path)
    marks.advance("a" * 64, "file1", 5.0)
    marks.advance("b" * 64, "file1", 9.0)
    marks.advance("a" * 64, "file2", 3.0)
    assert marks.since("file1") == {"a" * 64: 5.0, "b" * 64: 9.0}
    assert marks.since("file2") == {"a" * 64: 3.0}
    assert marks.since("file-we-have-never-seen") == {}


def test_thinning_does_not_make_a_record_come_back(tmp_path):
    """Three rounds of the exchange after a thin, with the mark where it
    would be. A set difference would re-offer the dropped lines every time."""
    history = History(tmp_path / "h")
    history.me = "a" * 64
    for n in range(6):
        history.record("main.tex", f"draft {n}\n", op="create", peer="a" * 64)

    # The other peer has taken everything so far.
    marks = history_sync.Marks(tmp_path)
    marks.advance("a" * 64, "file1", max(v.at for v in history.versions("main.tex")))

    # Some of them are thinned away here.
    kept = history.versions("main.tex")[2:]
    history._write_log("main.tex", kept)

    for _ in range(3):
        lines, reached = history_sync.offer(
            history, "main.tex", "a" * 64, "b" * 64, marks.since("file1"),
        )
        assert lines == [], "a thinned record was offered again"
        for author, at in reached.items():
            marks.advance(author, "file1", at)
    assert len(history.versions("main.tex")) == len(kept)


def test_a_batch_never_splits_two_records_sharing_a_moment(tmp_path):
    """The mark moves to the last moment sent, so a record sharing that
    moment with one that went would be skipped on the next ask and never
    sent at all.  `record` keeps an author's moments apart, but a log
    written before it did may still hold ties."""
    history = History(tmp_path / "h")
    history.me = "a" * 64
    at = now_ms()
    history.absorb("main.tex", [
        {"at": at, "sha": f"{n:064d}", "bytes": 1, "peer": "c" * 64, "op": "create"}
        for n in range(history_sync.BATCH + 4)
    ])
    lines, reached = history_sync.offer(
        history, "main.tex", "a" * 64, "b" * 64, {},
    )
    assert len(lines) == history_sync.BATCH + 4
    assert reached == {"c" * 64: at}


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


# --- and the contents, when somebody asks for them --------------------------


@pytest.mark.asyncio
async def test_a_collaborators_old_version_can_be_opened(tmp_path):
    """An old version arrives as a line; the bytes come when asked for.

    Almost nobody opens almost any old version, so pulling a peer's whole
    past down before the first keystroke would be the wrong trade -- and it
    is a trade this deliberately does not make.  What it does make is the
    exception below, for the handful anybody actually reaches for.
    """
    alice = Peer(tmp_path / "alice", "The chapter.\n")
    bob = Peer(tmp_path / "bob", "")
    alice.network._me = "a" * 64
    bob.network._me = "b" * 64

    alice.history.record("main.tex", "an early draft nobody kept\n", who="Alice")
    # Aged five days, so it is past the window that is fetched eagerly.
    aged = alice.history.versions("main.tex")
    aged[0].at = now_ms() - 5 * 24 * 3600 * 1000
    alice.history._write_log("main.tex", aged)
    sha = aged[0].sha

    alice.network.begin_sharing("Alice")
    await alice.network.start()
    for file_id, record in alice.store.files.items():
        if record.get("kind") == "text":
            alice.store.body(file_id)
    await bob.network.join(alice.network.invite(), "Bob")
    await asyncio.sleep(1.0)

    # Bob has the version listed, and not its contents.
    assert any(v.sha == sha for v in bob.history.versions("main.tex"))
    assert bob.history.blobs.get(sha) is None

    await bob.network.fetch_blob(sha)
    await asyncio.sleep(0.6)

    assert bob.history.blobs.get(sha) is not None
    assert bob.history.content("main.tex", sha) == "an early draft nobody kept\n"

    await alice.network.close()
    await bob.network.close()
    alice.store.close()
    bob.store.close()


@pytest.mark.asyncio
async def test_a_peer_cannot_ask_for_a_blob_outside_the_store(tmp_path):
    """`BlobStore.path_for` joins the sha onto a directory, so an unchecked
    value lets a member read anything zlib-compressed the server can reach."""
    alice = Peer(tmp_path / "alice", "The chapter.\n")
    bob = Peer(tmp_path / "bob", "")
    alice.network._me = "a" * 64
    bob.network._me = "b" * 64

    alice.network.begin_sharing("Alice")
    await alice.network.start()
    await bob.network.join(alice.network.invite(), "Bob")
    await asyncio.sleep(0.8)

    link = next(iter(bob.network.links.values()))
    before = list((alice.project.state_dir / "history").rglob("*"))
    await link.want_blob("../" * 8 + "etc/passwd")
    await asyncio.sleep(0.4)
    # Nothing sent, nothing read, nothing written.
    assert list((alice.project.state_dir / "history").rglob("*")) == before

    await alice.network.close()
    await bob.network.close()
    alice.store.close()
    bob.store.close()


@pytest.mark.asyncio
async def test_a_recent_version_arrives_ready_to_open(tmp_path):
    """The exception, and where the line is drawn.

    A version listed and permanently unopenable is worse than one not listed
    at all, and the moment a collaborator's version is worth opening is
    usually the moment after they wrote it.  So the last day of them, and
    anything anybody named, comes with its contents; the rest waits to be
    asked for.
    """
    alice = Peer(tmp_path / "alice", "The chapter.\n")
    bob = Peer(tmp_path / "bob", "")
    alice.network._me = "a" * 64
    bob.network._me = "b" * 64

    alice.history.record("main.tex", "written this morning\n", who="Alice")
    sha = alice.history.versions("main.tex")[0].sha

    alice.network.begin_sharing("Alice")
    await alice.network.start()
    for file_id, record in alice.store.files.items():
        if record.get("kind") == "text":
            alice.store.body(file_id)
    await bob.network.join(alice.network.invite(), "Bob")
    await asyncio.sleep(1.2)

    assert bob.history.content("main.tex", sha) == "written this morning\n"

    await alice.network.close()
    await bob.network.close()
    alice.store.close()
    bob.store.close()
