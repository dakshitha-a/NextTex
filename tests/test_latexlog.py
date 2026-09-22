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


def test_the_keys_left_undefined_are_named_once_each():
    """The compile tool reports "3 undefined citations" from these, and the
    scheduler compares the set across passes, so a key cited on ten lines
    is one key."""
    log = (
        "(./main.tex\n"
        "LaTeX Warning: Citation `smith2020' on page 1 undefined on input line 4.\n"
        "LaTeX Warning: Citation `smith2020' on page 2 undefined on input line 9.\n"
        "LaTeX Warning: Citation 'jones2021' undefined on input line 14.\n"
        "LaTeX Warning: Reference `fig:one' on page 3 undefined on input line 12.\n"
        "LaTeX Warning: There were undefined references.\n"
        "Overfull \\hbox (12.5pt too wide) in paragraph at lines 40--42\n"
        "Output written on build/main.pdf (28 pages, 431920 bytes).\n"
        ")\n"
    )
    result = parse_log(log, ROOT, MAIN)
    assert result.undefined_citations == ["smith2020", "jones2021"]
    assert result.undefined_references == ["fig:one"]
    assert result.overfull == 1
    assert result.pages == 28
    assert result.bibliography_stale is False
    payload = result.as_dict()
    assert payload["undefinedCitations"] == ["smith2020", "jones2021"]
    assert payload["pages"] == 28


def test_the_engine_asking_for_bibtex_is_remembered_though_the_line_is_hidden():
    """The rerun hints are noise in a gutter and are suppressed as
    diagnostics; this one is the fact a fast pass needs, so it is kept
    as a flag on the way past."""
    log = (
        "(./main.tex\n"
        "LaTeX Warning: Please (re)run BibTeX.\n"
        ")\n"
    )
    result = parse_log(log, ROOT, MAIN)
    assert result.bibliography_stale is True
    assert not result.warnings


def test_the_engine_asking_to_be_run_again_is_remembered_though_the_line_is_hidden():
    """A writer saw figures on the wrong page until a whole rebuild: a
    single pass had left the layout one pass behind, the engine said so
    in its log, and nothing read it.  The hints stay out of the gutter
    and become one flag the scheduler acts on."""
    for hint in (
        "LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.",
        "Package rerunfilecheck Warning: File `main.out' has changed.",
        "LaTeX Warning: Some pages have been shifted.",
        "Package hyperref Warning: Rerun to get outlines right.",
    ):
        result = parse_log(f"(./main.tex\n{hint}\n)\n", ROOT, MAIN)
        assert result.rerun_needed is True, hint
        assert not result.warnings, hint
        assert result.as_dict()["rerunNeeded"] is True
    clean = parse_log("(./main.tex\nOutput written on main.pdf (3 pages).\n)\n", ROOT, MAIN)
    assert clean.rerun_needed is False
    # The bibliography hint is the other flag and not this one.
    stale = parse_log("(./main.tex\nLaTeX Warning: Please (re)run BibTeX.\n)\n", ROOT, MAIN)
    assert stale.bibliography_stale is True
    assert stale.rerun_needed is False
