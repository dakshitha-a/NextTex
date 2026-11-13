"""The record of what two installs last agreed a document said."""

from pycrdt import Doc, Text

from server.collab.agreed import Agreed, state_of


def test_their_text_is_the_checkpoint_with_their_changes_since(tmp_path):
    ours = Doc()
    ours["text"] = text = Text()
    text += "Para one.\n\nPara two.\n"
    agreed = Agreed(tmp_path)
    assert agreed.save("peer", "text/x", ours.get_update())
    theirs = Doc()
    theirs["text"] = their_text = Text()
    theirs.apply_update(agreed.get("peer", "text/x"))
    since = theirs.get_state()
    their_text.insert(len(str(their_text)) - 1, " Theirs.")
    text.insert(0, "Ours. ")

    rebuilt = Doc()
    rebuilt.apply_update(agreed.get("peer", "text/x"))
    rebuilt.apply_update(theirs.get_update(since))
    assert str(rebuilt.get("text", type=Text)) == str(their_text)


def test_one_blob_per_state_and_none_left_behind(tmp_path):
    agreed = Agreed(tmp_path)
    assert agreed.save("a", "text/x", b"one")
    assert not agreed.save("a", "text/x", b"one")
    assert agreed.save("b", "text/x", b"one")
    assert len(list((tmp_path / "agreed").glob("*.y"))) == 1
    agreed.save("a", "text/x", b"two")
    agreed.save("b", "text/x", b"two")
    assert len(list((tmp_path / "agreed").glob("*.y"))) == 1
    agreed.keep_only({"a"}, set())
    assert agreed.index == {"a": {}}
    assert not list((tmp_path / "agreed").glob("*.y"))
    # Read back from disk as it was left.
    assert Agreed(tmp_path).index == {"a": {}}


def test_a_state_vector_compares_whatever_its_order():
    doc = Doc()
    doc["t"] = t = Text()
    t += "x"
    assert state_of(doc.get_state()) == {doc.client_id: 1}
    assert state_of(b"") == {}


def test_noting_many_documents_is_not_quadratic(tmp_path, monkeypatch):
    """A join notes a checkpoint for every document it agrees on. Each save
    rewrote the whole index, flushed to disk, and listed the folder to
    clear what nothing named, so 1830 documents meant 1830 rewrites and
    1830 listings of up to 1830 files: on the Windows laptop, minutes."""
    from server.collab import agreed as module

    writes = []
    real = module.write_atomically

    def counted(target, data, **options):
        writes.append((target.name, options.get("durable", True)))
        return real(target, data, **options)

    listings = []
    real_glob = type(tmp_path).glob

    def glob(self, pattern):
        listings.append(pattern)
        return real_glob(self, pattern)

    monkeypatch.setattr(module, "write_atomically", counted)
    monkeypatch.setattr(type(tmp_path), "glob", glob)
    agreed = Agreed(tmp_path)
    for n in range(500):
        assert agreed.save("peer", f"text/{n}", f"state {n}".encode())
    index_writes = [w for w in writes if w[0] == "index.json"]
    assert len(index_writes) <= 2, len(index_writes)
    assert not listings
    # Checkpoints are a cache: none of them is flushed to disk.
    assert all(durable is False for _, durable in writes)

    agreed.flush()
    assert len(Agreed(tmp_path).index["peer"]) == 500


def test_a_replaced_checkpoint_takes_its_blob_with_it(tmp_path):
    agreed = Agreed(tmp_path)
    agreed.save("a", "text/x", b"one")
    agreed.save("a", "text/y", b"one")
    agreed.save("a", "text/x", b"two")
    # Still named by text/y.
    assert len(list((tmp_path / "agreed").glob("*.y"))) == 2
    agreed.save("a", "text/y", b"two")
    assert len(list((tmp_path / "agreed").glob("*.y"))) == 1


def test_a_write_that_need_not_survive_power_loss_is_not_flushed(tmp_path, monkeypatch):
    from nexttex import atomic

    flushed = []
    monkeypatch.setattr(atomic.os, "fsync", lambda fd: flushed.append(fd))
    atomic.write_atomically(tmp_path / "cache", b"x", durable=False)
    assert not flushed and (tmp_path / "cache").read_bytes() == b"x"
    atomic.write_atomically(tmp_path / "kept", b"y")
    assert flushed
