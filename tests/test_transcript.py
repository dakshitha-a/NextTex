"""The record of what was done to the document.

It has to survive a restart: the model resumes its own memory of the
conversation from disk, and the chips and permission records are the audit
trail of what an assistant did to a dissertation.
"""

from server.transcript import Transcript


def test_streamed_text_is_stored_as_one_message(tmp_path):
    t = Transcript(tmp_path / "t.jsonl")
    t.record({"type": "turn_start", "prompt": "hello"})
    for piece in ("Hel", "lo ", "there."):
        t.record({"type": "text", "text": piece})
    t.record({"type": "text_end"})
    items = t.items()
    assert [i["kind"] for i in items] == ["user", "claude"]
    assert items[1]["text"] == "Hello there."


def test_an_edit_gets_an_id_so_its_undo_can_be_recorded(tmp_path):
    t = Transcript(tmp_path / "t.jsonl")
    event = t.record({"type": "edit", "path": "main.tex", "before": "a", "after": "b"})
    assert event["id"]
    t.note_revert(event["id"], "reverted")
    assert t.items()[0]["state"] == "reverted"


def test_a_decision_is_folded_into_its_card(tmp_path):
    t = Transcript(tmp_path / "t.jsonl")
    t.record({"type": "permission", "id": "perm-1", "tool": "Bash", "detail": "ls"})
    t.note_decision("perm-1", "deny")
    items = t.items()
    assert len(items) == 1
    assert items[0]["decision"] == "deny"


def test_a_corrupt_line_does_not_lose_the_rest(tmp_path):
    path = tmp_path / "t.jsonl"
    t = Transcript(path)
    t.record({"type": "turn_start", "prompt": "first"})
    with path.open("a", encoding="utf-8") as handle:
        handle.write("{not json\n")
    t.record({"type": "turn_start", "prompt": "second"})
    assert [i["text"] for i in t.items()] == ["first", "second"]


def test_reading_a_transcript_that_does_not_exist_yet(tmp_path):
    assert Transcript(tmp_path / "none.jsonl").items() == []
