"""Path handling, which is the other half of the security boundary."""

from pathlib import Path

import pytest

from nexttex.project import Project, ProjectConfig


def project(tmp_path):
    (tmp_path / "main.tex").write_text(
        r"\documentclass{article}\begin{document}\end{document}", encoding="utf-8"
    )
    return Project.open(tmp_path)


def test_resolves_a_path_inside_the_project(tmp_path):
    p = project(tmp_path)
    assert p.resolve("main.tex") == (tmp_path / "main.tex").resolve()


@pytest.mark.parametrize(
    "attempt",
    ["../outside.tex", "chapters/../../outside.tex", "/etc/passwd"],
)
def test_refuses_to_leave_the_project(tmp_path, attempt):
    p = project(tmp_path)
    with pytest.raises(PermissionError):
        p.resolve(attempt)


def test_refuses_a_symlink_pointing_outside(tmp_path):
    p = project(tmp_path)
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("x", encoding="utf-8")
    (tmp_path / "link.tex").symlink_to(secret)
    with pytest.raises(PermissionError):
        p.resolve("link.tex")


def test_the_main_file_is_guessed_from_the_document_itself(tmp_path):
    (tmp_path / "helper.tex").write_text("\\section{x}", encoding="utf-8")
    (tmp_path / "thesis.tex").write_text(
        "\\documentclass{report}\n\\begin{document}\n\\end{document}", encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).main == "thesis.tex"


def test_a_config_file_wins_over_the_guess(tmp_path):
    (tmp_path / "thesis.tex").write_text(
        "\\documentclass{report}\\begin{document}\\end{document}", encoding="utf-8"
    )
    (tmp_path / "other.tex").write_text("x", encoding="utf-8")
    (tmp_path / "nexttex.toml").write_text(
        '[project]\nname = "T"\nmain = "other.tex"\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).main == "other.tex"


def test_the_tree_hides_build_output_and_our_own_files(tmp_path):
    p = project(tmp_path)
    (tmp_path / "build").mkdir()
    (tmp_path / "build" / "main.pdf").write_bytes(b"%PDF")
    (tmp_path / ".nexttex-preview.tex").write_text("x", encoding="utf-8")
    names = [child["name"] for child in p.tree()["children"]]
    assert "main.tex" in names
    assert "build" not in names
    assert ".nexttex-preview.tex" not in names


def test_our_own_state_directory_ignores_itself_in_git(tmp_path):
    """A project whose .gitignore predates NextTex would otherwise commit
    every version blob and every deleted file on its next `git add -A`."""
    p = project(tmp_path)
    assert (p.state_dir / ".gitignore").read_text(encoding="utf-8").strip() == "*"


def test_a_project_can_be_removed_from_the_list_without_opening_it(tmp_path):
    """The projects most likely to be removed are the ones nobody opened."""
    import re

    source = (Path(__file__).resolve().parent.parent / "server" / "main.py").read_text()
    handler = source[source.index("async def forget_project"):source.index("@app.post(\"/api/projects/{project_id}/open\")")]
    assert "REGISTRY.find(project_id)" in handler
    # And it falls back to the registry when there is no project to open,
    # which is the case for an entry whose folder has been moved away.
    assert "REGISTRY.path_for(project_id)" in handler
    # The removal must not sit inside the "if session" branch.
    assert re.search(r"\n    REGISTRY\.remove\(root\)", handler)
