"""What a published page may ask NextTex to fill in for it.

A page is sandboxed and can load nothing but itself, its Google font and
the KaTeX that NextTex serves, so on 24 October 2026 the thesis's agent
drew a derivation's 52 equations as MathML through script helpers of its
own, and one stray parenthesis left every one of them blank. A plot made
the way the writer makes them, with matplotlib, could reach a page only
by the agent turning the file into base64 by hand. So a page names what
it wants and publishing fills it in:

`{{maths}}`
    KaTeX, its chemistry extension and the project's own macros, then
    rendering `$...$`, `\\(...\\)`, `$$...$$` and `\\[...\\]` in the page.
    Written once, anywhere; the script waits for the page to be read.

`{{figure:figures/decay.pdf}}`
    A project file as an image's address, in place: a PDF drawn to SVG so
    it stays sharp, a picture as it is. The figure on the page is the
    figure in the thesis.

`{{equation:eq:coupled-nuclear}}`
    The maths of the equation with that label, as the source has it now,
    in display delimiters for `{{maths}}` to set. The page quotes the
    thesis rather than a copy that drifts from it.

What the agent wrote is kept as it wrote it, and only the served copy is
filled in, so reading a page back and changing one string never deals in
a megabyte of base64.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .figures import _uncommented
from .symbols import _balanced, scan

PART = re.compile(r"\{\{\s*(maths|figure|equation)\s*(?::\s*([^}]*?))?\s*\}\}")

#: Where NextTex serves KaTeX, from the built interface's assets; the page
#: policy lets a page load from here and nowhere else on the server.
KATEX = "/assets/katex/"

#: The colour KaTeX draws a command it does not know in. One shade off its
#: own default, so the check after publishing can find them by it: KaTeX
#: marks them with nothing else.
UNKNOWN_COLOUR = "#cc0001"

#: Kinds a page may show as they are. A PDF is drawn first.
PICTURES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}

#: Display maths environments, and what KaTeX sets their bodies in.
_DISPLAY = {
    "equation": "", "equation*": "",
    "align": "aligned", "align*": "aligned", "flalign": "aligned", "flalign*": "aligned",
    "eqnarray": "aligned", "eqnarray*": "aligned",
    "alignat": "alignedat", "alignat*": "alignedat",
    "gather": "gathered", "gather*": "gathered", "multline": "gathered", "multline*": "gathered",
}


@dataclass
class Filled:
    html: str
    #: What could not be filled in, one sentence each.
    problems: list[str] = field(default_factory=list)


def fill(html: str, root: Path) -> Filled:
    """`html` with every part filled in from the project at `root`."""
    problems: list[str] = []
    found = None

    def symbols():
        nonlocal found
        if found is None:
            found = scan(root)
        return found

    def one(match: re.Match) -> str:
        kind, argument = match.group(1), (match.group(2) or "").strip()
        if kind == "maths":
            return maths_tags(macros(root, symbols().texfiles))
        if kind == "figure":
            address, problem = figure_address(root, argument)
            if problem:
                problems.append(problem)
            return address
        labels = {entry["name"]: entry for entry in symbols().labels}
        text, problem = equation_text(labels, argument)
        if problem:
            problems.append(problem)
        return text

    return Filled(PART.sub(one, html), problems)


def maths_tags(defined: dict[str, str]) -> str:
    """KaTeX and its auto-render, set going once the page is read."""
    data = json.dumps(defined).replace("</", "<\\/")
    return (
        f'<link rel="stylesheet" href="{KATEX}katex.min.css">'
        f'<script src="{KATEX}katex.min.js"></script>'
        f'<script src="{KATEX}contrib/auto-render.min.js"></script>'
        f'<script src="{KATEX}contrib/mhchem.min.js"></script>'
        "<script>(function(){var macros=" + data + ";"
        "function go(){renderMathInElement(document.body,{delimiters:["
        '{left:"$$",right:"$$",display:true},{left:"\\\\[",right:"\\\\]",display:true},'
        '{left:"\\\\(",right:"\\\\)",display:false},{left:"$",right:"$",display:false}],'
        "macros:macros,throwOnError:false,errorColor:\"#cc0001\",ignoredClasses:[\"no-maths\"]});}"
        'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",go);}else{go();}'
        "})();</script>"
    )


#: `\newcommand{\name}[n]{body}` and its kin, and `\DeclareMathOperator`.
_COMMAND = re.compile(r"\\(?:new|renew|provide)command\*?\s*\{?\s*\\([A-Za-z]+)\s*\}?\s*(?:\[(\d)\])?\s*(\[[^\]]*\])?\s*(?=\{)")
_DEF = re.compile(r"\\def\s*\\([A-Za-z]+)\s*((?:#\d)*)\s*(?=\{)")
_OPERATOR = re.compile(r"\\DeclareMathOperator(\*?)\s*\{\s*\\([A-Za-z]+)\s*\}\s*(?=\{)")


def macros(root: Path, files: list[str]) -> dict[str, str]:
    """The project's own macros, as KaTeX's `macros` option takes them.

    A body KaTeX cannot set is left for it to say so on the page, which
    the check after publishing reads: guessing what to drop would set the
    wrong maths quietly. An optional first argument's default is not
    carried, since KaTeX's macros take none."""
    found: dict[str, str] = {}
    for relative in files:
        try:
            text = _uncommented((root / relative).read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        for match in _COMMAND.finditer(text):
            name = "\\" + match.group(1)
            if name not in found:
                found[name] = _balanced(text, match.end(), limit=2000)
        for match in _DEF.finditer(text):
            name = "\\" + match.group(1)
            if name not in found:
                found[name] = _balanced(text, match.end(), limit=2000)
        for match in _OPERATOR.finditer(text):
            name = "\\" + match.group(2)
            if name not in found:
                limits = "\\limits" if match.group(1) else ""
                found[name] = f"\\operatorname*{{{_balanced(text, match.end(), limit=200)}}}{limits}" if limits \
                    else f"\\operatorname{{{_balanced(text, match.end(), limit=200)}}}"
    return found


def figure_address(root: Path, relative: str) -> tuple[str, str]:
    """A data address for a project file, and a sentence if there is none."""
    if not relative:
        return "", "{{figure:...}} needs a path, such as {{figure:figures/decay.pdf}}."
    try:
        path = (root / relative).resolve()
        path.relative_to(root.resolve())
    except (OSError, ValueError):
        return "", f"{relative} is not inside the project."
    if not path.is_file():
        return "", f"{relative} is not in the project."
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        data, kind = _drawn(path)
        if data is None:
            return "", f"{relative} could not be drawn: pdftocairo, from poppler, is not on this machine."
    elif suffix in PICTURES:
        data, kind = path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/png"
        if suffix == ".svg":
            kind = "image/svg+xml"
    else:
        return "", f"{relative} is not a figure a page can show: a PDF or a picture is."
    return f"data:{kind};base64," + base64.b64encode(data).decode("ascii"), ""


def _drawn(path: Path) -> tuple[bytes | None, str]:
    """A PDF's first page as SVG, which stays sharp at any size, or as a
    PNG at twice the screen's resolution when the SVG cannot be made."""
    if shutil.which("pdftocairo") is None:
        return None, ""
    with tempfile.TemporaryDirectory() as scratch:
        out = Path(scratch) / "figure"
        try:
            subprocess.run(["pdftocairo", "-svg", "-f", "1", "-l", "1", str(path), str(out) + ".svg"],
                           check=True, capture_output=True, timeout=30)
            return (Path(str(out) + ".svg")).read_bytes(), "image/svg+xml"
        except (OSError, subprocess.SubprocessError):
            pass
        try:
            subprocess.run(["pdftocairo", "-png", "-singlefile", "-f", "1", "-l", "1", "-r", "200",
                            str(path), str(out)], check=True, capture_output=True, timeout=30)
            return out.with_suffix(".png").read_bytes(), "image/png"
        except (OSError, subprocess.SubprocessError):
            return None, ""


_LABEL = re.compile(r"\\label\s*\{[^}]*\}|\\(?:nonumber|notag)\b")


def equation_text(labels: dict[str, dict], name: str) -> tuple[str, str]:
    """The display maths of the equation labelled `name`, for KaTeX."""
    entry = labels.get(name)
    if entry is None:
        return "", f"No label {name} is in the project."
    env = entry.get("env", "")
    if env not in _DISPLAY or "body" not in entry:
        return "", f"{name} labels {env or 'something'} that is not an equation."
    body = _LABEL.sub("", entry["body"]).strip()
    inner = _DISPLAY[env]
    if inner == "alignedat":
        columns = re.match(r"\s*\{(\d+)\}", body)
        body = body[columns.end():] if columns else body
        return f"\\[\\begin{{alignedat}}{{{columns.group(1) if columns else 1}}}{body}\\end{{alignedat}}\\]", ""
    if inner:
        return f"\\[\\begin{{{inner}}}{body}\\end{{{inner}}}\\]", ""
    return f"\\[{body}\\]", ""
