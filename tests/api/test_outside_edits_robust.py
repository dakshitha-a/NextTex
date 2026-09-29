"""Every way a file can change under NextTex, folded in and named.

The writer asked on 24 September for the mechanism to be made robust and
for an outside edit to show in History as the disk's. Each test writes the
file the way another program would and drives one watcher tick directly,
since the watcher itself polls a real directory on a real timer.
"""

import asyncio

from server import main as server_main


def session_of(project_id):
    return server_main.SESSIONS[project_id]


def versions_of(client, project_id, path):
    answer = client.get(f"/api/projects/{project_id}/history", params={"path": path})
    return list(reversed(answer.json()["versions"]))


def text_of(client, project_id, path="main.tex"):
    session = session_of(project_id)

    async def read():
        return str(session.collab.body(session.collab.file_id_for(path)))

    return client.portal.call(read)


def fold(client, project_id, *paths):
    client.portal.call(server_main._fold_tick, session_of(project_id), set(paths))


def settled(client, project_id, path="main.tex"):
    """The document written out, so the disk and the document agree."""
    session = session_of(project_id)

    async def flush():
        session.collab.flush()

    client.portal.call(flush)
    fold(client, project_id, path)


def test_an_outside_edit_while_open_is_folded_in_and_named_the_disks(client, opened, project_dir):
    project_id = opened["id"]
    settled(client, project_id)
    main = project_dir / "main.tex"
    main.write_text(main.read_text(encoding="utf-8") + "From vim.\n", encoding="utf-8")
    fold(client, project_id, "main.tex")
    assert text_of(client, project_id).endswith("From vim.\n")
    last = versions_of(client, project_id, "main.tex")[-1]
    assert last["by"] == "outside" and last["why"] == "changed outside NextTex"


def test_typing_not_yet_on_disk_survives_an_outside_edit_elsewhere(client, opened, project_dir):
    """The two-way diff read typing inside the flush's debounce as a
    deletion made on disk, and deleted it."""
    project_id = opened["id"]
    settled(client, project_id)
    main = project_dir / "main.tex"
    before = main.read_text(encoding="utf-8")
    session = session_of(project_id)

    async def type_then_outside_write():
        text = session.collab.body(session.collab.file_id_for("main.tex"))
        text.insert(0, "% typed a moment ago\n")
        # The disk changes before the flush writes the typing out.
        main.write_text(before + "Appended by git.\n", encoding="utf-8")
        await server_main._fold_tick(session, {"main.tex"})

    client.portal.call(type_then_outside_write)
    now = text_of(client, project_id)
    assert now.startswith("% typed a moment ago\n")
    assert now.endswith("Appended by git.\n")


def test_a_clash_keeps_both_versions_and_the_editors_text(client, opened, project_dir):
    """Typing and an outside save changed one paragraph: both stay, between
    comment lines, and what the editor held is a version as well."""
    project_id = opened["id"]
    main = project_dir / "main.tex"
    main.write_text("One sentence.\n", encoding="utf-8")
    fold(client, project_id, "main.tex")
    settled(client, project_id)
    session = session_of(project_id)

    async def clash():
        text = session.collab.body(session.collab.file_id_for("main.tex"))
        del text[0:len(text)]
        text += "One sentence, as typed.\n"
        main.write_text("One sentence, as saved in vim.\n", encoding="utf-8")
        await server_main._fold_tick(session, {"main.tex"})

    client.portal.call(clash)
    now = text_of(client, project_id)
    assert "% Version from the file on disk {nexttex-conflict" in now
    assert "% Version from the editor {nexttex-conflict" in now
    assert now.count("One sentence, as saved in vim.") == 1
    assert now.count("One sentence, as typed.") == 1
    assert now.index("as saved in vim") < now.index("as typed")
    versions = versions_of(client, project_id, "main.tex")
    why = "What the editor held before the file on disk was merged in"
    kept = [v for v in versions if v["why"] == why]
    assert kept and kept[-1]["by"] == "you"


def test_a_git_pull_that_clashes_with_typing_keeps_both(client, opened, project_dir):
    """The same through real git: a commit elsewhere changed the paragraph
    being typed in, and `git pull` brings it in."""
    import subprocess

    project_id = opened["id"]
    main = project_dir / "main.tex"
    env = {"PATH": "/usr/bin:/bin", "HOME": str(project_dir),
           "GIT_AUTHOR_NAME": "A Test", "GIT_AUTHOR_EMAIL": "t@example.invalid",
           "GIT_COMMITTER_NAME": "A Test", "GIT_COMMITTER_EMAIL": "t@example.invalid"}

    def git(*arguments, cwd=project_dir):
        subprocess.run(["git", *arguments], cwd=cwd, check=True, capture_output=True, env=env)

    main.write_text("Intro.\n\nThe paragraph.\n", encoding="utf-8")
    fold(client, project_id, "main.tex")
    settled(client, project_id)
    git("init", "-q", "-b", "main")
    git("add", "main.tex")
    git("commit", "-q", "-m", "base")
    other = project_dir.parent / (project_dir.name + "-elsewhere")
    git("clone", "-q", str(project_dir), str(other), cwd=project_dir.parent)
    (other / "main.tex").write_text("Intro.\n\nThe paragraph, from the other machine.\n")
    git("commit", "-q", "-am", "theirs", cwd=other)
    session = session_of(project_id)

    async def type_then_pull():
        text = session.collab.body(session.collab.file_id_for("main.tex"))
        text.insert(len(str(text)) - 1, " Typed here.")
        git("pull", "-q", str(other), "main")
        await server_main._fold_tick(session, {"main.tex"})

    client.portal.call(type_then_pull)
    now = text_of(client, project_id)
    assert now.startswith("Intro.\n\n")
    assert now.count("The paragraph, from the other machine.") == 1
    assert now.count("The paragraph. Typed here.") == 1
    assert "{nexttex-conflict" in now and "<<<<" not in now


def test_a_truncate_then_write_save_never_blanks_the_document(client, opened, project_dir):
    project_id = opened["id"]
    settled(client, project_id)
    main = project_dir / "main.tex"
    whole = main.read_text(encoding="utf-8")
    session = session_of(project_id)

    async def truncate_then_write():
        main.write_text("", encoding="utf-8")
        tick = asyncio.ensure_future(server_main._fold_tick(session, {"main.tex"}))
        await asyncio.sleep(0.05)
        main.write_text(whole + "Saved.\n", encoding="utf-8")
        await tick

    client.portal.call(truncate_then_write)
    assert text_of(client, project_id) == whole + "Saved.\n"
    assert all(v.get("bytes", 1) != 0 for v in versions_of(client, project_id, "main.tex"))


def test_a_file_really_emptied_empties_the_document(client, opened, project_dir):
    project_id = opened["id"]
    settled(client, project_id)
    (project_dir / "main.tex").write_text("", encoding="utf-8")
    fold(client, project_id, "main.tex")
    assert text_of(client, project_id) == ""


def test_crlf_from_a_windows_editor_is_read_as_the_same_lines(client, opened, project_dir):
    project_id = opened["id"]
    settled(client, project_id)
    main = project_dir / "main.tex"
    lines = main.read_text(encoding="utf-8")
    main.write_bytes((lines + "Added on Windows.\n").replace("\n", "\r\n").encode("utf-8"))
    fold(client, project_id, "main.tex")
    assert text_of(client, project_id) == lines + "Added on Windows.\n"


def test_a_rename_into_place_is_an_ordinary_outside_edit(client, opened, project_dir):
    """What most editors do: write a temporary file and rename it over."""
    project_id = opened["id"]
    settled(client, project_id)
    main = project_dir / "main.tex"
    temp = project_dir / ".main.tex.swp~"
    temp.write_text(main.read_text(encoding="utf-8") + "Atomically.\n", encoding="utf-8")
    temp.replace(main)
    fold(client, project_id, "main.tex")
    assert text_of(client, project_id).endswith("Atomically.\n")
    assert versions_of(client, project_id, "main.tex")[-1]["by"] == "outside"


def test_two_writes_in_one_tick_fold_to_the_last(client, opened, project_dir):
    project_id = opened["id"]
    settled(client, project_id)
    main = project_dir / "main.tex"
    base = main.read_text(encoding="utf-8")
    main.write_text(base + "First.\n", encoding="utf-8")
    main.write_text(base + "Second.\n", encoding="utf-8")
    fold(client, project_id, "main.tex")
    assert text_of(client, project_id) == base + "Second.\n"


def test_nextexs_own_write_coming_back_is_not_a_version(client, opened, project_dir):
    project_id = opened["id"]
    settled(client, project_id)
    count = len(versions_of(client, project_id, "main.tex"))
    fold(client, project_id, "main.tex")
    assert len(versions_of(client, project_id, "main.tex")) == count


def test_a_file_edited_while_the_server_was_stopped_is_the_disks_too(tmp_path):
    from nexttex.project import Project
    from server.collab.store import CollabStore

    root = tmp_path / "paper"
    root.mkdir()
    (root / "main.tex").write_text("Before.\n", encoding="utf-8")
    project = Project.open(root)
    store = CollabStore(project)
    store.adopt()
    file_id = store.file_id_for("main.tex")
    store.body(file_id)
    store.flush()
    store.close()
    (root / "main.tex").write_text("Before, and after.\n", encoding="utf-8")

    seen = []

    class Session:
        def mark_written(self, path): pass
        def note_edit(self, *a): pass
        def schedule_compile(self): pass
        def note_comments(self): pass

        def record_version(self, path, text, *, previous=None, by="you", why="", op="edit", source=""):
            seen.append((by, why))

    again = CollabStore(project, Session())
    again.adopt()
    assert str(again.body(file_id)) == "Before, and after.\n"
    assert seen == [("outside", "changed while NextTex was not running")]
    again.close()


def test_the_disks_authorship_survives_the_trip_to_a_collaborator():
    """History sync carries a record as it is, so a collaborator's copy of
    an outside version still says it was the disk's, and whose."""
    from nexttex.history import Version

    record = Version.from_dict({
        "at": 1.0, "sha": "a" * 40, "bytes": 3, "by": "outside",
        "why": "changed outside NextTex", "peer": "b" * 64, "who": "Mira",
    }).as_dict()
    assert record["by"] == "outside" and record["who"] == "Mira"
    assert not Version.from_dict(record).permanent
