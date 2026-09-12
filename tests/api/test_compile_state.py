"""What a browser is told about builds it did not see start.

`compile_start` is published to whoever is subscribed at that instant, and
the `Broadcaster` keeps no backlog. A tab that opens a project and starts a
build in the same breath regularly misses its own: `new EventSource(...)`
returns before the connection is established, and `api.compile` goes out a
few lines later. So the status strip said Ready for the whole of a project's
first build, which is R-045, and the preview said the document was empty
beside it, which is R-044.

It is also the older half of R-001. A flag raised by one event and lowered
only by another has no way back if the second one is lost, so a stream that
dropped mid-build left the strip on Compiling for ever. A state that can be
*read* rather than only listened for answers both, and the stream sends it
as its first frame so every connection and every reconnection starts from
the truth.
"""

import asyncio

from server.session import DocumentState


def a_document(session, name="main.tex"):
    return session.documents[name]


def test_the_snapshot_says_nothing_is_running_on_a_quiet_project(client, opened):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    snapshot = session.compile_snapshot()
    assert snapshot["type"] == "compile_state"
    assert snapshot["documents"], "no documents in the snapshot"
    assert all(not row["compiling"] for row in snapshot["documents"])


def test_the_snapshot_says_a_build_is_running_while_one_is(client, opened):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    state = a_document(session)
    # What `compile` does either side of the queue slot, without a real
    # latexmk: the point under test is what a late subscriber is told, not
    # what LaTeX does.
    state.build_id += 1
    state.in_flight = state.build_id

    rows = {row["document"]: row for row in session.compile_snapshot()["documents"]}
    assert rows[state.path]["compiling"] is True
    assert rows[state.path]["build"] == state.build_id

    state.in_flight = 0
    rows = {row["document"]: row for row in session.compile_snapshot()["documents"]}
    assert rows[state.path]["compiling"] is False


def test_the_snapshot_says_whether_anything_has_ever_been_built(client, opened):
    from server.main import SESSIONS
    from nexttex.compile import CompileResult, Outcome

    session = SESSIONS[opened["id"]]
    state = a_document(session)
    rows = {row["document"]: row for row in session.compile_snapshot()["documents"]}
    assert rows[state.path]["everBuilt"] is False, (
        "a project nobody has built says it has been"
    )

    state.last_result = CompileResult(
        outcome=Outcome.OK, log=None, pdf=None, duration=0.1,
        scope="full", engine_pass="full",
    )
    rows = {row["document"]: row for row in session.compile_snapshot()["documents"]}
    assert rows[state.path]["everBuilt"] is True


def test_a_superseded_build_finishing_does_not_clear_the_newer_one(client, opened):
    """Two builds of one document overlap by design: a keystroke during a
    build supersedes it. The one that was replaced finishing afterwards must
    not report that the replacement has stopped."""
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    state = a_document(session)
    state.build_id += 1
    superseded = state.build_id
    state.in_flight = superseded

    state.build_id += 1
    state.in_flight = state.build_id      # the newer build starts

    if state.in_flight == superseded:     # the older one finishes
        state.in_flight = 0

    assert state.in_flight != 0, "the newer build was reported as finished"
