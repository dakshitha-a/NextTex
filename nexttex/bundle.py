r"""The source a journal's or a preprint server's upload wants, and no more.

One document's files with their paths as they are: every `.tex` it reads,
its bibliographies, its figures, the project's own `.sty`, `.cls`, `.bst`,
`.bbx`, `.cbx`, `.clo` and `.def` files it loads, and the `.bbl` its last
build made, beside the document under the name a build expects. Not the
build folder, not `.nexttex/`, not a figure the document does not use.
Comments can be stripped on the way out, since a referee can read them:
a whole-line comment goes, the text after a `%` on any other line goes
and the `%` stays, so no line joins its neighbour differently, and an
escaped `\%` is a percent sign. Nothing inside `verbatim`, `lstlisting`,
`minted` or `comment` is touched.

`deps.reachable` gives the documents' files; it does not read
`\usepackage`, `\documentclass` or `\bibliographystyle`, nor
`\graphicspath`, so those are read here.
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path, PurePosixPath

from .deps import uncommented
from .rename import comment_starts

PACKAGE = re.compile(r"\\(?:usepackage|RequirePackage|documentclass|LoadClass)\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}")
STYLE = re.compile(r"\\bibliographystyle\s*\{([^}]*)\}")
BIBLATEX_STYLE = re.compile(r"\\usepackage\s*\[([^\]]*)\]\s*\{biblatex\}")
GRAPHICSPATH = re.compile(r"\\graphicspath\s*\{((?:\{[^{}]*\}\s*)+)\}")
GRAPHIC = re.compile(r"\\includegraphics\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}")
GRAPHIC_SUFFIXES = ("", ".pdf", ".png", ".jpg", ".jpeg", ".eps")
#: What a local package, class or style can be, by what loads it.
LOADED = (".sty", ".cls", ".clo", ".def", ".cfg")
KEEP_AS_WRITTEN = ("verbatim", "verbatim*", "lstlisting", "minted", "comment", "Verbatim")
TEXT = (".tex", ".ltx", ".sty", ".cls", ".clo", ".def", ".cfg", ".bbx", ".cbx")


def strip_comments(text: str) -> str:
    """`text` with its comments taken out, as the module says."""
    out: list[str] = []
    keep_until: str | None = None
    for line in text.split("\n"):
        if keep_until is not None:
            out.append(line)
            if keep_until in line:
                keep_until = None
            continue
        cut = comment_starts(line)
        if cut is None:
            out.append(line)
        elif not line[:cut].strip():
            continue
        else:
            out.append(line[:cut + 1])
        live = line if cut is None else line[:cut]
        for name in KEEP_AS_WRITTEN:
            opener = f"\\begin{{{name}}}"
            if opener in live and f"\\end{{{name}}}" not in live[live.index(opener):]:
                keep_until = f"\\end{{{name}}}"
                break
    return "\n".join(out)


def _graphics_dirs(text: str) -> list[str]:
    dirs: list[str] = []
    for match in uncommented(GRAPHICSPATH, text):
        dirs += [d.strip() for d in re.findall(r"\{([^{}]*)\}", match.group(1)) if d.strip()]
    return dirs


def _inside(root: Path, name: str) -> str | None:
    """A project-relative path for `name`, if it is a file in the project."""
    clean = PurePosixPath(name.replace("\\", "/"))
    if clean.is_absolute() or ".." in clean.parts:
        return None
    path = root / clean
    try:
        path.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return None
    return clean.as_posix() if path.is_file() else None


def files(root: Path, document: str, reads: set[str], texts: dict[str, str]) -> list[str]:
    """Every project file the bundle for `document` holds, sorted."""
    chosen = {name for name in reads if (root / name).is_file()} | {document}
    sources = [name for name in chosen if name.lower().endswith((".tex", ".ltx"))]
    for name in sources:
        text = texts.get(name, "")
        here = PurePosixPath(name).parent.as_posix()
        here = "" if here == "." else here + "/"
        loaded = []
        for match in uncommented(PACKAGE, text):
            loaded += [part.strip() for part in match.group(1).split(",") if part.strip()]
        for stem in loaded:
            for suffix in LOADED:
                found = _inside(root, stem if stem.endswith(suffix) else stem + suffix)
                if found:
                    chosen.add(found)
        for match in uncommented(STYLE, text):
            found = _inside(root, match.group(1).strip() + ".bst")
            if found:
                chosen.add(found)
        for match in uncommented(BIBLATEX_STYLE, text):
            styles = re.findall(r"(?:style|bibstyle|citestyle)\s*=\s*([\w-]+)", match.group(1))
            for stem in styles:
                for suffix in (".bbx", ".cbx"):
                    found = _inside(root, stem + suffix)
                    if found:
                        chosen.add(found)
        # A figure named under `\graphicspath`, which `deps` resolves from
        # the project's top only.
        dirs = _graphics_dirs(text)
        if dirs:
            for match in uncommented(GRAPHIC, text):
                written = match.group(1).strip()
                for directory in ["", here, *dirs]:
                    hit = next(
                        (found for suffix in GRAPHIC_SUFFIXES
                         if (found := _inside(root, directory + written + suffix))),
                        None,
                    )
                    if hit:
                        chosen.add(hit)
                        break
    return sorted(chosen)


def build(
    root: Path,
    document: str,
    reads: set[str],
    texts: dict[str, str],
    bbl: Path | None,
    strip: bool = False,
) -> tuple[bytes, list[str]]:
    """The bundle as a zip, and the names in it. `texts` are the project's
    sources as the open editors have them, for what is written out; a file
    not among them is read from the disk."""
    names = files(root, document, reads, texts)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            if name in texts:
                data = texts[name]
                if strip and name.lower().endswith(TEXT):
                    data = strip_comments(data)
                archive.writestr(name, data.encode("utf-8"))
            else:
                archive.write(root / name, name)
        if bbl is not None and bbl.is_file():
            stem = PurePosixPath(document)
            named = (stem.parent / f"{stem.stem}.bbl").as_posix()
            if named not in names:
                archive.write(bbl, named)
                names.append(named)
    return buffer.getvalue(), sorted(names)
