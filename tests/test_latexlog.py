"""The log parser is the difference between a useful error and a shrug.

Every case here came from a real failure mode: the paren-balance bug that
attributed a chapter's error to whatever file happened to be open, the
79-column wrapping that splits a message in half, and the \\include indirection
that makes the file TeX names not the file the user is editing.
"""

from pathlib import Path

from nexttex.latexlog import parse as parse_log

ROOT = Path("/project")
MAIN = ROOT / "main.tex"


def test_file_line_error_is_attributed_to_its_own_file():
    log = (
        "(./main.tex (./chapters/02_theory/02_theory.tex\n"
        "./chapters/02_theory/02_theory.tex:24: Undefined control sequence.\n"
        "l.24 \\undefinedcmd\n"
        ") )\n"
    )
    result = parse_log(log, ROOT, MAIN)
    assert len(result.errors) == 1
    error = result.errors[0]
    assert error.line == 24
    assert error.file is not None and error.file.name == "02_theory.tex"


def test_a_bare_parenthesis_does_not_close_someone_elses_file():
    """`(see below)` in a package banner used to pop the file stack.

    The next error then landed on whichever file TeX had opened before, which
    is the most confusing possible way for a diagnostic to be wrong.
    """
    log = (
        "(./main.tex (./preamble/formatting.tex\n"
        "Package foo Info: something (see the manual) here.\n"
        ")\n"
        "(./chapters/01_introduction/01_introduction.tex\n"
        "./chapters/01_introduction/01_introduction.tex:9: Missing $ inserted.\n"
        ") )\n"
    )
    result = parse_log(log, ROOT, MAIN)
    assert result.errors[0].file is not None
    assert result.errors[0].file.name == "01_introduction.tex"


def test_undefined_reference_and_citation_are_warnings_not_errors():
    log = (
        "(./main.tex\n"
        "LaTeX Warning: Reference `fig:one' on page 3 undefined on input line 12.\n"
        "LaTeX Warning: Citation 'smith2020' undefined on input line 14.\n"
        ")\n"
    )
    result = parse_log(log, ROOT, MAIN)
    assert not result.errors
    assert len(result.warnings) >= 2


def test_overfull_box_carries_its_line():
    log = (
        "(./main.tex\n"
        "Overfull \\hbox (12.5pt too wide) in paragraph at lines 40--42\n"
        ")\n"
    )
    result = parse_log(log, ROOT, MAIN)
    assert result.warnings
    assert any(w.line == 40 for w in result.warnings)
