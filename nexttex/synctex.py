"""SyncTeX: map between a place in the PDF and a place in the source.

This is what makes double-clicking a paragraph in the preview jump to the
line that produced it, and what lets the editor highlight where the
cursor's line landed on the page.

Both directions shell out to the `synctex` binary, which reads the
`.synctex.gz` file the engine writes when compiled with `-synctex=1`.
Parsing that format by hand is possible but pointless: the binary ships
with TeX Live and stays in step with the engine.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

TIMEOUT = 10


@dataclass(frozen=True)
class SourcePosition:
    """A place in a .tex file."""

    file: Path
    line: int
    column: int | None = None


@dataclass(frozen=True)
class PdfPosition:
    """A place on a PDF page, in PDF points from the top-left corner.

    These are the units synctex speaks. The browser converts them with
    PDF.js's viewport rather than scaling by hand, because the viewport
    already knows the rotation and the render scale.
    """

    page: int
    x: float
    y: float
    width: float = 0.0
    height: float = 0.0


def _run(args: list[str], cwd: Path) -> str:
    """Ask synctex a question, and take silence for an answer.

    Every failure here means the same thing to the caller -- no location --
    and none of them is worth a 500 in the middle of a click on the PDF.
    synctex may not be installed at all; a large .synctex.gz may outrun the
    timeout; the file may be unreadable.
    """
    try:
        proc = subprocess.run(
            ["synctex", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return ""
    # synctex exits nonzero when it simply has no answer, which is not an
    # error worth raising -- the caller gets None and moves on.
    return proc.stdout


def _blocks(output: str) -> list[dict[str, str]]:
    """Split synctex's output into its `begin`/`end` record blocks."""
    blocks, current = [], None
    for line in output.splitlines():
        if line.startswith("SyncTeX result begin"):
            current = {}
        elif line.startswith("SyncTeX result end"):
            if current:
                blocks.append(current)
            current = None
        elif current is not None and ":" in line:
            key, _, value = line.partition(":")
            current.setdefault(key.strip(), value.strip())
    return blocks


def _normalise(raw: str, project_root: Path, base: Path | None = None) -> Path:
    """Clean up the path synctex reports.

    It echoes the path as the engine recorded it, which keeps the `./`
    that latexmk passes in -- e.g.
    `/home/you/thesis/./chapters/02_theory/02_theory.tex`.
    Left alone, that string compares unequal to the same file opened any
    other way, and the editor opens a second tab for it.

    `base` is the directory the engine ran in, the document's own, which
    is what a relative path it recorded is relative to.  The engine's
    search path names that directory and the root in full, so nearly
    every path arrives absolute; the fallback to the root is for a map
    written by an older build.
    """
    path = Path(raw)
    # A relative path belongs to the project, not to whatever directory the
    # server happens to be running in -- which under systemd is the NextTex
    # source tree, so resolving it there would produce a path outside the
    # project and the click would silently do nothing.
    if not path.is_absolute():
        against_base = (base or project_root) / path
        if base is not None and not against_base.exists() and (project_root / path).exists():
            path = project_root / path
        else:
            path = against_base
    try:
        return path.resolve()
    except OSError:
        return path


# Files the engine generates and then reads back.  A click that lands on a
# table of contents or a bibliography resolves to one of these, and opening
# it in the editor would be actively wrong: the user would edit a file that
# is overwritten on the next compile.
GENERATED_SUFFIXES = {".toc", ".lof", ".lot", ".aux", ".bbl", ".out", ".ind", ".nav"}

_INCLUDEONLY = re.compile(r"^%?\s*\\includeonly\{[^}]*\}\s*$")


def shadow_shift(shadow: Path, main: Path) -> int | None:
    """The line the stand-in main file has that the real one does not.

    `compile.write_shadow` scopes a build by writing a copy of the main file
    with an `\\includeonly` directive.  When the main file already has one
    the directive is replaced in place and every line keeps its number; when
    it does not, the directive is inserted on its own line after
    `\\documentclass`, and every line after it is one further down in the
    shadow than in the file the writer has open.  synctex only ever saw the
    shadow, so its line numbers for the main file were one too high in that
    case, for both directions of the search.

    Returns the 1-based line of the inserted directive, or None when nothing
    was inserted, decided by comparing the two files rather than by
    remembering what the last build did: the shadow stays on disk after a
    later full build, and a build made outside NextTex never wrote one.
    """
    try:
        ours = shadow.read_text(encoding="utf-8", errors="replace").split("\n")
        theirs = main.read_text(encoding="utf-8", errors="replace").split("\n")
    except OSError:
        return None
    if len(ours) != len(theirs) + 1:
        return None
    for index, (mine, real) in enumerate(zip(ours, theirs)):
        if mine != real:
            break
    else:
        index = len(theirs)
    if not _INCLUDEONLY.match(ours[index]):
        return None
    if ours[:index] + ours[index + 1:] != theirs:
        return None
    return index + 1


def to_main_line(line: int, shift: int | None) -> int:
    """A shadow line as a main-file line: one up past the inserted directive.
    The directive's own line, which nothing the writer typed produced, maps
    to the line before it."""
    if shift is None or line < shift:
        return line
    return max(1, line - 1)


def to_shadow_line(line: int, shift: int | None) -> int:
    """A main-file line as a shadow line, the other way round."""
    if shift is None or line < shift:
        return line
    return line + 1


def pdf_to_source(
    pdf: Path,
    page: int,
    x: float,
    y: float,
    project_root: Path,
    shadow_main: Path | None = None,
    main_file: Path | None = None,
    base: Path | None = None,
) -> SourcePosition | None:
    """Inverse search: where in the source did this spot on the page come from?

    `x` and `y` are in PDF points, measured from the top-left of the page.

    Returns None when the click lands on something with no editable source,
    a generated table of contents, or a page whose content came from the
    engine rather than from a file the user wrote.

    `shadow_main` maps the compiler's stand-in main file back to the real
    one; see compile.py for why that stand-in exists.
    """
    output = _run(
        ["edit", "-o", f"{page}:{x:.2f}:{y:.2f}:{pdf}"], cwd=base or project_root
    )
    for block in _blocks(output):
        if "Input" not in block:
            continue
        try:
            line = int(block.get("Line", "0"))
        except ValueError:
            continue
        if line <= 0:
            continue

        path = _normalise(block["Input"], project_root, base)
        if path.suffix.lower() in GENERATED_SUFFIXES:
            return None
        if shadow_main is not None and main_file is not None:
            try:
                is_shadow = path.samefile(shadow_main)
            except OSError:
                is_shadow = path == shadow_main
            if is_shadow:
                path = main_file
                line = to_main_line(line, shadow_shift(shadow_main, main_file))

        column = block.get("Column")
        return SourcePosition(
            file=path,
            line=line,
            # synctex writes -1 for "no column information"
            column=int(column) if column and column.isdigit() else None,
        )
    return None


def source_to_pdf(
    pdf: Path, source: Path, line: int, project_root: Path, column: int = 0,
    base: Path | None = None,
) -> list[PdfPosition]:
    """Forward search: where on the page did this source line end up?

    Returns every box synctex knows about for that line, nearest match
    first. A line often produces several -- one per line of set type --
    so the caller highlights them all rather than guessing.
    """
    output = _run(
        ["view", "-i", f"{line}:{column}:{source}", "-o", str(pdf)],
        cwd=base or project_root,
    )
    positions = []
    for block in _blocks(output):
        if "Page" not in block:
            continue
        try:
            positions.append(
                PdfPosition(
                    page=int(block["Page"]),
                    x=float(block.get("h", block.get("x", 0))),
                    y=float(block.get("v", block.get("y", 0))),
                    width=float(block.get("W", 0)),
                    height=float(block.get("H", 0)),
                )
            )
        except (ValueError, KeyError):
            continue
    return positions


def available() -> bool:
    """Is the synctex binary on PATH?"""
    try:
        subprocess.run(["synctex", "help"], capture_output=True, timeout=5)
        return True
    except (OSError, subprocess.SubprocessError):
        return False
