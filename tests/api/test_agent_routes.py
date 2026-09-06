"""The agent's routes, driven by the scripted stand-in.

Waiting is on the agent rather than on the event stream: a turn can finish
before a subscriber arrives, and a test that races the thing it measures is
worse than no test.  What the turn *did* is read back from the transcript,
which is what the panel itself replays after a reload.
"""

from conftest import use_script, wait_idle


def transcript(client, project_id):
    return client.post(f"/api/projects/{project_id}/open").json()["transcript"]


# -- the model picker -------------------------------------------------------
def test_changing_the_model_does_not_500(client, opened):
    """Setting the *same* model twice returned 200, which is how a broken
    switch survived being used."""
    response = client.post(
        f"/api/projects/{opened['id']}/agent/model", json={"model": "claude-sonnet-5"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["model"] == "claude-sonnet-5"


def test_the_chosen_model_is_remembered(client, opened):
    client.post(f"/api/projects/{opened['id']}/agent/model",
                json={"model": "claude-opus-5"})
    usage = client.get(f"/api/projects/{opened['id']}/agent/usage").json()
    assert usage["model"] == "claude-opus-5"


def test_an_unknown_model_is_refused(client, opened):
    response = client.post(
        f"/api/projects/{opened['id']}/agent/model", json={"model": "gpt-9"}
    )
    assert response.status_code == 400


def test_the_default_model_can_be_chosen_back(client, opened):
    client.post(f"/api/projects/{opened['id']}/agent/model",
                json={"model": "claude-opus-5"})
    response = client.post(f"/api/projects/{opened['id']}/agent/model",
                           json={"model": ""})
    assert response.status_code == 200
    assert client.get(
        f"/api/projects/{opened['id']}/agent/usage").json()["model"] == ""


# -- a turn -----------------------------------------------------------------
def test_asking_records_the_question_and_the_answer(client, opened):
    client.post(f"/api/projects/{opened['id']}/agent/ask",
                json={"prompt": "What does a label do?"})
    wait_idle(opened["id"])
    items = transcript(client, opened["id"])
    kinds = [item["kind"] for item in items]
    assert kinds[0] == "user" and "claude" in kinds
    assert "label" in "".join(i.get("text", "") for i in items if i["kind"] == "claude")


def test_streamed_text_is_stored_as_one_paragraph(client, opened):
    """The turn arrives in fragments; the transcript keeps prose, not deltas."""
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "hello"})
    wait_idle(opened["id"])
    said = [i for i in transcript(client, opened["id"]) if i["kind"] == "claude"]
    assert len(said) == 1


def test_a_second_question_while_one_is_running_is_refused(client, opened):
    use_script(opened["id"], "slow")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "one"})
    second = client.post(f"/api/projects/{opened['id']}/agent/ask",
                         json={"prompt": "two"})
    assert second.status_code == 409
    client.post(f"/api/projects/{opened['id']}/agent/interrupt")


def test_a_turn_can_be_interrupted(client, opened):
    use_script(opened["id"], "slow")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "one"})
    assert client.post(
        f"/api/projects/{opened['id']}/agent/interrupt").status_code == 200
    wait_idle(opened["id"], 2.0)
    assert client.post(f"/api/projects/{opened['id']}/agent/ask",
                       json={"prompt": "after"}).status_code == 200


# -- an edit ----------------------------------------------------------------
def test_an_agent_edit_is_written_versioned_and_recorded(client, opened, project_dir):
    use_script(opened["id"], "edit")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "add one"})
    wait_idle(opened["id"])

    on_disk = (project_dir / "main.tex").read_text(encoding="utf-8")
    assert "A sentence the scripted agent inserted." in on_disk

    versions = client.get(f"/api/projects/{opened['id']}/history",
                          params={"path": "main.tex"}).json()["versions"]
    assert any(v["by"] == "claude" for v in versions), versions

    edits = [i for i in transcript(client, opened["id"]) if i["kind"] == "edit"]
    assert len(edits) == 1 and edits[0]["path"] == "main.tex"
    assert edits[0]["after"] == on_disk


def test_undoing_an_agent_edit_puts_the_old_text_back(client, opened, project_dir):
    use_script(opened["id"], "edit")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "add one"})
    wait_idle(opened["id"])
    edit = [i for i in transcript(client, opened["id"]) if i["kind"] == "edit"][0]

    response = client.post(
        f"/api/projects/{opened['id']}/agent/undo",
        json={"path": "main.tex", "before": edit["before"], "after": edit["after"],
              "edit_id": edit["id"], "state": "reverted"},
    )
    assert response.json() == {"ok": True}
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == edit["before"]
    again = [i for i in transcript(client, opened["id"]) if i["kind"] == "edit"][0]
    assert again["state"] == "reverted"


def test_an_undo_that_would_clobber_newer_work_refuses(client, opened):
    response = client.post(
        f"/api/projects/{opened['id']}/agent/undo",
        json={"path": "main.tex", "before": "old", "after": "not what is on disk"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": False, "reason": "changed since"}


def test_a_redo_is_not_recorded_as_an_undo(client, opened, project_dir):
    """Undo and redo call one route with the arguments swapped, and the
    history read 'undid one of Claude's edits' for both."""
    original = (project_dir / "main.tex").read_text(encoding="utf-8")
    client.put(f"/api/projects/{opened['id']}/file",
               json={"path": "main.tex", "text": "edited", "compile": False})
    client.post(f"/api/projects/{opened['id']}/agent/undo",
                json={"path": "main.tex", "before": original, "after": "edited",
                      "state": "reverted"})
    client.post(f"/api/projects/{opened['id']}/agent/undo",
                json={"path": "main.tex", "before": "edited", "after": original,
                      "state": "live"})
    whys = [v["why"] for v in client.get(
        f"/api/projects/{opened['id']}/history",
        params={"path": "main.tex"}).json()["versions"]]
    assert any("undid" in why for why in whys), whys
    assert any("put" in why or "redid" in why for why in whys), whys


# -- permission -------------------------------------------------------------
def test_a_permission_request_waits_for_an_answer(client, opened):
    use_script(opened["id"], "permission")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "run it"})
    import time
    time.sleep(0.6)                       # the script reaches the card quickly
    asked = [i for i in transcript(client, opened["id"]) if i["kind"] == "permission"]
    assert len(asked) == 1
    assert client.post(f"/api/projects/{opened['id']}/agent/permission",
                       json={"id": asked[0]["id"], "decision": "allow"}
                       ).json() == {"resolved": True}
    wait_idle(opened["id"])
    answered = [i for i in transcript(client, opened["id"])
                if i["kind"] == "permission"][0]
    assert answered["decision"] == "allow"


def test_an_unknown_decision_is_refused(client, opened):
    response = client.post(f"/api/projects/{opened['id']}/agent/permission",
                           json={"id": "nope", "decision": "maybe"})
    assert response.status_code == 400


def test_answering_a_card_that_is_gone_says_so(client, opened):
    response = client.post(f"/api/projects/{opened['id']}/agent/permission",
                           json={"id": "perm-does-not-exist", "decision": "allow"})
    assert response.json() == {"resolved": False}


# -- usage ------------------------------------------------------------------
def test_usage_accumulates_over_turns(client, opened):
    before = client.get(f"/api/projects/{opened['id']}/agent/usage").json()["usage"]
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "one"})
    wait_idle(opened["id"])
    after = client.get(f"/api/projects/{opened['id']}/agent/usage").json()["usage"]
    assert after["turns"] == before["turns"] + 1


def test_the_model_list_is_offered_with_usage(client, opened):
    body = client.get(f"/api/projects/{opened['id']}/agent/usage").json()
    assert [entry["id"] for entry in body["models"]][0] == ""
    assert all({"id", "name", "note"} <= set(entry) for entry in body["models"])
