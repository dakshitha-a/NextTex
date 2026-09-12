"""What a join writes, and when, and what the card says about it.

Accepting an invite is downloading somebody else's files, so the app offers
a list first and writes nothing until the answer. That was the intent, said
in four places, and it was not what happened: the join flushed every
document to disk and then closed the store, which flushes again, so the
folder held the whole project before the card asking about it was drawn.

The Windows laptop proved it with timestamps. With the card still on screen
its folder held `main.tex` complete and readable from preamble to
`\\end{document}`, and two other files carrying an mtime a full minute older
than the card. Discard would have had to delete real files rather than
decline to create them.

It also found the two smaller ones: a file offered that never arrived, and
three sizes on the card none of which matched what landed.
"""

import asyncio

import pytest

from server import main as server_main


class Body:
    def __init__(self, text=""):
        self.text = text

    def __str__(self):
        return self.text


class Store:
    """Just enough of a `CollabStore` for the offer builder."""

    def __init__(self, files, bodies):
        self.files = files
        self.bodies = bodies
        self.project = None

    def body(self, file_id):
        return self.bodies.get(file_id)


def test_the_card_measures_what_arrived_and_not_what_was_recorded(tmp_path):
    """`size` is written once, when the sharer first adopts a file, and is
    never refreshed as the document is edited. The card was quoting a
    number from whenever the project was first shared: the laptop was shown
    3 kB for a file that landed at 957 bytes."""
    from nexttex.project import Project

    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text("x", encoding="utf-8")
    project = Project.open(root)

    store = Store(
        files={
            "a": {"path": "main.tex", "kind": "text", "size": 3679, "trashed": False},
        },
        bodies={"a": Body("Nine char")},
    )

    offered = server_main._offered_files(store, project)

    assert [item["size"] for item in offered] == [9], (
        "the card is still quoting the size the sharer recorded"
    )


def test_a_file_with_no_extension_is_offered_as_text(tmp_path):
    """`figures/.gitkeep` was classified binary, because its suffix is
    empty, and blob transfer carries history blobs by content address and
    never file bodies. So it was named in the manifest, listed on the card,
    accepted, and never written."""
    from nexttex.project import kind_of

    for name in ("figures/.gitkeep", ".gitignore", "README", "Makefile"):
        assert kind_of(name) == "text", f"{name} is not carried between peers"


@pytest.mark.parametrize("size,body,waits", [
    (12, "", True),      # named, sized, and its text has not landed
    (12, "hello", False),  # arrived
    (0, "", False),      # really is empty, so waiting would never end
])
def test_the_wait_is_for_the_bodies_and_not_the_manifest(size, body, waits):
    """`send_documents` pipelines the bodies behind the manifest without
    waiting for a reply, so "a text record exists" was true well before the
    text was. The wait ended, half a second was slept for luck, and
    whatever had not landed was written to disk as an empty file."""
    store = Store(
        files={"a": {"path": "main.tex", "kind": "text", "size": size,
                     "trashed": False}},
        bodies={"a": Body(body)},
    )

    async def run():
        return await server_main._wait_for_the_project(store, seconds=0.4)

    reason = asyncio.run(run())
    if waits:
        assert reason, "it stopped waiting while a body was still missing"
        assert "part of that project" in reason
    else:
        assert reason == ""


class Pending:
    """A join waiting for an answer, recording what is done to it."""

    def __init__(self, tmp_path):
        self.target = tmp_path / "joined"
        self.target.mkdir()
        (self.target / "already-here.tex").write_text("x", encoding="utf-8")
        self.token = "tok"
        self.project = type("P", (), {"id": "pid"})()
        self.did: list[str] = []
        self.store = self
        self.network = self
        self.at = 0.0

    # what the route calls on the store
    def project_everything(self):
        self.did.append("project_everything")

    def flush(self):
        self.did.append("flush")

    def close(self):
        self.did.append("close")

    async def release(self, keep: bool):
        self.did.append(f"release keep={keep}")
        if not keep:
            import shutil
            shutil.rmtree(self.target, ignore_errors=True)


def test_accepting_writes_every_document_and_only_then(client, tmp_path, monkeypatch):
    pending = Pending(tmp_path)
    monkeypatch.setitem(server_main.PENDING_JOINS, "tok", pending)
    monkeypatch.setattr(server_main.REGISTRY, "add", lambda path: None)
    monkeypatch.setattr(server_main, "_restart_watch", lambda: None)

    response = client.post("/api/collab/join/accept", json={"token": "tok"})

    assert response.status_code == 200
    assert pending.did[:2] == ["project_everything", "flush"], (
        f"the accept did {pending.did}"
    )


def test_discarding_writes_nothing_and_takes_the_folder(client, tmp_path, monkeypatch):
    """Nothing was written while the card was up, so discarding has nothing
    to undo. It used to have the whole project to delete."""
    pending = Pending(tmp_path)
    monkeypatch.setitem(server_main.PENDING_JOINS, "tok", pending)

    response = client.post("/api/collab/join/discard", json={"token": "tok"})

    assert response.status_code == 200
    assert "flush" not in pending.did, "discarding flushed the documents to disk"
    assert not pending.target.exists()
