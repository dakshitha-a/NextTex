"""Path handling, which is the other half of the security boundary."""

from pathlib import Path

import pytest

from nexttex.project import Project, ProjectConfig, guess_document


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


def test_the_document_is_guessed_from_the_document_itself(tmp_path):
    (tmp_path / "helper.tex").write_text("\\section{x}", encoding="utf-8")
    (tmp_path / "thesis.tex").write_text(
        "\\documentclass{report}\n\\begin{document}\n\\end{document}", encoding="utf-8"
    )
    assert guess_document(tmp_path) == "thesis.tex"


def test_a_folder_with_no_document_guesses_nothing(tmp_path):
    """A brand new project has no document until its template is loaded,
    and guessing `main.tex` for it registered a file that was not there."""
    (tmp_path / "helper.tex").write_text("\\section{x}", encoding="utf-8")
    assert guess_document(tmp_path) is None


def test_an_older_toml_hands_over_its_main_and_previews_once(tmp_path):
    """`main` and `previews` are viewer state now, kept per install in
    `.nexttex/previews.json`.  A toml that still has them is read once, in
    order, and the keys are not written back."""
    (tmp_path / "nexttex.toml").write_text(
        '[project]\nname = "T"\nmain = "other.tex"\nprevious = 1\n'
        'previews = ["si.tex", "other.tex"]\n',
        encoding="utf-8",
    )
    config = ProjectConfig.load(tmp_path)
    assert config.inherited_documents == ["other.tex", "si.tex"]
    config.save(tmp_path)
    text = (tmp_path / "nexttex.toml").read_text(encoding="utf-8")
    assert "main" not in text and "previews" not in text
    assert ProjectConfig.load(tmp_path).inherited_documents == []


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
def test_a_document_outside_the_project_is_refused(tmp_path, escape):
    """An inherited document name is opened and read straight off the disk
    by the compiler, so an escaping one is dropped rather than kept."""
    (tmp_path / "thesis.tex").write_text(
        "\\documentclass{report}\\begin{document}\\end{document}", encoding="utf-8"
    )
    (tmp_path / "nexttex.toml").write_text(
        f'[project]\nmain = "{escape}"\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).inherited_documents == []


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
    assert ProjectConfig.load(tmp_path).inherited_documents == ["si.tex", "notes/x.tex"]


@pytest.mark.parametrize("fine", [
    "main.tex", "chapters/intro.tex", "a/b/c/deep.tex",
])
def test_an_ordinary_relative_path_is_untouched(tmp_path, fine):
    """The rule must not refuse what every real project says."""
    (tmp_path / "nexttex.toml").write_text(
        f'[project]\nmain = "{fine}"\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).inherited_documents == [fine]


def test_the_tree_hides_build_output_and_our_own_files(tmp_path):
    p = project(tmp_path)
    (tmp_path / "build").mkdir()
    (tmp_path / "build" / "main.pdf").write_bytes(b"%PDF")
    (tmp_path / ".nexttex-preview.tex").write_text("x", encoding="utf-8")
    names = [child["name"] for child in p.tree()["children"]]
    assert "main.tex" in names
    assert "build" not in names
    assert ".nexttex-preview.tex" not in names


def test_a_virtual_environment_is_hidden_whatever_it_is_called(tmp_path):
    """The tracker had `env` and `site-packages` down as names to add to
    the ignore list when a project with a bare environment inside it turned
    up.  `env` is a plausible name for a folder of a writer's own, so the
    rule is the marker every virtual environment carries, `pyvenv.cfg`,
    and `site-packages` by name since it never holds anybody's writing."""
    from nexttex.project import guess_document, ignored_directory

    p = project(tmp_path)
    (tmp_path / "env" / "lib").mkdir(parents=True)
    (tmp_path / "env" / "pyvenv.cfg").write_text("home = /usr/bin\n", encoding="utf-8")
    (tmp_path / "env" / "lib" / "helper.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "env" / "lib" / "stray.tex").write_text("\\documentclass{article}\\begin{document}x\\end{document}", encoding="utf-8")
    (tmp_path / "site-packages").mkdir()
    (tmp_path / "site-packages" / "mod.py").write_text("y = 2\n", encoding="utf-8")
    (tmp_path / "environment").mkdir()          # a folder that merely sounds like one
    (tmp_path / "environment" / "notes.tex").write_text("notes", encoding="utf-8")

    names = [child["name"] for child in p.tree()["children"]]
    assert "env" not in names
    assert "site-packages" not in names
    assert "environment" in names
    assert ignored_directory(tmp_path / "env")
    assert not ignored_directory(tmp_path / "environment")
    # The first-open guess walks the whole tree and must not pick a .tex
    # out of the environment either.
    assert guess_document(tmp_path) != "env/lib/stray.tex"


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
