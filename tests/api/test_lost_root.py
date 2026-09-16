"""The whole path from a folder disappearing to the browser being told.

`tests/collab/test_lost_root.py` drives the store directly.  This one lets
the real watcher notice, which is what a writer's `rm -rf` reaches first,
and checks that the session closes itself and says why.
"""

import shutil
import time

from server import main as server_main


def _wait(predicate, seconds: float = 10.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


def test_a_folder_removed_under_an_open_project_closes_it(client, opened, project_dir):
    project_id = opened["id"]
    session = server_main.session_for(project_id)
    queue = session.events.subscribe()
    # Open a document, so there is something a projection could write back.
    session.collab.body(session.collab.file_id_for("main.tex"))
    # Let the watcher start watching this root before it goes: it picks a
    # newly opened project up within a second.
    assert _wait(lambda: bool(server_main.WATCH_RESTART), 5.0)
    time.sleep(0.3)

    shutil.rmtree(project_dir)

    assert _wait(lambda: project_id not in server_main.SESSIONS), (
        "the session stayed open on a folder that is not there"
    )
    assert session.root_lost is True
    assert session.collab.root_lost is True
    kinds = []
    while not queue.empty():
        kinds.append(queue.get_nowait().get("type"))
    assert "root_lost" in kinds
    # Nothing was flagged, and the folder was not brought back by a flush.
    assert not any(r.get("trashed") for r in session.collab.files.values())
    assert not project_dir.exists()

    # The list says the folder is missing, the way it does for one that
    # went while the server was down.
    listed = client.get("/api/projects").json()["projects"]
    assert [p["missing"] for p in listed if p["id"] == project_id] == [True]
