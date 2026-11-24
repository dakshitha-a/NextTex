"""A file the system will not let us replace for a moment is written later.

The laptop keeps its thesis under OneDrive, and seven times in a week a
collaborator's edit was not written to it: OneDrive held the chapter open
just as the store replaced it, Windows said "Access is denied", and the
store took that `PermissionError` for its own path fence, which is never
retried. The edit stayed in the shared document and out of the file.
"""

import os

import pytest

os.environ["NEXTTEX_COLLAB_TRANSPORT"] = "loopback"

from nexttex.project import PathRefused, Project             # noqa: E402
from server.collab import store as store_module              # noqa: E402
from server.collab.store import CollabStore                  # noqa: E402


@pytest.fixture
def store(tmp_path):
    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text("The chapter.\n")
    made = CollabStore(Project.open(root))
    made.adopt()
    yield made
    made.close()


def test_access_denied_by_the_system_is_tried_again(store, monkeypatch):
    file_id = next(key for key, record in store.files.items()
                   if record.get("path") == "main.tex")
    body = store.body(file_id)
    body += "A collaborator's sentence.\n"

    real = store_module.write_atomically
    held = {"times": 1}

    def held_open(path, content, **kwargs):
        if held["times"]:
            held["times"] -= 1
            raise PermissionError(13, "Access is denied", str(path))
        return real(path, content, **kwargs)

    monkeypatch.setattr(store_module, "write_atomically", held_open)
    store._dirty.add(file_id)
    store.flush()
    assert file_id in store._dirty          # queued for another attempt
    assert file_id not in store._refused
    store.flush()
    assert "A collaborator's sentence." in (store.project.root / "main.tex").read_text()
    assert file_id not in store._dirty


def test_the_fence_is_still_its_own_refusal():
    assert issubclass(PathRefused, PermissionError)


def test_a_file_held_for_long_is_tried_less_and_less_often(store, monkeypatch):
    """A file a program keeps open is not tried eight times a second for as
    long as it stays open, each a failed rename on the event loop."""
    import asyncio

    file_id = next(key for key, record in store.files.items()
                   if record.get("path") == "main.tex")
    body = store.body(file_id)
    body += "More.\n"
    real_write = store_module.write_atomically

    def held_open(path, content, **kwargs):
        raise PermissionError(13, "Access is denied", str(path))

    monkeypatch.setattr(store_module, "write_atomically", held_open)
    waits: list[float] = []

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        real = loop.call_later

        def noted(delay, callback, *args):
            waits.append(delay)
            return real(delay, callback, *args)

        monkeypatch.setattr(loop, "call_later", noted)
        for _ in range(8):
            store._dirty.add(file_id)
            store.flush()
            if store._timer is not None:
                store._timer.cancel()
                store._timer = None

    asyncio.run(scenario())
    assert waits[0] == store_module.PROJECT_DEBOUNCE * 2
    assert waits == sorted(waits)
    assert waits[-1] == store_module.RETRY_MOST
    # And once it can be written, the count starts again.
    monkeypatch.setattr(store_module, "write_atomically", real_write)
    store._dirty.add(file_id)
    store.flush()
    assert store._failures == 0
    assert "More." in (store.project.root / "main.tex").read_text()
