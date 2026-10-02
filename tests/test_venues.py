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
