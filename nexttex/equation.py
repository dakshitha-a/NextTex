"""An equation as an image: typeset on its own, handed back as SVG or PNG.

The math hover draws an equation with KaTeX, which is quick and close
but is not the document: a project's own macros, its fonts and its class
are what a slide pasted beside the paper should match. So the equation
is built by the project's own engine, with the main document's own
preamble, and shipped out as a page of its own exactly the size of the
equation: the box is measured and the page size set from it with the
engine's own primitives. The `preview` package does the same and is
the usual way, but it is not in every distribution's basic install, and
this host's TeX lacked it. `pdftocairo`, which comes with poppler
beside the submission check's tools, then turns the page into an SVG or
a PNG. `dvisvgm --pdf` would do the SVG too, but it needs a Ghostscript
that a MiKTeX machine may not have, and poppler is already asked for.

Nothing here runs with shell escape, whatever the project allows: the
preamble is the writer's, but an equation's image is not a build.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

#: How long a build or a conversion may take before it is given up on.
TIMEOUT = 60
#: How long a body may be. A slide equation is a line or a few; a body
#: much longer than this is a selection gone wrong.
MAX_BODY = 20_000
#: The PNG's resolution: print quality, and sharp on a slide.
PNG_DPI = 300

BEGIN_DOCUMENT = re.compile(r"\\begin\s*\{\s*document\s*\}")
AMSMATH = re.compile(r"\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\b(?:amsmath|mathtools)\b[^}]*\}")
#: A line break or an alignment point: the body needs an environment that
#: takes them.
MULTILINE = re.compile(r"\\\\|(?<!\\)&")
FORMATS = ("svg", "png")


class EquationError(Exception):
    """What went wrong, in a sentence the card can show."""


@dataclass
class Image:
    data: bytes
    media_type: str


def preamble(main_source: str) -> str:
    """Everything before `\\begin{document}`, or an article's when the main
    file has no body, which a fragment or a broken file may not."""
    found = BEGIN_DOCUMENT.search(main_source)
    if not found:
        return "\\documentclass{article}\n\\usepackage{amsmath}\n"
    return main_source[: found.start()]


#: The page, made by hand: the maths in a box with a small border, the
#: page set to its size (`\\pagewidth` in LuaTeX, `\\pdfpagewidth` in
#: pdfTeX and XeTeX), and the box shipped out at the page's corner, since
#: `\\shipout` puts a box's top left one inch in from `\\hoffset` and
#: `\\voffset`.
PAGE = r"""\begin{document}
\setbox0=\vbox{\kern%(border)s\hbox{\kern%(border)s%(maths)s\kern%(border)s}\kern%(border)s}
\dimen0=\wd0 \dimen2=\ht0 \advance\dimen2 by \dp0
\ifdefined\pagewidth \pagewidth=\dimen0 \pageheight=\dimen2 \fi
\ifdefined\pdfpagewidth \pdfpagewidth=\dimen0 \pdfpageheight=\dimen2 \fi
\hoffset=-1in \voffset=-1in
\shipout\box0
\end{document}
"""


def standalone(preamble_text: str, body: str) -> str:
    """The file that is built: the document's preamble and the body set as
    a display on a page of its own, exactly its size.

    A body with `\\\\` or `&` is set in `aligned`, which takes both, so an
    `align` from the paper comes out as it looks there; `amsmath` is
    loaded for it when the preamble has neither it nor `mathtools`.
    """
    body = body.strip()
    extra = "" if AMSMATH.search(preamble_text) else "\\usepackage{amsmath}\n"
    if MULTILINE.search(body):
        maths = f"$\\displaystyle\\begin{{aligned}}{body}\\end{{aligned}}$"
    else:
        maths = f"$\\displaystyle {body}$"
    return preamble_text.rstrip() + "\n" + extra + PAGE % {"border": "2pt", "maths": maths}


def missing_tool(engine: str) -> str | None:
    """The first tool this machine lacks, by name, or None."""
    for tool in (engine, "pdftocairo"):
        if shutil.which(tool) is None:
            return tool
    return None


def _first_error(log: str) -> str:
    """The first `!` line of a TeX log, which is the one that says why."""
    for line in log.splitlines():
        if line.startswith("!"):
            return line[1:].strip()
    return "the equation did not build"


def render(
    *,
    main_source: str,
    body: str,
    engine: str,
    fmt: str,
    cwd: Path,
    env: dict[str, str] | None = None,
    scratch_parent: Path | None = None,
) -> Image:
    """Build `body` with the document's preamble and convert it to `fmt`.

    `cwd` is the main document's directory, so the preamble's `\\input`
    and its packages beside the paper are found the way a build finds
    them; the scratch files go in a directory of their own under
    `scratch_parent`, the build directory, and are removed.
    """
    if fmt not in FORMATS:
        raise EquationError(f"{fmt} is not a format this makes")
    if not body.strip():
        raise EquationError("There is no equation here to typeset.")
    if len(body) > MAX_BODY:
        raise EquationError("That is too long to be one equation.")
    lacking = missing_tool(engine)
    if lacking:
        raise EquationError(f"{lacking} is not installed, so the equation cannot be made into an image.")
    if scratch_parent is not None:
        scratch_parent.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix="equation-", dir=scratch_parent))
    try:
        source = scratch / "equation.tex"
        source.write_text(standalone(preamble(main_source), body), encoding="utf-8")
        run_env = {**os.environ, **(env or {})}
        try:
            built = subprocess.run(
                [engine, "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error",
                 f"-output-directory={scratch}", str(source)],
                cwd=cwd, env=run_env, capture_output=True, timeout=TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            raise EquationError("The equation took too long to build.")
        pdf = scratch / "equation.pdf"
        if built.returncode != 0 or not pdf.exists():
            log = (scratch / "equation.log")
            text = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
            raise EquationError(f"It did not build: {_first_error(text)}")
        if fmt == "svg":
            out = scratch / "equation.svg"
            argv = ["pdftocairo", "-svg", "-f", "1", "-l", "1", str(pdf), str(out)]
            media = "image/svg+xml"
        else:
            out = scratch / "equation.png"
            argv = ["pdftocairo", "-png", "-singlefile", "-transp", "-f", "1", "-l", "1", "-r", str(PNG_DPI),
                    str(pdf), str(scratch / "equation")]
            media = "image/png"
        try:
            converted = subprocess.run(argv, capture_output=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise EquationError("The conversion took too long.")
        if converted.returncode != 0 or not out.exists():
            raise EquationError("pdftocairo could not convert the equation.")
        return Image(out.read_bytes(), media)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
