"""What a LaTeX error actually means, without asking a model.

The error pane used to show what TeX said, which for most of these is a
sentence written for somebody debugging TeX rather than somebody writing a
thesis.  "Missing $ inserted" does not tell a chemist that they typed an
underscore in ordinary prose, and "Undefined control sequence" does not
say which command or that the usual cause is a missing package.

None of this needs an agent, and it must not: a writer who runs NextTex
with no model at all should still be told where the build broke and what
to do about it.  This is a table of the errors that actually happen,
matched against the parsed log.

Two design rules the table obeys:

*   **Never guess a fix that edits.**  Every entry says what is wrong and
    what to look for.  None of them silently rewrites anything -- that is
    the agent's job, and it asks first.
*   **The first error is the one worth reading.**  TeX cascades: one
    unclosed brace produces a dozen complaints from the paragraphs after
    it, and a writer who starts at the bottom of the list fixes noise.
    `summarise` says which one to start with and why.
"""

from __future__ import annotations

import re
from typing import Iterable

# (pattern, title, what it means, what to do about it).
#
# Order matters: the first match wins, so anything specific goes above the
# general case it would otherwise be swallowed by.
RULES: list[tuple[re.Pattern, str, str, str]] = [
    (
        re.compile(r"Undefined control sequence", re.I),
        "A command LaTeX does not know",
        "The command shown below was not defined by anything this document "
        "loads. Almost always it is either a typo, or a command that needs a "
        "package the preamble does not have yet.",
        "Check the spelling first. If it is spelt right, find which package "
        "provides it and add \\usepackage for it near the top of the file.",
    ),
    (
        re.compile(r"Missing \$ inserted", re.I),
        "Maths outside maths mode",
        "Something that only means anything in maths, usually _ or ^ and "
        "sometimes \\alpha or \\times, was used in ordinary prose.",
        "Put the expression between dollar signs, or write \\_ if you meant a "
        "literal underscore in text.",
    ),
    (
        re.compile(r"Double (superscript|subscript)", re.I),
        "Two superscripts or subscripts in a row",
        "An expression has two ^ or two _ applied to the same thing, which "
        "LaTeX cannot typeset because it does not know which order you meant.",
        "Group them with braces: x^{a^b}, or x_{\\text{a},\\text{b}}.",
    ),
    (
        re.compile(r"Extra alignment tab has been changed", re.I),
        "Too many columns in a table row",
        "A row has more & separators than the table was declared to have "
        "columns.",
        "Count the & in that row against the column specification in "
        "\\begin{tabular}{...}. A stray & inside a cell needs \\&.",
    ),
    (
        re.compile(r"Misplaced alignment tab character &", re.I),
        "An & outside a table",
        "The & character separates table columns, so LaTeX will not accept "
        "one in ordinary text.",
        "Write \\& if you meant the symbol itself.",
    ),
    (
        re.compile(r"File [`'\"]?([^'\"]+\.sty)", re.I),
        "A package that is not installed",
        "The preamble asks for a package this TeX installation does not have.",
        "Install it with your TeX package manager. For TinyTeX that is "
        "`tlmgr install <name>`. Then build again.",
    ),
    (
        re.compile(r"File [`'\"]?([^'\"]+)['\"]? not found", re.I),
        "A file the document refers to is missing",
        "Usually a figure: the path in \\includegraphics does not match "
        "anything in the project.",
        "Check the path and the extension against the file list. Paths are "
        "relative to the main document, and they are case-sensitive.",
    ),
    (
        re.compile(r"Environment ([^\s]+) undefined", re.I),
        "An environment LaTeX does not know",
        "A \\begin{...} names an environment nothing has defined, which "
        "normally means the package that provides it is not loaded.",
        "Add the \\usepackage that defines it, or check the spelling.",
    ),
    (
        re.compile(r"\\begin\{([^}]*)\} on input line (\d+) ended by", re.I),
        "An environment that never ends",
        "A \\begin has no matching \\end, so LaTeX ran to the end of "
        "something else looking for it.",
        "Go to the line named below and add the \\end that belongs to it.",
    ),
    (
        re.compile(r"(Too many \}'s|Missing \} inserted|Missing \{ inserted)", re.I),
        "Unbalanced braces",
        "A { has no matching }, or the other way round. Everything after the "
        "mistake is likely to be reported as an error too, so this is the "
        "only one worth reading.",
        "Look at the line below and count the braces on it.",
    ),
    (
        re.compile(r"Runaway argument", re.I),
        "A command argument that never closed",
        "LaTeX started reading an argument and hit the end of a paragraph "
        "before the closing brace.",
        "The line below is where it started. A missing } is the usual cause.",
    ),
    (
        re.compile(r"Citation [`'\"]?([^'\"]+)['\"]? .*undefined", re.I),
        "A citation with nothing behind it",
        "The key in \\cite is not in the bibliography: either it is not in "
        "the .bib file, or the bibliography has not been rebuilt since it "
        "was added.",
        "Check the key against the .bib file. If it is there, press Rebuild: "
        "a new citation needs a full pass through biber.",
    ),
    (
        re.compile(r"Reference [`'\"]?([^'\"]+)['\"]? .*undefined", re.I),
        "A cross-reference with no label",
        "\\ref points at a \\label that does not exist, or that was added "
        "since the last full build.",
        "Check the label name. If it exists, press Rebuild, because cross-references "
        "need two passes to settle.",
    ),
    (
        re.compile(r"There were undefined references", re.I),
        "Some references have not settled yet",
        "LaTeX needs more than one pass to resolve references and citations.",
        "Press Rebuild. If it persists, one of the labels really is missing.",
    ),
    (
        re.compile(r"Label .* multiply defined", re.I),
        "The same label twice",
        "Two \\label commands use one name, so every \\ref to it points at "
        "whichever came last.",
        "Rename one of them.",
    ),
    (
        re.compile(r"Missing number, treated as zero", re.I),
        "A length or count that is not a number",
        "A command that wanted a number got something else, often a missing "
        "value, or a unit written without its number.",
        "Check the command below for an empty or malformed argument.",
    ),
    (
        re.compile(r"Illegal unit of measure", re.I),
        "A measurement without a unit",
        "A length was given as a bare number. LaTeX needs a unit: pt, cm, "
        "in, em, \\textwidth.",
        "Add the unit, e.g. 0.8\\textwidth rather than 0.8.",
    ),
    (
        re.compile(r"perhaps a missing \\item", re.I),
        "Something inside a list that is not an item",
        "Text appears directly inside itemize, enumerate or description "
        "without an \\item in front of it.",
        "Put \\item before it, or move it outside the list.",
    ),
    (
        re.compile(r"Unicode character", re.I),
        "A character this font cannot set",
        "A character in the source, often a dash, a curly quote or an "
        "accented letter pasted from a word processor, has no definition in "
        "the current encoding.",
        "Retype it, or load \\usepackage[utf8]{inputenc} with a font that "
        "covers it. Text pasted from Word is the usual source.",
    ),
    (
        re.compile(r"Command .* already defined", re.I),
        "A command defined twice",
        "\\newcommand was used for a name that already exists, either your "
        "own or one from a package.",
        "Rename yours, or use \\renewcommand if replacing it is deliberate.",
    ),
    (
        re.compile(r"Missing \\begin\{document\}", re.I),
        "Text before the document starts",
        "Something that typesets appears in the preamble, above "
        "\\begin{document}, often a stray character or an unclosed comment.",
        "Look just above \\begin{document} for text that is not a "
        "\\usepackage or a setting.",
    ),
    (
        re.compile(r"(Emergency stop|Fatal error occurred)", re.I),
        "LaTeX gave up",
        "The run stopped rather than carrying on with errors, which means "
        "something earlier made the rest of the document unreadable.",
        "Fix the first error above this one; this message is its consequence.",
    ),
    (
        re.compile(r"Overfull \\hbox", re.I),
        "A line that runs into the margin",
        "A line could not be broken within the text width. It is cosmetic, "
        "the document still typesets.",
        "Usually a long word, URL or inline equation. \\sloppy, a manual "
        "hyphenation, or rewording the sentence all fix it.",
    ),
    (
        re.compile(r"Underfull \\hbox", re.I),
        "A line stretched to fit",
        "LaTeX padded a line more than it likes to. Cosmetic.",
        "Safe to ignore unless the spacing looks visibly wrong.",
    ),
]


def explain(message: str) -> dict | None:
    """What one message means, or None when there is nothing useful to add."""
    for pattern, title, detail, fix in RULES:
        if pattern.search(message or ""):
            return {"title": title, "detail": detail, "fix": fix}
    return None


def annotate(diagnostics: Iterable[dict]) -> list[dict]:
    """The same diagnostics, each with an explanation where one exists."""
    out = []
    for item in diagnostics:
        found = explain(item.get("message", ""))
        out.append({**item, "explain": found} if found else dict(item))
    return out


def summarise(diagnostics: list[dict]) -> dict | None:
    """Where to start, and why that one.

    TeX cascades: one unclosed brace produces complaints from every
    paragraph after it, and a writer who starts at the bottom of the list
    spends the evening fixing consequences.  This names the first error in
    document order, which is nearly always the cause.
    """
    errors = [item for item in diagnostics if item.get("severity") == "error"]
    if not errors:
        return None

    # The first one, in the order the log gave them, which is the order the
    # engine met them in. It used to be `min` over `(file, line)`, which is
    # alphabetical by filename: with `chapters/one.tex` and `main.tex` both
    # carrying an error, the one to start from was whichever file sorted
    # first, and the docstring above and the README both say document
    # order. `parse` appends in the order it reads the log, so this is
    # already the answer and the sort was undoing it.
    first = errors[0]
    found = explain(first.get("message", ""))
    rest = len(errors) - 1
    headline = found["title"] if found else first.get("message", "The build failed")
    return {
        "headline": headline,
        "message": first.get("message", ""),
        "file": first.get("file"),
        "line": first.get("line"),
        "detail": found["detail"] if found else "",
        "fix": found["fix"] if found else "",
        "others": rest,
        # Said plainly, because it is the part people get wrong: the list
        # below the first error is usually its own consequence.
        "note": (
            f"{rest} more error{'s' if rest != 1 else ''} followed it. "
            "LaTeX reports everything after a mistake as a mistake too, so "
            "fix this one and rebuild before reading the rest."
        ) if rest else "",
    }
