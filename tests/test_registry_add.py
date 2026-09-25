"""Adding a folder that is already registered keeps its entry's state.

Q-026: adding a folder wrote a fresh entry over any entry at that path, so
a project that was archived or in the trash came back as active, dates
reset, without the Restore the projects screen offers for that.
"""

from nexttex.project import Registry


def test_adding_an_archived_project_again_leaves_it_archived(tmp_path):
    registry = Registry(tmp_path / "projects.json")
    folder = tmp_path / "paper"
    folder.mkdir()
    (folder / "main.tex").write_text("\\documentclass{article}\n")
    registry.add(folder)
    assert registry.set_state(folder, "archived")
    registry.add(folder)
    [entry] = [e for e in registry._read() if e.path == str(folder.resolve())]
    assert entry.state == "archived"
    assert entry.state_at > 0


def test_adding_a_new_folder_is_active(tmp_path):
    registry = Registry(tmp_path / "projects.json")
    folder = tmp_path / "paper"
    folder.mkdir()
    registry.add(folder)
    [entry] = registry._read()
    assert entry.state == "active"
