"""The agent reads a file's open comments and answers them in the thread.

A co-author's comments sat beside the text where only the writer could
answer them. Both providers now have two tools, `list_comments` and
`reply_to_comment`, over the session's `agent_comments` and `agent_reply`,
and a reply is a message in the thread like anyone's, under the agent's own
name and a peer of its own, so it is never taken for the writer's.
"""

from __future__ import annotations

import server.main as server_main

from tests.api.test_comments_routes import anchors, first_words


def a_thread(client, pid, project_dir, body="Is this ours?"):
    words = first_words(project_dir)
    start, end = anchors(client, pid, "main.tex", words)
    made = client.post(f"/api/projects/{pid}/comments", json={
        "path": "main.tex", "start": start, "end": end, "quote": words,
        "line": 1, "body": body,
    })
    assert made.status_code == 200, made.text
    return made.json()["id"], words


def test_the_agent_reads_open_threads_and_replies_under_its_own_name(client, opened, project_dir):
    pid = opened["id"]
    thread_id, words = a_thread(client, pid, project_dir)

    def read():
        return server_main.session_for(pid).agent_comments("main.tex")

    [seen] = client.portal.call(read)
    assert seen["id"] == thread_id
    assert seen["quote"] == words
    assert seen["messages"][0]["body"] == "Is this ours?"

    def reply():
        return server_main.session_for(pid).agent_reply(thread_id, "Yes, from the 2019 run.")

    assert client.portal.call(reply) == words

    [thread] = client.get(f"/api/projects/{pid}/comments").json()["threads"]
    first, answer = thread["messages"]
    assert answer["body"] == "Yes, from the 2019 run."
    assert answer["name"] == "Claude"
    assert answer["agent"] is True
    # Not the writer's own, though it was written by this install.
    assert answer["mine"] is False
    assert first.get("agent") is not True
    # A reply is words: the thread stays open for a person to close.
    assert not thread["resolved"]


def test_a_resolved_thread_is_not_offered_and_another_file_is_not_listed(client, opened, project_dir):
    pid = opened["id"]
    thread_id, _ = a_thread(client, pid, project_dir)
    client.post(f"/api/projects/{pid}/comments/{thread_id}/resolve", json={"resolved": True})

    def read(path):
        return lambda: server_main.session_for(pid).agent_comments(path)

    assert client.portal.call(read("main.tex")) == []
    assert client.portal.call(read("")) == []
    assert client.portal.call(read("other.tex")) == []


def test_a_reply_to_a_thread_that_is_gone_says_so(client, opened, project_dir):
    pid = opened["id"]

    def reply():
        try:
            server_main.session_for(pid).agent_reply("c000000000000", "Hello")
        except LookupError as error:
            return str(error)
        return "no error"

    assert "no such thread" in client.portal.call(reply)
