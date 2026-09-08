"""The CRDT store, and the loop it must not make.

The single most dangerous property in this design is that disk and document
each write to the other.  Most of what is here is about that loop staying
closed, because an unclosed one does not throw -- it duplicates a writer's
paragraphs and then converges every peer onto the result.
"""

import pytest

from nexttex.project import Project
from server.collab.store import CollabStore, edits_for, minimal_edit


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n"
    )
    (root / "chapters").mkdir()
    (root / "chapters" / "one.tex").write_text("The first chapter.\n")
    return Project.open(root)


@pytest.fixture
def store(project):
    made = CollabStore(project)
    made.adopt()
    yield made
    made.close()


# --- the diff ---------------------------------------------------------------


@pytest.mark.parametrize("before, after", [
    ("", "hello"),
    ("hello", ""),
    ("hello", "hello"),
    ("hello", "hello world"),
    ("hello world", "hello"),
    ("abc", "xyz"),
    ("line one\nline two\n", "line one\nline CHANGED\n"),
    ("a" * 500, "a" * 250 + "b" + "a" * 250),
])
def test_a_diff_reconstructs_the_target(before, after):
    text = before
    for start, end, replacement in edits_for(before, after):
        text = text[:start] + replacement + text[end:]
    assert text == after


def test_no_change_is_no_edits():
    assert edits_for("same", "same") == []


def test_one_keystroke_is_one_small_splice():
    """The property a `git pull` depends on: an edit must not span the whole
    file, or a collaborator's untouched paragraphs are replaced with copies
    of themselves and their concurrent edits lose."""
    before = "chapter one\n" * 200
    after = before.replace("chapter one\n", "chapter ONE\n", 1)
    start, end, replacement = minimal_edit(before, after)
    assert end - start < 20
    assert len(replacement) < 20


# --- adopting a project -----------------------------------------------------


def test_adopt_lists_the_text_files(store):
    paths = {record["path"] for record in store.files.values()}
    assert "main.tex" in paths
    assert "chapters/one.tex" in paths


def test_a_files_id_is_its_history_slug(store):
    """So an existing project's version log stays attached with no migration."""
    from nexttex.history import slug_for

    assert store.file_id_for("main.tex") == slug_for("main.tex")


def test_adopting_twice_does_not_renumber(store):
    before = dict(store.files.items())
    store.adopt()
    after = {key: dict(value) for key, value in store.files.items()}
    assert set(before) == set(after)


def test_a_new_file_is_adopted_on_ingest(store, project):
    (project.root / "extra.tex").write_text("late arrival\n")
    assert store.ingest("extra.tex", "late arrival\n")
    assert store.file_id_for("extra.tex") is not None


def test_a_binary_file_is_not_given_a_text_document(store, project):
    (project.root / "figures").mkdir(exist_ok=True)
    (project.root / "figures" / "plot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    store.adopt()
    file_id = store.file_id_for("figures/plot.png")
    assert file_id is not None
    assert store.files[file_id]["kind"] == "blob"
    assert store.body(file_id) is None


# --- disk into the document -------------------------------------------------


def test_the_document_opens_holding_what_the_file_says(store):
    text = store.body(store.file_id_for("chapters/one.tex"))
    assert str(text) == "The first chapter.\n"


def test_ingesting_an_outside_change_reaches_the_document(store, project):
    file_id = store.file_id_for("chapters/one.tex")
    store.body(file_id)
    (project.root / "chapters" / "one.tex").write_text("Rewritten elsewhere.\n")
    assert store.ingest("chapters/one.tex", "Rewritten elsewhere.\n")
    assert str(store.body(file_id)) == "Rewritten elsewhere.\n"


def test_ingesting_a_deletion_marks_the_file_rather_than_dropping_it(store):
    """A map delete concurrent with an edit is ambiguous; a flag is not."""
    file_id = store.file_id_for("chapters/one.tex")
    assert store.ingest("chapters/one.tex", None)
    assert store.files[file_id]["trashed"] is True


# --- the loop ---------------------------------------------------------------


def test_ingesting_what_the_document_already_says_does_nothing(store):
    """The idempotence the whole design rests on."""
    file_id = store.file_id_for("chapters/one.tex")
    text = store.body(file_id)
    before = str(text)
    assert store.ingest("chapters/one.tex", before) is False
    assert str(text) == before


def test_a_projection_is_never_ingested_as_an_edit(store, project):
    """The write loop, in the smallest form that can happen.

    A change is made in the document, written out, and the watcher hands the
    file straight back.  If that were taken as an outside edit, the file
    would grow a copy of every change ever made to it.
    """
    file_id = store.file_id_for("chapters/one.tex")
    text = store.body(file_id)
    text += "A second sentence.\n"
    store.flush()

    on_disk = (project.root / "chapters" / "one.tex").read_text()
    assert on_disk == "The first chapter.\nA second sentence.\n"

    # The watcher, arriving late with exactly what we just wrote.
    assert store.ingest("chapters/one.tex", on_disk) is False
    assert str(text) == on_disk


def test_a_trailing_newline_difference_is_not_a_phantom_edit(store, project):
    """What a `git pull` of text the peer already has hands back."""
    file_id = store.file_id_for("chapters/one.tex")
    text = store.body(file_id)
    assert store.ingest("chapters/one.tex", str(text)) is False
    # And a genuine difference still lands.
    assert store.ingest("chapters/one.tex", str(text) + "\n") is True


def test_round_tripping_many_times_does_not_grow_the_file(store, project):
    """Twenty passes of write-then-ingest, which is what an editing session
    is.  Length is the assertion: a loop shows up as growth first."""
    file_id = store.file_id_for("chapters/one.tex")
    text = store.body(file_id)
    for n in range(20):
        text += f"line {n}\n"
        store.flush()
        store.ingest("chapters/one.tex",
                     (project.root / "chapters" / "one.tex").read_text())
    expected = "The first chapter.\n" + "".join(f"line {n}\n" for n in range(20))
    assert str(text) == expected
    assert (project.root / "chapters" / "one.tex").read_text() == expected


# --- the document out to disk -----------------------------------------------


def test_a_document_change_reaches_the_file(store, project):
    file_id = store.file_id_for("main.tex")
    text = store.body(file_id)
    text.insert(0, "% a comment\n")
    store.flush()
    assert (project.root / "main.tex").read_text().startswith("% a comment\n")


def test_writing_is_skipped_when_nothing_moved(store, project):
    file_id = store.file_id_for("main.tex")
    store.body(file_id)
    path = project.root / "main.tex"
    before = path.stat().st_mtime_ns
    store._dirty.add(file_id)
    store.flush()
    assert path.stat().st_mtime_ns == before


# --- persistence ------------------------------------------------------------


def test_a_document_survives_being_closed_and_opened(project):
    first = CollabStore(project)
    first.adopt()
    file_id = first.file_id_for("chapters/one.tex")
    first.body(file_id).insert(0, "Kept. ")
    first.flush()
    first.close()

    second = CollabStore(project)
    assert second.file_id_for("chapters/one.tex") == file_id
    assert str(second.body(file_id)).startswith("Kept. ")
    second.close()


def test_a_truncated_log_still_loads(project):
    """A machine that lost power mid-append. Every prefix of an update log is
    a valid document, so what survived must still open."""
    first = CollabStore(project)
    first.adopt()
    file_id = first.file_id_for("main.tex")
    first.body(file_id).insert(0, "% one\n")
    first.close()

    log = project.state_dir / "collab" / "docs" / f"{file_id}.y"
    blob = log.read_bytes()
    log.write_bytes(blob[: len(blob) - 3])

    second = CollabStore(project)
    assert second.body(file_id) is not None      # opened rather than raised
    second.close()


def test_rubbish_in_the_log_is_not_fatal(project):
    store = CollabStore(project)
    store.adopt()
    file_id = store.file_id_for("main.tex")
    store.body(file_id)
    store.close()

    log = project.state_dir / "collab" / "docs" / f"{file_id}.y"
    log.write_bytes(b"not a nexttex document at all")

    again = CollabStore(project)
    assert str(again.body(file_id)) == (project.root / "main.tex").read_text()
    again.close()
