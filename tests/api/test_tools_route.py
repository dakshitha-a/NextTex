"""Which optional tools this machine has, for the interface to offer only
what will work."""

import shutil


def test_the_answer_names_each_tool_with_a_boolean(client):
    answer = client.get("/api/tools")
    assert answer.status_code == 200
    tools = answer.json()
    assert set(tools) >= {"pandoc", "pdffonts", "pdfimages", "pdftotext", "chktex"}
    assert all(isinstance(value, bool) for value in tools.values())
    assert tools["pdffonts"] == bool(shutil.which("pdffonts"))


def test_the_answer_follows_the_machine(client, monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda name: None)
    assert not any(client.get("/api/tools").json().values())
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    assert all(client.get("/api/tools").json().values())
