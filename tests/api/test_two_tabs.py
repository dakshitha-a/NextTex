"""Two windows on one project.

The rule this defends: nothing a writer typed is lost without them being
told.  Before the `base` check, the second tab's autosave wrote its whole
stale buffer over everything the first tab had saved -- no error, no dirty
marker, and the only copy left was in the version history.
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


def test_a_stale_tab_is_refused_rather_than_believed(client, opened, project_dir):
    """Tab A saves; tab B, which last read the file a minute ago, saves its
    own copy.  B must not win by arriving second."""
    stale = client.get(f"/api/projects/{opened['id']}/file",
                       params={"path": "main.tex"}).json()["tag"]
    save(client, opened["id"], "what tab A wrote")
    answer = save(client, opened["id"], "what tab B still had", base=stale).json()

    assert answer["ok"] is False and answer["conflict"] is True
    assert answer["text"] == "what tab A wrote"
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == "what tab A wrote"


def test_two_saves_a_fraction_of_a_second_apart_still_conflict(client, opened,
                                                              project_dir):
    """Autosave lands a quarter of a second after typing stops, and two
    writes that close together share a modification time on plenty of
    filesystems -- which is why the tag is a hash of the contents and not a
    clock reading."""
    # The same length either side and no pause between them: neither size
    # nor time distinguishes these, only what they say.
    stale = save(client, opened["id"], "B" * 40).json()["tag"]
    save(client, opened["id"], "A" * 40)
    answer = save(client, opened["id"], "C" * 40, base=stale).json()
    assert answer["conflict"] is True
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == "A" * 40


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


def test_a_closing_tab_never_overwrites_the_open_one(client, opened, project_dir):
    """A beacon cannot be asked anything and the tab is going away, so the
    window still open keeps its work -- and what the closing tab held is
    put in the file's history rather than dropped."""
    stale = save(client, opened["id"], "what the closing tab had").json()["tag"]
    save(client, opened["id"], "what the open tab wrote")

    answer = client.post(
        f"/api/projects/{opened['id']}/file/beacon",
        json={"path": "main.tex", "text": "the closing tab's older copy",
              "base": stale},
    ).json()
    assert answer["conflict"] is True
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == (
        "what the open tab wrote"
    )

    versions = client.get(f"/api/projects/{opened['id']}/history",
                          params={"path": "main.tex"}).json()["versions"]
    texts = [
        client.get(f"/api/projects/{opened['id']}/history/blob",
                   params={"path": "main.tex", "sha": v["sha"]}).json()["text"]
        for v in versions
    ]
    assert "the closing tab's older copy" in texts


def test_a_beacon_with_no_tag_still_saves(client, opened, project_dir):
    client.post(
        f"/api/projects/{opened['id']}/file/beacon",
        json={"path": "main.tex", "text": "the last quarter second"},
    )
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == (
        "the last quarter second"
    )


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
