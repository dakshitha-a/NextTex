"""The manifests that say what each template is (`nexttex/venues.py`)."""

import re
from pathlib import Path

import pytest

from nexttex import venues


def test_every_shipped_template_has_a_manifest_that_reads():
    names = [t.name for t in venues.templates()]
    assert names[:6] == ["basic", "report", "beamer", "letter", "application", "reply"]
    application = venues.get("application")
    assert application.lead == "resume.tex" and not application.scaffold
    assert venues.get("basic").scaffold and venues.get("basic").lead == "main.tex"


def test_the_manifest_is_not_one_of_the_files(tmp_path):
    (tmp_path / "t").mkdir()
    (tmp_path / "t" / "template.toml").write_text('title = "T"\nkind = "general"\norder = 1\n')
    (tmp_path / "t" / "main.tex").write_text("x")
    (tmp_path / "t" / "figures").mkdir()
    (tmp_path / "t" / "figures" / ".gitkeep").write_text("")
    assert [p.name for p in venues.files("t", tmp_path)] == ["main.tex"]


@pytest.mark.parametrize("manifest, says", [
    ("", "no title"),
    ('title = "T"\norder = 1\nkind = "novel"\n', "kind 'novel'"),
    ('title = "T"\norder = 1\nkind = "general"\nlead = "paper.tex"\n', "leads with paper.tex"),
    ('title = "T\n', "template.toml"),
])
def test_a_manifest_that_is_wrong_says_how(tmp_path, manifest, says):
    (tmp_path / "t").mkdir()
    (tmp_path / "t" / "template.toml").write_text(manifest)
    (tmp_path / "t" / "main.tex").write_text("x")
    with pytest.raises(venues.ManifestError, match=says):
        venues.templates.__wrapped__(tmp_path)


def test_a_template_without_a_manifest_is_refused(tmp_path):
    (tmp_path / "t").mkdir()
    with pytest.raises(venues.ManifestError, match="no template.toml"):
        venues.templates.__wrapped__(tmp_path)


def test_the_guides_read_and_each_has_steps_and_an_official_page():
    guides = venues.guides()
    assert len(guides) >= 10
    for guide in guides:
        assert guide.kind in venues.KINDS
        assert guide.official.startswith("https://")
        assert 1 <= len(guide.steps) <= 4
    # A venue is a template or a guide, never both.
    assert not {g.name for g in guides} & {t.name for t in venues.templates()}


def test_a_guide_without_an_https_page_is_refused(tmp_path):
    (tmp_path / "catalogue.toml").write_text(
        '[[guide]]\nname = "x"\ntitle = "X"\nkind = "journal"\n'
        'official = "http://example.org"\nsteps = ["Get it."]\n'
    )
    with pytest.raises(venues.ManifestError, match="https"):
        venues.guides.__wrapped__(tmp_path)


def test_a_manifest_that_checks_a_package_it_does_not_need_is_refused(tmp_path):
    (tmp_path / "t").mkdir()
    (tmp_path / "t" / "main.tex").write_text("x")
    (tmp_path / "t" / "template.toml").write_text(
        'title = "T"\nkind = "journal"\norder = 1\n[needs]\na = "a.cls"\n[checked]\nb = "1.0"\n'
    )
    with pytest.raises(venues.ManifestError, match="checks b"):
        venues.templates.__wrapped__(tmp_path)


def test_missing_reads_kpsewhich_output_as_the_files_it_found(monkeypatch, tmp_path):
    """kpsewhich prints a path for each file it finds and exits 1 when any
    is missing; the paths are the answer, whatever the exit code."""
    import subprocess

    class Done:
        stdout = "/tex/acmart.cls\n/tex/comment.sty\n"
        returncode = 1

    monkeypatch.setattr(venues.shutil, "which", lambda name, **_: "/bin/kpsewhich")
    monkeypatch.setattr(venues.texpkg, "manager_here", lambda: ("tlmgr", "/bin/tlmgr"))
    monkeypatch.setattr(venues, "ensure_tex_on_path", lambda: None)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Done())
    assert venues._present(["acmart.cls", "comment.sty", "environ.sty"]) == {"acmart.cls", "comment.sty"}
    venues.forget()
    acm = venues.get("acm")
    assert venues.missing(acm) == [
        "xstring", "microtype", "totpages", "everyshi", "environ", "hyperxmp",
        "ncctools", "cmap", "caption", "fancyhdr", "preprint",
    ]
    venues.forget()



def test_on_miktex_the_package_list_answers_and_kpsewhich_is_not_asked(monkeypatch):
    """MiKTeX's kpsewhich, asked for a file of a package it lacks, waits on
    an install dialog; on the owner's laptop on 29 October 2026 the check
    never returned. The package manager's own list is asked instead, and a
    name MiKTeX does not know is left for the build to name."""
    import subprocess

    calls = []

    class Done:
        returncode = 0
        stdout = "acmart true\neveryshi true\nxstring false\nmicrotype false\ncmap false\n"

    def run(argv, **_):
        calls.append(argv)
        return Done()

    monkeypatch.setattr(venues.texpkg, "manager_here", lambda: ("miktex", "C:/m/miktex.exe"))
    monkeypatch.setattr(subprocess, "run", run)
    venues.forget()
    try:
        assert venues.missing(venues.get("acm")) == ["xstring", "microtype", "cmap"]
        assert calls == [["C:/m/miktex.exe", "packages", "list", "--template={id} {isInstalled}"]]
    finally:
        venues.forget()


def test_a_check_that_cannot_answer_names_every_package_when_a_manager_is_there(monkeypatch):
    """A kpsewhich that hangs past the limit is not "nothing missing": with
    a package manager to install them, every package is named."""
    import subprocess

    def hang(argv, **_):
        raise subprocess.TimeoutExpired(argv, venues.TIMEOUT)

    monkeypatch.setattr(venues.texpkg, "manager_here", lambda: ("tlmgr", "/t/tlmgr"))
    monkeypatch.setenv("NEXTTEX_KPSEWHICH", "/t/kpsewhich")
    monkeypatch.setattr(subprocess, "run", hang)
    venues.forget()
    try:
        acm = venues.get("acm")
        assert venues.missing(acm) == list(acm.needs)
        monkeypatch.setattr(venues.texpkg, "manager_here", lambda: ("", ""))
        venues.forget()
        assert venues.missing(acm) is None
    finally:
        venues.forget()


TEX = venues.shutil.which("latexmk")


@pytest.mark.skipif(not TEX, reason="no latexmk here; CI has no TeX")
@pytest.mark.parametrize("name", [t.name for t in venues.templates()])
def test_each_template_builds(name, tmp_path):
    """Run where a TeX is installed, which is how each manifest's [needs]
    was filled: every package the first clean build asked for.  Skipped
    for a template whose packages this TeX lacks.  Every template, not
    only the venues: the article had no [needs] and built here only
    because this TeX had everything, while a fresh TinyTeX on a Mac
    could not build it (26 October 2026)."""
    import shutil
    import subprocess

    template = venues.get(name)
    venues.forget()
    if venues.missing(template):
        pytest.skip(f"this TeX lacks {venues.missing(template)}")
    for path in venues.files(name):
        target = tmp_path / path.relative_to(venues.ROOT / name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(path, target)
    done = subprocess.run(
        ["latexmk", "-pdf", "-interaction=nonstopmode", "-halt-on-error", template.lead],
        cwd=tmp_path, capture_output=True, text=True, timeout=300,
    )
    assert done.returncode == 0, done.stdout[-3000:]
    assert (tmp_path / template.lead.replace(".tex", ".pdf")).is_file()


#: The style and class files a clean TinyTeX has once the installer has
#: added its five tools, measured from the bundle on 26 October 2026.
TINYTEX = {
    line.strip()
    for line in (Path(__file__).parent / "fixtures" / "tinytex-files.txt").read_text().splitlines()
    if line.strip() and not line.startswith("#")
}
LOADS = re.compile(
    r"\\(documentclass|usepackage|RequirePackage|usetheme)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}"
)


def _loaded_files(template) -> set:
    """Every class, package and beamer theme a template's sources load."""
    found = set()
    for path in venues.files(template.name):
        if path.suffix not in (".tex", ".cls", ".sty"):
            continue
        text = "\n".join(line.split("%", 1)[0]
                         for line in path.read_text(encoding="utf-8").splitlines())
        for command, names in LOADS.findall(text):
            for name in (n.strip() for n in names.split(",")):
                if not name:
                    continue
                if command == "documentclass":
                    found.add(name + ".cls")
                elif command == "usetheme":
                    # The default theme is part of beamer itself.
                    if name != "default":
                        found.add(f"beamertheme{name}.sty")
                else:
                    found.add(name + ".sty")
    return found


@pytest.mark.parametrize("name", [t.name for t in venues.templates()])
def test_a_template_names_everything_a_fresh_tinytex_lacks(name):
    """A fresh TinyTeX on a Mac could not build the article, NextTex's
    default template: its manifest had no [needs], so Create installed
    nothing, and parskip, microtype, siunitx, pgf and biblatex are not in
    TinyTeX's bundle.  It built on every machine that had looked, because
    each had a fuller TeX.  So every file a template loads is either one
    a clean TinyTeX has, one its own folder ships, or one its [needs]
    names.  This sees what the sources load; what a class loads in turn
    only a build on a clean TinyTeX shows, which is how the tables were
    filled."""
    template = venues.get(name)
    shipped = {path.name for path in venues.files(name)}
    needed = set(template.needs.values())
    lacking = sorted(_loaded_files(template) - TINYTEX - shipped - needed)
    assert not lacking, f"{name} loads {lacking}, which a fresh TinyTeX lacks; add them to [needs]"
