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


def test_a_missing_shared_project_still_says_which_share_it_was(client, opened, project_dir):
    """From the card in the state directory, since the folder is gone."""
    project_id = opened["id"]
    state = client.post(f"/api/projects/{project_id}/collab/share",
                        json={"name": "Wilhelmina"}).json()
    share_id = state["shareId"]

    listed = client.get("/api/projects").json()["projects"]
    row = next(p for p in listed if p["id"] == project_id)
    assert row["shared"] is True and row["shareId"] == share_id
    assert row["removed"] is False

    shutil.rmtree(project_dir)
    assert _wait(lambda: project_id not in server_main.SESSIONS)
    listed = client.get("/api/projects").json()["projects"]
    row = next(p for p in listed if p["id"] == project_id)
    assert row["missing"] is True
    assert row["shared"] is True and row["shareId"] == share_id


def test_a_private_project_carries_no_share(client, opened):
    listed = client.get("/api/projects").json()["projects"]
    row = next(p for p in listed if p["id"] == opened["id"])
    assert row["shared"] is False and row["shareId"] == "" and row["removed"] is False


def test_a_card_for_a_share_this_install_was_removed_from_says_so(client, opened):
    project_id = opened["id"]
    state = client.post(f"/api/projects/{project_id}/collab/share",
                        json={"name": "A"}).json()
    peers = server_main.SESSIONS[project_id].peers
    peers.share.members[state["me"]]["removed_at"] = 1.0
    peers.share.save()
    listed = client.get("/api/projects").json()["projects"]
    row = next(p for p in listed if p["id"] == project_id)
    assert row["removed"] is True


def test_a_card_that_is_not_one_is_ignored(client, opened):
    """Anything in the shares directory that is not a well-formed card."""
    from nexttex.paths import shares_home

    home = shares_home()
    home.mkdir(parents=True, exist_ok=True)
    (home / "notes.txt").write_text("not a card")
    (home / f"{'e' * 32}.json").write_text("{not json")
    (home / f"{'f' * 32}.json").write_text('{"share_id": "other", "path": "/x"}')
    listed = client.get("/api/projects").json()["projects"]
    assert all(p["shared"] is False for p in listed)


def test_a_file_written_before_the_watcher_started_is_adopted_when_it_does(client, opened, project_dir):
    """`adopt()` at the session's opening is before the gap, and the
    watcher reports only what happens after it; what appeared in between
    was never adopted until the project was next opened."""
    session = server_main.session_for(opened["id"])
    (project_dir / "appeared.tex").write_text("Written into the gap.\n", encoding="utf-8")
    assert session.collab.file_id_for("appeared.tex") is None

    client.portal.call(server_main._adopt_what_appeared, [session])

    assert session.collab.file_id_for("appeared.tex") is not None
    # And its history begins, as it would have had the watcher seen it.
    versions = client.get(
        f"/api/projects/{opened['id']}/history", params={"path": "appeared.tex"}
    ).json()["versions"]
    assert [v["op"] for v in versions] == ["create"]
    assert versions[0]["source"].startswith("outside:")


def test_an_edit_under_an_open_document_before_the_watcher_started_is_folded_in(
    client, opened, project_dir,
):
    """The other half of the gap. A file the manifest knew was left alone
    at the watch's start, so an edit saved from another editor in that
    second reached neither the document nor the history, and the next
    keystroke in the browser wrote the document over it."""
    session = server_main.session_for(opened["id"])

    async def open_main() -> str:
        return str(session.collab.body(session.collab.file_id_for("main.tex")))

    template = client.portal.call(open_main)
    (project_dir / "main.tex").write_text("Saved from vim in the gap.\n", encoding="utf-8")

    client.portal.call(server_main._adopt_what_appeared, [session])

    assert client.portal.call(open_main) == "Saved from vim in the gap.\n"
    versions = client.get(
        f"/api/projects/{opened['id']}/history", params={"path": "main.tex"}
    ).json()["versions"]
    assert [v["op"] for v in versions] == ["edit", "create"]
    assert versions[0]["why"] == "changed outside NextTex"
    assert client.get(
        f"/api/projects/{opened['id']}/history/blob",
        params={"path": "main.tex", "sha": versions[1]["sha"]},
    ).json()["text"] == template


def test_the_idle_watcher_wakes_when_a_project_opens(client, project):
    """Not after a second's sleep: within that second a file could be
    written and missed."""
    import time

    # With nothing open the watcher is idle and waiting on the wake event.
    assert not server_main.SESSIONS
    assert _wait(lambda: server_main.WATCH_WAKE is not None and not server_main.WATCH_RESTART, 5.0)
    started = time.monotonic()
    client.post(f"/api/projects/{project['id']}/open")
    assert _wait(lambda: bool(server_main.WATCH_RESTART), 5.0)
    assert time.monotonic() - started < 0.9


def test_the_reaper_notices_a_folder_the_watcher_did_not(client, opened, project_dir):
    """On Windows a deleted watch root produced no event at all."""
    project_id = opened["id"]
    session = server_main.session_for(project_id)
    shutil.rmtree(project_dir)
    time.sleep(0.5)
    # Whatever the watcher did or did not notice on this platform, put the
    # session back as one that has not heard, and let the reaper look.
    server_main.SESSIONS[project_id] = session
    session.root_lost = False
    session.closing = False

    client.portal.call(server_main._reap_once)

    assert session.root_lost is True
    assert _wait(lambda: project_id not in server_main.SESSIONS)
