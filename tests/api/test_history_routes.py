"""Reading and putting back an earlier version, and labelling one.

These are the routes the history panel is made of, and the only ones that
write a file from something other than what the writer typed.  The rule
they defend is that going back is never destructive: a restore is a new
version on top, so the state you restored *from* is still there to return
to if the restore was a mistake.
"""

import pytest


def save(client, project_id: str, text: str, origin: str = "tab-a") -> None:
    # The origin matters: an editing burst from one window collapses into a
    # single version on purpose, so two saves meant to be two versions have
    # to come from two windows -- which is also the only way a writer gets
    # two versions a second apart in earnest.
    client.put(f"/api/projects/{project_id}/file",
               json={"path": "main.tex", "text": text, "compile": False,
                     "origin": origin})


def versions(client, project_id: str) -> list[dict]:
    """Newest first, the way the panel reads them."""
    return client.get(f"/api/projects/{project_id}/history",
                      params={"path": "main.tex"}).json()["versions"]


def text_of(client, project_id: str, sha: str) -> str:
    return client.get(f"/api/projects/{project_id}/history/blob",
                      params={"path": "main.tex", "sha": sha}).json()["text"]


def version_saying(client, project_id: str, text: str) -> dict:
    """Picked by what it says rather than by position.  The oldest version
    of a file is not the writer's first save -- it is the `create` entry
    holding what the file said before NextTex ever opened it."""
    for version in versions(client, project_id):
        if text_of(client, project_id, version["sha"]) == text:
            return version
    raise AssertionError(f"no version says {text!r}")


def test_restoring_puts_the_old_text_back(client, opened, project_dir):
    save(client, opened["id"], "the first draft", origin="tab-a")
    save(client, opened["id"], "a rewrite that went badly", origin="tab-b")
    first = version_saying(client, opened["id"], "the first draft")

    answer = client.post(f"/api/projects/{opened['id']}/history/restore",
                         json={"path": "main.tex", "sha": first["sha"]})
    assert answer.status_code == 200
    assert (project_dir / "main.tex").read_text(encoding="utf-8") == "the first draft"


def test_a_restore_is_a_new_version_rather_than_an_erasure(client, opened):
    """The whole promise of the panel: restoring the wrong version is
    itself undoable, because what you restored from is still there."""
    save(client, opened["id"], "the first draft", origin="tab-a")
    save(client, opened["id"], "a rewrite that went badly", origin="tab-b")
    first = version_saying(client, opened["id"], "the first draft")
    client.post(f"/api/projects/{opened['id']}/history/restore",
                json={"path": "main.tex", "sha": first["sha"]})

    after = versions(client, opened["id"])
    assert after[0]["op"] == "restore"
    texts = [text_of(client, opened["id"], v["sha"]) for v in after]
    assert "a rewrite that went badly" in texts


def test_restoring_something_no_longer_stored_is_a_404(client, opened):
    save(client, opened["id"], "anything")
    answer = client.post(f"/api/projects/{opened['id']}/history/restore",
                         json={"path": "main.tex", "sha": "0" * 64})
    assert answer.status_code == 404


def test_a_restore_cannot_reach_outside_the_project(client, opened):
    save(client, opened["id"], "anything")
    sha = versions(client, opened["id"])[-1]["sha"]
    answer = client.post(f"/api/projects/{opened['id']}/history/restore",
                         json={"path": "../escaped.tex", "sha": sha})
    assert answer.status_code in (400, 403)


def test_a_label_is_set_and_comes_back_with_the_version(client, opened):
    save(client, opened["id"], "the version that went to the committee")
    sha = versions(client, opened["id"])[0]["sha"]
    assert client.post(f"/api/projects/{opened['id']}/history/label",
                       json={"path": "main.tex", "sha": sha,
                             "label": "sent to the committee"}).status_code == 200
    assert versions(client, opened["id"])[0]["label"] == "sent to the committee"


def test_an_empty_label_clears_it(client, opened):
    save(client, opened["id"], "text")
    sha = versions(client, opened["id"])[0]["sha"]
    client.post(f"/api/projects/{opened['id']}/history/label",
                json={"path": "main.tex", "sha": sha, "label": "a name"})
    client.post(f"/api/projects/{opened['id']}/history/label",
                json={"path": "main.tex", "sha": sha, "label": "   "})
    assert not versions(client, opened["id"])[0]["label"]


def test_labelling_a_version_that_is_not_there_is_a_404(client, opened):
    answer = client.post(f"/api/projects/{opened['id']}/history/label",
                         json={"path": "main.tex", "sha": "0" * 64, "label": "x"})
    assert answer.status_code == 404


def test_the_timeline_covers_every_file_newest_first(client, opened):
    save(client, opened["id"], "a change to the main file")
    client.put(f"/api/projects/{opened['id']}/file",
               json={"path": "references.bib", "text": "@book{a, title={T}}\n",
                     "compile": False})

    body = client.get(f"/api/projects/{opened['id']}/history/timeline").json()
    paths = [item["path"] for item in body["versions"]]
    assert "main.tex" in paths and "references.bib" in paths
    stamps = [item["at"] for item in body["versions"]]
    assert stamps == sorted(stamps, reverse=True)


@pytest.mark.parametrize("limit", [-5, 0, 10_000])
def test_the_timeline_limit_is_clamped_rather_than_trusted(client, opened, limit):
    save(client, opened["id"], "one change")
    answer = client.get(f"/api/projects/{opened['id']}/history/timeline",
                        params={"limit": limit})
    assert answer.status_code == 200
    assert len(answer.json()["versions"]) >= 1


def test_a_replaced_figure_is_recoverable(client, opened, project_dir):
    """Uploading over a figure destroyed the previous one outright.  The
    route recorded a version by reading the file as UTF-8 and swallowing
    the UnicodeDecodeError, so a PNG -- which is most of what anybody
    uploads -- got no version, no trash entry, and no warning."""
    figure = project_dir / "figures" / "plot.png"
    figure.parent.mkdir(parents=True, exist_ok=True)
    original = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 4
    figure.write_bytes(original)

    answer = client.post(
        f"/api/projects/{opened['id']}/upload",
        data={"directory": "figures"},
        files=[("files", ("plot.png", b"\x89PNG a different figure entirely",
                          "image/png"))],
    )
    assert answer.status_code == 200
    assert figure.read_bytes() != original

    versions = client.get(f"/api/projects/{opened['id']}/history",
                          params={"path": "figures/plot.png"}).json()["versions"]
    assert versions, "the figure that was replaced has no history at all"
    assert versions[-1]["bytes"] == len(original)


def test_restoring_a_figure_gives_back_the_bytes_not_a_decoding_of_them(
    client, opened, project_dir
):
    """`content()` decodes with errors="replace", which is right for
    showing an old draft and turns every invalid byte of a PNG into U+FFFD.
    A restore that went through it handed back a corrupt image."""
    figure = project_dir / "figures" / "plot.png"
    figure.parent.mkdir(parents=True, exist_ok=True)
    original = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 4
    figure.write_bytes(original)
    client.post(
        f"/api/projects/{opened['id']}/upload",
        data={"directory": "figures"},
        files=[("files", ("plot.png", b"a different figure", "image/png"))],
    )
    versions = client.get(f"/api/projects/{opened['id']}/history",
                          params={"path": "figures/plot.png"}).json()["versions"]
    old = versions[-1]

    assert client.post(f"/api/projects/{opened['id']}/history/restore",
                       json={"path": "figures/plot.png",
                             "sha": old["sha"]}).status_code == 200
    assert figure.read_bytes() == original
