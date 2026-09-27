"""The readable companion of a file handed to the agent: the text of a
PDF, a Word, PowerPoint or Excel file, and a PNG of a picture a model
cannot open. The files are built here, byte by byte, so nothing binary is
checked in."""

from __future__ import annotations

import shutil
import struct
import zipfile
from pathlib import Path

import pytest

from nexttex import extract

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def zipped(path: Path, parts: dict[str, str]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for name, body in parts.items():
            archive.writestr(name, body)
    return path


def test_a_word_document_gives_its_paragraphs(tmp_path):
    body = (
        f'<w:document {W}><w:body>'
        '<w:p><w:r><w:t>Aims of the </w:t></w:r><w:r><w:t>renewal</w:t></w:r></w:p>'
        '<w:p><w:r><w:t>Year</w:t><w:tab/><w:t>2027</w:t></w:r></w:p>'
        '</w:body></w:document>'
    )
    path = zipped(tmp_path / "aims.docx", {"word/document.xml": body})
    text, pages = extract.text_of(path)
    assert text == "Aims of the renewal\nYear\t2027\n"
    assert pages is None


def test_a_deck_gives_its_slides_in_order(tmp_path):
    def slide(*lines: str) -> str:
        paragraphs = "".join(f"<a:p><a:r><a:t>{line}</a:t></a:r></a:p>" for line in lines)
        return f'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" {A}><p:txBody>{paragraphs}</p:txBody></p:sld>'

    # Slide 10 sorts after slide 2 by number, not by name.
    path = zipped(tmp_path / "talk.pptx", {
        "ppt/slides/slide10.xml": slide("Thanks"),
        "ppt/slides/slide1.xml": slide("Dynamics at conical intersections", "A. Writer"),
        "ppt/slides/slide2.xml": slide("Results"),
    })
    text, slides = extract.text_of(path)
    assert slides == 3
    assert text.index("Slide 1\nDynamics at conical intersections\nA. Writer") < text.index("Slide 2\nResults")
    assert text.index("Slide 2\nResults") < text.index("Slide 3\nThanks")


def test_a_workbook_gives_its_sheets_as_rows(tmp_path):
    path = zipped(tmp_path / "lifetimes.xlsx", {
        "xl/workbook.xml": f'<workbook {S} {R}><sheets><sheet name="Solvents" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/sharedStrings.xml": f'<sst {S}><si><t>Solvent</t></si><si><t>tau (ps)</t></si><si><t>Hexane</t></si></sst>',
        "xl/worksheets/sheet1.xml": (
            f'<worksheet {S}><sheetData>'
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>12.4</v></c></row>'
            '<row r="3"><c r="A3" t="inlineStr"><is><t>Water</t></is></c><c r="B3"><v>0.8</v></c></row>'
            '</sheetData></worksheet>'
        ),
    })
    text, _ = extract.text_of(path)
    # A gap in a row keeps its column.
    assert text == "Sheet Solvents\nSolvent\ttau (ps)\nHexane\t\t12.4\nWater\t0.8\n"


def test_a_broken_archive_gives_nothing_rather_than_an_error(tmp_path):
    path = tmp_path / "broken.docx"
    path.write_bytes(b"not a zip at all")
    assert extract.text_of(path) == ("", None)


def test_text_is_read_as_it_is_and_capped(tmp_path, monkeypatch):
    path = tmp_path / "fit.py"
    path.write_text("print('decay')\n", encoding="utf-8")
    assert extract.text_of(path) == ("print('decay')\n", None)
    monkeypatch.setattr(extract, "LIMIT", 5)
    text, _ = extract.text_of(path)
    assert text.startswith("print") and "cut" in text


def minimal_pdf(words: str) -> bytes:
    stream = f"BT /F1 12 Tf 72 720 Td ({words}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return out


@pytest.mark.skipif(not shutil.which("pdftotext"), reason="pdftotext is not installed")
def test_a_pdf_gives_its_text_and_pages(tmp_path):
    path = tmp_path / "paper.pdf"
    path.write_bytes(minimal_pdf("Excited state lifetimes"))
    text, pages = extract.text_of(path)
    assert "Excited state lifetimes" in text
    if shutil.which("pdfinfo"):
        assert pages == 1


def tiny_bmp() -> bytes:
    # A 2 by 1 picture, 24 bits, rows padded to four bytes.
    pixels = b"\x00\x00\xff\xff\x00\x00" + b"\x00\x00"
    header = b"BM" + struct.pack("<IHHI", 14 + 40 + len(pixels), 0, 0, 54)
    info = struct.pack("<IiiHHIIiiII", 40, 2, 1, 1, 24, 0, len(pixels), 2835, 2835, 0, 0)
    return header + info + pixels


@pytest.mark.skipif(extract._magick() is None, reason="ImageMagick is not installed")
def test_a_picture_a_model_cannot_open_gets_a_png(tmp_path):
    source = tmp_path / "scan.bmp"
    source.write_bytes(tiny_bmp())
    out = tmp_path / "scan.png"
    assert extract.picture_of(source, out)
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_a_picture_a_model_can_open_needs_no_png(tmp_path):
    source = tmp_path / "plot.png"
    source.write_bytes(b"\x89PNG\r\n\x1a\n")
    assert not extract.picture_of(source, tmp_path / "plot-copy.png")


def test_a_picture_that_will_not_convert_gives_nothing(tmp_path):
    source = tmp_path / "broken.tif"
    source.write_bytes(b"not a tiff")
    out = tmp_path / "broken.png"
    assert not extract.picture_of(source, out)
    assert not out.exists()
