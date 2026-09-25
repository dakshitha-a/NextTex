"""Routes that walk or rewrite many files do it off the event loop.

The probe found three that ran on the loop, where they stop every request
on the install while they work: the reference library's walk for a `.bib`
(Q-029), moving a folder to the trash and back (Q-022), and the History
drawer's timeline (Q-021). Each is checked by asking, from inside the work,
whether an event loop is running on the thread it is on.
"""

import asyncio


def on_the_loop() -> bool:
    try:
        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False


def spy(monkeypatch, owner, name) -> list[bool]:
    seen: list[bool] = []
    original = getattr(owner, name)

    def wrapped(*args, **kwargs):
        seen.append(on_the_loop())
        return original(*args, **kwargs)

    monkeypatch.setattr(owner, name, wrapped)
    return seen


def test_trashing_and_restoring_a_folder_run_in_a_worker(client, opened, project_dir, monkeypatch):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    (project_dir / "figures" / "a.txt").write_text("a")
    deleted = spy(monkeypatch, session.trash, "delete")
    restored = spy(monkeypatch, session.trash, "restore")
    answer = client.delete(f"/api/projects/{opened['id']}/file", params={"path": "figures"})
    assert answer.status_code == 200, answer.text
    entries = client.get(f"/api/projects/{opened['id']}/trash").json()
    entry_id = (entries.get("entries") or entries)[0]["id"]
    assert client.post(f"/api/projects/{opened['id']}/trash/{entry_id}/restore").status_code == 200
    assert deleted == [False] and restored == [False]


def test_the_timeline_runs_in_a_worker(client, opened, monkeypatch):
    from server.main import SESSIONS

    seen = spy(monkeypatch, SESSIONS[opened["id"]].history, "timeline")
    assert client.get(f"/api/projects/{opened['id']}/history/timeline").status_code == 200
    assert seen == [False]


def test_the_library_finds_its_bib_in_a_worker(client, opened, monkeypatch):
    from server.main import SESSIONS

    seen = spy(monkeypatch, SESSIONS[opened["id"]].deps, "reachable")
    assert client.get(f"/api/projects/{opened['id']}/library").status_code == 200
    assert seen and not any(seen)


def test_the_library_uses_the_bib_the_document_names(client, opened, project_dir):
    from server.main import SESSIONS, _bib_for

    main = project_dir / "main.tex"
    (project_dir / "library.bib").write_text("@article{a, title={A}}\n")
    (project_dir / "refs.bib").write_text("@article{b, title={B}}\n")
    lines = [line for line in main.read_text().splitlines()
             if "\\bibliography{" not in line and "\\addbibresource" not in line]
    main.write_text("\n".join(lines).replace(
        "\\end{document}", "\\bibliography{refs}\n\\end{document}") + "\n")
    session = SESSIONS[opened["id"]]
    session.deps.invalidate()
    assert _bib_for(session) == project_dir / "refs.bib"


def test_with_no_bibliography_named_the_walk_skips_git(client, opened, project_dir):
    from server.main import SESSIONS, _bib_for

    main = project_dir / "main.tex"
    lines = [line for line in main.read_text().splitlines()
             if "\\bibliography{" not in line and "\\addbibresource" not in line]
    main.write_text("\n".join(lines) + "\n")
    for bib in project_dir.rglob("*.bib"):
        bib.unlink()
    (project_dir / ".git").mkdir(exist_ok=True)
    (project_dir / ".git" / "a.bib").write_text("@misc{x}\n")
    (project_dir / "z.bib").write_text("@misc{y}\n")
    session = SESSIONS[opened["id"]]
    session.deps.invalidate()
    assert _bib_for(session) == project_dir / "z.bib"
