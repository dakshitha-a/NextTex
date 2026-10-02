"""The manifests that say what each template is (`nexttex/venues.py`)."""

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

    monkeypatch.setattr(venues.shutil, "which", lambda name: "/bin/kpsewhich")
    monkeypatch.setattr(venues, "ensure_tex_on_path", lambda: None)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Done())
    assert venues._present(["acmart.cls", "comment.sty", "environ.sty"]) == {"acmart.cls", "comment.sty"}
    venues.forget()
    acm = venues.get("acm")
    assert venues.missing(acm) == ["environ", "hyperxmp", "ncctools", "totpages"]
    venues.forget()


TEX = venues.shutil.which("latexmk")


@pytest.mark.skipif(not TEX, reason="no latexmk here; CI has no TeX")
@pytest.mark.parametrize("name", [t.name for t in venues.templates() if t.cls])
def test_each_venue_template_builds(name, tmp_path):
    """Run where a TeX is installed, which is how each manifest's [needs]
    was filled: every package the first clean build asked for.  Skipped
    for a template whose packages this TeX lacks."""
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
