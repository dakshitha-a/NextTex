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
