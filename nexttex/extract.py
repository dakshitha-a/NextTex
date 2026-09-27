"""A readable form of a file somebody handed the agent.

The agent reads what it is given by path. The Claude CLI's Read takes
plain text, PNG, JPEG, GIF, WebP and PDF; the OpenAI provider's
`read_file` takes text alone. So a Word, PowerPoint or Excel file, a PDF,
or a picture in a format neither can open, gets a companion it can read:
`text_of` for the words in a document, `picture_of` for a PNG of an
image. Both answer with what they made or with nothing, never raise, and
use only the standard library and the tools the machine already has
(`pdftotext`, ImageMagick, and what `export.convert_figure` finds for
SVG).

Office files are zip archives of XML, so their text is read with
`zipfile` and `xml.etree` rather than a converter the machine may lack:
a document's paragraphs, a deck's slides in order under a heading each,
a workbook's sheets as tab-separated rows. What comes back is capped at
`LIMIT` characters, which is far more than a question needs and keeps a
spreadsheet of a million cells from filling the context.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

LIMIT = 400_000

TEXT = {
    ".txt", ".md", ".markdown", ".tex", ".bib", ".rst", ".org", ".py", ".r", ".m",
    ".json", ".csv", ".tsv", ".yml", ".yaml", ".toml", ".sh", ".dat",
}
OFFICE = {".docx", ".pptx", ".xlsx"}
# What a model can look at as it is; anything else in PICTURES needs a PNG.
SEEN = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
PICTURES = SEEN | {".tif", ".tiff", ".bmp", ".heic", ".heif", ".svg", ".avif"}

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _cap(text: str) -> str:
    if len(text) <= LIMIT:
        return text
    return text[:LIMIT] + "\n\n[The rest is cut: the file's text runs past this point.]"


def text_of(path: Path) -> tuple[str, int | None]:
    """The text of `path` and its page or slide count where it has one,
    or ("", None) when there is none to be had."""
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            return _pdf(path)
        if suffix == ".docx":
            return _cap(_docx(path)), None
        if suffix == ".pptx":
            text, slides = _pptx(path)
            return _cap(text), slides
        if suffix == ".xlsx":
            return _cap(_xlsx(path)), None
        if suffix in TEXT:
            return _cap(path.read_text(encoding="utf-8", errors="replace")), None
    except (OSError, zipfile.BadZipFile, ElementTree.ParseError, KeyError, ValueError):
        return "", None
    return "", None


def _pdf(path: Path) -> tuple[str, int | None]:
    """`pdftotext -layout`, which keeps the columns that tables and
    formatting examples depend on."""
    if not shutil.which("pdftotext"):
        return "", None
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            capture_output=True, text=True, timeout=120,
        )
        pages = None
        if shutil.which("pdfinfo"):
            info = subprocess.run(
                ["pdfinfo", str(path)], capture_output=True, text=True, timeout=30
            ).stdout
            for line in info.splitlines():
                if line.startswith("Pages:"):
                    pages = int(line.split()[1])
        return _cap(result.stdout), pages
    except (subprocess.SubprocessError, ValueError, OSError):
        return "", None


def _runs(element, tag: str) -> str:
    return "".join(node.text or "" for node in element.iter(tag))


def _docx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    paragraphs = []
    for paragraph in root.iter(f"{_W}p"):
        text = ""
        for node in paragraph.iter():
            if node.tag == f"{_W}t":
                text += node.text or ""
            elif node.tag == f"{_W}tab":
                text += "\t"
            elif node.tag in (f"{_W}br", f"{_W}cr"):
                text += "\n"
        paragraphs.append(text)
    return "\n".join(paragraphs).strip() + "\n"


def _slide_number(name: str) -> int:
    found = re.search(r"(\d+)\.xml$", name)
    return int(found.group(1)) if found else 0


def _pptx(path: Path) -> tuple[str, int]:
    with zipfile.ZipFile(path) as archive:
        names = sorted(
            (n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
            key=_slide_number,
        )
        parts = []
        for index, name in enumerate(names, start=1):
            root = ElementTree.fromstring(archive.read(name))
            lines = [_runs(p, f"{_A}t") for p in root.iter(f"{_A}p")]
            body = "\n".join(line for line in lines if line.strip())
            parts.append(f"Slide {index}\n{body}".rstrip())
    return "\n\n".join(parts) + "\n", len(names)


def _column(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference or "")
    number = 0
    for letter in letters.group(0) if letters else "":
        number = number * 26 + ord(letter) - 64
    return max(number - 1, 0)


def _xlsx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = [_runs(item, f"{_S}t") for item in root.iter(f"{_S}si")]
        # The sheets' names and order are the workbook's, their files the
        # relationships'.
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        targets: dict[str, str] = {}
        if "xl/_rels/workbook.xml.rels" in names:
            rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            for rel in rels:
                target = rel.get("Target", "")
                target = target.lstrip("/")
                targets[rel.get("Id", "")] = target if target.startswith("xl/") else f"xl/{target}"
        parts = []
        for sheet in workbook.iter(f"{_S}sheet"):
            name = sheet.get("name", "Sheet")
            member = targets.get(sheet.get(f"{_R}id", ""), "")
            if member not in names:
                continue
            root = ElementTree.fromstring(archive.read(member))
            rows = []
            for row in root.iter(f"{_S}row"):
                cells: dict[int, str] = {}
                for cell in row.iter(f"{_S}c"):
                    kind = cell.get("t")
                    value = cell.find(f"{_S}v")
                    if kind == "s" and value is not None and value.text:
                        text = shared[int(value.text)] if int(value.text) < len(shared) else ""
                    elif kind == "inlineStr":
                        text = _runs(cell, f"{_S}t")
                    else:
                        text = value.text if value is not None and value.text else ""
                    cells[_column(cell.get("r", ""))] = text
                if cells:
                    rows.append("\t".join(cells.get(i, "") for i in range(max(cells) + 1)))
            parts.append(f"Sheet {name}\n" + "\n".join(rows))
    return "\n\n".join(parts) + "\n"


def _magick() -> str | None:
    # `convert` on Windows is the system's disk converter, not ImageMagick.
    found = shutil.which("magick")
    if found:
        return found
    if sys.platform != "win32":
        return shutil.which("convert")
    return None


def picture_of(path: Path, out: Path) -> bool:
    """Write a PNG of the picture at `path` to `out`, for a format a model
    cannot look at as it is. True when `out` now holds one."""
    suffix = path.suffix.lower()
    if suffix not in PICTURES or suffix in SEEN:
        return False
    try:
        if suffix == ".svg":
            from .export import convert_figure

            made, _why = convert_figure(path, "docx", out.parent)
            if made is None or made.suffix != ".png":
                return False
            if made != out:
                made.replace(out)
            return out.is_file()
        magick = _magick()
        if not magick:
            return False
        # The first frame only: a multi-page TIFF is one picture here.
        subprocess.run(
            [magick, f"{path}[0]", str(out)],
            capture_output=True, timeout=60, check=True,
        )
        return out.is_file() and out.stat().st_size > 0
    except (subprocess.SubprocessError, OSError):
        out.unlink(missing_ok=True)
        return False
