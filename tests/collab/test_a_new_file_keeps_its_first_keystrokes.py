"""What is typed into a file just made is not wiped by the file's own creation.

The browser opens a new file the moment the route that made it answers,
and the writer starts typing.  The watcher reports the file's creation a
third of a second or more later, reads the disk, which is still empty
because the projection's debounce has not written the typing yet, and
hands that empty text to `ingest`.  The echo guard is what says "this is
what we last wrote, so it is our own write coming back", and it compares
against `last_projected`, which `body()` never set for an empty file: the
seed only recorded a file with something in it.  An empty string against
a missing entry is not an echo, so the empty disk was folded over the
document as an outside edit, and everything typed in that window went.
The browser tier caught it as a caret readout one column short; in a
writer's hands it is the first sentence of a new chapter disappearing.
"""

from __future__ import annotations

import pytest

from nexttex.project import Project
from server.collab.store import CollabStore


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text("The chapter.\n", encoding="utf-8")
    return Project.open(root)


def _type(store: CollabStore, file_id: str, words: str) -> None:
    text = store.body(file_id)
    with store.texts[file_id].transaction():
        text += words


def test_the_creation_the_watcher_reports_late_leaves_the_typing_alone(project):
    store = CollabStore(project)
    store.adopt()
    # What the new-file route does: an empty file on disk, and the document
    # made at once rather than when the watcher gets round to it.
    (project.root / "second.tex").touch()
    store.ingest("second.tex", "", by="create")
    file_id = store.file_id_for("second.tex")
    assert file_id is not None

    _type(store, file_id, "abc")
    # The watcher's report of the creation, with the disk still empty.
    store.ingest("second.tex", "")

    assert str(store.body(file_id)) == "abc"
    store.close()


def test_an_empty_file_is_recorded_as_written_empty(project):
    # The watcher's restart asks the same question of every open document,
    # "is the disk still what we last wrote", and a missing answer read as
    # no.
    (project.root / "notes.tex").touch()
    store = CollabStore(project)
    store.adopt()
    file_id = store.file_id_for("notes.tex")
    store.body(file_id)

    assert store.last_projected.get(file_id) == ""
    store.close()


def test_an_outside_edit_to_an_empty_file_still_arrives(project):
    # The guard must not swallow a real change: something else writing
    # into the empty file is still folded in.
    (project.root / "notes.tex").touch()
    store = CollabStore(project)
    store.adopt()
    file_id = store.file_id_for("notes.tex")
    store.body(file_id)

    store.ingest("notes.tex", "Written in vim.\n")

    assert str(store.body(file_id)) == "Written in vim.\n"
    store.close()
