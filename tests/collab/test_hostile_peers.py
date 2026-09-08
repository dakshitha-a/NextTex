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
