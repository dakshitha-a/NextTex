r"""Every figure and table of a document, in the order the reader meets them.

The Sections drawer's second list. Each entry is a figure or a table
environment at the top level, `figure`, `table`, their starred and
wrapped and sideways forms, found by walking the document from its own
file through every `\input`, `\include` and `\subfile` in the order they
appear, so the list is the reader's order and not the file tree's.

An entry carries what the source says, its file, its line, its caption
and its labels; what the last build says, its number and page, from the
`.aux` files `auxlabels` reads; how often the document refers to it,
summed over its labels from `usage`; and, when the last PDF's
`pdfimages -list` has exactly one picture on the entry's page and the
entry draws one, the picture's resolution. `pdfimages` names no file, so
a page with two pictures says nothing about either.
"""

from __future__ import annotations

import re
from posixpath import normpath

from .rename import comment_starts
from .symbols import CAPTION, INCLUDEGRAPHICS, _balanced, environment_index
from .usage import scan

#: The environments a list of figures and tables lists, each a figure or
#: a table. A `subfigure` is a part of a figure and not an entry.
TOP = {
    "figure": "figure", "figure*": "figure", "wrapfigure": "figure",
    "sidewaysfigure": "figure", "SCfigure": "figure",
    "table": "table", "table*": "table", "wraptable": "table",
    "sidewaystable": "table", "longtable": "table",
}
INPUT = re.compile(r"\\(?:input|include|subfile)\s*\{([^{}]+)\}")
LABEL = re.compile(r"\\label\s*\{([^{}]+)\}")
#: Under this a picture is drawn at screen resolution; the submission
#: check's own threshold.
LOW_PPI = 150


def _uncommented(text: str) -> str:
    """`text` with each line's comment blanked, lengths kept."""
    lines = text.split("\n")
    for index, line in enumerate(lines):
        cut = comment_starts(line)
        if cut is not None:
            lines[index] = line[:cut] + " " * (len(line) - cut)
    return "\n".join(lines)


#: Greek letters and the signs a title or a caption writes in maths, as
#: the page sets them.
SIGNS = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "vartheta": "θ", "iota": "ι", "kappa": "κ",
    "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ",
    "tau": "τ", "upsilon": "υ", "phi": "φ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
    "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π",
    "Sigma": "Σ", "Upsilon": "Υ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
    "pm": "±", "mp": "∓", "times": "×", "cdot": "·", "cdots": "⋯", "ldots": "…", "dots": "…",
    "to": "→", "rightarrow": "→", "leftarrow": "←", "leftrightarrow": "↔",
    "rightleftharpoons": "⇌", "sim": "∼", "approx": "≈", "le": "≤", "leq": "≤", "ge": "≥",
    "geq": "≥", "ne": "≠", "neq": "≠", "infty": "∞", "hbar": "ħ", "circ": "∘", "prime": "′",
    "AA": "Å", "deg": "°", "degree": "°", "nabla": "∇", "partial": "∂", "langle": "⟨",
    "rangle": "⟩", "vert": "|", "mid": "|", "lvert": "|", "rvert": "|", "cdotp": "·",
}
#: Switches that change the face or the size of what follows and set
#: nothing themselves, as `{\\bf g}` writes a bold g.
SWITCHES = {
    "bf", "it", "rm", "sf", "tt", "em", "sc", "sl", "normalfont", "bfseries", "itshape",
    "rmfamily", "sffamily", "ttfamily", "upshape", "scshape", "tiny", "scriptsize", "footnotesize",
    "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "centering", "noindent",
    "newline", "linebreak", "hfill", "protect", "relax", "displaystyle", "textstyle",
}
_SUB = dict(zip("0123456789+-=()aehiklmnoprstuvx", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢₖₗₘₙₒₚᵣₛₜᵤᵥₓ"))
_SUP = dict(zip("0123456789+-=()in", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ"))
#: Commands that set their argument in another face, kept as the argument.
_FACE = re.compile(
    r"\\(?:mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|boldsymbol|bm|text|textrm|textit|"
    r"textbf|textsf|texttt|textup|textnormal|emph|operatorname|ensuremath|mbox|hbox)\s*\*?\s*(?=\{)"
)
_SCRIPT = re.compile(r"([_^])\s*(?:\{([^{}]*)\}|(\\[A-Za-z]+|.))")


def _script(match: re.Match[str]) -> str:
    """A sub- or superscript as the small figures Unicode has for it, or
    as itself where Unicode has none for one of its characters."""
    body = match.group(2) if match.group(2) is not None else match.group(3)
    body = body.replace(" ", "")
    table = _SUB if match.group(1) == "_" else _SUP
    if body and all(char in table for char in body):
        return "".join(table[char] for char in body)
    return body


def _unwrap(text: str, pattern: re.Pattern[str]) -> str:
    """`text` with each command `pattern` finds replaced by its braced
    argument, read whole however deeply it nests."""
    for _ in range(8):
        match = pattern.search(text)
        if not match:
            return text
        # Every pattern given here ends looking at the argument's brace.
        body = _balanced(text, match.end(), limit=len(text))
        text = text[:match.start()] + body + text[match.end() + len(body) + 2:]
    return text


def _replace(text: str, pattern: re.Pattern[str], count: int, make) -> str:
    """`text` with each command `pattern` finds and its `count` braced
    arguments replaced by what `make` makes of the arguments."""
    for _ in range(8):
        match = pattern.search(text)
        if not match:
            return text
        args: list[str] = []
        at = match.end()
        for _ in range(count):
            while at < len(text) and text[at] in " \t\n":
                at += 1
            if text[at:at + 1] != "{":
                break
            args.append(_balanced(text, at, limit=len(text)))
            at += len(args[-1]) + 2
        if len(args) < count:
            return text
        text = text[:match.start()] + make(args) + text[at:]
    return text


def _maths(body: str) -> str:
    """Inline maths as the page sets it: Greek as letters, scripts as the
    small figures, faces and spacing gone."""
    body = re.sub(r"\\label\s*\{[^{}]*\}", "", body)
    body = _unwrap(body, _FACE)
    body = re.sub(r"\\(?:[,;:!> ]|quad|qquad)", "", body)
    body = re.sub(
        r"\\([A-Za-z]+)(\s*)",
        lambda m: "" if m.group(1) in SWITCHES else SIGNS.get(m.group(1), f"\\{m.group(1)}") + m.group(2),
        body,
    )
    for _ in range(3):
        body = _SCRIPT.sub(_script, body)
    return re.sub(r"\s+", " ", body).strip()


def _expand(raw: str, macros: dict[str, str]) -> str:
    """`raw` with the project's own argumentless macros written out:
    `\\Sz{}` is the S₀ its definition sets, not a hole in the caption."""
    if not macros:
        return raw
    pattern = re.compile(r"\\(" + "|".join(sorted(map(re.escape, macros), key=len, reverse=True)) + r")(?![A-Za-z])(\s*\{\})?")
    for _ in range(4):
        expanded = pattern.sub(lambda m: macros[m.group(1)], raw)
        if expanded == raw:
            break
        raw = expanded
    return raw


#: `\\newcommand{\\name}{body}` and its kin, with no arguments.
_DEFINITION = re.compile(r"\\(?:new|renew|provide)command\*?\s*\{?\\([A-Za-z]+)\}?\s*(\[\d\])?\s*(?=\{)")
_DEF = re.compile(r"\\def\s*\\([A-Za-z]+)\s*(?=\{)")


def macros_of(texts: dict[str, str]) -> dict[str, str]:
    """Every argumentless macro the project's own files define, by name,
    the first definition winning, as `\\newcommand` keeps the first."""
    found: dict[str, str] = {}
    for body in texts.values():
        clean = _uncommented(body)
        for match in list(_DEFINITION.finditer(clean)) + list(_DEF.finditer(clean)):
            if match.re is _DEFINITION and match.group(2):
                continue
            definition = _balanced(clean, match.end(), limit=2000)
            if "#" in definition or match.group(1) in found:
                continue
            found[match.group(1)] = definition
    return found


_HOLD = {"$": "\ue000", "{": "\ue001", "}": "\ue002"}


def _plain(raw: str, macros: dict[str, str] | None = None, numbers: dict[str, dict] | None = None) -> str:
    """A caption or a title as words: the project's macros written out,
    a `\\texorpdfstring`'s first form, references and labels out, a
    command's argument kept and its name dropped, maths as the page sets
    it, and an argumentless command's name kept, as the Sections list in
    the editor keeps it."""
    # An escaped `$`, `{` or `}` is a character of the text, held aside
    # while the markup is taken out; `\\%` and its kin are the character.
    raw = re.sub(r"\\([$%&#_{}])", lambda m: _HOLD.get(m.group(1), m.group(1)), raw)
    raw = _expand(raw, macros or {})
    # The TeX form, and not the bookmark's as well.
    raw = _replace(raw, re.compile(r"\\texorpdfstring\s*(?=\{)"), 2, lambda args: args[0])
    raw = _replace(raw, re.compile(r"\\ensuremath\s*(?=\{)"), 1, lambda args: f"${args[0]}$")
    raw = raw.replace("$$", "")
    raw = re.sub(r"\$([^$]*)\$|\\\((.*?)\\\)", lambda m: _maths(m.group(1) if m.group(1) is not None else m.group(2)), raw)
    # A reference the last build numbered reads as its number, as on the
    # page; one it did not, and every citation and label, goes.
    def numbered(match: re.Match[str]) -> str:
        known = (numbers or {}).get(match.group(2).strip())
        if not known or not known.get("number"):
            return ""
        return f" ({known['number']})" if match.group(1) == "eqref" else f" {known['number']}"
    raw = re.sub(r"~?\\(ref|eqref)\s*\{([^{}]*)\}", numbered, raw)
    text = re.sub(r"~?\\(?:label|cite\w*|cref|Cref|autoref)\s*\{[^{}]*\}", "", raw)
    for _ in range(4):
        # The group must hold something: `\\Sone{}` is a macro and the idiom
        # that keeps the space after it, and its name is kept below.
        text = re.sub(r"\\[A-Za-z]+\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}", r"\1", text)
    text = re.sub(
        r"\\([A-Za-z]+)\*?", lambda m: "" if m.group(1) in SWITCHES else SIGNS.get(m.group(1), m.group(1)), text,
    )
    text = re.sub(r"[{}$~]", " ", text).replace("\\", "")
    # The dashes as the page sets them, as the editor's list has them.
    text = text.replace("---", chr(0x2014)).replace("--", chr(0x2013)).replace("``", '"').replace("''", '"')
    text = re.sub(r"\s+", " ", text).strip()
    text = text.translate({ord(held): char for char, held in _HOLD.items()})
    text = re.sub(r"([(\[])\s+", r"\1", text)
    text = re.sub(r"\s+([)\]])", r"\1", text)
    return re.sub(r"\s+([.,;:])", r"\1", text)


def _resolve(name: str, here: str, texts: dict[str, str], macros: dict[str, str] | None = None) -> str | None:
    """The project path an `\\input` names: from the project's top, as TeX
    reads it, with or without `.tex`, a macro in it written out:
    `\\input{\\figdir/pipeline}`."""
    name = _expand(name, macros or {}).strip()
    for candidate in (name, f"{name}.tex"):
        path = normpath(candidate).lstrip("./")
        if path in texts:
            return path
    return None


def _walk(
    path: str, texts: dict[str, str], seen: set[str], out: list[dict], macros: dict[str, str] | None = None,
    numbers: dict[str, dict] | None = None,
) -> None:
    if path in seen or path not in texts:
        return
    seen.add(path)
    macros = macros or {}
    text = texts[path]
    clean = _uncommented(text)
    events: list[tuple[int, str, object]] = []
    index = environment_index(clean)
    for entry in index:
        kind = TOP.get(entry["name"])
        if kind is None:
            continue
        # Inside another listed environment, a table in a figure, is part
        # of that one.
        if any(
            other is not entry and other["name"] in TOP
            and other["inner_start"] <= entry["start"] < other["inner_end"]
            for other in index
        ):
            continue
        events.append((entry["start"], "env", (kind, entry)))
    for match in INPUT.finditer(clean):
        events.append((match.start(), "input", match.group(1)))
    for _, what, item in sorted(events, key=lambda event: event[0]):
        if what == "input":
            child = _resolve(item, path, texts, macros)
            if child:
                _walk(child, texts, seen, out, macros, numbers)
            continue
        kind, entry = item
        inner = clean[entry["inner_start"]:entry["inner_end"]]
        caption = CAPTION.search(inner)
        out.append({
            "kind": kind,
            "env": entry["name"],
            "file": path,
            "line": text.count("\n", 0, entry["start"]) + 1,
            # Read whole, however long: a caption cut at a limit read as
            # empty, and a writer's captions run to thousands of letters.
            "caption": _plain(_balanced(inner, caption.end() - 1, limit=len(inner)), macros, numbers)[:300] if caption else "",
            "labels": [name.strip() for name in LABEL.findall(inner)],
            "graphics": [
                _balanced(inner, found.end() - 1, limit=300).strip()
                for found in INCLUDEGRAPHICS.finditer(inner)
            ],
        })


def _pictures(rows: list[dict[str, str]]) -> dict[int, list[int]]:
    """The resolution of every picture `pdfimages -list` found, by page."""
    by_page: dict[int, list[int]] = {}
    for row in rows:
        if row.get("type") != "image":
            continue
        try:
            page = int(row["page"])
            ppi = min(int(row["x-ppi"]), int(row["y-ppi"]))
        except (KeyError, ValueError):
            continue
        by_page.setdefault(page, []).append(ppi)
    return by_page


def listing(
    texts: dict[str, str],
    document: str,
    numbers: dict[str, dict] | None = None,
    image_rows: list[dict[str, str]] | None = None,
) -> list[dict]:
    """Every figure and table `document` reaches, in reading order.

    `texts` is every `.tex` in the project, path to text; `numbers` is what
    `auxlabels.read` gives for the document's last build; `image_rows` is
    its PDF's `pdfimages -list`, as `submit._image_rows` parses it."""
    tex = {path: body for path, body in texts.items() if path.lower().endswith(".tex")}
    entries: list[dict] = []
    numbers = numbers or {}
    _walk(document, tex, set(), entries, macros_of(
        {path: body for path, body in texts.items() if path.lower().endswith((".tex", ".sty", ".cls"))}
    ), numbers)
    usage = scan(tex)
    pictures = _pictures(image_rows or [])
    for entry in entries:
        known = next((numbers[name] for name in entry["labels"] if name in numbers), None)
        entry["number"] = known["number"] if known else None
        try:
            entry["page"] = int(known["page"]) if known else None
        except ValueError:
            entry["page"] = None
        entry["refs"] = sum(usage.uses.get(name, 0) for name in entry["labels"])
        entry["ppi"] = None
        entry["shared"] = False
        if entry["page"] is not None and entry["graphics"]:
            on_page = pictures.get(entry["page"], [])
            if len(on_page) == 1 and len(entry["graphics"]) == 1:
                entry["ppi"] = on_page[0]
            elif len(on_page) > 1:
                entry["shared"] = True
    return entries
