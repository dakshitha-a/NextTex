r"""The prose of a LaTeX file, with everything else blanked out.

The browser has its own mask for spelling and grammar, `spell-scan.ts`,
and it reads one file at a time. The consistency checks read the whole
project on the server, so they need the same idea in Python: every
character that is not prose a reader would see becomes a space, and
newlines are kept, so an offset in the mask is the offset in the file
and a line number is the file's line number.

Blanked: comments, the preamble, verbatim and listing environments, maths
inline and displayed, every command's name, and the arguments of the
commands whose arguments are machinery rather than words, a label, a
reference, a citation, a file, a length. The arguments of the rest,
`\emph{...}`, `\section{...}`, `\caption{...}`, stay, since they are
prose.
"""

from __future__ import annotations

import re

#: Environments whose contents are not prose.
OPAQUE = {
    "verbatim", "verbatim*", "lstlisting", "minted", "comment", "Verbatim",
    "equation", "equation*", "align", "align*", "gather", "gather*",
    "multline", "multline*", "eqnarray", "eqnarray*", "displaymath", "math",
    "flalign", "flalign*", "alignat", "alignat*", "tikzpicture", "tabular*",
}
#: Commands whose braced arguments are machinery: every one of them is
#: blanked, with any optional argument before it.
MACHINERY = {
    "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "cpageref",
    "nameref", "vref", "cite", "citep", "citet", "citealt", "citealp",
    "citeauthor", "citeyear", "parencite", "textcite", "autocite", "footcite",
    "nocite", "input", "include", "includeonly", "subfile", "includegraphics",
    "includepdf", "usepackage", "RequirePackage", "documentclass", "begin",
    "end", "bibliography", "bibliographystyle", "addbibresource", "url",
    "href", "hyperref", "newcommand", "renewcommand", "providecommand",
    "DeclareMathOperator", "setlength", "addtolength", "setcounter",
    "hspace", "vspace", "rule", "newacronym", "acro", "ac", "acs", "acl",
    "acp", "gls", "glspl", "Gls", "Glspl", "SI", "si", "num", "qty",
    "unit", "color", "textcolor", "definecolor", "graphicspath", "lstinputlisting",
    "pagestyle", "thispagestyle", "geometry", "hypersetup", "caption*",
    "multicolumn", "multirow", "cline", "hline", "toprule", "midrule",
    "bottomrule", "renewenvironment", "newenvironment", "fontsize",
    "includestandalone", "import", "subimport", "footnotemark",
}
COMMAND = re.compile(r"\\([A-Za-z@]+\*?|.)")
BEGIN = re.compile(r"\\begin\s*\{([^{}]+)\}")


def _blank(chars: list[str], start: int, end: int) -> None:
    for i in range(max(0, start), min(end, len(chars))):
        if chars[i] != "\n":
            chars[i] = " "


def _group_end(text: str, at: int, open_: str, close: str) -> int:
    """One past the group opening at `at`, or the end of the text."""
    depth = 0
    i = at
    while i < len(text):
        char = text[i]
        if char == "\\":
            i += 2
            continue
        if char == open_:
            depth += 1
        elif char == close:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def mask(text: str) -> str:
    """`text` with every character that is not prose replaced by a space,
    newlines kept."""
    chars = list(text)
    n = len(text)
    # Comments first, so nothing below reads into one.
    i = 0
    while i < n:
        char = text[i]
        if char == "\\":
            i += 2
            continue
        if char == "%":
            end = text.find("\n", i)
            end = n if end == -1 else end
            _blank(chars, i, end)
            i = end
            continue
        i += 1
    cleaned = "".join(chars)
    # The preamble is not prose.
    start = cleaned.find("\\begin{document}")
    if start != -1:
        _blank(chars, 0, start + len("\\begin{document}"))
    end_doc = cleaned.find("\\end{document}")
    if end_doc != -1:
        _blank(chars, end_doc, n)
    # Opaque environments, whole.
    for match in BEGIN.finditer(cleaned):
        name = match.group(1).strip()
        if name in OPAQUE:
            close = cleaned.find("\\end{" + name + "}", match.end())
            close = n if close == -1 else close + len("\\end{" + name + "}")
            _blank(chars, match.start(), close)
    cleaned = "".join(chars)
    # Maths, commands and machinery arguments, in one pass.
    i = 0
    while i < n:
        char = cleaned[i]
        if char == "$":
            double = cleaned.startswith("$$", i)
            close = cleaned.find("$$" if double else "$", i + (2 if double else 1))
            while close != -1 and cleaned[close - 1] == "\\":
                close = cleaned.find("$$" if double else "$", close + 1)
            close = n if close == -1 else close + (2 if double else 1)
            _blank(chars, i, close)
            i = close
            continue
        if char == "\\":
            if cleaned.startswith("\\(", i) or cleaned.startswith("\\[", i):
                closer = "\\)" if cleaned[i + 1] == "(" else "\\]"
                close = cleaned.find(closer, i + 2)
                close = n if close == -1 else close + 2
                _blank(chars, i, close)
                i = close
                continue
            match = COMMAND.match(cleaned, i)
            name = match.group(1) if match else ""
            end = match.end() if match else i + 1
            _blank(chars, i, end)
            if name.rstrip("*") in MACHINERY or name in MACHINERY:
                j = end
                while True:
                    while j < n and cleaned[j] in " \t":
                        j += 1
                    if j < n and cleaned[j] in "[{":
                        close = _group_end(cleaned, j, cleaned[j], "]" if cleaned[j] == "[" else "}")
                        _blank(chars, j, close)
                        j = close
                        continue
                    break
                end = j
            i = end
            continue
        if char in "{}~&":
            chars[i] = " "
        i += 1
    return "".join(chars)


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1
