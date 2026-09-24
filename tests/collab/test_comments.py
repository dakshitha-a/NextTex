"""Comment threads: made, replied to, resolved, deleted, and found again.

The threads live on the manifest and are anchored to a file's shared text
by relative positions, so they have to follow the text through edits made
anywhere, outside ones included, and survive their text being deleted as a
thread that says so.
"""

from __future__ import annotations

import base64

import pytest
from pycrdt import Assoc

from nexttex.project import Project
from server.collab.comments import CommentError, Comments
from server.collab.store import CollabStore

CHAPTER = "The decay is biexponential, with a fast\ncomponent of 180 fs that we assign to\ninternal conversion.\n"


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text(CHAPTER, encoding="utf-8")
    return Project.open(root)


@pytest.fixture
def store(project):
    made = CollabStore(project)
    made.adopt()
    yield made
    made.close()


def _anchors(store: CollabStore, relative: str, start: int, end: int) -> tuple[str, str]:
    """What a browser sends: the range's two ends as encoded relative
    positions, the start holding to the text after it and the end to the
    text before it, so typing at either edge stays outside the range."""
    text = store.body(store.file_id_for(relative))
    lead = text.sticky_index(start, Assoc.AFTER).encode()
    tail = text.sticky_index(end, Assoc.BEFORE).encode()
    return base64.b64encode(lead).decode(), base64.b64encode(tail).decode()


def _comments(store: CollabStore, name: str = "You") -> Comments:
    return Comments(store, lambda: {"name": name, "peer": "a" * 64})


def _on(store: CollabStore, words: str) -> tuple[str, str]:
    at = CHAPTER.index(words)
    return _anchors(store, "main.tex", at, at + len(words))


def test_a_thread_is_made_listed_replied_to_resolved_and_deleted(store):
    comments = _comments(store)
    start, end = _on(store, "180 fs")
    made = comments.create("main.tex", start, end, "180 fs", 2, "Is this ours?")

    [thread] = comments.listing()
    assert thread["id"] == made
    assert thread["path"] == "main.tex"
    assert thread["line"] == 2
    assert thread["detached"] is False
    assert [m["body"] for m in thread["messages"]] == ["Is this ours?"]
    assert thread["messages"][0]["name"] == "You"

    _comments(store, "Mira").reply(made, "Ours, from the anisotropy.")
    comments.resolve(made, True)
    [thread] = comments.listing()
    assert [m["name"] for m in thread["messages"]] == ["You", "Mira"]
    assert thread["resolved"]["name"] == "You"

    comments.resolve(made, False)
    assert comments.listing()[0]["resolved"] == {}

    comments.delete(made)
    assert comments.listing() == []


def test_a_thread_follows_its_text_through_an_edit_above_it(store):
    comments = _comments(store)
    start, end = _on(store, "internal conversion")
    comments.create("main.tex", start, end, "internal conversion", 3, "Cite it.")

    text = store.body(store.file_id_for("main.tex"))
    with store.texts[store.file_id_for("main.tex")].transaction():
        text.insert(0, "A new first line.\nAnd a second.\n")

    assert comments.listing()[0]["line"] == 5


def test_a_thread_follows_its_text_through_an_outside_edit(store, project):
    comments = _comments(store)
    start, end = _on(store, "internal conversion")
    comments.create("main.tex", start, end, "internal conversion", 3, "Cite it.")

    store.ingest("main.tex", "Written in vim above it.\n" + CHAPTER)

    thread = comments.listing()[0]
    assert thread["line"] == 4
    assert thread["detached"] is False


def test_a_thread_whose_text_is_deleted_is_detached_and_kept(store):
    comments = _comments(store)
    start, end = _on(store, "180 fs")
    comments.create("main.tex", start, end, "180 fs", 2, "Is this ours?")

    store.ingest("main.tex", CHAPTER.replace("180 fs", ""))

    [thread] = comments.listing()
    assert thread["detached"] is True
    assert thread["quote"] == "180 fs"
    assert thread["line"] == 2


def test_lines_are_counted_right_after_accented_text(store, project):
    # pycrdt counts bytes and Yjs UTF-16 units; the line is what matters.
    store.ingest("main.tex", "Schrödinger équation, é à ü.\n" + CHAPTER)
    comments = _comments(store)
    whole = str(store.body(store.file_id_for("main.tex")))
    text = store.body(store.file_id_for("main.tex"))
    at_chars = whole.index("internal")
    at = len(whole[:at_chars].encode("utf-8"))
    lead = base64.b64encode(text.sticky_index(at, Assoc.AFTER).encode()).decode()
    tail = base64.b64encode(text.sticky_index(at + 8, Assoc.BEFORE).encode()).decode()
    comments.create("main.tex", lead, tail, "internal", 4, "Here.")
    assert comments.listing()[0]["line"] == 4


def test_what_cannot_be_a_comment_is_refused_in_a_sentence(store):
    comments = _comments(store)
    start, end = _on(store, "180 fs")
    with pytest.raises(CommentError, match="something in it"):
        comments.create("main.tex", start, end, "180 fs", 2, "   ")
    with pytest.raises(CommentError, match="not a file"):
        comments.create("nowhere.tex", start, end, "x", 1, "Hello")
    with pytest.raises(CommentError, match="could not be read"):
        comments.create("main.tex", "not base64!", end, "x", 1, "Hello")
    with pytest.raises(CommentError, match="no such thread"):
        comments.reply("c000000000000", "Hello")
