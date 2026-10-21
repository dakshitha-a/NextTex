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
    shelf.remember("The supervisor is Prof. Vellacourt")
    kept, message = shelf.remember("The supervisor is Prof. Vellacourt")
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
    # It says how much is left and where the note must not go. Told only
    # "full" with 4,000 characters, the agent put three notes in a
    # thesis's CLAUDE.md, where they soon disagreed with the memory.
    assert f"of {MEMORY_MAX_CHARS} characters" in message
    assert "left" in message and "CLAUDE.md" in message
    assert "revise_memory" in message


def test_the_cap_holds_a_working_memory(tmp_path):
    """Five notes of the length a thesis's agent wrote, 500 to 860
    characters, filled the old cap; ten fit now."""
    shelf = store(tmp_path)
    for index in range(10):
        kept, _ = shelf.remember(f"note {index} " + "w" * 700)
        assert kept, index


def test_a_note_is_changed_or_removed_by_its_text(tmp_path):
    shelf = store(tmp_path)
    shelf.remember("PDFs go in refs/<bibkey>.pdf")
    shelf.remember("Never use an em dash")
    kept, message = shelf.revise_memory(
        "PDFs go in refs/<bibkey>.pdf", "PDFs go in refs/articles/ or refs/books/")
    assert kept and "refs/articles/" in message
    assert shelf.memory_notes() == ["PDFs go in refs/articles/ or refs/books/",
                                    "Never use an em dash"]
    kept, message = shelf.revise_memory("Never use an em dash", "")
    assert kept and message.startswith("Removed")
    assert shelf.memory_notes() == ["PDFs go in refs/articles/ or refs/books/"]
    kept, _ = shelf.revise_memory("PDFs go in refs/articles/ or refs/books/", "")
    assert kept and shelf.memory_text() == ""


def test_a_revision_that_names_no_note_or_grows_past_the_cap_changes_nothing(tmp_path):
    from nexttex.context import MEMORY_MAX_CHARS

    shelf = store(tmp_path)
    shelf.remember("one")
    shelf.remember("two")
    before = shelf.memory_text()
    assert not shelf.revise_memory("three", "x")[0]
    assert not shelf.revise_memory("one", "two")[0]
    assert not shelf.revise_memory("one", "y" * MEMORY_MAX_CHARS)[0]
    assert shelf.memory_text() == before


def test_the_prompt_says_where_an_overflow_must_not_go(tmp_path):
    shelf = store(tmp_path)
    shelf.remember("The supervisor is Matsika")
    section = shelf.prompt_section()
    assert "revise_memory" in section and "never written into CLAUDE.md" in section


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
