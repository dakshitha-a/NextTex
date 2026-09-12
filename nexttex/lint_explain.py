"""chktex's warnings, in English.

The README says errors are explained in English, and that was true of
LaTeX's own errors and not of chktex's. chktex writes for somebody who
already knows TeX: "Interword spacing (`\\ ') should perhaps be used" is
correct, useless to a writer who has never heard of interword spacing, and
sits in the same drawer as a sentence saying which package went missing
and what to do about it. The route already parses the warning number and
threw it away.

Each rule is keyed on the number chktex itself prints under `%n`, and each
carries the fragment that produces it. `tests/test_lint_explain.py` runs
chktex over every trigger and asserts the number comes back, so a chktex
that renumbers its warnings fails the suite rather than quietly explaining
the wrong thing. Warnings this project's `.chktexrc` mutes have no rule,
and the test checks that too, from the file rather than from a list.

The three fields are the ones the drawer already draws for a LaTeX error:
a title, what actually goes wrong on the page, and what to type instead.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    title: str
    detail: str
    fix: str
    #: A fragment of a document body that makes chktex report this number.
    #: Part of the rule rather than of the test, so a rule cannot be added
    #: without a way to prove the number is the one meant.
    trigger: str

    def as_dict(self) -> dict:
        return {"title": self.title, "detail": self.detail, "fix": self.fix}


LINT_RULES: dict[int, Rule] = {
    2: Rule(
        "A line could break here, and should not",
        "TeX is free to end a line between the word and the number, so a "
        "reference can end up as \"Section\" at the end of one line and \"2\" "
        "at the start of the next. It looks like a mistake in the typesetting "
        "because it is one.",
        "Put a ~ where the space is: Section~2, Figure~\\ref{fig:flux}. It is "
        "a space that cannot break.",
        r"see \pageref {x} here",
    ),
    3: Rule(
        "The superscript applies to the bracket, not to what is in it",
        "A superscript or subscript after a closing bracket attaches to that "
        "one character, so $(x+y)^2$ raises the bracket rather than the sum. "
        "It happens to look right for a single digit and stops looking right "
        "the moment the exponent is longer.",
        "Wrap the bracketed part: ${(x+y)}^2$.",
        r"$(x+y)^2$",
    ),
    4: Rule(
        "An italic correction outside italics",
        "\\/ adds the small slant compensation an italic letter needs before "
        "an upright one. In upright text there is nothing to compensate for, "
        "so it inserts a sliver of space where none belongs.",
        "Remove the \\/, or move it inside the italic text it was meant for.",
        r"\textit{word}\/ text",
    ),
    5: Rule(
        "Two italic corrections in a row",
        "The slant compensation is applied twice, so the gap after the "
        "italic word is twice as wide as it should be.",
        "Keep one \\/ and delete the other.",
        r"{\it word\/\/} next",
    ),
    6: Rule(
        "Italic text running straight into upright text",
        "An italic letter leans right, and the next upright letter starts at "
        "the same place it would after an upright one, so the two touch or "
        "very nearly do.",
        "Put \\/ at the end of the italic text, or use \\textit{...}, which "
        "does it for you.",
        r"{\it word}next",
    ),
    7: Rule(
        "An accent over a letter that has to lose its dot first",
        "An i or a j keeps its own dot under the accent, so the letter comes "
        "out with two marks on it.",
        "Use the dotless form: \\^{\\i} rather than \\^{i}, and \\~{\\j} "
        "rather than \\~{j}.",
        r"\^{i} here.",
    ),
    9: Rule(
        "A bracket or an environment closed with the wrong one",
        "The opening and closing marks do not match, so the engine will "
        "either stop or nest something inside a group it was never meant to "
        "be in. This is the warning that catches a \\begin{itemize} closed "
        "with \\end{enumerate}.",
        "Close it with the partner of what opened it.",
        r"$[x)$",
    ),
    10: Rule(
        "A bracket on its own",
        "A closing bracket with nothing opening it, or the other way round. "
        "In maths this changes the size of everything around it; in text it "
        "usually means a group was left open somewhere above.",
        "Add the missing partner, or escape the character with a backslash "
        "if it is meant to be printed.",
        r"a } here",
    ),
    12: Rule(
        "TeX will read this full stop as the end of a sentence",
        "TeX puts a wider gap after a full stop, and it cannot tell an "
        "abbreviation from the end of a sentence. After \"e.g.\" or \"Fig.\" "
        "the reader gets a sentence-sized gap in the middle of a sentence.",
        "Write e.g.\\ this, with a backslash and a space, which forces an "
        "ordinary word gap.",
        r"e.g. this thing",
    ),
    13: Rule(
        "TeX will read this full stop as the middle of a sentence",
        "The opposite case: after a capital letter TeX assumes an initial or "
        "an abbreviation and uses an ordinary word gap, so a sentence that "
        "ends in a capital, such as one ending in NASA, runs into the next "
        "one.",
        "Write NASA\\@. Next, which tells TeX the sentence really did end.",
        r"Ends in CAPS. Next one.",
    ),
    15: Rule(
        "Something was opened and never closed",
        "A bracket, a brace or an environment is still open at the end of "
        "the file or the group. The engine will report this somewhere else "
        "entirely, usually many pages later, which is why it is worth seeing "
        "it here.",
        "Close it where it belongs.",
        r"$( x $",
    ),
    16: Rule(
        "Maths mode is still open at the end of the file",
        "A $ was opened and never closed, so everything from there to the "
        "end of the document is being typeset as an equation.",
        "Find the unpaired $ and close it. The first line that comes out in "
        "italics is usually where it is.",
        r"$x = 1",
    ),
    23: Rule(
        "Three quotation marks in a row",
        "A quote inside a quote puts ''' together, and TeX sets them at the "
        "same spacing as any other three characters, so the reader cannot "
        "tell where the inner quotation ends and the outer one begins.",
        "Separate them with a thin space: '\\,'' or ''\\,'.",
        r"``\emph{a}'''' b",
    ),
    24: Rule(
        "A space here moves the page reference",
        "A space before the brace of a label or a reference is part of the "
        "text, and TeX can place the label after it, so \\pageref can name "
        "the page after the one the label was meant for.",
        "Remove the space between the command and its brace.",
        r"\label{a b}",
    ),
    25: Rule(
        "Only the first character is in the superscript",
        "A superscript or subscript takes the single character after it "
        "unless it is braced, so $x^12$ is x to the power one, followed by a "
        "two.",
        "Brace the whole thing: $x^{12}$.",
        r"$x^12$",
    ),
    26: Rule(
        "A space in front of punctuation",
        "The space is printed, so the comma or full stop sits away from the "
        "word it belongs to. In English typesetting there is no space before "
        "punctuation.",
        "Delete the space. If the line was broken there for readability in "
        "the source, end the previous line with a % so the break does not "
        "become a space.",
        r"a word , and another .",
    ),
    29: Rule(
        "A letter x standing in for a multiplication sign",
        "In maths an x is the variable x, set in italics and spaced as a "
        "letter, which is visibly not the same shape as a multiplication "
        "sign.",
        "Use \\times: $3 \\times 4$.",
        r"3 x 4 in maths $3 x 4$",
    ),
    32: Rule(
        "A closing quote where an opening one belongs",
        "TeX makes quotation marks out of backticks and apostrophes, and "
        "which one you type decides which way the mark curls. An apostrophe "
        "at the start of a quotation gives a right-hand mark on the left.",
        "Open with a backtick: `single' or ``double''.",
        r"Say 'this' now.",
    ),
    33: Rule(
        "An opening quote where a closing one belongs",
        "The same rule at the other end: a backtick closing a quotation "
        "gives a left-hand mark on the right.",
        "Close with an apostrophe: `single' or ``double''.",
        r"Say ``this`` now.",
    ),
    37: Rule(
        "A space just inside a bracket",
        "The space is printed, so the bracket stands away from what it "
        "encloses.",
        "Delete the space next to the bracket.",
        r"word( text )word",
    ),
    39: Rule(
        "Two spaces where one was meant",
        "This one is next to a ~, which is itself a space, so what reaches "
        "the page is a double gap.",
        "Remove one of the two.",
        r"Section~ 2",
    ),
    42: Rule(
        "A space before a footnote mark",
        "The space is printed before the raised number, so the mark floats "
        "away from the word it belongs to, and a line can break between "
        "them.",
        "Put the \\footnote straight after the word, with no space, and "
        "after the punctuation rather than before it.",
        r"A sentence \footnote{note} here.",
    ),
    45: Rule(
        "$$ is plain TeX, not LaTeX",
        "$$ works, and it sets the spacing above and below the equation by "
        "TeX's rules rather than by the document class's, so a displayed "
        "equation written this way is spaced differently from every other "
        "one in the document.",
        "Use \\[ ... \\], or an equation environment if it needs a number.",
        r"$$x = 1$$",
    ),
}


def explain(number: int | str | None) -> dict | None:
    """The English for a chktex warning number, or None if there is none."""
    try:
        rule = LINT_RULES[int(number)]  # type: ignore[arg-type]
    except (TypeError, ValueError, KeyError):
        return None
    return rule.as_dict()
