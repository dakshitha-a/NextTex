"""Opening a project used to be a one way door.

Nothing evicted a session. The reaper disconnected an idle agent and left
everything else resident, so fifty projects touched over a week meant fifty
CRDT stores, symbol caches, dependency graphs and libraries held until the
server was restarted, on a machine somebody is also trying to write on.

A session can always be rebuilt from disk, so evicting one is never about
losing state. It is about what would be interrupted, which is what `in_use`
answers and what most of this file is about.
"""

import time

from server import main as server_main


def reap(client) -> None:
    """Run one pass of the reaper on the loop the app is running on.

    Not `asyncio.run`. The CRDT objects a session holds are bound to the
    thread that built them, so closing a session from a fresh loop on the
    test's own thread makes pycrdt panic outright. That is worth knowing
    rather than working around: it is why the reaper is a task on the app's
    loop and could not be, say, a thread.
    """
    client.portal.call(server_main._reap_once)


def gone_stale(session):
    """Put the last request far enough back to be past any timeout."""
    session.touched = time.monotonic() - server_main.SESSION_IDLE_TIMEOUT - 1


def test_a_project_nobody_is_using_is_given_back(client, opened):
    session = server_main.session_for(opened["id"])
    gone_stale(session)

    reap(client)

    assert opened["id"] not in server_main.SESSIONS


def test_and_the_next_request_simply_opens_it_again(client, opened):
    """Which is why evicting is safe: the door swings both ways."""
    first = server_main.session_for(opened["id"])
    gone_stale(first)
    reap(client)

    answer = client.get(f"/api/projects/{opened['id']}/tree")
    assert answer.status_code == 200
    assert server_main.session_for(opened["id"]) is not first


def test_a_project_touched_recently_is_left_alone(client, opened):
    session = server_main.session_for(opened["id"])
    reap(client)
    assert server_main.SESSIONS[opened["id"]] is session


def test_a_browser_holding_the_event_stream_keeps_it(client, opened):
    session = server_main.session_for(opened["id"])
    gone_stale(session)
    queue = session.events.subscribe()
    try:
        assert session.in_use()
        reap(client)
        assert opened["id"] in server_main.SESSIONS
    finally:
        session.events.unsubscribe(queue)


def test_a_browser_holding_an_editing_socket_keeps_it(client, opened):
    session = server_main.session_for(opened["id"])
    gone_stale(session)
    session.sync.rooms["main.tex"] = [object()]
    try:
        assert session.in_use()
        reap(client)
        assert opened["id"] in server_main.SESSIONS
    finally:
        session.sync.rooms.clear()


def test_a_shared_project_is_never_evicted(client, opened):
    """Whether or not a collaborator is connected this second.

    Closing the peer network is what takes a project off the network, and
    somebody who was told they could reach it should be able to.
    """
    session = server_main.session_for(opened["id"])
    gone_stale(session)
    session.peers.share.share_id = "a-share"
    try:
        assert session.in_use()
        reap(client)
        assert opened["id"] in server_main.SESSIONS
    finally:
        session.peers.share.share_id = ""


def test_asking_for_a_session_counts_as_using_it(client, opened):
    session = server_main.session_for(opened["id"])
    gone_stale(session)
    was = session.touched

    # Any route at all: they all come through `session_for`.
    client.get(f"/api/projects/{opened['id']}/tree")

    assert session.touched > was
    reap(client)
    assert opened["id"] in server_main.SESSIONS


def test_one_session_failing_does_not_strand_the_others(client, project_dir, monkeypatch, caplog):
    """The per-session catch, which was already here and is now load-bearing
    for eviction too rather than only for the agent."""
    import logging

    first = client.post("/api/projects", json={"path": str(project_dir)}).json()
    session = server_main.session_for(first["id"])
    gone_stale(session)

    async def refuse():
        raise RuntimeError("a test, deliberately")

    monkeypatch.setattr(session, "close", refuse)
    with caplog.at_level(logging.WARNING, logger="nexttex.server"):
        reap(client)
    assert "could not reap the idle session" in caplog.text


def test_evicting_collects_the_blobs_nothing_refers_to(client, opened, monkeypatch):
    """Collection walks the whole store and only ever ran when somebody
    emptied the trash, so a writer who never empties it kept every thinned
    blob forever. Eviction is the one moment a project is certainly idle."""
    session = server_main.session_for(opened["id"])
    gone_stale(session)

    collected: list[bool] = []
    monkeypatch.setattr(
        session.history, "collect", lambda *a, **k: collected.append(True)
    )

    reap(client)

    assert collected == [True]
    assert opened["id"] not in server_main.SESSIONS


def test_a_shared_project_still_collects_its_blobs(client, opened, monkeypatch):
    """The failure the eviction sweep was added to fix, reintroduced.

    A shared project is deliberately never evicted -- somebody may be typing
    into it from another machine this second -- and eviction was the only
    routine moment anything was swept. So unless the writer emptied the trash
    or cleared a file by hand, a shared project kept every thinned version's
    contents for ever.
    """
    session = server_main.session_for(opened["id"])
    gone_stale(session)
    session.peers.share.share_id = "a-share"
    session.collected_at = 0.0

    collected: list[bool] = []
    monkeypatch.setattr(
        session.history, "collect", lambda *a, **k: collected.append(True)
    )
    try:
        reap(client)
        assert opened["id"] in server_main.SESSIONS, "it was evicted after all"
        assert collected == [True], "a shared project was never swept"

        # And not again on the next pass, a moment later.
        reap(client)
        assert collected == [True]
    finally:
        session.peers.share.share_id = ""


def test_a_session_is_closed_before_its_blobs_are_swept(client, opened, monkeypatch):
    """Closing flushes documents that are still pending, and each of those
    writes a version. Sweeping first took its picture of what is referenced
    before those lines existed."""
    session = server_main.session_for(opened["id"])
    gone_stale(session)

    order: list[str] = []
    monkeypatch.setattr(session.history, "collect", lambda *a, **k: order.append("swept"))
    original = session.close

    async def closing():
        order.append("closed")
        await original()

    monkeypatch.setattr(session, "close", closing)
    reap(client)
    assert order == ["closed", "swept"]
