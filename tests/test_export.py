"""A document as Word, HTML or Markdown through pandoc."""

import os
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

from nexttex import export

FAKE = Path(__file__).parent / "fake_pandoc.py"
#: The real pandoc where it is: on PATH, or in `~/.local/bin`, which is
#: where the plan put it on the machine this was written on and where a
#: shell that has not been told about it does not look.
REAL = shutil.which("pandoc") or (
    str(Path.home() / ".local" / "bin" / "pandoc")
    if (Path.home() / ".local" / "bin" / "pandoc").exists() else None
)


def test_the_binary_is_the_seam_first_and_the_path_second(monkeypatch):
    monkeypatch.setenv("NEXTTEX_PANDOC", str(FAKE))
    assert export.pandoc_here() == str(FAKE)
    monkeypatch.delenv("NEXTTEX_PANDOC")
    monkeypatch.setattr(shutil, "which", lambda name: None)
    assert export.pandoc_here() is None


@pytest.mark.parametrize("fmt, writer, suffix", [("docx", "docx", "docx"), ("html", "html", "html"), ("md", "gfm", "md")])
def test_the_argv_for_each_format(tmp_path, fmt, writer, suffix):
    main = tmp_path / "paper" / "main.tex"
    bibs = [tmp_path / "refs.bib", tmp_path / "more.bib"]
    command = export.argv("pandoc", main, fmt, tmp_path / f"out.{suffix}", tmp_path, bibs)
    assert command[:7] == ["pandoc", str(main), "-f", "latex", "-t", writer, "-o"]
    assert command[8] == f"--resource-path={main.parent}{os.pathsep}{tmp_path}"
    assert ("--standalone" in command) == (fmt == "html")
    assert ("--embed-resources" in command) == (fmt == "html")
    assert command.count("--citeproc") == 1
    assert f"--bibliography={bibs[0]}" in command and f"--bibliography={bibs[1]}" in command


def test_no_bibliography_means_no_citeproc(tmp_path):
    command = export.argv("pandoc", tmp_path / "m.tex", "md", tmp_path / "m.md", tmp_path, [])
    assert "--citeproc" not in command


def test_the_fake_writes_a_file_and_the_failure_carries_the_message(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXTTEX_PANDOC", str(FAKE))
    main = tmp_path / "main.tex"
    main.write_text("x", encoding="utf-8")
    out = export.convert(main, "docx", tmp_path, tmp_path, [])
    assert out.name == "main.docx" and "wrote docx" in out.read_text(encoding="utf-8")
    broken = tmp_path / "broken.tex"
    broken.write_text("x", encoding="utf-8")
    with pytest.raises(export.ExportError, match="nothere"):
        export.convert(broken, "html", tmp_path, tmp_path, [])


def test_a_missing_pandoc_and_a_timeout_are_sentences(tmp_path, monkeypatch):
    monkeypatch.delenv("NEXTTEX_PANDOC", raising=False)
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(export.ExportError, match="not installed"):
        export.convert(tmp_path / "m.tex", "md", tmp_path, tmp_path, [])
    monkeypatch.setenv("NEXTTEX_PANDOC", str(FAKE))

    def slow(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="pandoc", timeout=1)

    monkeypatch.setattr(subprocess, "run", slow)
    with pytest.raises(export.ExportError, match="took more than"):
        export.convert(tmp_path / "m.tex", "md", tmp_path, tmp_path, [], timeout=1)


def test_an_unknown_format_is_refused(tmp_path):
    with pytest.raises(export.ExportError, match="not a format"):
        export.convert(tmp_path / "m.tex", "pdf", tmp_path, tmp_path, [])


@pytest.mark.skipif(REAL is None, reason="pandoc is needed")
def test_the_real_pandoc_writes_all_three(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXTTEX_PANDOC", REAL)
    (tmp_path / "refs.bib").write_text(
        "@article{knuth84,\n  author = {Donald E. Knuth}, title = {Literate programming},\n"
        "  journal = {The Computer Journal}, year = {1984}\n}\n", encoding="utf-8",
    )
    # A one-pixel PNG, so the HTML has an image to embed.
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
        "53de0000000c4944415408d763f8cfc0000003010100c9fe92ef0000000049454e44ae426082"
    )
    (tmp_path / "dot.png").write_bytes(png)
    main = tmp_path / "main.tex"
    main.write_text(
        "\\documentclass{article}\\usepackage{graphicx}\\begin{document}\n"
        "\\section{Hello}\nA sentence with a citation \\cite{knuth84}.\n"
        "\\includegraphics{dot.png}\n\\bibliographystyle{plain}\\bibliography{refs}\n"
        "\\end{document}\n", encoding="utf-8",
    )
    bibs = [tmp_path / "refs.bib"]
    docx = export.convert(main, "docx", tmp_path, tmp_path, bibs)
    with zipfile.ZipFile(docx) as archive:
        assert "word/document.xml" in archive.namelist()
    html = export.convert(main, "html", tmp_path, tmp_path, bibs).read_text(encoding="utf-8")
    assert "<h1" in html and "data:image/png;base64" in html and "Knuth" in html
    md = export.convert(main, "md", tmp_path, tmp_path, bibs).read_text(encoding="utf-8")
    assert md.startswith("# Hello") and "Knuth" in md
