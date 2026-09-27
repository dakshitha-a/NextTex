"""A document as Word, HTML or Markdown through pandoc."""

import json
import os
import shutil
import subprocess
import sys
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
    out = export.convert(main, "docx", tmp_path, tmp_path, []).path
    assert out.name == "main.docx" and "wrote docx for main.json" in out.read_text(encoding="utf-8")
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


# -- the two passes ----------------------------------------------------------


def test_word_and_html_read_to_a_tree_and_write_from_it(tmp_path):
    main = tmp_path / "paper" / "main.tex"
    tree = tmp_path / "main.json"
    assert export.read_argv("pandoc", main, tree) == [
        "pandoc", str(main), "-f", "latex", "-t", "json", "-o", str(tree),
    ]
    bibs = [tmp_path / "refs.bib"]
    command = export.write_argv("pandoc", tree, "html", tmp_path / "o.html", main, tmp_path, bibs)
    assert command[:8] == ["pandoc", str(tree), "-f", "json", "-t", "html", "-o", str(tmp_path / "o.html")]
    assert command[8] == f"--resource-path={main.parent}{os.pathsep}{tmp_path}"
    assert "--embed-resources" in command and "--citeproc" in command
    assert f"--bibliography={bibs[0]}" in command


def test_markdown_keeps_one_pass_and_its_figures_as_written(tmp_path, monkeypatch):
    log = tmp_path / "log.jsonl"
    monkeypatch.setenv("NEXTTEX_PANDOC", str(FAKE))
    monkeypatch.setenv("NEXTTEX_FAKE_PANDOC_LOG", str(log))
    main = tmp_path / "main.tex"
    main.write_text("\\includegraphics{plot}", encoding="utf-8")
    export.convert(main, "md", tmp_path, tmp_path, [])
    seen = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert len(seen) == 1 and seen[0][seen[0].index("-f") + 1] == "latex"


def test_graphicspath_is_read_from_every_source_and_not_from_a_comment(tmp_path):
    main = tmp_path / "main.tex"
    main.write_text(
        "\\graphicspath{{figures/}{plots/raw/}}\n% \\graphicspath{{old/}}\n", encoding="utf-8",
    )
    part = tmp_path / "part.tex"
    part.write_text("\\graphicspath{ {more/} }\n", encoding="utf-8")
    assert export.graphics_dirs([main, part, tmp_path / "gone.tex"]) == ["figures/", "plots/raw/", "more/"]


def test_a_figure_is_found_the_way_tex_finds_it(tmp_path):
    root = tmp_path
    paper = root / "paper"
    (paper / "figures").mkdir(parents=True)
    main = paper / "main.tex"
    main.write_text("", encoding="utf-8")
    (paper / "figures" / "plot.pdf").write_bytes(b"%PDF")
    (paper / "figures" / "plot.png").write_bytes(b"png")
    (root / "shared.svg").write_text("<svg/>", encoding="utf-8")
    (paper / "local.png").write_bytes(b"png")
    # A suffix left off tries pdflatex's order, PDF first.
    assert export.resolve_figure("plot", main, root, ["figures/"]) == ((paper / "figures" / "plot.pdf").resolve(), "")
    assert export.resolve_figure("figures/plot.png", main, root, []) == ((paper / "figures" / "plot.png").resolve(), "")
    # The document's directory, then the project root.
    assert export.resolve_figure("local", main, root, []) == ((paper / "local.png").resolve(), "")
    assert export.resolve_figure("shared", main, root, []) == ((root / "shared.svg").resolve(), "")
    assert export.resolve_figure("nothere", main, root, ["figures/"]) == (None, "missing")


def test_a_figure_outside_the_project_is_never_read(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    main = root / "main.tex"
    main.write_text("", encoding="utf-8")
    secret = tmp_path / "secret.png"
    secret.write_bytes(b"png")
    assert export.resolve_figure("../secret.png", main, root, []) == (None, "outside")
    assert export.resolve_figure(str(secret), main, root, []) == (None, "outside")
    assert export.resolve_figure("C:/x.png", main, root, []) == (None, "outside")
    link = root / "link.png"
    try:
        link.symlink_to(secret)
    except OSError:
        pytest.skip("no symlinks here")
    assert export.resolve_figure("link.png", main, root, []) == (None, "outside")


def _png(width: int = 1, height: int = 1) -> bytes:
    import struct
    import zlib

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    raw = b"".join(b"\x00" + b"\x00\x00\x00" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"pHYs", struct.pack(">IIB", 2835, 2835, 1))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _dpi(data: bytes) -> tuple[int, list[bytes]]:
    import struct

    at, kinds, dpi = 8, [], 0
    while at < len(data):
        length = struct.unpack(">I", data[at:at + 4])[0]
        kind = data[at + 4:at + 8]
        kinds.append(kind)
        if kind == b"pHYs":
            dpi = round(struct.unpack(">I", data[at + 8:at + 12])[0] * 0.0254)
        at += 12 + length
    return dpi, kinds


def test_every_picture_made_says_300_dpi_once(tmp_path):
    png = tmp_path / "p.png"
    png.write_bytes(_png())
    export.stamp_png_dpi(png)
    dpi, kinds = _dpi(png.read_bytes())
    assert dpi == 300 and kinds.count(b"pHYs") == 1 and kinds[:2] == [b"IHDR", b"pHYs"]
    # Still a PNG anything can open.
    assert kinds[-1] == b"IEND"


def _tool(bin_dir: Path, name: str, body: str) -> None:
    """A stand-in for a converter: a Python script that writes what the
    real one would, at the path the argv names."""
    script = bin_dir / name
    script.write_text(f"#!{sys.executable}\nimport sys\n{body}\n", encoding="utf-8")
    script.chmod(0o755)


@pytest.fixture
def tools(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    return bin_dir


def _which(bin_dir: Path):
    return lambda name: str(bin_dir / name) if (bin_dir / name).exists() else None


PNG_WRITER = f"open({{}}, 'wb').write({_png()!r})"


@pytest.mark.skipif(sys.platform == "win32", reason="stand-in tools are scripts")
def test_a_pdf_figure_becomes_a_300_dpi_png_for_word_and_an_svg_for_html(tmp_path, tools):
    _tool(tools, "pdftocairo", "\n".join([
        "out = sys.argv[-1]",
        "if '-svg' in sys.argv: open(out, 'w').write('<svg/>')",
        "else: " + PNG_WRITER.format("out + '.png'"),
    ]))
    pdf = tmp_path / "plot.pdf"
    pdf.write_bytes(b"%PDF")
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    shown, why = export.convert_figure(pdf, "docx", scratch, _which(tools))
    assert why == "" and shown.suffix == ".png" and _dpi(shown.read_bytes())[0] == 300
    shown, why = export.convert_figure(pdf, "html", scratch, _which(tools))
    assert why == "" and shown.suffix == ".svg"
    # A PNG or a JPEG is already a picture.
    jpg = tmp_path / "photo.jpg"
    jpg.write_bytes(b"jpg")
    assert export.convert_figure(jpg, "docx", scratch, _which(tools)) == (jpg, "")


@pytest.mark.skipif(sys.platform == "win32", reason="stand-in tools are scripts")
def test_an_eps_goes_through_epstopdf_or_ghostscript_and_then_poppler(tmp_path, tools):
    _tool(tools, "pdftocairo", PNG_WRITER.format("sys.argv[-1] + '.png'"))
    _tool(tools, "gs", "out = [a for a in sys.argv if a.startswith('-sOutputFile=')][0].split('=', 1)[1]\n"
                       "open(out, 'wb').write(b'%PDF')")
    eps = tmp_path / "old.eps"
    eps.write_text("%!PS", encoding="utf-8")
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    shown, why = export.convert_figure(eps, "docx", scratch, _which(tools))
    assert why == "" and shown.suffix == ".png"
    assert export.convert_figure(eps, "docx", scratch, lambda name: None) == (None, "no-converter")


@pytest.mark.skipif(sys.platform == "win32", reason="stand-in tools are scripts")
def test_an_svg_without_a_renderer_stays_svg_and_says_so(tmp_path, tools, monkeypatch):
    svg = tmp_path / "b.svg"
    svg.write_text("<svg/>", encoding="utf-8")
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    monkeypatch.setattr(export, "has_resvg", lambda: False)
    assert export.convert_figure(svg, "docx", scratch, lambda name: None) == (svg, "svg-only")
    # HTML shows an SVG as it is.
    assert export.convert_figure(svg, "html", scratch, lambda name: None) == (svg, "")
    # ImageMagick is never asked: its renderer draws matplotlib's plots empty.
    _tool(tools, "convert", "raise SystemExit(1)")
    _tool(tools, "magick", "raise SystemExit(1)")
    assert export.convert_figure(svg, "docx", scratch, _which(tools)) == (svg, "svg-only")
    _tool(tools, "rsvg-convert", PNG_WRITER.format("sys.argv[sys.argv.index('-o') + 1]"))
    shown, why = export.convert_figure(svg, "docx", scratch, _which(tools))
    assert why == "" and shown.suffix == ".png"


@pytest.mark.skipif(not export.has_resvg(), reason="resvg is optional")
def test_resvg_draws_an_svg_at_its_size_in_points(tmp_path):
    svg = tmp_path / "b.svg"
    # 72 pt by 36 pt: one inch by half an inch, so 300 by 150 at 300 dpi.
    svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="72pt" height="36pt" viewBox="0 0 72 36">'
        '<rect width="72" height="36" fill="#1f77b4"/></svg>', encoding="utf-8",
    )
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    shown, why = export.convert_figure(svg, "docx", scratch, lambda name: None)
    import struct

    data = shown.read_bytes()
    assert why == "" and struct.unpack(">II", data[16:24]) == (300, 150) and _dpi(data)[0] == 300


def test_the_tree_is_rewritten_and_a_lost_figure_becomes_its_name(tmp_path, monkeypatch):
    (tmp_path / "figures").mkdir()
    (tmp_path / "figures" / "a.png").write_bytes(_png())
    main = tmp_path / "main.tex"
    image = lambda src: {"t": "Image", "c": [["", [], []], [], [src, ""]]}  # noqa: E731
    tree = {"pandoc-api-version": [1, 23, 1], "meta": {}, "blocks": [
        {"t": "Figure", "c": [["", [], []], [None, []], [{"t": "Plain", "c": [image("a")]}]]},
        {"t": "Para", "c": [image("gone"), image("https://example.org/x.png")]},
    ]}
    rewritten, notes = export.rewrite_images(tree, "docx", main, tmp_path, ["figures/"], tmp_path)
    inner = rewritten["blocks"][0]["c"][2][0]["c"][0]
    assert inner["t"] == "Image" and inner["c"][2][0] == str((tmp_path / "figures" / "a.png").resolve())
    assert rewritten["blocks"][1]["c"][0] == {"t": "Str", "c": "[gone]"}
    # A web address is left for pandoc.
    assert rewritten["blocks"][1]["c"][1]["c"][2][0] == "https://example.org/x.png"
    assert notes == [export.FigureNote("gone", "missing")]
    # The tree it was given is untouched.
    assert tree["blocks"][1]["c"][0]["t"] == "Image"


def test_the_writer_is_told_what_became_of_the_figures_in_plain_words():
    assert export.notes_sentence([], "main.docx") == ""
    said = export.notes_sentence([export.FigureNote("figures/c.eps", "no-converter")], "main.docx")
    assert said == (
        "main.docx is saved. 1 figure could not be made into a picture and shows as its name: "
        "figures/c.eps (no EPS converter on this machine)."
    )
    said = export.notes_sentence([export.FigureNote("figures/b.svg", "svg-only")], "main.docx")
    assert said == (
        "main.docx is saved. figures/b.svg went in as SVG, which only Word 365 shows. "
        "Installing rsvg-convert makes it a picture every reader can open."
    )
    said = export.notes_sentence(
        [export.FigureNote("a", "missing"), export.FigureNote("../b.png", "outside")], "p.html",
    )
    assert "2 figures could not be made into pictures" in said and "../b.png (outside the project)" in said
    assert chr(0x2014) not in said and chr(0x2013) not in said


@pytest.mark.skipif(REAL is None, reason="pandoc is needed")
def test_the_real_pandoc_writes_all_three(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXTTEX_PANDOC", REAL)
    (tmp_path / "refs.bib").write_text(
        "@article{knuth84,\n  author = {Donald E. Knuth}, title = {Literate programming},\n"
        "  journal = {The Computer Journal}, year = {1984}\n}\n", encoding="utf-8",
    )
    (tmp_path / "dot.png").write_bytes(_png())
    main = tmp_path / "main.tex"
    main.write_text(
        "\\documentclass{article}\\usepackage{graphicx}\\begin{document}\n"
        "\\section{Hello}\nA sentence with a citation \\cite{knuth84}.\n"
        "\\includegraphics{dot.png}\n\\bibliographystyle{plain}\\bibliography{refs}\n"
        "\\end{document}\n", encoding="utf-8",
    )
    bibs = [tmp_path / "refs.bib"]
    docx = export.convert(main, "docx", tmp_path, tmp_path, bibs)
    with zipfile.ZipFile(docx.path) as archive:
        assert "word/document.xml" in archive.namelist()
        assert "Knuth" in archive.read("word/document.xml").decode("utf-8")
    html = export.convert(main, "html", tmp_path, tmp_path, bibs).path.read_text(encoding="utf-8")
    assert "<h1" in html and "data:image/png;base64" in html and "Knuth" in html
    md = export.convert(main, "md", tmp_path, tmp_path, bibs).path.read_text(encoding="utf-8")
    assert md.startswith("# Hello") and "Knuth" in md


@pytest.mark.skipif(REAL is None or not shutil.which("pdftocairo"), reason="pandoc and poppler are needed")
def test_a_papers_figures_all_reach_the_word_file_as_pictures(tmp_path, monkeypatch):
    """The case the writer met: PDF figures, one named without a suffix
    and one found through `\\graphicspath`, and an SVG, all shown in Word."""
    monkeypatch.setenv("NEXTTEX_PANDOC", REAL)
    (tmp_path / "figures").mkdir()
    # A one-page PDF written by hand, so no plotting library is needed.
    (tmp_path / "figures" / "a.pdf").write_bytes(MINIMAL_PDF)
    (tmp_path / "figures" / "b.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="72pt" height="36pt" viewBox="0 0 72 36">'
        '<rect width="72" height="36" fill="#1f77b4"/></svg>', encoding="utf-8",
    )
    (tmp_path / "c.png").write_bytes(_png())
    main = tmp_path / "main.tex"
    main.write_text(
        "\\documentclass{article}\\usepackage{graphicx}\n\\graphicspath{{figures/}}\n"
        "\\begin{document}\n\\includegraphics{a}\n\\includegraphics{figures/b.svg}\n"
        "\\begin{figure}\\includegraphics[width=3cm]{c}\\caption{A dot}\\end{figure}\n"
        "\\end{document}\n", encoding="utf-8",
    )
    done = export.convert(main, "docx", tmp_path, tmp_path, [])
    with zipfile.ZipFile(done.path) as archive:
        media = [name for name in archive.namelist() if name.startswith("word/media/")]
        body = archive.read("word/document.xml").decode("utf-8")
    assert not any(name.endswith(".pdf") for name in media)
    assert sum(name.endswith(".png") for name in media) >= (3 if export.has_resvg() else 2)
    assert body.count("r:embed=") == 3
    if export.has_resvg():
        assert done.notes == []
    html = export.convert(main, "html", tmp_path, tmp_path, []).path.read_text(encoding="utf-8")
    assert "data:image/svg+xml" in html


#: One page, 72 by 36 points, a filled rectangle.
MINIMAL_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 36]/Contents 4 0 R>>endobj\n"
    b"4 0 obj<</Length 21>>stream\n0 0 1 rg 0 0 72 36 re f\nendstream endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF\n"
)


@pytest.mark.skipif(REAL is None, reason="pandoc is needed")
def test_the_real_pandoc_writes_a_file_whose_figures_are_lost(tmp_path, monkeypatch):
    """A figure that is not there becomes its name, inside a figure
    environment and outside one, and pandoc still writes the file."""
    monkeypatch.setenv("NEXTTEX_PANDOC", REAL)
    main = tmp_path / "main.tex"
    main.write_text(
        "\\documentclass{article}\\usepackage{graphicx}\\begin{document}\nText.\n"
        "\\begin{figure}\\includegraphics{nothere}\\caption{x}\\end{figure}\n"
        "\\includegraphics{alsogone}\n\\end{document}\n", encoding="utf-8",
    )
    for fmt in ("docx", "html"):
        done = export.convert(main, fmt, tmp_path, tmp_path, [])
        assert done.path.is_file()
        assert done.notes == [export.FigureNote("nothere", "missing"), export.FigureNote("alsogone", "missing")]
    with zipfile.ZipFile(tmp_path / "main.docx") as archive:
        assert "[nothere]" in archive.read("word/document.xml").decode("utf-8")
