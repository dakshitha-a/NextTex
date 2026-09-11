"""What the transcript says when nothing was asked.

The safety argument for the position that puts up no cards rests entirely on
this file: every action is still recorded, so the writer can read afterwards
what was done. Nothing asserted that the record was actually complete or
actually readable, which is a gap in exactly the place where it matters
most, because there is no card to have noticed the action at the time.

Read it with `-s` to see the account itself rather than only the assertions.
"""

from tests.api.conftest import wait_idle


def transcript(client, project_id):
    return client.post(f"/api/projects/{project_id}/open").json()["transcript"]


def run(client, project_id, script, question):
    from server import main as server_main

    server_main.SESSIONS[project_id].agent.script_name = script
    client.post(f"/api/projects/{project_id}/agent/ask", json={"prompt": question})
    wait_idle(project_id)


def test_nothing_was_asked_and_everything_was_written_down(client, opened, capsys):
    client.post(f"/api/projects/{opened['id']}/agent/mode", json={"mode": "all"})

    for script, question in [
        ("twobuilds", "Build it twice."),
        ("network", "Fetch that paper."),
        ("outside", "Write a note beside the project."),
    ]:
        run(client, opened["id"], script, question)

    items = transcript(client, opened["id"])

    with capsys.disabled():
        print("\n  what the record says, with nothing having been asked:")
        for item in items:
            kind = item["kind"]
            if kind == "user":
                print(f"\n    you        {item['text']}")
            elif kind == "claude":
                print(f"    claude     {item['text'][:80]}")
            elif kind == "tool":
                print(f"    ran        {item['name']}")
            elif kind == "edit":
                print(f"    edited     {item['path']}")
            elif kind == "permission":
                print(
                    f"    {item.get('decision', 'asked'):10} "
                    f"{item.get('headline', '')} | {item.get('detail', '')[:40]}"
                )
            elif kind == "notice":
                print(f"    notice     {item['text'][:70]}")

    # Every question is there, in order, and answered.
    asked = [item["text"] for item in items if item["kind"] == "user"]
    assert asked == [
        "Build it twice.", "Fetch that paper.", "Write a note beside the project.",
    ]

    # And every action that nobody was asked about is there, marked as one.
    records = [item for item in items if item["kind"] == "permission"]
    assert len(records) >= 4, [r.get("headline") for r in records]
    assert all(record["decision"] == "auto" for record in records)

    # Each one says what it actually did, not just that something happened.
    said = " ".join(record.get("detail", "") for record in records)
    assert "latexmk" in said
    assert "example.invalid" in said
    assert "nexttex-note.txt" in said

    # Including the two this position is the only one that would let through
    # in silence, which is the whole reason the record has to be complete.
    headlines = " ".join(record.get("headline", "") for record in records)
    assert "internet" in headlines
    assert "outside the project" in headlines


def test_the_middle_position_records_what_it_ran_silently(client, opened):
    """The same promise one position up, where the two gates still ask."""
    client.post(f"/api/projects/{opened['id']}/agent/mode", json={"mode": "project"})
    run(client, opened["id"], "twobuilds", "Build it twice.")
    records = [
        item for item in transcript(client, opened["id"])
        if item["kind"] == "permission"
    ]
    assert records and all(record["decision"] == "auto" for record in records)
    assert "latexmk" in " ".join(record.get("detail", "") for record in records)
