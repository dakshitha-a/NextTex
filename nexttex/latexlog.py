"""Turn a LaTeX log into diagnostics the editor can put on a line.

LaTeX log parsing has a reputation for being miserable, and most of that
misery comes from two things this module sidesteps.

The first is line wrapping: TeX hard-wraps its log at 79 columns by
default, splitting messages and file paths mid-word. Rather than
reassembling them heuristically, the compiler runs with
`max_print_line=1000` (see compile.py), so a message arrives on one line.

The second is that many warnings never name the file they came from --
they assume you are reading the log top to bottom and can see which file
TeX had open. So the parser tracks that itself, following the `(path`
and `)` markers TeX writes as it opens and closes files, and attributes
each unattributed message to whatever was open at the time.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

Severity = Literal["error", "warning", "info"]

# ---------------------------------------------------------------------------
# Message patterns.  Each captures at least a message, and a line where the
# log offers one.

# From -file-line-error:  ./chapters/02_theory.tex:41: Undefined control sequence.
FILE_LINE_ERROR = re.compile(r"^(?P<file>(?:\.|/|[A-Za-z]:)[^:\n]*?):(?P<line>\d+): (?P<msg>.*)$")

# A bare error, when -file-line-error cannot attribute it:  ! Missing $ inserted.
BARE_ERROR = re.compile(r"^! (?P<msg>.*)$")

# The line TeX was reading when it failed:  l.41 \undefinedcommand
ERROR_LINE = re.compile(r"^l\.(?P<line>\d+)\s?(?P<context>.*)$")

# LaTeX Warning: Reference `x' on page 1 undefined on input line 5.
LATEX_WARNING = re.compile(
    r"^(?:LaTeX|Package (?P<pkg>[\w@.-]+)) (?:Font )?Warning: (?P<msg>.*?)"
    r"(?: on input line (?P<line>\d+))?\.?$"
)

# Overfull \hbox (295.19504pt too wide) detected at line 8
# Overfull \vbox (12.0pt too high) has occurred while \output is active
# Underfull \hbox (badness 10000) in paragraph at lines 12--14
BOX_WARNING = re.compile(
    r"^(?P<kind>Over|Under)full \\(?P<box>[hv])box "
    r"\((?P<amount>[^)]*)\)"
    r"(?:.*?(?:at lines? (?P<line>\d+)(?:--(?P<endline>\d+))?))?"
)

# A file TeX opens looks like `(/abs/path.tex` or `(./rel/path.tex`.
FILE_OPEN_PATH = re.compile(r"(?:/|\.\.?/)[^\s(){}]*")

# Messages that are noise in an editor gutter: they repeat what the
# individual warnings already said, or they are about the run, not the source.
SUPPRESSED = (
    "There were undefined references",
    "There were multiply-defined labels",
    "Citation(s) may have changed",
    "Label(s) may have changed",
    "Rerun to get cross-references right",
    "Rerun to get outlines right",
    "Please rerun LaTeX",
    "Some pages have been shifted",
    "Please (re)run Biber",
    "Please (re)run BibTeX",
    "has changed",            # "File `main.out' has changed" -- a rerun hint
    "Font shape",             # substitution notices; never actionable in source
)


@dataclass
class Diagnostic:
    """One thing to mark in the editor."""

    severity: Severity
    message: str
    file: Path | None = None
    line: int | None = None
    end_line: int | None = None
    # The source snippet TeX echoed back, when it gave one.  This is what
    # makes an error understandable without opening the file.
    context: str | None = None
    package: str | None = None

    def key(self) -> tuple:
        """Identity for de-duplication across compiler passes."""
        return (self.severity, self.message, str(self.file), self.line)

    def as_dict(self) -> dict:
        return {
            "severity": self.severity,
            "message": self.message,
            "file": str(self.file) if self.file else None,
            "line": self.line,
            "endLine": self.end_line,
            "context": self.context,
            "package": self.package,
        }


@dataclass
class ParsedLog:
    diagnostics: list[Diagnostic] = field(default_factory=list)
    # A run can fail without producing a parseable error (a missing file, a
    # killed process).  Keep the raw tail so the UI can show something true.
    raw_tail: str = ""

    @property
    def errors(self) -> list[Diagnostic]:
        return [d for d in self.diagnostics if d.severity == "error"]

    @property
    def warnings(self) -> list[Diagnostic]:
        return [d for d in self.diagnostics if d.severity == "warning"]

    def as_dict(self) -> dict:
        return {
            "diagnostics": [d.as_dict() for d in self.diagnostics],
            "errorCount": len(self.errors),
            "warningCount": len(self.warnings),
            "rawTail": self.raw_tail,
        }


class _FileStack:
    """Follows which source file TeX currently has open.

    TeX writes `(path` when it opens a file and `)` when it closes one, so
    the innermost unclosed path is the file a message belongs to.

    The subtlety that breaks naive implementations: the log is also full of
    ordinary parenthesised prose -- `(preloaded format=pdflatex)`,
    `(Font)` -- whose closing paren is indistinguishable from a file's.
    Counting only the parens that open a *path* and then counting every
    `)` pops real files off the stack and loses attribution. So every `(`
    pushes something: a path when one follows, and an opaque marker when
    one does not. The brackets then balance, and only the paths are ever
    reported.
    """

    SOURCE_SUFFIXES = {".tex", ".ltx"}

    def __init__(self, root: Path):
        self.root = root
        self.stack: list[Path | None] = []

    def feed(self, line: str) -> None:
        i, n = 0, len(line)
        while i < n:
            char = line[i]
            if char == "(":
                match = FILE_OPEN_PATH.match(line, i + 1)
                if match:
                    path = Path(match.group(0))
                    if not path.is_absolute():
                        path = self.root / path
                    self.stack.append(path)
                    i = match.end()
                    continue
                # A parenthesis that opens no file still has to be
                # balanced, or its `)` will close somebody else's file.
                self.stack.append(None)
            elif char == ")":
                if self.stack:
                    self.stack.pop()
            i += 1

    @property
    def current(self) -> Path | None:
        """The innermost open .tex file.

        A warning raised while a .sty is open still refers to the document
        being typeset, so style and class files are skipped when reporting
        even though they are tracked for balance.
        """
        for entry in reversed(self.stack):
            if entry is not None and entry.suffix.lower() in self.SOURCE_SUFFIXES:
                try:
                    return entry.resolve()
                except OSError:
                    return entry
        return None


def parse(log_text: str, project_root: Path, main_file: Path | None = None) -> ParsedLog:
    """Read a .log file into diagnostics."""
    result = ParsedLog()
    stack = _FileStack(project_root)
    seen: set[tuple] = set()
    lines = log_text.splitlines()
    # An error is reported before the `l.NN` line that says where it was, so
    # hold the most recent one open to receive that detail.
    pending: Diagnostic | None = None

    def emit(diag: Diagnostic) -> None:
        if any(s in diag.message for s in SUPPRESSED):
            return
        if diag.file is None:
            diag.file = stack.current or main_file
        if diag.key() not in seen:
            seen.add(diag.key())
            result.diagnostics.append(diag)

    for raw in lines:
        line = raw.rstrip("\n")

        # The `l.NN` follow-up to an error we are already holding.
        if pending is not None:
            match = ERROR_LINE.match(line)
            if match:
                pending.line = pending.line or int(match.group("line"))
                context = match.group("context").strip()
                if context:
                    pending.context = context
                emit(pending)
                pending = None
                continue
            # Errors are followed by a blank line and then the next message;
            # if no `l.NN` arrives, emit what we have.
            if line.startswith(("!", "./", "/")) or not line.strip():
                emit(pending)
                pending = None

        stack.feed(line)

        match = FILE_LINE_ERROR.match(line)
        if match and not line.startswith("l."):
            path = Path(match.group("file"))
            if not path.is_absolute():
                path = project_root / path
            pending = Diagnostic(
                severity="error",
                message=match.group("msg").strip(),
                file=path.resolve(),
                line=int(match.group("line")),
            )
            continue

        match = BARE_ERROR.match(line)
        if match:
            pending = Diagnostic(severity="error", message=match.group("msg").strip())
            continue

        match = BOX_WARNING.match(line)
        if match:
            start = match.group("line")
            emit(
                Diagnostic(
                    severity="warning",
                    message=(
                        f"{match.group('kind')}full \\{match.group('box')}box "
                        f"({match.group('amount')})"
                    ),
                    line=int(start) if start else None,
                    end_line=int(match.group("endline")) if match.group("endline") else None,
                )
            )
            continue

        match = LATEX_WARNING.match(line)
        if match:
            emit(
                Diagnostic(
                    severity="warning",
                    message=match.group("msg").strip(),
                    line=int(match.group("line")) if match.group("line") else None,
                    package=match.group("pkg"),
                )
            )
            continue

    if pending is not None:
        emit(pending)

    if not result.errors:
        result.raw_tail = "\n".join(lines[-25:])
    else:
        result.raw_tail = "\n".join(lines[-60:])
    return result
