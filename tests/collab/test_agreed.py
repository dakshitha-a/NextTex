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
