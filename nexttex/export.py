r"""A document as Word, HTML or Markdown, through pandoc.

A co-author who does not write LaTeX, a journal that wants a `.docx`, a
web page for the group's site: the one conversion a paper needs on the
way out.  pandoc does it, and it is an optional tool the way `pdftotext`
is, named in the installer's survey and never installed by NextTex; when
it is here the download menu offers the three formats, and when it is
not the menu says nothing about them.

The conversion runs in the document's own directory, as the engine does,
so `\input` resolves; the project root is on the resource path too.  HTML
is one file with its images embedded, since a page for a site or a mail
wants to travel alone.  The `.bib` files the document reaches are handed
over with `--citeproc`, so a `\cite` becomes a reference rather than a
bracketed key.  pandoc's stderr comes back verbatim on failure, because a
`\newcommand` it cannot read is usually what it says, and that is what
the writer needs to know.

Figures are the part pandoc does not do for a paper.  Its LaTeX reader
takes `\includegraphics{plot}` literally, so a name without a suffix and
a `\graphicspath` directory are never found, and its Word writer copies a
PDF figure into the file where no Word can draw it.  So Word and HTML go
in two passes: pandoc reads the LaTeX into its own document tree as JSON,
every image in the tree is found the way TeX finds it and turned into
something the format can show, and pandoc writes the format from the
rewritten tree.  For Word that is a 300 dpi PNG: PDF through poppler's
`pdftocairo`, EPS through `epstopdf` or Ghostscript and then the same,
SVG through whichever of resvg, `rsvg-convert` or Inkscape is here,
resvg first: the installer adds it where it has a wheel, and it
draws matplotlib's SVG faithfully where ImageMagick's renderer does not.
HTML takes a PDF or EPS figure as SVG, which a browser draws at
any size.  A figure that cannot be converted becomes its own name in the
text and one sentence for the writer, so the export never fails over a
figure.  Markdown keeps one pass: its images are references to files
beside it, and a scratch path would break them.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from nexttex import deps

#: The format the menu names, pandoc's writer for it, the file suffix and
#: the media type the download answers with.
FORMATS: dict[str, tuple[str, str, str]] = {
    "docx": ("docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "html": ("html", "html", "text/html; charset=utf-8"),
    "md": ("gfm", "md", "text/markdown; charset=utf-8"),
}
TIMEOUT = 120
#: How long one figure's conversion may take.
FIGURE_TIMEOUT = 60
#: A Word figure's resolution: print quality, and what the equation
#: images use too.
DPI = 300
#: Tried in order against a figure named without a suffix: pdflatex's own
#: order, and then SVG, which the `svg` package draws.
FIGURE_SUFFIXES = (".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg")
#: What each format can show as it is.
SHOWN = {
    "docx": {".png", ".jpg", ".jpeg", ".gif"},
    "html": {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"},
}

GRAPHICSPATH = re.compile(r"\\graphicspath\s*\{((?:\s*\{[^{}]*\})*)\s*\}")


class ExportError(RuntimeError):
    """pandoc could not, and this is what it said."""


@dataclass(frozen=True)
class FigureNote:
    """A figure that did not become a picture, as written, and why:
    `missing`, `outside`, `no-converter`, `failed` or `svg-only`."""

    src: str
    reason: str


@dataclass
class Exported:
    path: Path
    notes: list[FigureNote] = field(default_factory=list)


def pandoc_here() -> str | None:
    """The pandoc binary: `NEXTTEX_PANDOC` names one, the way
    `NEXTTEX_TLMGR` names a tlmgr, so the browser tier can point the
    server at `tests/fake_pandoc.py`; otherwise whatever is on PATH."""
    named = os.environ.get("NEXTTEX_PANDOC", "").strip()
    if named:
        return named
    return shutil.which("pandoc")


def _resource_path(main: Path, root: Path) -> str:
    return f"--resource-path={main.parent}{os.pathsep}{root}"


def _writer_flags(fmt: str, bibs: list[Path]) -> list[str]:
    flags: list[str] = []
    if fmt == "html":
        flags += ["--standalone", "--embed-resources"]
    if bibs:
        flags.append("--citeproc")
        flags += [f"--bibliography={bib}" for bib in bibs]
    return flags


def argv(binary: str, main: Path, fmt: str, out: Path, root: Path, bibs: list[Path]) -> list[str]:
    """The one-pass command, as a list, so a test can read it: Markdown's."""
    writer, _suffix, _media = FORMATS[fmt]
    return [
        binary, str(main), "-f", "latex", "-t", writer, "-o", str(out),
        _resource_path(main, root), *_writer_flags(fmt, bibs),
    ]


def read_argv(binary: str, main: Path, tree: Path) -> list[str]:
    """The first of two passes: the LaTeX as pandoc's document tree."""
    return [binary, str(main), "-f", "latex", "-t", "json", "-o", str(tree)]


def write_argv(
    binary: str, tree: Path, fmt: str, out: Path, main: Path, root: Path, bibs: list[Path],
) -> list[str]:
    """The second pass: the rewritten tree as the format."""
    writer, _suffix, _media = FORMATS[fmt]
    return [
        binary, str(tree), "-f", "json", "-t", writer, "-o", str(out),
        _resource_path(main, root), *_writer_flags(fmt, bibs),
    ]


# -- finding a figure the way TeX does ----------------------------------------


def graphics_dirs(sources: list[Path]) -> list[str]:
    """Every `\\graphicspath` directory the document's files name, in order,
    ignoring any behind a comment."""
    found: list[str] = []
    for source in sources:
        try:
            text = source.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for match in deps.uncommented(GRAPHICSPATH, text):
            for one in re.findall(r"\{([^{}]*)\}", match.group(1)):
                one = one.strip()
                if one and one not in found:
                    found.append(one)
    return found


def resolve_figure(src: str, main: Path, root: Path, dirs: list[str]) -> tuple[Path | None, str]:
    """The file a figure names, or None and why: `missing` when nothing
    is there, `outside` when the name leaves the project.

    The document's directory first, as TeX's working directory, then each
    `\\graphicspath` directory under it, then the project root and the same
    directories under that; a name without a suffix tries pdflatex's.
    """
    reference = src.strip().replace("\\", "/")
    if not reference or Path(reference).is_absolute() or re.match(r"^[A-Za-z]:/", reference):
        return None, "outside"
    home = root.resolve()
    bases: list[Path] = []
    for base in (main.parent, root):
        bases.append(base)
        bases += [base / d for d in dirs]
    names = [reference]
    if not Path(reference).suffix:
        names += [reference + suffix for suffix in FIGURE_SUFFIXES]
    escaped = False
    for base in bases:
        for name in names:
            candidate = (base / name).resolve()
            try:
                candidate.relative_to(home)
            except ValueError:
                escaped = escaped or candidate.is_file()
                continue
            if candidate.is_file():
                return candidate, ""
    return None, "outside" if escaped else "missing"


# -- turning a figure into something the format shows --------------------------


def _run(command: list[str], cwd: Path) -> bool:
    try:
        done = subprocess.run(
            command, cwd=cwd, capture_output=True, timeout=FIGURE_TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return done.returncode == 0


def _first(which: Callable[[str], str | None], *names: str) -> str | None:
    for name in names:
        found = which(name)
        if found:
            return found
    return None


#: resvg drawing an SVG, in a child process so a figure that makes it
#: spin is stopped by the timeout like any other tool.  `dpi` rather than
#: `zoom`, which refuses an SVG sized in points.
RESVG = (
    "import sys, resvg_py; open(sys.argv[2], 'wb').write("
    "resvg_py.svg_to_bytes(svg_path=sys.argv[1], dpi=float(sys.argv[3])))"
)


def has_resvg() -> bool:
    """Whether the installer's optional resvg is in this environment."""
    return importlib.util.find_spec("resvg_py") is not None


def stamp_png_dpi(path: Path, dpi: int = DPI) -> None:
    """Give a PNG a `pHYs` chunk saying `dpi`, replacing any it has, so
    pandoc sizes every figure the same whichever tool drew it."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return
    per_metre = round(dpi / 0.0254)
    body = struct.pack(">IIB", per_metre, per_metre, 1)
    phys = struct.pack(">I", len(body)) + b"pHYs" + body + struct.pack(">I", zlib.crc32(b"pHYs" + body))
    chunks = [data[:8]]
    at = 8
    while at + 8 <= len(data):
        length = struct.unpack(">I", data[at:at + 4])[0]
        kind = data[at + 4:at + 8]
        whole = data[at:at + 12 + length]
        if kind != b"pHYs":
            chunks.append(whole)
        if kind == b"IHDR":
            chunks.append(phys)
        at += 12 + length
    path.write_bytes(b"".join(chunks))


def convert_figure(
    source: Path, fmt: str, scratch: Path,
    which: Callable[[str], str | None] = shutil.which,
) -> tuple[Path | None, str]:
    """`source` as a file `fmt` can show, written into `scratch`, or None
    and why.  An SVG with nothing to rasterise it comes back as itself
    with `svg-only`: Word 365 still draws it."""
    suffix = source.suffix.lower()
    if suffix in SHOWN[fmt]:
        return source, ""
    stem = f"{source.stem}-{hashlib.sha1(str(source).encode()).hexdigest()[:10]}"
    cairo = which("pdftocairo")

    if suffix == ".eps":
        pdf = scratch / f"{stem}.pdf"
        epstopdf = which("epstopdf")
        ghostscript = _first(which, "gs", "gswin64c", "gswin32c")
        if epstopdf:
            made = _run([epstopdf, f"--outfile={pdf}", str(source)], scratch)
        elif ghostscript:
            made = _run([
                ghostscript, "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dQUIET", "-dEPSCrop",
                "-sDEVICE=pdfwrite", f"-sOutputFile={pdf}", str(source),
            ], scratch)
        else:
            return None, "no-converter"
        if not made or not pdf.is_file():
            return None, "failed"
        source, suffix = pdf, ".pdf"

    if suffix == ".pdf":
        if not cairo:
            return None, "no-converter"
        if fmt == "html":
            out = scratch / f"{stem}.svg"
            made = _run([cairo, "-svg", "-f", "1", "-l", "1", str(source), str(out)], scratch)
        else:
            # -singlefile names the output `<stem>.png` rather than
            # `<stem>-1.png`.
            made = _run([
                cairo, "-png", "-r", str(DPI), "-f", "1", "-l", "1", "-singlefile",
                str(source), str(scratch / stem),
            ], scratch)
            out = scratch / f"{stem}.png"
        if not made or not out.is_file():
            return None, "failed"
        if out.suffix == ".png":
            stamp_png_dpi(out)
        return out, ""

    if suffix == ".svg":
        out = scratch / f"{stem}.png"
        rsvg = which("rsvg-convert")
        inkscape = which("inkscape")
        # ImageMagick is not asked: its own SVG renderer drops matplotlib's
        # clipped lines and draws an empty plot without saying so.
        if has_resvg():
            made = _run([sys.executable, "-c", RESVG, str(source), str(out), str(DPI)], scratch)
        elif rsvg:
            made = _run([rsvg, "-z", str(DPI / 96), "-f", "png", "-o", str(out), str(source)], scratch)
        elif inkscape:
            made = _run([
                inkscape, str(source), "--export-type=png", f"--export-dpi={DPI}",
                f"--export-filename={out}",
            ], scratch)
        else:
            return source, "svg-only"
        if not made or not out.is_file():
            return source, "svg-only"
        stamp_png_dpi(out)
        return out, ""

    return None, "no-converter"


# -- the tree ------------------------------------------------------------------


def _images(node, found: list[str]) -> None:
    if isinstance(node, list):
        for item in node:
            _images(item, found)
    elif isinstance(node, dict):
        if node.get("t") == "Image":
            found.append(node["c"][2][0])
        else:
            for value in node.values():
                _images(value, found)


def _rewrite(node, done: dict[str, str | None]):
    """The tree with every image's source replaced by `done[src]`, or the
    image replaced by its name where `done[src]` is None."""
    if isinstance(node, list):
        return [_rewrite(item, done) for item in node]
    if isinstance(node, dict):
        if node.get("t") == "Image":
            src = node["c"][2][0]
            if src not in done:
                return node
            target = done[src]
            if target is None:
                return {"t": "Str", "c": f"[{src}]"}
            attr, alt, (_old, title) = node["c"]
            return {"t": "Image", "c": [attr, alt, [target, title]]}
        return {key: _rewrite(value, done) for key, value in node.items()}
    return node


def rewrite_images(
    tree: dict, fmt: str, main: Path, root: Path, dirs: list[str], scratch: Path,
    which: Callable[[str], str | None] = shutil.which,
) -> tuple[dict, list[FigureNote]]:
    """Every image in pandoc's tree found and made showable in `fmt`."""
    found: list[str] = []
    _images(tree.get("blocks", []), found)
    wanted = [src for src in dict.fromkeys(found) if "://" not in src and not src.startswith("data:")]

    def one(src: str) -> tuple[str, str | None, str]:
        path, why = resolve_figure(src, main, root, dirs)
        if path is None:
            return src, None, why
        shown, why = convert_figure(path, fmt, scratch, which)
        return src, (str(shown) if shown else None), why

    done: dict[str, str | None] = {}
    notes: list[FigureNote] = []
    if wanted:
        with ThreadPoolExecutor(max_workers=min(4, os.cpu_count() or 1)) as pool:
            for src, target, why in pool.map(one, wanted):
                done[src] = target
                if why:
                    notes.append(FigureNote(src, why))
    tree = dict(tree)
    tree["blocks"] = _rewrite(tree.get("blocks", []), done)
    return tree, notes


WHY = {
    "missing": "not found",
    "outside": "outside the project",
    "failed": "the conversion failed",
}


def notes_sentence(notes: list[FigureNote], name: str) -> str:
    """What the writer is told about the figures, or nothing."""
    if not notes:
        return ""
    lost = [note for note in notes if note.reason != "svg-only"]
    kept = [note for note in notes if note.reason == "svg-only"]
    said = [f"{name} is saved."]
    if lost:
        parts = []
        for note in lost:
            if note.reason == "no-converter":
                kind = Path(note.src).suffix.lstrip(".").upper() or "this"
                parts.append(f"{note.src} (no {kind} converter on this machine)")
            else:
                parts.append(f"{note.src} ({WHY.get(note.reason, note.reason)})")
        if len(lost) == 1:
            said.append(f"1 figure could not be made into a picture and shows as its name: {parts[0]}.")
        else:
            said.append(
                f"{len(lost)} figures could not be made into pictures and show as their names: "
                + ", ".join(parts) + "."
            )
    if kept:
        names = ", ".join(note.src for note in kept)
        them = "it a picture" if len(kept) == 1 else "them pictures"
        said.append(
            f"{names} went in as SVG, which only Word 365 shows. "
            f"Installing rsvg-convert makes {them} every reader can open."
        )
    return " ".join(said)


# -- the conversion ------------------------------------------------------------


def _pandoc(command: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ExportError(f"pandoc took more than {timeout} seconds and was stopped")
    except OSError as error:
        raise ExportError(f"could not run pandoc: {error}")


def _failed(done: subprocess.CompletedProcess) -> ExportError:
    said = (done.stderr or done.stdout or "").strip()
    return ExportError(said.splitlines()[-1] if said else "pandoc failed without a message")


def convert(
    main: Path, fmt: str, out_dir: Path, root: Path, bibs: list[Path],
    sources: list[Path] | None = None, timeout: int = TIMEOUT,
) -> Exported:
    """Convert `main` to `fmt` into `out_dir`: the file written and what
    became of the figures.  `sources` are the files the document reads,
    for their `\\graphicspath`; `main` alone when not given."""
    if fmt not in FORMATS:
        raise ExportError(f"not a format pandoc is asked for here: {fmt}")
    binary = pandoc_here()
    if not binary:
        raise ExportError("pandoc is not installed")
    _writer, suffix, _media = FORMATS[fmt]
    out = out_dir / f"{main.stem}.{suffix}"

    if fmt not in SHOWN:
        done = _pandoc(argv(binary, main, fmt, out, root, bibs), main.parent, timeout)
        if done.returncode != 0 or not out.is_file():
            raise _failed(done)
        return Exported(out)

    with tempfile.TemporaryDirectory(prefix="nexttex-figures-") as work:
        scratch = Path(work)
        # Named after the document, so what pandoc reports on the second
        # pass still names the file the writer knows.
        tree_file = scratch / f"{main.stem}.json"
        done = _pandoc(read_argv(binary, main, tree_file), main.parent, timeout)
        if done.returncode != 0 or not tree_file.is_file():
            raise _failed(done)
        try:
            tree = json.loads(tree_file.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise ExportError(f"pandoc's document tree could not be read: {error}")
        dirs = graphics_dirs(list(dict.fromkeys([main, *(sources or [])])))
        tree, notes = rewrite_images(tree, fmt, main, root, dirs, scratch)
        tree_file.write_text(json.dumps(tree), encoding="utf-8")
        done = _pandoc(write_argv(binary, tree_file, fmt, out, main, root, bibs), main.parent, timeout)
        if done.returncode != 0 or not out.is_file():
            raise _failed(done)
    return Exported(out, notes)
