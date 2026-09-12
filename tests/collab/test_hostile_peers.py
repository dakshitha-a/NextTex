"""What a peer, or a browser, must not be able to do.

Two of these look like ordinary bookkeeping and are not.  A file id is a key
in a CRDT map, and that map is written by every peer *and* by every
authenticated browser through the manifest socket -- so "it came off a URL,
and anything unrecognised is refused" was only ever true of a dictionary
somebody else fills in.  A content address arrives from another machine and
is joined straight onto a path.
"""

import os

import pytest

os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from pycrdt import Map                                       # noqa: E402

from nexttex.project import Project                          # noqa: E402
from server.collab.store import CollabStore                  # noqa: E402


@pytest.fixture
def store(tmp_path):
    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text("The chapter.\n")
    made = CollabStore(Project.open(root))
    made.adopt()
    yield made
    made.close()


def test_a_file_id_cannot_be_a_path(store, tmp_path):
    """It becomes a file name under `.nexttex/collab/docs`, and `append`
    creates the directories on the way, so an id of `../../..` wrote outside
    the project entirely."""
    escape = "../" * 12 + str(tmp_path / "escaped")
    store.files[escape] = Map({
        "path": "main.tex", "kind": "text", "size": 1, "trashed": False,
    })

    with pytest.raises(ValueError):
        store._text_path(escape)
    # And nothing reaches it through the ordinary door either.
    assert store.document(f"text/{escape}") is None
    assert not (tmp_path / "escaped.y").exists()


@pytest.mark.parametrize("bad", [
    "..", "../x", "a/b", "main.tex", "", "NOTHEX", "x" * 200, "../../etc/passwd",
])
def test_only_well_formed_ids_are_accepted(store, bad):
    with pytest.raises(ValueError):
        store._text_path(bad)


def test_the_ids_this_makes_are_all_acceptable(store):
    """The check must not refuse what the app itself writes."""
    for file_id in store.files.keys():
        assert store._text_path(file_id).name.endswith(".y")


def test_a_blob_request_cannot_be_a_path():
    """`BlobStore.path_for` joins the sha onto a directory, so an unchecked
    value from a peer lets a member read anything on the disk that happens
    to be zlib-compressed."""
    from server.collab.peers import _IS_SHA

    assert _IS_SHA.fullmatch("a" * 64)
    for bad in ("../" * 8 + "etc/passwd", "..", "", "a" * 63, "A" * 64, "a" * 65):
        assert not _IS_SHA.fullmatch(bad), bad


def test_two_peers_creating_the_same_path_do_not_collide(tmp_path):
    """They derived the same id from the same path, the documents merged,
    and each peer ended up holding both files interleaved."""
    ids = set()
    for name in ("alice", "bob"):
        root = tmp_path / name
        root.mkdir()
        (root / "main.tex").write_text("x\n")
        store = CollabStore(Project.open(root))
        store.adopt()
        # A file neither of them has adopted: created independently, now.
        ids.add(store._new_id("chapters/03.tex"))
        store.close()
    assert len(ids) == 2


# --- the files that are instructions rather than writing --------------------


CONTROL = [
    ".git/config",                 # core.fsmonitor runs on the next git status
    ".git/hooks/pre-commit",       # and this on the next commit
    "latexmkrc",                   # arbitrary Perl on the next full build
    ".latexmkrc",
    "Makefile",
    ".envrc",
    ".claude/settings.json",       # settings may declare hooks, and a hook runs
    ".nexttex/trash/entries.jsonl",   # where a restore puts things
    "chapters/latexmkrc",          # not only at the root
]


@pytest.mark.parametrize("relative", CONTROL)
def test_a_peer_cannot_write_a_control_file(store, relative):
    """Staying inside the project was never the whole question.

    `.git/config` is inside the project, and a `core.fsmonitor` entry in it is
    a command that runs on the next `git status` -- which this app performs
    after every build, so no LaTeX pass is even needed.  `latexmkrc` is Perl,
    read from the working directory by a build the editor starts on its own a
    second and a half after somebody stops typing.
    """
    file_id = "a1b2c3d4e5f60718"
    store.files[file_id] = Map({
        "path": relative, "kind": "text", "size": 1, "trashed": False,
    })
    body = store.body(file_id)
    assert body is not None
    body += "system('rm -rf ~');"

    store._dirty.add(file_id)
    store.flush()

    assert not (store.project.root / relative).exists()
    assert file_id in store._refused


@pytest.mark.parametrize("relative", [
    "chapters/one.tex", "refs.bib", "nexttex.toml", ".gitignore", "CLAUDE.md",
])
def test_the_writing_itself_is_still_written(store, relative):
    """The rule must not refuse what collaboration is for.

    `nexttex.toml` is deliberately in this list: two people working on one
    document want the same main file, and the dangerous half of that file is
    fixed by validating what it says rather than by refusing to receive it.
    """
    file_id = "b1b2c3d4e5f60718"
    store.files[file_id] = Map({
        "path": relative, "kind": "text", "size": 1, "trashed": False,
    })
    body = store.body(file_id)
    assert body is not None
    body += "the writing"

    store._dirty.add(file_id)
    store.flush()

    assert (store.project.root / relative).read_text().endswith("the writing")


def test_a_symlink_cannot_smuggle_one_in(store):
    """The refusal resolves before it decides, because otherwise a link named
    `notes` pointing at `.git` writes `.git/config` under a path that never
    mentions `.git`."""
    root = store.project.root
    (root / ".git").mkdir(exist_ok=True)
    (root / "notes").symlink_to(root / ".git")
    with pytest.raises(PermissionError):
        store.project.resolve_for_write("notes/config")


def test_a_refused_record_is_not_retried_forever(store):
    """It used to go back in the dirty set, so the flush timer picked it up
    again 120 ms later, and again, with the refusal swallowed by the timer
    callback so nothing anywhere said a word."""
    file_id = "c1b2c3d4e5f60718"
    store.files[file_id] = Map({
        "path": "latexmkrc", "kind": "text", "size": 1, "trashed": False,
    })
    body = store.body(file_id)
    assert body is not None
    body += "system('rm -rf ~');"

    store._dirty.add(file_id)
    store.flush()
    assert file_id not in store._dirty      # not queued for another attempt
    assert file_id in store._refused

    # And a second flush does not try again either.
    store._dirty.add(file_id)
    store.flush()
    assert not (store.project.root / "latexmkrc").exists()


def test_the_path_fence_is_also_not_retried(store, tmp_path):
    """The same loop, reached by the other refusal: a record naming
    `../../escaped` will name it just as much in 120 ms."""
    file_id = "d1b2c3d4e5f60718"
    store.files[file_id] = Map({
        "path": "../" * 6 + "escaped.tex",
        "kind": "text", "size": 1, "trashed": False,
    })
    body = store.body(file_id)
    assert body is not None
    body += "outside"

    store._dirty.add(file_id)
    store.flush()
    assert file_id not in store._dirty
    assert file_id in store._refused


# --- what a member may and may not tell us about the share ------------------


def _link_and_share(tmp_path):
    """A PeerLink with just enough network behind it to run `handle`."""
    import asyncio
    from types import SimpleNamespace

    from server.collab.peers import PeerLink, Share

    share = Share(tmp_path)
    network = SimpleNamespace(
        share=share,
        store=None,
        hub=None,
        peer_id="us",
        mirror_members=lambda: None,
        dial_later=lambda peer_id: None,
        dropped=lambda link: None,
    )
    link = PeerLink(network, stream=None, peer_id="them")
    # send_documents talks to a stream this test does not have.
    async def _nothing() -> None:
        return None
    link.send_documents = _nothing
    return link, share, asyncio


def _welcome(share_id: str):
    """A WELCOME frame naming a share, as an admitted peer would send one."""
    from server.collab import wire

    return wire.Frame(kind=wire.WELCOME,
                      header={"share": share_id, "members": {}},
                      payload=b"")


def test_a_peer_cannot_replace_the_share_id_we_already_hold(tmp_path):
    """The share id is the gate `_accept` checks incoming peers against.

    A joiner has none until somebody welcomes them, which is what this frame
    is for, so it has to be able to *fill* one.  Taking the value from every
    WELCOME meant any admitted member could send a different one and cut this
    install off from every other member at once, with one frame, and without
    touching the member list the same handler is careful about.
    """
    link, share, asyncio = _link_and_share(tmp_path)
    share.share_id = "the-real-share"

    asyncio.run(link.handle(_welcome("a-share-of-their-own")))

    assert share.share_id == "the-real-share"


def test_a_joiner_still_learns_the_share_id(tmp_path):
    """The case that actually exists must keep working: a peer with no share
    id is welcomed into one."""
    link, share, asyncio = _link_and_share(tmp_path)
    assert not share.share_id

    asyncio.run(link.handle(_welcome("the-real-share")))

    assert share.share_id == "the-real-share"


def test_a_rename_cannot_move_a_file_from_outside_the_project_in(store, tmp_path):
    """The one path into `_named` that was not fenced.

    `settle_paths` records whatever a record says its path is the first time
    it sees that file, and `_rename_locally` then builds the *source* of the
    rename as `root / was` with no fence at all.  Only the target was
    resolved.  So a peer could name a file `../../.ssh/id_rsa`, wait for that
    to become the baseline, rename it to `notes.tex`, and the file would be
    moved off the machine's own disk into the project, where the manifest
    would then hand it to everybody in the share.

    A rename is a move, so this is a read of anything the server's user can
    read, and it destroys the original on the way.
    """
    secret = tmp_path / "secret"
    secret.mkdir()
    key = secret / "id_rsa"
    key.write_text("PRIVATE KEY\n")

    file_id = "beefbeefbeefbeef"
    outside = "../secret/id_rsa"
    store.files[file_id] = Map({
        "path": outside, "kind": "text", "size": 1, "trashed": False,
    })
    store.settle_paths()

    store.files[file_id]["path"] = "notes.tex"
    store.settle_paths()

    assert key.read_text() == "PRIVATE KEY\n", "the file outside the project was moved"
    assert not (store.project.root / "notes.tex").exists(), (
        "a file from outside the project arrived inside it"
    )


def test_a_rename_cannot_reach_a_control_file_either(store):
    """`.git` and `.nexttex` are inside the project and are not writable.

    The target of a rename was already fenced against them.  The source was
    not, so the move ran the other way: a peer could carry `.git/config` out
    into the project as an ordinary file, and read it.
    """
    (store.project.root / ".git").mkdir()
    (store.project.root / ".git" / "config").write_text("[core]\n")

    file_id = "cafecafecafecafe"
    store.files[file_id] = Map({
        "path": ".git/config", "kind": "text", "size": 1, "trashed": False,
    })
    store.settle_paths()
    store.files[file_id]["path"] = "config.tex"
    store.settle_paths()

    assert (store.project.root / ".git" / "config").exists()
    assert not (store.project.root / "config.tex").exists()


def test_a_file_displaced_by_a_peer_rename_goes_to_the_trash(tmp_path):
    """The manifest wins, and the writer's own file is not thrown away for it.

    When a peer renames one of their files onto a name this machine is
    already using, the local file has to step aside: the manifest is the
    authority on what a file is called. It used to step aside into
    `chapter (was here).tex`, silently, inside a suppressed OSError. The
    writer's file was still there and they had no way to know it had been
    renamed, or why, or that a name they had chosen was now somebody
    else's.

    The trash is where this app puts a file that has to go, and it is
    already reachable from here: `_trash_locally` two functions down uses
    it for exactly this reason.
    """
    from nexttex.history import History
    from nexttex.trash import Trash

    class Session:
        def __init__(self, project):
            self.history = History(project.state_dir / "history")
            self.trash = Trash(project.state_dir / "trash", self.history, project.root)

        def mark_written(self, path): pass
        def note_edit(self, *args, **kwargs): pass
        def schedule_compile(self): pass
        def record_version(self, *args, **kwargs): pass

    root = tmp_path / "paper"
    root.mkdir()
    (root / "mine.tex").write_text("What I wrote.\n")
    (root / "theirs.tex").write_text("What they wrote.\n")
    project = Project.open(root)
    made = CollabStore(project, Session(project))
    made.adopt()
    try:
        file_id = next(
            fid for fid, record in made.files.items()
            if record.get("path") == "theirs.tex"
        )
        made.settle_paths()
        made.files[file_id]["path"] = "mine.tex"
        made.settle_paths()

        assert not (root / "mine.tex (was here).tex").exists(), (
            "the writer's file was renamed out of the way rather than filed"
        )
        names = [entry.path for entry in made.session.trash.entries()]
        assert "mine.tex" in names, f"nothing was put in the trash: {names}"
    finally:
        made.close()


def test_a_refusal_is_about_the_path_and_not_the_file_for_ever(store):
    """A refused write latched on the file id, so a corrected path never wrote.

    Refusing to retry the *same* path is right: a record naming
    `.git/hooks/pre-commit` will name it just as much next time. But the
    path is a field a peer can change, and once the id was in the set
    nothing ever took it out, so the file stayed unwritable for the life of
    the session even after it was pointed somewhere ordinary.
    """
    file_id = "d00dd00dd00dd00d"
    store.files[file_id] = Map({
        "path": ".git/config", "kind": "text", "size": 1, "trashed": False,
    })
    body = store.body(file_id)
    body += "[core]\n"
    store._dirty.add(file_id)
    store.flush()
    assert file_id in store._refused

    store.files[file_id]["path"] = "notes.tex"
    store._dirty.add(file_id)
    store.flush()

    assert (store.project.root / "notes.tex").exists(), (
        "a corrected path was still refused"
    )


@pytest.mark.asyncio
async def test_a_blob_nobody_asked_for_is_not_stored(tmp_path):
    """`take_blob` says "if it is really the one asked for" and never asked.

    It checks that the bytes hash to the name they arrived under, which is
    the right check for a content-addressed store and is not the same
    question. A peer could send `BLOB_HAVE` for anything at all, unasked,
    and every one of them was written into this install's history blobs. A
    peer is somebody who was invited, but an invitation is not a licence to
    fill the disk, and nothing on any screen accounts for what is in there.
    """
    import hashlib

    from nexttex.history import History
    from server.collab.peers import PeerNetwork

    class Session:
        def __init__(self, project):
            self.history = History(project.state_dir / "history")

    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text("The chapter.\n")
    project = Project.open(root)
    made = CollabStore(project)
    made.adopt()
    try:
        session = Session(project)
        history = session.history
        network = PeerNetwork(made, session=session)

        junk = b"x" * 4096
        network.take_blob(hashlib.sha256(junk).hexdigest(), junk)

        assert not history.blobs.has(hashlib.sha256(junk).hexdigest()), (
            "a blob nobody asked for was written to disk"
        )
    finally:
        made.close()
