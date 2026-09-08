"""Two windows on one project.

The rule this defends is unchanged -- nothing a writer typed is lost -- but
the way it is kept is not.  This app used to answer a stale second tab by
*refusing* its save and offering both copies back as a banner.  That was
right while a save was a whole file arriving over HTTP with nothing
watching.  It is wrong now: the file is a shared document and the two tabs
are two views of it, so there is nothing to be stale about.

The tests below are therefore about the two windows agreeing rather than
about one of them being turned away.  `base` is still accepted by the route
and ignored, so a caller written against the old shape does not break.
"""


def save(client, project_id, text, base="", origin="", path="main.tex"):
    return client.put(
        f"/api/projects/{project_id}/file",
        json={"path": path, "text": text, "compile": False,
              "base": base, "origin": origin},
    )


def test_a_save_hands_back_a_tag_to_come_back_with(client, opened):
    body = save(client, opened["id"], "first").json()
    assert body["ok"] is True and body["tag"]


def test_reading_a_file_hands_back_the_same_kind_of_tag(client, opened):
    written = save(client, opened["id"], "first").json()
    read = client.get(f"/api/projects/{opened['id']}/file",
                      params={"path": "main.tex"}).json()
    assert read["tag"] == written["tag"]


def test_the_tag_says_what_the_file_holds_not_when_it_was_touched(client, opened,
                                                                  project_dir):
    """Rewriting a file with what it already said is not a change, and
    something that reads the clock would say it was."""
    first = save(client, opened["id"], "the same words").json()["tag"]
    (project_dir / "main.tex").write_text("the same words", encoding="utf-8")
    again = client.get(f"/api/projects/{opened['id']}/file",
                       params={"path": "main.tex"}).json()["tag"]
    assert again == first


def test_saving_against_the_tag_you_were_given_works(client, opened, project_dir):
    first = save(client, opened["id"], "one").json()
    second = save(client, opened["id"], "two", base=first["tag"]).json()
    assert second["ok"] is True
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == "two"


def test_writing_the_same_text_is_never_a_conflict(client, opened):
    """Both tabs holding identical text is not a disagreement, and a beacon
    save on tab close must not fail because of one."""
    save(client, opened["id"], "agreed")
    assert save(client, opened["id"], "agreed", base="0-0").json()["ok"] is True


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
    # Nothing appeared or disappeared, so nobody needs to walk the tree.
    assert told[0]["structural"] is False


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


def test_neither_window_loses_its_paragraph_to_the_others_burst(client, opened):
    """History collapses an editing burst into one version, and both tabs
    are "you" -- so the second tab's save replaced the first tab's version
    and the paragraph it overwrote was gone from the history as well."""
    save(client, opened["id"], "the first window's paragraph", origin="tab-a")
    tag = client.get(f"/api/projects/{opened['id']}/file",
                     params={"path": "main.tex"}).json()["tag"]
    save(client, opened["id"], "the second window's paragraph",
         base=tag, origin="tab-b")

    versions = client.get(f"/api/projects/{opened['id']}/history",
                          params={"path": "main.tex"}).json()["versions"]
    texts = [
        client.get(f"/api/projects/{opened['id']}/history/blob",
                   params={"path": "main.tex", "sha": v["sha"]}).json()["text"]
        for v in versions
    ]
    assert "the first window's paragraph" in texts
    assert "the second window's paragraph" in texts


# --- what replaced the refusal ---------------------------------------------


def document_of(project_id: str, relative: str = "main.tex"):
    from server import main as server_main

    session = server_main.SESSIONS[project_id]
    file_id = session.collab.file_id_for(relative)
    return session, session.collab.body(file_id)


def test_a_stale_save_merges_instead_of_being_refused(client, opened, project_dir):
    """The test this file was built around, inverted.

    Tab A saves; tab B saves its own copy against a tag from a minute ago.
    B used to be refused, and the writer was asked which copy survived.
    Now the two are folded together and nobody is asked anything.
    """
    project_id = opened["id"]
    stale = client.get(f"/api/projects/{project_id}/file",
                       params={"path": "main.tex"}).json()["tag"]
    save(client, project_id, "what tab A wrote\n")
    answer = save(client, project_id, "what tab B still had\n", base=stale).json()

    assert answer["ok"] is True
    assert "conflict" not in answer

    session, _ = document_of(project_id)
    session.collab.flush()
    assert (project_dir / "main.tex").read_text() == "what tab B still had\n"


def test_a_save_reaches_the_shared_document(client, opened):
    """Which is how the other window hears about it without reloading."""
    project_id = opened["id"]
    save(client, project_id, "a line from the other tab\n")
    _, body = document_of(project_id)
    assert str(body) == "a line from the other tab\n"


def test_two_windows_each_keep_their_own_paragraph(client, opened, project_dir):
    """Both windows type into one file at the same time, in different
    places.  Under the old rule one of them was refused; both edits now
    survive, which is the whole reason for the change."""
    project_id = opened["id"]
    save(client, project_id, "one\ntwo\nthree\n")
    session, body = document_of(project_id)

    body.insert(0, "% from the first window\n")
    body.insert(len(str(body)), "% from the second window\n")
    session.collab.flush()

    on_disk = (project_dir / "main.tex").read_text()
    assert "% from the first window" in on_disk
    assert "% from the second window" in on_disk
    assert "one\ntwo\nthree\n" in on_disk


def test_the_agent_edit_reaches_the_open_windows(client, opened, project_dir):
    """An agent write is suppressed for the file watcher -- correctly, it is
    our own write -- so it has to reach the shared document by another
    route, or every open browser sits on text the agent already replaced."""
    from server import main as server_main

    project_id = opened["id"]
    save(client, project_id, "before the agent\n")
    session = server_main.SESSIONS[project_id]
    session.write_from_agent(project_dir / "main.tex", "after the agent\n")

    _, body = document_of(project_id)
    assert str(body) == "after the agent\n"
    # And it is still the agent's edit in the history, not yours. The log
    # is oldest first, so the newest is the one the agent just made.
    assert session.history.versions("main.tex")[-1].by == "claude"
