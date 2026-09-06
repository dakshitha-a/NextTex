"""Documents the writer hands the agent as background.

The rule this defends: two documents added in the same breath are two
documents.  They shared an id derived from the millisecond, so the second
overwrote the first's extracted text and removing either deleted both.
"""

from nexttex.context import ProjectContext


def store(tmp_path) -> ProjectContext:
    return ProjectContext(tmp_path / "context")


def test_two_documents_added_at_once_stay_separate(tmp_path):
    shelf = store(tmp_path)
    first = shelf.add("style", "guide.txt", b"the first document")
    second = shelf.add("style", "notes.txt", b"the second document")

    assert first.id != second.id
    assert shelf.extracted_text(first) == "the first document"
    assert shelf.extracted_text(second) == "the second document"


def test_removing_one_of_a_pair_leaves_the_other_whole(tmp_path):
    shelf = store(tmp_path)
    first = shelf.add("style", "guide.txt", b"the first document")
    second = shelf.add("style", "notes.txt", b"the second document")

    assert shelf.remove(first.id)
    assert [d.id for d in shelf.documents()] == [second.id]
    assert shelf.stored_path(second) is not None
    assert shelf.extracted_text(second) == "the second document"


def test_an_upload_named_to_escape_lands_in_the_context_directory(tmp_path):
    shelf = store(tmp_path)
    document = shelf.add("style", "../../.bashrc", b"nothing doing")
    stored = shelf.stored_path(document)
    assert stored is not None
    assert shelf.root in stored.parents
    assert document.filename == ".bashrc"


def test_a_remembered_note_reaches_the_prompt(tmp_path):
    shelf = store(tmp_path)
    kept, message = shelf.remember("Chapter 3 uses the Stony Brook data")
    assert kept and "Stony Brook" in message
    assert shelf.memory_notes() == ["Chapter 3 uses the Stony Brook data"]
    assert "Stony Brook" in shelf.prompt_section()


def test_the_same_note_twice_is_kept_once(tmp_path):
    shelf = store(tmp_path)
    shelf.remember("The supervisor is Prof. Matsika")
    kept, message = shelf.remember("The supervisor is Prof. Matsika")
    assert kept and message == "Already remembered."
    assert len(shelf.memory_notes()) == 1


def test_a_note_is_folded_onto_one_line(tmp_path):
    # A multi-line note would otherwise write lines that are not bullets,
    # and `memory_notes` would drop everything after the first.
    shelf = store(tmp_path)
    shelf.remember("two\nlines   and  spaces")
    assert shelf.memory_notes() == ["two lines and spaces"]


def test_a_full_memory_says_so_rather_than_failing_quietly(tmp_path):
    from nexttex.context import MEMORY_MAX_CHARS

    shelf = store(tmp_path)
    shelf.set_memory("- " + "x" * (MEMORY_MAX_CHARS - 4))
    kept, message = shelf.remember("one more thing")
    assert not kept
    assert "full" in message.lower()
    # And it said nothing untrue: the note really was not kept.
    assert "one more thing" not in shelf.memory_text()


def test_an_empty_memory_costs_the_prompt_nothing(tmp_path):
    shelf = store(tmp_path)
    assert "remember" not in shelf.prompt_section().lower()


def test_a_hand_edit_replaces_the_memory_and_is_trimmed_to_the_cap(tmp_path):
    from nexttex.context import MEMORY_MAX_CHARS

    shelf = store(tmp_path)
    shelf.remember("something old")
    saved = shelf.set_memory("- something new\n" + "y" * (MEMORY_MAX_CHARS * 2))
    assert len(saved) <= MEMORY_MAX_CHARS
    assert "something old" not in shelf.memory_text()
