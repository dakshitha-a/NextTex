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


def test_the_venue_facts_round_trip_and_a_bad_one_is_the_default(tmp_path):
    """`page_limit` and `blind` are the submission check's two settings,
    in the project's own file so a co-author's check agrees with yours."""
    (tmp_path / "nexttex.toml").write_text(
        '[project]\nname = "T"\npage_limit = 8\nblind = true\n', encoding="utf-8"
    )
    config = ProjectConfig.load(tmp_path)
    assert config.page_limit == 8 and config.blind is True
    config.save(tmp_path)
    written = (tmp_path / "nexttex.toml").read_text(encoding="utf-8")
    assert "page_limit = 8" in written and "blind = true" in written
    # Unset is unwritten, so a project that never asked does not gain lines.
    config.page_limit, config.blind = 0, False
    config.save(tmp_path)
    written = (tmp_path / "nexttex.toml").read_text(encoding="utf-8")
    assert "page_limit" not in written and "blind" not in written


@pytest.mark.parametrize("raw", ['"8"', "true", "-3", "8.5", "1000000"])
def test_a_page_limit_that_is_not_a_count_reads_as_none(tmp_path, raw):
    (tmp_path / "nexttex.toml").write_text(
        f'[project]\nname = "T"\npage_limit = {raw}\nblind = "yes"\n', encoding="utf-8"
    )
    config = ProjectConfig.load(tmp_path)
    assert config.page_limit == 0 and config.blind is False


def test_word_limits_round_trip_beside_the_other_settings(tmp_path):
    """A table under `[project]`, keyed by a heading's title, written after
    every other field so the file stays one `[project]` table and one
    `[project.limits]`; an entry that is not a title and a whole number is
    dropped on reading, and the rest kept."""
    (tmp_path / "nexttex.toml").write_text(
        '[project]\nname = "T"\npage_limit = 8\nexclude = ["drafts"]\n'
        '[project.limits]\nAbstract = 250\n"Results and discussion" = 3000\n'
        'Bad = "many"\nZero = 0\nFlag = true\n',
        encoding="utf-8",
    )
    config = ProjectConfig.load(tmp_path)
    assert config.word_limits == {"Abstract": 250, "Results and discussion": 3000}
    assert config.page_limit == 8 and config.exclude == ["drafts"]
    config.save(tmp_path)
    again = ProjectConfig.load(tmp_path)
    assert again.word_limits == config.word_limits
    assert again.page_limit == 8 and again.exclude == ["drafts"]
    config.word_limits = {}
    config.save(tmp_path)
    assert "limits" not in (tmp_path / "nexttex.toml").read_text(encoding="utf-8")


def test_keeping_every_version_round_trips_and_defaults_off(tmp_path):
    """Thinning is the default, so the key is absent until a project turns
    it on; only a real true turns it on, since the file is shared."""
    (tmp_path / "nexttex.toml").write_text('[project]\nname = "T"\n', encoding="utf-8")
    config = ProjectConfig.load(tmp_path)
    assert config.keep_all_versions is False
    config.keep_all_versions = True
    config.save(tmp_path)
    assert ProjectConfig.load(tmp_path).keep_all_versions is True
    (tmp_path / "nexttex.toml").write_text(
        '[project]\nname = "T"\nkeep_all_versions = "yes"\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).keep_all_versions is False


def test_projects_opened_in_the_same_moment_are_listed_by_name_then_path(tmp_path):
    """Most recently opened first, and a tie, which a seeded or hand-written
    registry can hold, by name and then by path: the order is a function
    of the entries, not of the order they were written in."""
    from nexttex.project import Registry, RegistryEntry

    for folder in ("zeta", "Alpha", "alpha-2", "mid"):
        (tmp_path / folder).mkdir()
    registry = Registry(tmp_path / "projects.json")
    registry._write([
        RegistryEntry(str(tmp_path / "zeta"), "zeta", 100.0),
        RegistryEntry(str(tmp_path / "alpha-2"), "alpha", 100.0),
        RegistryEntry(str(tmp_path / "Alpha"), "Alpha", 100.0),
        RegistryEntry(str(tmp_path / "mid"), "mid", 200.0),
    ])
    listed = [(row["name"], row["path"]) for row in registry.list()]
    assert listed == [
        ("mid", str(tmp_path / "mid")),
        ("Alpha", str(tmp_path / "Alpha")),
        ("alpha", str(tmp_path / "alpha-2")),
        ("zeta", str(tmp_path / "zeta")),
    ]


def test_the_tree_skips_machinery_sorts_folders_first_and_follows_a_linked_folder(tmp_path):
    """The tree is one `scandir` per folder now, where it was four `stat`s
    an entry; it must answer as it did. Folders first, then names without
    case; the build directory, `.git`, a virtual environment found by its
    marker and NextTex's own state left out; a linked folder followed."""
    from nexttex.project import Project

    root = tmp_path / "paper"
    (root / "build").mkdir(parents=True)
    (root / "build" / "main.pdf").write_text("x")
    (root / ".git").mkdir()
    (root / "env").mkdir()
    (root / "env" / "pyvenv.cfg").write_text("")
    (root / "Figures").mkdir()
    (root / "Figures" / "plot.png").write_bytes(b"x")
    (root / "appendix").mkdir()
    (root / "Zeta.tex").write_text("z")
    (root / "alpha.tex").write_text("a")
    (root / "linked").symlink_to(root / "Figures", target_is_directory=True)
    tree = Project.open(root).tree()
    names = [child["name"] for child in tree["children"]]
    assert names[:3] == ["appendix", "Figures", "linked"]
    assert "build" not in names and ".git" not in names and "env" not in names
    assert names.index("alpha.tex") < names.index("Zeta.tex")
    linked = next(child for child in tree["children"] if child["name"] == "linked")
    assert [child["path"] for child in linked["children"]] == ["linked/plot.png"]
    image = next(c for c in tree["children"] if c["name"] == "Figures")["children"][0]
    assert image["kind"] == "image" and image["size"] == 1 and image["mtime"] > 0


# --- what the editor may open --------------------------------------------

#: A Gaussian input, an ORCA output, a molecule and a Fortran source: the
#: files a computational chemist keeps beside a thesis, none of whose
#: suffixes any list names.
TEXT_FILES = {
    "calc/water.gjf": "%mem=4GB\n# B3LYP/6-31G(d) opt\n\nwater\n\n0 1\nO 0 0 0\n",
    "calc/water.out": "ORCA TERMINATED NORMALLY\nTotal Energy : -76.4 Eh\n",
    "geom/benzene.xyz": "12\nbenzene\nC 0.000 1.396 0.000\n",
    "src/integrals.f90": "program integrals\n  implicit none\nend program\n",
    "md/run.mdp": "integrator = md\nnsteps = 500000\n",
    "notes.unheardof": "Å and ü are text too.\n",
}


@pytest.mark.parametrize("name, text", TEXT_FILES.items())
def test_any_file_whose_bytes_are_text_is_text(tmp_path, name, text):
    """The editor used to open a file only when its suffix was on a list of
    eighteen, so a `.xyz`, an `.inp` or a `.f90` was offered as a download.
    What decides it now is the bytes."""
    from nexttex.project import kind_of_file

    target = tmp_path / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    assert kind_of_file(target) == "text"


@pytest.mark.parametrize("name, body", [
    # A suffix nobody lists, holding a binary: a checkpoint under a name a
    # program chose, an unformatted Fortran `.dat`.
    ("calc/run.gbw2", bytes(range(256)) * 40),
    ("data/unformatted.dat", b"\x10\x00\x00\x00" + b"\x9a\x99\x99\x99" * 4),
    ("calc/latin1.out", "Energie in \u00c5ngstr\u00f6m\n".encode("latin-1")),
])
def test_a_file_whose_bytes_are_not_text_is_binary(tmp_path, name, body):
    from nexttex.project import kind_of_file

    target = tmp_path / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    assert kind_of_file(target) == "binary"


def test_a_character_cut_by_the_sniff_is_forgiven_and_a_cut_file_is_not(tmp_path):
    """Only the head of a file is read, so a multibyte character can straddle
    its end. That is the reading stopping, not the file being binary; a
    file that really ends halfway through a character is not UTF-8."""
    from nexttex.project import SNIFF_BYTES, kind_of_file, looks_like_text

    long = tmp_path / "long.log2"
    long.write_bytes(b"a" * (SNIFF_BYTES - 1) + "Å".encode() + b"\nmore\n")
    assert kind_of_file(long) == "text"
    assert looks_like_text("Å".encode()[:1], whole=True) is False


def test_the_name_answers_without_reading_when_it_can(tmp_path):
    """A known suffix is never opened, which is what keeps the tree, asked
    after every change, as fast as it was: a `.png` full of text is still a
    picture and a `.zip` is still an archive."""
    from nexttex.project import kind_of, kind_of_file

    (tmp_path / "plot.png").write_text("not really a png")
    (tmp_path / "bundle.zip").write_text("not really a zip")
    assert kind_of_file(tmp_path / "plot.png") == "image"
    assert kind_of_file(tmp_path / "bundle.zip") == "binary"
    assert kind_of("geom/benzene.xyz") == "text"
    assert kind_of("calc/water.chk") == "binary"


def test_a_file_that_changes_is_read_again(tmp_path):
    """The answer is kept by size and modification time, so the tree reads a
    thousand output files once rather than on every change; a file that
    becomes binary must not keep its old answer."""
    import os

    from nexttex.project import kind_of_file

    target = tmp_path / "run.out"
    target.write_text("SCF converged\n")
    assert kind_of_file(target) == "text"
    target.write_bytes(b"\x00\x01\x02 binary now")
    stat = target.stat()
    os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    assert kind_of_file(target) == "binary"


def test_the_tree_calls_a_file_by_its_bytes(tmp_path):
    root = tmp_path / "paper"
    root.mkdir()
    (root / "benzene.xyz").write_text("12\nbenzene\n")
    (root / "run.gbw2").write_bytes(bytes(range(256)))
    kinds = {c["name"]: c["kind"] for c in Project.open(root).tree()["children"]}
    assert kinds == {"benzene.xyz": "text", "run.gbw2": "binary"}
