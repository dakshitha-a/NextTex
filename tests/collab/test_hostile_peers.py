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
