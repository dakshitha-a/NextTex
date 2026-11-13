"""A folder moved, removed or copied in outside NextTex reaches the manifest.

The watcher reports a folder that is renamed, or removed with its whole
contents, as the folder alone, with no word about the files inside it, and
`ingest` knows files, not folders. So a `git mv` of a chapter folder left
every record inside it naming a path that was gone. In a shared thesis on
13 November 2026 that meant the other machine was asked for those figures
on every reconnect and the old folders were written back. A tick that
names a folder now speaks for the files in it: a folder that went and one
that came with the same files are a rename, which keeps every id and
reaches the others as one; a folder that only went is its files going; a
folder that only came is its files arriving.
"""

import os
import shutil

from server import main as server_main

PDF = b"%PDF-1.5\n" + bytes(range(256)) * 8


def fold(client, project_id: str, *paths: str) -> None:
    session = server_main.SESSIONS[project_id]
    client.portal.call(server_main._fold_tick, session, set(paths))


def flush(client, project_id: str, times: int = 3) -> None:
    session = server_main.SESSIONS[project_id]

    async def run() -> None:
        for _ in range(times):
            session.collab.flush()

    client.portal.call(run)


def records(client, project_id: str) -> dict[str, tuple[str, bool]]:
    session = server_main.SESSIONS[project_id]

    async def read() -> dict[str, tuple[str, bool]]:
        return {
            file_id: (str(record.get("path") or ""), bool(record.get("trashed")))
            for file_id, record in session.collab.files.items()
        }

    return client.portal.call(read)


def live_ids(client, project_id: str, prefix: str) -> dict[str, str]:
    return {
        path: file_id
        for file_id, (path, trashed) in records(client, project_id).items()
        if not trashed and path.startswith(prefix)
    }


def chapter(project_dir, name: str = "chapters/old") -> list[str]:
    folder = project_dir / name
    (folder / "figures").mkdir(parents=True)
    (folder / "old.tex").write_text("The chapter.\n", encoding="utf-8")
    (folder / "figures" / "plot.pdf").write_bytes(PDF)
    return [f"{name}/old.tex", f"{name}/figures/plot.pdf"]


def test_a_folder_renamed_outside_keeps_its_records(client, opened, project_dir):
    project_id = opened["id"]
    fold(client, project_id, *chapter(project_dir))
    before = live_ids(client, project_id, "chapters/")
    assert set(before) == {"chapters/old/old.tex", "chapters/old/figures/plot.pdf"}

    os.rename(project_dir / "chapters" / "old", project_dir / "chapters" / "new")
    # What the watcher reports for that rename: the two folders, nothing else.
    fold(client, project_id, "chapters/old", "chapters/new")
    flush(client, project_id)

    after = live_ids(client, project_id, "chapters/")
    assert after == {
        "chapters/new/old.tex": before["chapters/old/old.tex"],
        "chapters/new/figures/plot.pdf": before["chapters/old/figures/plot.pdf"],
    }


def test_a_folder_removed_outside_takes_its_records(client, opened, project_dir):
    project_id = opened["id"]
    fold(client, project_id, *chapter(project_dir))
    assert live_ids(client, project_id, "chapters/old/")

    shutil.rmtree(project_dir / "chapters" / "old")
    fold(client, project_id, "chapters/old")
    flush(client, project_id)

    assert live_ids(client, project_id, "chapters/old/") == {}


def test_a_folder_copied_in_outside_is_adopted(client, opened, project_dir):
    project_id = opened["id"]
    paths = chapter(project_dir, "chapters/copied")
    fold(client, project_id, "chapters/copied")
    flush(client, project_id)

    assert set(live_ids(client, project_id, "chapters/copied/")) == set(paths)


def test_a_rename_onto_a_folder_with_records_is_not_guessed(client, opened, project_dir):
    """Two candidates, or a target the manifest already knows, is no
    rename: each side is handled on its own and no two live records end
    up on one path."""
    project_id = opened["id"]
    fold(client, project_id, *chapter(project_dir, "chapters/a"))
    fold(client, project_id, *chapter(project_dir, "chapters/b"))
    shutil.rmtree(project_dir / "chapters" / "a")
    shutil.copytree(project_dir / "chapters" / "b", project_dir / "chapters" / "d")
    shutil.copytree(project_dir / "chapters" / "b", project_dir / "chapters" / "e")
    fold(client, project_id, "chapters/a", "chapters/d", "chapters/e")
    flush(client, project_id)

    paths = [path for path, trashed in records(client, project_id).values() if not trashed]
    assert len(paths) == len(set(paths))
    assert live_ids(client, project_id, "chapters/a/") == {}
    assert "chapters/d/old.tex" in live_ids(client, project_id, "chapters/d/")
    assert "chapters/e/old.tex" in live_ids(client, project_id, "chapters/e/")
