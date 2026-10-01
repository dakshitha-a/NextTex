"""The always-on host: pairing with a code, keeping a writer's project.

The server under test is the host. The writer is a second install in the
same process, over the loopback transport, the way the rejoin tests make
one: a `PeerNetwork` with an identity of its own.
"""

from pathlib import Path

import pytest

from nexttex.project import Project
from server import main as server_main
from server.collab import endpoint, host, identity
from server.collab.peers import PeerNetwork, maker
from server.collab.store import CollabStore

WRITER = "e" * 64


@pytest.fixture
def hosting(client):
    turned = client.post("/api/host", json={"on": True}).json()
    assert turned["host"] and turned["code"].startswith(host.PREFIX)
    yield turned
    client.post("/api/host", json={"on": False})
    server_main.SETTINGS.host_paired = []
    server_main._save_settings()


@pytest.fixture
def writer(client, tmp_path):
    root = tmp_path / "writers-thesis"
    root.mkdir()
    (root / "main.tex").write_text("\\documentclass{article}\n\\begin{document}\nA thesis.\n\\end{document}\n")

    async def start():
        store = CollabStore(Project.open(root))
        store.adopt()
        network = PeerNetwork(store)
        network._me = WRITER
        network.share.card_dir = None
        network.begin_sharing("Writer")
        await network.start()
        for file_id, record in store.files.items():
            if record.get("kind") == "text":
                store.body(file_id)
        return store, network

    store, network = client.portal.call(start)
    yield {"root": root, "store": store, "network": network}

    async def stop():
        await network.close()
        store.close()

    client.portal.call(stop)


def ask(client, code: str, **extra) -> dict:
    read = host.read_code(code)

    async def go():
        return await host.ask(endpoint.endpoint_for(WRITER, maker(WRITER)),
                              read["address"], read["secret"], "Writer", **extra)

    return client.portal.call(go)


def test_a_pairing_code_pairs_once_and_a_wrong_one_is_refused(client, hosting):
    answer = ask(client, hosting["code"])
    assert answer["ok"] and answer["peer"] == identity.peer_id()
    state = client.get("/api/host").json()
    assert [p["peer"] for p in state["paired"]] == [WRITER]
    assert state["paired"][0]["name"] == "Writer"

    # A new code: the paired install is still paired, and the old secret
    # no longer pairs anybody new.
    fresh = client.post("/api/host/code").json()["code"]
    assert fresh != hosting["code"]
    assert ask(client, hosting["code"])["ok"]
    server_main.SETTINGS.host_paired = []
    refused = ask(client, hosting["code"])
    assert not refused["ok"] and "pairing code" in refused["reason"]


def test_a_host_that_is_off_says_so(client):
    turned = client.post("/api/host", json={"on": True}).json()
    code = turned["code"]
    client.post("/api/host", json={"on": False})
    answer = ask(client, code)
    assert not answer["ok"]


def test_a_kept_project_arrives_on_the_host_with_nobody_looking(client, hosting, writer):
    invite = writer["network"].invite("Writer")
    answer = ask(client, hosting["code"], invite=invite, project="Writer's thesis")
    assert answer["ok"], answer["reason"]
    state = client.get("/api/host").json()
    assert [k["name"] for k in state["kept"]] == ["Writer-s thesis"]
    kept = Path(state["root"]) / "Writer-s thesis"
    assert "A thesis." in (kept / "main.tex").read_text()
    # The writer's record says the host joined as a host.
    member = writer["network"].share.members[identity.peer_id()]
    assert member.get("role") == "host"
    # The name it paired under is the name it joins under.
    assert member.get("name") == server_main._host_name() == answer["name"]
    # Kept quietly: it builds nothing until somebody here opens it.
    session = server_main.SESSIONS[state["kept"][0]["id"]]
    assert session.quiet
    client.get(f"/api/projects/{state['kept'][0]['id']}/collab")
    assert not session.quiet
    # Asked again, it is already kept, and no second folder is made.
    again = ask(client, hosting["code"], invite=writer["network"].invite("Writer"), project="Writer's thesis")
    assert again["ok"]
    assert len(client.get("/api/host").json()["kept"]) == 1


def test_a_project_name_never_leaves_the_kept_folder(client, hosting, writer):
    invite = writer["network"].invite("Writer")
    answer = ask(client, hosting["code"], invite=invite, project="../../../escaped")
    assert answer["ok"], answer["reason"]
    root = Path(client.get("/api/host").json()["root"]).resolve()
    names = [k["name"] for k in client.get("/api/host").json()["kept"]]
    assert names == ["escaped"]
    assert (root / "escaped").is_dir()
    assert not (root.parent / "escaped").exists()


@pytest.mark.parametrize("name,folder", [
    ("Thesis", "Thesis"), ("..", "project"), (".hidden", "hidden"),
    ("a/b\\c", "a-b-c"), ("", "project"), ("x" * 200, "x" * 80),
])
def test_folder_names_are_made_here(tmp_path, name, folder):
    assert host.folder_for(tmp_path, name) == tmp_path.resolve() / folder


def test_a_taken_name_gets_a_number(tmp_path):
    (tmp_path / "Thesis").mkdir()
    assert host.folder_for(tmp_path, "Thesis").name == "Thesis (2)"


def test_a_code_that_is_not_one_is_refused(client):
    assert client.post("/api/hosts", json={"code": "hello"}).status_code == 400
    assert host.read_code("nexttex-host-v1-!!!") is None
    assert host.read_code(host.make_code("addr", "sec")) == {"address": "addr", "secret": "sec"}


def test_start_at_boot_off_linux_says_what_to_run(client, monkeypatch):
    """The route answered every other platform with "see the README for
    Windows", and the README stopped carrying that passage on 1 October
    2026. A refusal should say what to do instead, so it names the script
    and the shell it wants."""
    monkeypatch.setattr(server_main.sys, "platform", "win32")
    answer = client.post("/api/host/boot")
    assert answer.status_code == 501
    detail = answer.json()["detail"]
    assert "register-task.ps1 -AtStartup" in detail
    assert "README" not in detail
