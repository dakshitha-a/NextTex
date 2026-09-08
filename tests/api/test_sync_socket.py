"""The document socket.

Two things are being protected here.

The first is that **this route authenticates itself**.  Starlette's HTTP
middleware does not run for the websocket scope, so the check that guards
every other route in this app does not guard this one, and a version of it
that forgot would hand every document to anyone who could reach the port
while looking, on screen, exactly like a version that did not.  A test is the
only thing that notices.

The second is that two connections converge.  That is the whole reason any
of this exists.
"""

import pytest
from pycrdt import (
    Doc, Text, create_sync_message, create_update_message, handle_sync_message,
)

from server import main as server_main


@pytest.fixture
def project_id(opened) -> str:
    """The id of an open project. `opened` comes from the shared conftest."""
    return opened["id"]


def file_id_of(project_id: str, relative: str) -> str:
    return server_main.SESSIONS[project_id].collab.file_id_for(relative)


def waiting(socket, seconds: float = 0.4) -> list[bytes]:
    """Every message already queued for this socket, and no blocking.

    `receive_bytes()` waits forever, so a test that reads one message more
    than the server sent hangs the whole run rather than failing -- which is
    what the first draft of this file did.  The session's stream is
    reachable, so a deadline can be put on it.
    """
    import anyio

    async def once():
        with anyio.move_on_after(seconds):
            return await socket._send_rx.receive()
        return None

    messages: list[bytes] = []
    while True:
        message = socket.portal.call(once)
        if message is None or message.get("type") == "websocket.close":
            return messages
        payload = message.get("bytes")
        if payload:
            messages.append(payload)


class Peer:
    """A browser's half of the conversation, in as few lines as possible."""

    def __init__(self, socket):
        self.socket = socket
        self.doc = Doc()
        self.text = None
        self.awareness: list[bytes] = []
        self._applying = False
        # A local change is pushed as an update, exactly as the browser's
        # provider does it -- a state vector only *asks*, so a peer that
        # only ever announced would receive everything and send nothing.
        self._subscription = self.doc.observe(self._changed)
        # Both ends open with their own state vector. The server's step 1
        # asks what we have; ours asks what it has, and its answer is the
        # file's contents.
        self.announce()

    def _changed(self, event) -> None:
        if self._applying:
            return
        self.socket.send_bytes(create_update_message(event.update))

    def pump(self) -> None:
        """Apply everything waiting, and answer what needs answering."""
        for message in waiting(self.socket):
            if message[0] == 1:
                self.awareness.append(message)
                continue
            self._applying = True
            try:
                reply = handle_sync_message(message[1:], self.doc)
            finally:
                self._applying = False
            if reply is not None:
                self.socket.send_bytes(reply)

    def announce(self) -> None:
        """Tell the server what this document now holds."""
        self.socket.send_bytes(create_sync_message(self.doc))

    def open_text(self):
        self.text = self.doc.get("text", type=Text)
        return self.text


# --- authentication ---------------------------------------------------------


def test_the_socket_refuses_a_browser_with_no_credentials(project_id, project_dir):
    """The one that would not show up any other way."""
    from starlette.testclient import TestClient
    from websockets.exceptions import WebSocketException
    from starlette.websockets import WebSocketDisconnect

    anonymous = TestClient(server_main.app)
    file_id = file_id_of(project_id, "main.tex")
    with pytest.raises((WebSocketDisconnect, WebSocketException, Exception)):
        with anonymous.websocket_connect(
            f"/api/projects/{project_id}/sync/text/{file_id}"
        ) as socket:
            socket.receive_bytes()


def test_the_socket_refuses_a_forged_session(project_id):
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    forged = TestClient(server_main.app)
    forged.cookies.set(server_main.COOKIE, "not-a-session", domain="testserver.local")
    file_id = file_id_of(project_id, "main.tex")
    with pytest.raises(Exception):
        with forged.websocket_connect(
            f"/api/projects/{project_id}/sync/text/{file_id}"
        ) as socket:
            socket.receive_bytes()


def test_an_unknown_document_is_refused(client, project_id):
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/projects/{project_id}/sync/text/nosuchfileid"
        ) as socket:
            socket.receive_bytes()


# --- the document itself ----------------------------------------------------


def test_a_browser_is_handed_what_the_file_says(client, project_id, project_dir):
    file_id = file_id_of(project_id, "main.tex")
    with client.websocket_connect(
        f"/api/projects/{project_id}/sync/text/{file_id}"
    ) as socket:
        peer = Peer(socket)
        peer.pump()
        assert str(peer.open_text()) == (project_dir / "main.tex").read_text()


def test_two_browsers_converge_without_anybody_being_refused(client, project_id):
    """What replaces the conflict banner.

    Both tabs type into the same file at the same time. Before, the second
    save was refused and offered back as a choice; now both edits are in
    both documents and nobody was asked anything.
    """
    file_id = file_id_of(project_id, "main.tex")
    path = f"/api/projects/{project_id}/sync/text/{file_id}"

    with client.websocket_connect(path) as first_socket:
        with client.websocket_connect(path) as second_socket:
            first, second = Peer(first_socket), Peer(second_socket)
            first.pump()
            second.pump()
            first.open_text()
            second.open_text()

            first.text.insert(0, "% from the first tab\n")
            first.pump()
            second.pump()

            second.text.insert(0, "% from the second tab\n")
            second.pump()
            first.pump()
            second.pump()

            both = str(first.text)
            assert "% from the first tab" in both
            assert "% from the second tab" in both
            assert str(second.text) == both


def test_typing_in_the_browser_reaches_the_file(client, project_id, project_dir):
    """And through the seams: a version is recorded, so a collaborator's
    typing is in the history like anybody's."""
    file_id = file_id_of(project_id, "main.tex")
    session = server_main.SESSIONS[project_id]
    with client.websocket_connect(
        f"/api/projects/{project_id}/sync/text/{file_id}"
    ) as socket:
        peer = Peer(socket)
        peer.pump()
        peer.open_text().insert(0, "% typed in a browser\n")
        peer.pump()

    session.collab.flush()
    assert (project_dir / "main.tex").read_text().startswith("% typed in a browser\n")
    assert session.history.versions("main.tex")


def test_the_manifest_lists_the_project(client, project_id):
    from pycrdt import Map

    with client.websocket_connect(f"/api/projects/{project_id}/sync/manifest") as socket:
        peer = Peer(socket)
        peer.pump()
        files = peer.doc.get("files", type=Map)
        paths = {record["path"] for record in files.values()}
        assert "main.tex" in paths


# --- awareness --------------------------------------------------------------


def awareness_frame(who: str):
    """A real awareness update, of the shape a browser sends."""
    from pycrdt import Awareness, Doc, create_awareness_message

    doc = Doc()
    awareness = Awareness(doc)
    awareness.set_local_state({"user": {"name": who}})
    return doc.client_id, create_awareness_message(
        awareness.encode_awareness_update([doc.client_id])
    )


def names_in(frames, doc=None):
    """The names carried by a list of awareness frames."""
    from pycrdt import Awareness, Doc, read_message

    reader = Awareness(doc or Doc())
    for frame in frames:
        reader.apply_awareness_update(read_message(frame[1:]), "test")
    return {
        (state or {}).get("user", {}).get("name")
        for state in reader.states.values()
        if state
    }


def test_a_cursor_reaches_the_other_browser(client, project_id):
    file_id = file_id_of(project_id, "main.tex")
    path = f"/api/projects/{project_id}/sync/text/{file_id}"
    _, frame = awareness_frame("Alice")

    with client.websocket_connect(path) as first_socket:
        with client.websocket_connect(path) as second_socket:
            first, second = Peer(first_socket), Peer(second_socket)
            first.pump()
            second.pump()
            first_socket.send_bytes(frame)
            second.pump()
            assert "Alice" in names_in(second.awareness)
            # And not back to the browser that sent it.
            first.pump()
            assert "Alice" not in names_in(first.awareness)


def test_a_tab_arriving_late_is_told_who_is_already_there(client, project_id):
    file_id = file_id_of(project_id, "main.tex")
    path = f"/api/projects/{project_id}/sync/text/{file_id}"
    _, frame = awareness_frame("Alice")

    with client.websocket_connect(path) as first_socket:
        first = Peer(first_socket)
        first.pump()
        first_socket.send_bytes(frame)
        first.pump()

        with client.websocket_connect(path) as second_socket:
            second = Peer(second_socket)
            second.pump()
            assert "Alice" in names_in(second.awareness)


def test_a_cursor_is_taken_down_when_its_browser_goes(client, project_id):
    """The ghost this had at first.

    y-protocols drops a silent peer only after thirty seconds, and that
    timeout is a module constant -- so a collaborator who closed their laptop
    sat in the margin, caret and all, for half a minute. The server knows
    which ids belonged to the socket that just closed, and says so at once.
    """
    from pycrdt import Awareness, Doc

    file_id = file_id_of(project_id, "main.tex")
    path = f"/api/projects/{project_id}/sync/text/{file_id}"
    _, frame = awareness_frame("Alice")

    reader_doc = Doc()
    reader = Awareness(reader_doc)

    with client.websocket_connect(path) as watcher_socket:
        watcher = Peer(watcher_socket)
        watcher.pump()

        with client.websocket_connect(path) as leaver_socket:
            Peer(leaver_socket).pump()
            leaver_socket.send_bytes(frame)
            watcher.pump()
            assert "Alice" in names_in(watcher.awareness, reader_doc)

        # Alice's window has closed.
        watcher.awareness.clear()
        watcher.pump()
        assert watcher.awareness, "nothing was said about the cursor going"

        from pycrdt import read_message

        for message in watcher.awareness:
            reader.apply_awareness_update(read_message(message[1:]), "test")
        assert not [state for state in reader.states.values() if state]
