r"""A document as Word, HTML or Markdown, through pandoc.

A co-author who does not write LaTeX, a journal that wants a `.docx`, a
web page for the group's site: the one conversion a paper needs on the
way out.  pandoc does it, and it is an optional tool the way `pdftotext`
is, named in the installer's survey and never installed by NextTex; when
it is here the download menu offers the three formats, and when it is
not the menu says nothing about them.

The conversion runs in the document's own directory, as the engine does,
so `\input` and `\includegraphics` resolve; the project root is on the
resource path too.  HTML is one file with its images embedded, since a
page for a site or a mail wants to travel alone.  Every `.bib` the
project has is handed over with `--citeproc`, so a `\cite` becomes a
reference rather than a bracketed key.  pandoc's stderr comes back
verbatim on failure, because a `\newcommand` it cannot read is usually
what it says, and that is what the writer needs to know.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

#: The format the menu names, pandoc's writer for it, the file suffix and
#: the media type the download answers with.
FORMATS: dict[str, tuple[str, str, str]] = {
    "docx": ("docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "html": ("html", "html", "text/html; charset=utf-8"),
    "md": ("gfm", "md", "text/markdown; charset=utf-8"),
}
TIMEOUT = 120


class ExportError(RuntimeError):
    """pandoc could not, and this is what it said."""


def pandoc_here() -> str | None:
    """The pandoc binary: `NEXTTEX_PANDOC` names one, the way
    `NEXTTEX_TLMGR` names a tlmgr, so the browser tier can point the
    server at `tests/fake_pandoc.py`; otherwise whatever is on PATH."""
    named = os.environ.get("NEXTTEX_PANDOC", "").strip()
    if named:
        return named
    return shutil.which("pandoc")


def argv(binary: str, main: Path, fmt: str, out: Path, root: Path, bibs: list[Path]) -> list[str]:
    """The command, as a list, so a test can read it."""
    writer, _suffix, _media = FORMATS[fmt]
    command = [
        binary, str(main), "-f", "latex", "-t", writer, "-o", str(out),
        f"--resource-path={main.parent}{os.pathsep}{root}",
    ]
    if fmt == "html":
        command += ["--standalone", "--embed-resources"]
    if bibs:
        command.append("--citeproc")
        for bib in bibs:
            command.append(f"--bibliography={bib}")
    return command


def convert(main: Path, fmt: str, out_dir: Path, root: Path, bibs: list[Path], timeout: int = TIMEOUT) -> Path:
    """Convert `main` to `fmt` into `out_dir`, returning the file written."""
    if fmt not in FORMATS:
        raise ExportError(f"not a format pandoc is asked for here: {fmt}")
    binary = pandoc_here()
    if not binary:
        raise ExportError("pandoc is not installed")
    _writer, suffix, _media = FORMATS[fmt]
    out = out_dir / f"{main.stem}.{suffix}"
    try:
        done = subprocess.run(
            argv(binary, main, fmt, out, root, bibs),
            cwd=main.parent, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise ExportError(f"pandoc took more than {timeout} seconds and was stopped")
    except OSError as error:
        raise ExportError(f"could not run pandoc: {error}")
    if done.returncode != 0 or not out.is_file():
        said = (done.stderr or done.stdout or "").strip()
        raise ExportError(said.splitlines()[-1] if said else "pandoc failed without a message")
    return out
