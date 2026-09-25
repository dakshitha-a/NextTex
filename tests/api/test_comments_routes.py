"""The comment routes: a thread made, listed, answered, resolved and deleted
through the API, the path fence on the one route that takes a path, and a
refusal said in a sentence.

A thread's anchors are made by the browser from the file's shared text.
Here they are made from the server's own copy, on the app's thread, since
pycrdt's objects belong to the thread that made them.
"""

from __future__ import annotations

import base64

from pycrdt import Assoc

import server.main as server_main


def anchors(client, project_id: str, relative: str, words: str) -> tuple[str, str]:
    def make():
        session = server_main.session_for(project_id)
        store = session.collab
        text = store.body(store.file_id_for(relative))
        whole = str(text)
        at = len(whole[: whole.index(words)].encode("utf-8"))
        lead = text.sticky_index(at, Assoc.AFTER).encode()
        tail = text.sticky_index(at + len(words.encode("utf-8")), Assoc.BEFORE).encode()
        return base64.b64encode(lead).decode(), base64.b64encode(tail).decode()

    return client.portal.call(make)


def first_words(project_dir) -> str:
    """Some words from the template's main.tex that occur once."""
    text = (project_dir / "main.tex").read_text(encoding="utf-8")
    for line in text.splitlines():
        words = line.strip()
        if len(words) > 20 and text.count(words) == 1 and not words.startswith("%"):
            return words[:20]
    raise AssertionError("no unique line in the template")


def test_a_thread_through_the_routes(client, opened, project_dir):
    pid = opened["id"]
    words = first_words(project_dir)
    start, end = anchors(client, pid, "main.tex", words)

    made = client.post(f"/api/projects/{pid}/comments", json={
        "path": "main.tex", "start": start, "end": end, "quote": words,
        "line": 1, "body": "Is this ours?",
    })
    assert made.status_code == 200, made.text
    thread_id = made.json()["id"]

    [thread] = client.get(f"/api/projects/{pid}/comments").json()["threads"]
    assert thread["id"] == thread_id
    assert thread["path"] == "main.tex"
    assert thread["detached"] is False
    assert thread["messages"][0]["mine"] is True
    expected = (project_dir / "main.tex").read_text(encoding="utf-8").split(words)[0].count("\n") + 1
    assert thread["line"] == expected

    assert client.post(f"/api/projects/{pid}/comments/{thread_id}/reply",
                       json={"body": "Ours."}).status_code == 200
    assert client.post(f"/api/projects/{pid}/comments/{thread_id}/resolve",
                       json={"resolved": True}).status_code == 200
    [thread] = client.get(f"/api/projects/{pid}/comments").json()["threads"]
    assert [m["body"] for m in thread["messages"]] == ["Is this ours?", "Ours."]
    assert thread["resolved"]["mine"] is True

    assert client.delete(f"/api/projects/{pid}/comments/{thread_id}").status_code == 200
    assert client.get(f"/api/projects/{pid}/comments").json()["threads"] == []


def test_a_path_that_leaves_the_project_is_refused(client, opened, project_dir):
    pid = opened["id"]
    start, end = anchors(client, pid, "main.tex", first_words(project_dir))
    answer = client.post(f"/api/projects/{pid}/comments", json={
        "path": "../escaped.tex", "start": start, "end": end, "quote": "x",
        "line": 1, "body": "Out of bounds",
    })
    assert answer.status_code in (400, 403, 404)
    assert client.get(f"/api/projects/{pid}/comments").json()["threads"] == []


def test_refusals_are_sentences_and_ids_are_checked(client, opened, project_dir):
    pid = opened["id"]
    start, end = anchors(client, pid, "main.tex", first_words(project_dir))
    empty = client.post(f"/api/projects/{pid}/comments", json={
        "path": "main.tex", "start": start, "end": end, "quote": "x",
        "line": 1, "body": "  ",
    })
    assert empty.status_code == 400
    assert "something in it" in empty.json()["detail"]
    assert client.post(f"/api/projects/{pid}/comments/x..y/reply",
                       json={"body": "hi"}).status_code == 404
    assert client.post(f"/api/projects/{pid}/comments/c000000000000/reply",
                       json={"body": "hi"}).status_code == 400
    assert client.delete(f"/api/projects/{pid}/comments/not-an-id").status_code == 404


def test_a_thread_made_is_announced(client, opened, project_dir):
    pid = opened["id"]
    session = server_main.session_for(pid)
    seen: list[dict] = []
    original = session.events.publish

    async def publish(event):
        seen.append(event)
        await original(event)

    session.events.publish = publish
    try:
        start, end = anchors(client, pid, "main.tex", first_words(project_dir))
        client.post(f"/api/projects/{pid}/comments", json={
            "path": "main.tex", "start": start, "end": end, "quote": "x",
            "line": 1, "body": "Announced?",
        })
        client.get(f"/api/projects/{pid}/comments")
        assert any(event.get("type") == "comments_changed" for event in seen)
    finally:
        session.events.publish = original


def test_a_suggestion_is_accepted_as_an_edit_with_its_own_version(client, opened, project_dir):
    """Q-046: a comment carries the words it proposes, and Accept puts them
    in place of the quote through the ordinary save and resolves the
    thread as accepted."""
    pid = opened["id"]
    words = first_words(project_dir)
    start, end = anchors(client, pid, "main.tex", words)
    made = client.post(f"/api/projects/{pid}/comments", json={
        "path": "main.tex", "start": start, "end": end, "quote": words,
        "line": 1, "body": "Plainer?", "suggestion": "Some plainer words",
    })
    assert made.status_code == 200, made.text
    thread_id = made.json()["id"]
    [thread] = client.get(f"/api/projects/{pid}/comments").json()["threads"]
    assert thread["suggestion"] == "Some plainer words"

    taken = client.post(f"/api/projects/{pid}/comments/{thread_id}/accept")
    assert taken.status_code == 200, taken.text
    client.post(f"/api/projects/{pid}/flush")
    text = (project_dir / "main.tex").read_text(encoding="utf-8")
    assert "Some plainer words" in text and words not in text
    [thread] = client.get(f"/api/projects/{pid}/comments").json()["threads"]
    assert thread["resolved"]["accepted"] is True
    versions = client.get(f"/api/projects/{pid}/history", params={"path": "main.tex"}).json()
    assert any(v.get("why") == "Accepted a suggested change" for v in versions.get("versions", []))


def test_a_plain_comment_has_nothing_to_accept(client, opened, project_dir):
    pid = opened["id"]
    words = first_words(project_dir)
    start, end = anchors(client, pid, "main.tex", words)
    thread_id = client.post(f"/api/projects/{pid}/comments", json={
        "path": "main.tex", "start": start, "end": end, "quote": words,
        "line": 1, "body": "Only a remark.",
    }).json()["id"]
    answer = client.post(f"/api/projects/{pid}/comments/{thread_id}/accept")
    assert answer.status_code == 400
    assert "suggests no change" in answer.json()["detail"]
