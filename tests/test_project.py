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


# --- what nexttex.toml is allowed to say -----------------------------------
#
# The config is a file *in* the project, and a project is not always the
# writer's own work: it can be cloned, come from a template, or arrive from a
# collaborator, who can also edit it afterwards, because this file is
# deliberately shared rather than refused.  Two of its fields are paths that
# reach the filesystem, and both fall back to their default rather than
# escaping.


@pytest.mark.parametrize("escape", [
    "../../etc/passwd", "..", "../out", "/etc/passwd", "/tmp/anywhere",
    "C:\\Windows\\system32", "\\\\server\\share",
])
def test_a_main_file_outside_the_project_is_refused(tmp_path, escape):
    """`main` is opened and read straight off the disk by the compiler."""
    (tmp_path / "thesis.tex").write_text(
        "\\documentclass{report}\\begin{document}\\end{document}", encoding="utf-8"
    )
    (tmp_path / "nexttex.toml").write_text(
        f'[project]\nmain = "{escape}"\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).main == "thesis.tex"


@pytest.mark.parametrize("escape", [
    "../../elsewhere", "..", "/tmp/build",
])
def test_a_build_directory_outside_the_project_is_refused(tmp_path, escape):
    """`build_dir` becomes `latexmk -outdir=`, so an escaping one aims a
    build at somewhere outside the project."""
    (tmp_path / "nexttex.toml").write_text(
        f'[project]\nbuild_dir = "{escape}"\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).build_dir == "build"


def test_a_windows_absolute_path_is_refused(tmp_path):
    """Written as a TOML *literal* string, single quoted, because a basic
    string interprets backslash escapes: `"C:\\builds"` arrives as
    `C:\x08uilds`, which is not a Windows path and would pass a check that
    only looks for one.  The escaping this guards against would come from a
    file somebody else wrote, so it is worth testing the value that actually
    reaches the loader."""
    (tmp_path / "nexttex.toml").write_text(
        "[project]\nbuild_dir = 'C:\\builds'\n", encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).build_dir == "build"


def test_an_escaping_preview_is_dropped_and_the_rest_are_kept(tmp_path):
    """One bad entry must not take the good ones with it."""
    (tmp_path / "nexttex.toml").write_text(
        '[project]\npreviews = ["si.tex", "../../secrets.tex", "notes/x.tex"]\n',
        encoding="utf-8",
    )
    assert ProjectConfig.load(tmp_path).previews == ["si.tex", "notes/x.tex"]


@pytest.mark.parametrize("fine", [
    "main.tex", "chapters/intro.tex", "a/b/c/deep.tex",
])
def test_an_ordinary_relative_path_is_untouched(tmp_path, fine):
    """The rule must not refuse what every real project says."""
    (tmp_path / "nexttex.toml").write_text(
        f'[project]\nmain = "{fine}"\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).main == fine


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
