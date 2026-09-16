"""A file edited while NextTex was not running reaches the document.

The watcher reports only what happens while the server is up, and a
document with a log is opened from the log, so a chapter edited in
another editor while NextTex was stopped was overwritten by the next
projection without a version.  The opposite case looks the same from the
file's side and must be told apart: a server killed between appending to
the log and writing the file reopens with the document ahead of the file,
and folding the file in then would publish a revert to every peer.
"""

from __future__ import annotations

import json

import pytest

from nexttex.project import Project
from server.collab.store import PROJECTED, CollabStore

from .conftest import Peer, join_up, settle, until


class _Recorder:
    """What the store asks a session for, remembering the versions."""

    def __init__(self) -> None:
        self.versions: list[tuple[str, str, str]] = []

    def mark_written(self, path) -> None:
        pass

    def note_edit(self, *args) -> None:
        pass

    def schedule_compile(self) -> None:
        pass

    def record_version(self, path, text, *, previous=None, by="you", why="",
                       op="edit", source="") -> None:
        self.versions.append((path.name, text, why))


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text("The chapter.\n", encoding="utf-8")
    return Project.open(root)


def _open(project, session=None) -> tuple[CollabStore, str]:
    store = CollabStore(project, session)
    store.adopt()
    file_id = store.file_id_for("main.tex")
    store.body(file_id)
    return store, file_id


def test_the_store_remembers_what_it_wrote(project):
    store, file_id = _open(project)
    store.flush()
    store.close()
    record = json.loads((project.state_dir / "collab" / "docs" / PROJECTED).read_text())
    assert set(record) == {file_id}


def test_an_edit_made_while_stopped_is_folded_in_and_recorded(project):
    store, file_id = _open(project)
    store.close()

    (project.root / "main.tex").write_text("The chapter, revised in vim.\n")

    session = _Recorder()
    again, _ = _open(project, session)
    assert str(again.body(file_id)) == "The chapter, revised in vim.\n"
    assert session.versions == [
        ("main.tex", "The chapter, revised in vim.\n", "changed while NextTex was not running"),
    ]
    again.flush()
    assert (project.root / "main.tex").read_text() == "The chapter, revised in vim.\n"
    again.close()


def test_a_document_ahead_of_its_file_wins_and_is_written(project):
    """The crash case: the log was appended, the file never written."""
    store, file_id = _open(project)
    store.flush()
    text = store.body(file_id)
    text += "Typed just before the power went.\n"
    # No flush: the update is in the log, the file is as it was.
    assert (project.root / "main.tex").read_text() == "The chapter.\n"
    store._closed = True

    session = _Recorder()
    again, _ = _open(project, session)
    assert str(again.body(file_id)) == "The chapter.\nTyped just before the power went.\n"
    # Not an outside edit, so not a version; and the file catches up.
    assert session.versions == []
    again.flush()
    assert (project.root / "main.tex").read_text() == (
        "The chapter.\nTyped just before the power went.\n"
    )
    again.close()


def test_a_file_rewritten_to_the_same_text_is_not_an_edit(project):
    store, file_id = _open(project)
    store.close()
    (project.root / "main.tex").write_text("The chapter.\n")
    session = _Recorder()
    again, _ = _open(project, session)
    assert session.versions == []
    again.close()


def test_a_file_the_store_never_wrote_keeps_the_document(project):
    """No record of a projection: the document wins, as it always did."""
    store, file_id = _open(project)
    store.close()
    (project.state_dir / "collab" / "docs" / PROJECTED).unlink()
    (project.root / "main.tex").write_text("Edited, but nothing can say by whom.\n")
    session = _Recorder()
    again, _ = _open(project, session)
    assert str(again.body(file_id)) == "The chapter.\n"
    assert session.versions == []
    again.close()


@pytest.mark.asyncio
async def test_an_edit_made_while_a_peer_was_stopped_reaches_the_others(tmp_path):
    alice = Peer(tmp_path / "alice", {"main.tex": "One.\n"}).be("a" * 64)
    bob = Peer(tmp_path / "bob", {}).be("b" * 64)
    await join_up(alice, bob)
    assert await until(lambda: (bob.project.root / "main.tex").exists())
    bob.store.flush()
    await bob.close()

    (bob.project.root / "main.tex").write_text("One.\nTwo, from vim.\n")

    bob_again = Peer(tmp_path / "bob", {}).be("b" * 64)
    await bob_again.network.start()
    bob_again.open_documents()
    assert await until(
        lambda: str(alice.store.body(alice.store.file_id_for("main.tex")))
        == "One.\nTwo, from vim.\n"
    )
    alice.store.flush()
    text = (alice.project.root / "main.tex").read_text()
    assert text.count("One.") == 1 and text.count("Two, from vim.") == 1
    await settle()
    await bob_again.close()
    await alice.close()
