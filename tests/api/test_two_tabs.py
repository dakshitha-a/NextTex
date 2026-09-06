"""Two windows on one project.

The rule this defends: nothing a writer typed is lost without them being
told.  Before the `base` check, the second tab's autosave wrote its whole
stale buffer over everything the first tab had saved -- no error, no dirty
marker, and the only copy left was in the version history.
"""

import time


def save(client, project_id, text, base=0.0, origin=""):
    return client.put(
        f"/api/projects/{project_id}/file",
        json={"path": "main.tex", "text": text, "compile": False,
              "base": base, "origin": origin},
    )


def test_a_save_reports_the_time_it_wrote(client, opened):
    body = save(client, opened["id"], "first").json()
    assert body["ok"] is True and body["mtime"] > 0


def test_a_stale_tab_is_refused_rather_than_believed(client, opened, project_dir):
    """Tab A saves; tab B, which last read the file a minute ago, saves its
    own copy.  B must not win by arriving second."""
    first = save(client, opened["id"], "what tab A wrote").json()
    stale = first["mtime"] - 60
    answer = save(client, opened["id"], "what tab B still had", base=stale).json()

    assert answer["ok"] is False and answer["conflict"] is True
    assert answer["text"] == "what tab A wrote"
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == "what tab A wrote"


def test_saving_against_the_time_you_were_given_works(client, opened, project_dir):
    first = save(client, opened["id"], "one").json()
    second = save(client, opened["id"], "two", base=first["mtime"]).json()
    assert second["ok"] is True
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == "two"


def test_writing_the_same_text_is_never_a_conflict(client, opened):
    """Both tabs holding identical text is not a disagreement, and a beacon
    save on tab close must not fail because of one."""
    first = save(client, opened["id"], "agreed").json()
    again = save(client, opened["id"], "agreed", base=first["mtime"] - 600).json()
    assert again["ok"] is True


def test_a_save_tells_the_other_tabs(client, opened):
    """Tab B is told to reload, and hears whose save it was so the tab that
    made it does not reload itself."""
    from conftest import server_main

    session = server_main.SESSIONS[opened["id"]]
    seen = []
    original = session.events.publish

    async def spy(event):
        seen.append(event)
        await original(event)

    session.events.publish = spy
    save(client, opened["id"], "changed", origin="tab-a")
    session.events.publish = original

    told = [e for e in seen if e["type"] == "files_changed"]
    assert told and told[0]["origin"] == "tab-a"
    assert told[0]["paths"] == ["main.tex"]


def test_a_save_that_changes_nothing_says_nothing(client, opened):
    from conftest import server_main

    save(client, opened["id"], "same")
    session = server_main.SESSIONS[opened["id"]]
    seen = []
    original = session.events.publish

    async def spy(event):
        seen.append(event)
        await original(event)

    session.events.publish = spy
    save(client, opened["id"], "same")
    session.events.publish = original
    assert [e for e in seen if e["type"] == "files_changed"] == []
