"""The submission check: what a venue would send back, read off the last
build and the sources.

The poppler outputs under `tests/fixtures/` were captured from real
`pdffonts` and `pdfimages -list` runs on this machine, over a document
with a 75 ppi PNG, and over the same PDF re-distilled by ghostscript with
embedding off.  The `Type 1C` and `Type 3` rows are typed from poppler's
documented table, because cm-super is installed here and pdflatex would
not produce a bitmap font to capture.  The one test that runs the tools
is guarded above its import.
"""

import shutil
import struct
import subprocess
import zlib
from pathlib import Path

import pytest

from nexttex import latexlog, submit

FIXTURES = Path(__file__).parent / "fixtures"


def read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def png(width: int, height: int) -> bytes:
    """A flat orange PNG, written by hand so the suite needs no Pillow."""
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    row = b"\x00" + bytes((200, 120, 60)) * width
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(row * height)) + chunk(b"IEND", b""))


# -- the PDF ---------------------------------------------------------------

def test_an_unembedded_font_is_an_error_and_an_embedded_one_is_nothing():
    rows = submit.fonts(read("pdffonts-unembedded.txt"))
    assert [(r.kind, r.severity, r.message) for r in rows] == [("font", "error", "CMR10 is not embedded")]
    assert submit.fonts(read("pdffonts-embedded.txt")) == []


def test_a_font_type_with_a_space_in_it_does_not_shift_the_columns():
    table = (
        "name                                 type              encoding         emb sub uni object ID\n"
        "------------------------------------ ----------------- ---------------- --- --- --- ---------\n"
        "ABCDEF+NimbusSanL-Regu               Type 1C           WinAnsi          yes yes yes      5  0\n"
        "CMR10                                Type 3            Custom           yes no  no       9  0\n"
        "DEJAVU+DejaVuSans                    CID TrueType      Identity-H       no  yes yes     12  0\n"
    )
    rows = submit.fonts(table)
    assert [(r.severity, r.message) for r in rows] == [
        ("warning", "CMR10 is a Type 3 bitmap font"),
        ("error", "DEJAVU+DejaVuSans is not embedded"),
    ]


def test_a_low_resolution_image_names_its_page_and_its_ppi():
    rows = submit.images(read("pdfimages-low.txt"))
    assert len(rows) == 1
    row = rows[0]
    assert row.kind == "image" and row.page == 1 and row.file is None
    assert row.message == "a 300 by 200 image on page 1 is drawn at 75 ppi"


def test_a_mask_or_a_sharp_image_is_not_a_row():
    table = (
        "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n"
        "--------------------------------------------------------------------------------------------\n"
        "   1     0 image    1200   800  rgb     3   8  image  no         1  0   300   300   12K 0.3%\n"
        "   2     1 smask     300   200  gray    1   8  image  no         2  0    75    75  581B 0.3%\n"
    )
    assert submit.images(table) == []


def test_a_table_that_is_not_one_yields_nothing():
    assert submit.fonts("") == [] and submit.images("Syntax Error\n") == []


# -- the log -----------------------------------------------------------------

LOG = """This is pdfTeX
(./main.tex
LaTeX Warning: Reference `fig:gone' on page 1 undefined on input line 12.

LaTeX Warning: Citation `nobody99' on page 1 undefined on input line 13.

Overfull \\hbox (23.4pt too wide) in paragraph at lines 20--21

Overfull \\hbox (1.2pt too wide) in paragraph at lines 30--31

! LaTeX Error: File `figures/plot.png' not found.

l.40 \\includegraphics{figures/plot.png}
)
Output written on main.pdf (3 pages, 1000 bytes).
"""


def test_the_log_gives_undefined_wide_overfull_and_missing(tmp_path):
    parsed = latexlog.parse(LOG, tmp_path, tmp_path / "main.tex")
    rows = submit.from_log(parsed, lambda path: Path(path).name if path else None)
    kinds = [(r.kind, r.line) for r in rows]
    assert ("undefined", 12) in kinds and ("undefined", 13) in kinds
    assert ("overfull", 20) in kinds, kinds
    assert ("overfull", 30) not in kinds, "1.2pt is invisible"
    assert any(r.kind == "missing" and "plot.png" in r.message for r in rows)
    assert all(r.file == "main.tex" for r in rows)
    assert parsed.pages == 3


# -- the sources -------------------------------------------------------------

SOURCE = r"""\documentclass{article}
\author{Ada Lovelace \and Charles Babbage}
\affiliation{Analytical Engine Co.}
\begin{document}
Built \today.
\section{A}\label{sec:a}
\begin{figure}\label{fig:x}\end{figure}
\begin{figure}\label{fig:x}\end{figure}
See \ref{fig:x} and \cite{knuth84}. % TODO check the number
\todo{tighten this}
% This is a paragraph that was commented out and kept around for later use
% because it might come back. It goes on for a while so that its length
% passes the threshold the check uses to call a run of comments a paragraph.
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% !TeX root = main.tex
% short note
\section*{Acknowledgements}
Thanks.
\end{document}
"""
BIB = "@article{knuth84,\n  title={x}\n}\n@book{lamport94,\n  title={y}\n}\n@comment{not an entry}\n"


def kinds(rows):
    return [(r.kind, r.file, r.line) for r in rows]


def test_the_sources_give_every_kind():
    rows = submit.from_sources({"main.tex": SOURCE}, {"refs.bib": BIB}, blind=False)
    found = kinds(rows)
    assert ("duplicate-label", "main.tex", 8) in found
    assert ("unused-label", "main.tex", 6) in found
    assert ("uncited", "refs.bib", 4) in found
    assert ("today", "main.tex", 5) in found
    assert ("todo", "main.tex", 9) in found and ("todo", "main.tex", 10) in found
    assert ("commented", "main.tex", 11) in found
    assert not any(r.kind == "blind" for r in rows), "blind is off"
    # The comment entry in the .bib is not an uncited entry.
    assert not any(r.kind == "uncited" and "not an entry" in r.message for r in rows)


def test_blind_review_names_the_author_block_and_the_acknowledgements():
    rows = submit.from_sources({"main.tex": SOURCE}, {}, blind=True)
    blind = [(r.line, r.message) for r in rows if r.kind == "blind"]
    assert [line for line, _ in blind] == [2, 3, 17]
    assert blind[0][1] == "\\author names the authors"
    assert "Acknowledg" in SOURCE.split("\n")[16]


def test_an_anonymous_author_is_not_a_row():
    text = "\\author{Anonymous Author(s)}\n\\author{%\n  Anonymous\n}\n"
    assert not submit.from_sources({"main.tex": text}, {}, blind=True)


def test_a_short_comment_run_is_a_note_not_a_paragraph():
    text = "% one\n% two\n% three\n"
    assert not submit.from_sources({"main.tex": text}, {}, blind=False)


def test_defining_todo_is_not_a_note():
    text = "\\newcommand{\\todo}[1]{\\textbf{#1}}\n\\providecommand\\fixme[1]{}\n\\todo{real}\n"
    rows = submit.from_sources({"main.tex": text}, {}, blind=False)
    assert [r.line for r in rows if r.kind == "todo"] == [3]


def test_nocite_star_suppresses_every_uncited_row():
    rows = submit.from_sources({"main.tex": r"\nocite{*}"}, {"r.bib": BIB}, blind=False)
    assert not any(r.kind == "uncited" for r in rows)


# -- all of it -----------------------------------------------------------------

def test_the_report_carries_pages_against_the_limit_and_the_tool_gaps(tmp_path):
    main = tmp_path / "main.tex"
    main.write_text(SOURCE, encoding="utf-8")
    pdf = tmp_path / "main.pdf"
    pdf.write_bytes(b"%PDF-1.5 not really")
    report = submit.check(
        document="main.tex", log_text=LOG, project_root=tmp_path, main=main, pdf=pdf,
        engine="pdflatex", texts={"main.tex": SOURCE, "refs.bib": BIB},
        relative=lambda path: Path(path).name if path else None,
        blind=True, page_limit=2,
        pdffonts=lambda _pdf: read("pdffonts-unembedded.txt"),
        pdfimages=lambda _pdf: None,
        pdfinfo=lambda _pdf: "Title:          Ultrafast dynamics\nPages:          3\n",
    )
    assert report.pages == 3 and report.built is not None and report.engine == "pdflatex"
    counts = report.counts()
    assert counts["pages"] == 1 and counts["font"] == 1 and counts["tool"] == 1
    tool = next(r for r in report.findings if r.kind == "tool")
    assert "pdfimages" in tool.message
    payload = report.as_dict()
    assert payload["counts"] == counts
    assert all(row["source"] == "submit" and row["explain"]["title"] for row in payload["findings"])


def test_a_limit_of_zero_is_no_limit(tmp_path):
    main = tmp_path / "main.tex"
    main.write_text("x", encoding="utf-8")
    report = submit.check(
        document="main.tex", log_text=LOG, project_root=tmp_path, main=main, pdf=None,
        engine="", texts={}, relative=lambda p: None, blind=False, page_limit=0,
    )
    assert not any(r.kind == "pages" for r in report.findings)
    assert report.built is None


@pytest.mark.skipif(
    shutil.which("pdflatex") is None or shutil.which("pdffonts") is None
    or shutil.which("pdfimages") is None,
    reason="pdflatex and poppler are needed",
)
def test_the_real_tools_answer_over_a_real_build(tmp_path):
    (tmp_path / "low.png").write_bytes(png(300, 200))
    main = tmp_path / "main.tex"
    main.write_text(
        "\\documentclass{article}\\usepackage{graphicx}\\begin{document}\n"
        "\\includegraphics[width=4in]{low.png}\\end{document}\n", encoding="utf-8",
    )
    subprocess.run(["pdflatex", "-interaction=nonstopmode", "main.tex"], cwd=tmp_path,
                   capture_output=True, check=True, timeout=120)
    pdf = tmp_path / "main.pdf"
    assert submit.fonts(submit.run_pdffonts(pdf) or "") == []
    rows = submit.images(submit.run_pdfimages(pdf) or "")
    assert rows and rows[0].page == 1 and "75 ppi" in rows[0].message
    assert submit.pages_of(pdf) == 1
    assert "The PDF has no author" in [r.message for r in submit.metadata(submit.run_pdfinfo(pdf) or "", blind=False)]


# -- alt text, metadata and PDF/A ---------------------------------------------

def test_a_figure_with_no_alt_text_is_named_at_its_line():
    texts = {"main.tex": (
        "\\includegraphics[width=3in]{spectra}\n"
        "\\includegraphics[width=3in, alt={Two decays}]{kinetics}\n"
        "% \\includegraphics{commented}\n"
        "\\begin{figure}\\includegraphics{acm}\n"
        "\\Description{A plot}\\end{figure}\n"
        "\\begin{figure}\\includegraphics{bare}\\end{figure}\n"
        "\\Description{too late, another figure's}\n"
    )}
    rows = submit.alt_text(texts)
    assert [(r.message, r.line) for r in rows] == [
        ("spectra has no alt text", 1), ("bare has no alt text", 6),
    ]
    assert all(r.kind == "alt" and r.severity == "warning" for r in rows)


def test_metadata_wants_a_title_and_an_author_unless_blind():
    assert [r.message for r in submit.metadata("Pages: 3\n", blind=False)] == [
        "The PDF has no title", "The PDF has no author",
    ]
    assert submit.metadata("Title: A\nAuthor: B\n", blind=False) == []
    assert submit.metadata("Title: A\n", blind=True) == []
    named = submit.metadata("Title: A\nAuthor: Ada Lovelace\n", blind=True)
    assert [(r.kind, r.severity) for r in named] == [("blind", "error")]
    assert "Ada Lovelace" in named[0].message


def test_pdfa_is_asked_for_by_pdfx_or_document_metadata():
    assert [r.kind for r in submit.pdfa_missing({"main.tex": "\\usepackage{graphicx}"})] == ["pdfa"]
    assert submit.pdfa_missing({"main.tex": "\\usepackage[a-2b]{pdfx}"}) == []
    assert submit.pdfa_missing({"main.tex": "\\DocumentMetadata{pdfstandard=A-2b, lang=en}"}) == []
    assert submit.pdfa_missing({"main.tex": "\\DocumentMetadata{lang=en}"}) != []


def test_pdfa_is_checked_only_when_the_venue_wants_it(tmp_path):
    main = tmp_path / "main.tex"
    main.write_text("x", encoding="utf-8")

    def kinds(pdfa: bool) -> set[str]:
        report = submit.check(
            document="main.tex", log_text=LOG, project_root=tmp_path, main=main, pdf=None,
            engine="", texts={"main.tex": "\\documentclass{article}"},
            relative=lambda p: None, blind=False, page_limit=0, pdfa=pdfa,
        )
        return {r.kind for r in report.findings}

    assert "pdfa" not in kinds(False)
    assert "pdfa" in kinds(True)


def test_a_missing_pdfinfo_is_a_tool_note(tmp_path):
    main = tmp_path / "main.tex"
    main.write_text("x", encoding="utf-8")
    pdf = tmp_path / "main.pdf"
    pdf.write_bytes(b"%PDF-1.5")
    report = submit.check(
        document="main.tex", log_text=LOG, project_root=tmp_path, main=main, pdf=pdf,
        engine="", texts={}, relative=lambda p: None, blind=False, page_limit=0,
        pdffonts=lambda _pdf: "", pdfimages=lambda _pdf: "", pdfinfo=lambda _pdf: None,
    )
    assert any(r.kind == "tool" and "pdfinfo" in r.message for r in report.findings)
    assert not any(r.kind == "metadata" for r in report.findings)
