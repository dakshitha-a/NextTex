"""Clearing a file's stored versions.

The one destructive operation in the history store, so what it must *not* do
matters more than what it does.  Blobs are content-addressed and therefore
shared: with the file's own past, with any other file that happens to hold
identical bytes, and with the final version recorded for something now
sitting in the trash.  A purge that unlinked blobs by name would quietly
take another file's past with it, and the writer would not find out until
they went looking for a draft months later.

So the route drops one log and lets the collector sweep whatever no
remaining log points at, and these tests are mostly about the things that
have to survive it.
"""


def save(client, project_id: str, text: str, path: str = "main.tex",
         origin: str = "tab-a") -> None:
    # The origin matters: an editing burst from one window collapses into a
    # single version on purpose, so two saves meant to be two versions have
    # to come from two windows.
    client.put(f"/api/projects/{project_id}/file",
               json={"path": path, "text": text, "compile": False,
                     "origin": origin})


def versions(client, project_id: str, path: str = "main.tex") -> list[dict]:
    return client.get(f"/api/projects/{project_id}/history",
                      params={"path": path}).json()["versions"]


def text_of(client, project_id: str, sha: str, path: str = "main.tex") -> str:
    return client.get(f"/api/projects/{project_id}/history/blob",
                      params={"path": path, "sha": sha}).json()["text"]


def purge(client, project_id: str, path: str = "main.tex"):
    return client.delete(f"/api/projects/{project_id}/history",
                         params={"path": path})


def test_clearing_a_files_history_leaves_the_file_alone(client, opened, project_dir):
    """The obvious failure, and the one the confirmation copy has to rule out
    in the writer's mind: "delete version history" beside a file reads a
    great deal like "delete the file"."""
    save(client, opened["id"], "the first draft", origin="tab-a")
    save(client, opened["id"], "the second draft", origin="tab-b")

    answer = purge(client, opened["id"])

    assert answer.status_code == 200
    assert answer.json()["removed"] >= 2
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == "the second draft"
    assert client.get(f"/api/projects/{opened['id']}/file",
                      params={"path": "main.tex"}).json()["text"] == "the second draft"


def test_clearing_leaves_one_marker_so_the_file_still_has_a_floor(client, opened):
    """Without the re-seed the file has no past at all: the panel is empty,
    and the next edit has nothing to diff against."""
    save(client, opened["id"], "the first draft", origin="tab-a")
    save(client, opened["id"], "the second draft", origin="tab-b")

    purge(client, opened["id"])

    after = versions(client, opened["id"])
    assert len(after) == 1
    assert after[0]["op"] == "create"
    # And it holds the file as it stands, not as it was two drafts ago.
    assert text_of(client, opened["id"], after[0]["sha"]) == "the second draft"


def test_clearing_one_file_does_not_take_another_files_past_with_it(
    client, opened, project_dir,
):
    """Two files that have held identical bytes share one blob.  Purging one
    of them must not collect the blob the other's log still points at."""
    same = "a paragraph both files happened to hold"
    (project_dir / "other.tex").write_text("something else", encoding="utf-8")
    for path in ("main.tex", "other.tex"):
        save(client, opened["id"], same, path=path)

    shared = [v for v in versions(client, opened["id"], "other.tex")
              if v["bytes"] == len(same.encode())]
    assert shared, "the two files should have written one shared blob"
    sha = shared[0]["sha"]

    purge(client, opened["id"], "main.tex")

    still_there = client.get(f"/api/projects/{opened['id']}/history/blob",
                             params={"path": "other.tex", "sha": sha})
    assert still_there.status_code == 200
    assert still_there.json()["text"] == same


def test_a_cleared_file_can_be_edited_and_have_a_history_again(client, opened):
    """The store is not left in a state that refuses to record."""
    save(client, opened["id"], "the first draft", origin="tab-a")
    purge(client, opened["id"])
    save(client, opened["id"], "written after the clearing", origin="tab-b")

    after = versions(client, opened["id"])
    assert len(after) >= 2
    assert text_of(client, opened["id"], after[0]["sha"]) == "written after the clearing"


def test_clearing_refuses_a_path_outside_the_project(client, opened):
    answer = purge(client, opened["id"], "../../../etc/passwd")
    assert answer.status_code in (400, 403, 404)


def test_the_history_says_what_it_costs(client, opened):
    """So the writer deciding whether to clear it is told what they get back
    rather than asked to guess."""
    save(client, opened["id"], "the first draft", origin="tab-a")
    answer = client.get(f"/api/projects/{opened['id']}/history/size")
    assert answer.status_code == 200
    assert answer.json()["bytes"] > 0
