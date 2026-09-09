"""The name a route calls a file, and the name its history is filed under.

`slug_for` hashes the exact string it is handed, so `./main.tex` and
`main.tex` are two different files as far as a version log is concerned and
only one of them is ever real.  Everything that *writes* history normalises
first; the routes that read it, name it, clear it and rename it did not.
They called the fence, threw away the path it resolved, and passed the raw
query string on.
"""


def save(client, project_id: str, text: str, origin: str = "tab-a") -> None:
    client.put(f"/api/projects/{project_id}/file",
               json={"path": "main.tex", "text": text, "compile": False,
                     "origin": origin})


def history(client, project_id: str, path: str) -> list[dict]:
    return client.get(f"/api/projects/{project_id}/history",
                      params={"path": path}).json()["versions"]


def test_a_dotted_path_finds_the_same_history(client, opened):
    save(client, opened["id"], "the first draft")
    plain = history(client, opened["id"], "main.tex")
    assert plain, "nothing to compare against"
    assert history(client, opened["id"], "./main.tex") == plain


def test_renaming_through_a_dotted_path_keeps_the_past(client, opened):
    """The one that actually cost something.

    It moved the file on disk, left its entire history filed under a name
    nothing would ever look up again, and answered `{"ok": true}`.
    """
    save(client, opened["id"], "months of work")
    before = [v["sha"] for v in history(client, opened["id"], "main.tex")]
    assert before

    answer = client.post(f"/api/projects/{opened['id']}/file/rename",
                         json={"path": "./main.tex", "to": "chapters/one.tex"})
    assert answer.status_code == 200, answer.text

    after = [v["sha"] for v in history(client, opened["id"], "chapters/one.tex")]
    assert after == before


def test_clearing_through_a_dotted_path_really_clears(client, opened):
    save(client, opened["id"], "the first draft")
    save(client, opened["id"], "the second draft", origin="tab-b")
    assert len(history(client, opened["id"], "main.tex")) >= 2

    answer = client.delete(f"/api/projects/{opened['id']}/history",
                           params={"path": "./main.tex"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["removed"] >= 2
    # One marker, so the file still has a floor to its timeline.
    assert len(history(client, opened["id"], "main.tex")) == 1


def test_labelling_through_a_dotted_path_finds_the_version(client, opened):
    save(client, opened["id"], "worth coming back to")
    sha = history(client, opened["id"], "main.tex")[0]["sha"]

    answer = client.post(f"/api/projects/{opened['id']}/history/label",
                         json={"path": "./main.tex", "sha": sha,
                               "label": "before the rewrite"})
    assert answer.status_code == 200, answer.text
    named = [v for v in history(client, opened["id"], "main.tex") if v["sha"] == sha]
    assert named[0]["label"] == "before the rewrite"


def test_a_path_outside_the_project_is_still_refused(client, opened):
    """Normalising must not become a way through the fence."""
    answer = client.get(f"/api/projects/{opened['id']}/history",
                        params={"path": "../../../etc/passwd"})
    assert answer.status_code in (400, 403)
