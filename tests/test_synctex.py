"""The parts of SyncTeX handling that do not need a compiled document.

The path normalisation is where the bugs live: synctex reports paths with
`/./` in them, and reports the shadow file NextTex compiles rather than the
main file the writer has open.
"""

from pathlib import Path

from nexttex.synctex import GENERATED_SUFFIXES, _blocks, _normalise


def test_a_dot_segment_is_removed(tmp_path):
    raw = f"{tmp_path}/./chapters/02_theory/02_theory.tex"
    assert _normalise(raw, tmp_path) == (
        tmp_path / "chapters/02_theory/02_theory.tex"
    )


def test_a_relative_path_is_resolved_against_the_project(tmp_path):
    assert _normalise("chapters/one.tex", tmp_path) == tmp_path / "chapters/one.tex"


def test_generated_files_are_recognised():
    # A click landing in the table of contents must not open main.toc, which
    # is regenerated on every build and cannot be edited usefully.
    for suffix in (".toc", ".aux", ".bbl", ".lof"):
        assert suffix in GENERATED_SUFFIXES


def test_blocks_are_split_on_the_record_separator():
    output = (
        "SyncTeX result begin\n"
        "Output:main.pdf\n"
        "Input:/p/main.tex\n"
        "Line:12\n"
        "Column:-1\n"
        "SyncTeX result end\n"
    )
    parsed = _blocks(output)
    assert parsed and parsed[0]["Line"] == "12"
    assert parsed[0]["Input"] == "/p/main.tex"


# --- the line the stand-in main file inserts ---------------------------------


def _pair(tmp_path, main_text: str, shadow_text: str):
    main = tmp_path / "main.tex"
    shadow = tmp_path / "build" / ".nexttex-main.tex"
    shadow.parent.mkdir(exist_ok=True)
    main.write_text(main_text, encoding="utf-8")
    shadow.write_text(shadow_text, encoding="utf-8")
    return shadow, main


def test_an_inserted_includeonly_is_found_by_comparing_the_two_files(tmp_path):
    from nexttex.synctex import shadow_shift

    shadow, main = _pair(
        tmp_path,
        "\\documentclass{book}\n\\begin{document}\n\\include{ch1}\n\\end{document}\n",
        "\\documentclass{book}\n\\includeonly{ch1}\n\\begin{document}\n\\include{ch1}\n"
        "\\end{document}\n",
    )
    assert shadow_shift(shadow, main) == 2


def test_a_replaced_includeonly_moves_no_line(tmp_path):
    from nexttex.synctex import shadow_shift

    shadow, main = _pair(
        tmp_path,
        "\\documentclass{book}\n\\includeonly{ch1,ch2}\n\\begin{document}\n\\end{document}\n",
        "\\documentclass{book}\n\\includeonly{ch2}\n\\begin{document}\n\\end{document}\n",
    )
    assert shadow_shift(shadow, main) is None


def test_a_shadow_that_no_longer_matches_the_main_file_moves_no_line(tmp_path):
    # The main file was edited since the scoped build; the difference is
    # not the directive, so no line arithmetic is trusted.
    from nexttex.synctex import shadow_shift

    shadow, main = _pair(
        tmp_path,
        "\\documentclass{book}\nA new line.\n\\begin{document}\n\\end{document}\n",
        "\\documentclass{book}\n\\includeonly{ch1}\nOld line.\n\\begin{document}\n\\end{document}\n",
    )
    assert shadow_shift(shadow, main) is None


def test_lines_move_up_past_the_directive_and_not_before_it():
    from nexttex.synctex import to_main_line, to_shadow_line

    assert to_main_line(1, 2) == 1
    assert to_main_line(2, 2) == 1  # the directive itself
    assert to_main_line(3, 2) == 2
    assert to_main_line(40, 2) == 39
    assert to_main_line(40, None) == 40
    assert to_shadow_line(1, 2) == 1
    assert to_shadow_line(2, 2) == 3
    assert to_shadow_line(39, 2) == 40
    assert to_shadow_line(39, None) == 39


def test_pdf_to_source_maps_the_shadow_back_to_the_main_file_one_line_up(
    tmp_path, monkeypatch,
):
    """The inverse search answered the shadow's line number for the main
    file, which is one too high after the inserted directive, so a
    double-click in a chapter-scoped session landed a line below the
    paragraph on every click in main.tex."""
    from nexttex import synctex

    shadow, main = _pair(
        tmp_path,
        "\\documentclass{book}\n\\begin{document}\nA paragraph.\n\\end{document}\n",
        "\\documentclass{book}\n\\includeonly{ch1}\n\\begin{document}\nA paragraph.\n"
        "\\end{document}\n",
    )
    monkeypatch.setattr(
        synctex, "_run",
        lambda args, cwd: (
            "SyncTeX result begin\n"
            f"Output:main.pdf\nInput:{shadow}\nLine:4\nColumn:-1\n"
            "SyncTeX result end\n"
        ),
    )
    found = synctex.pdf_to_source(
        tmp_path / "build" / "main.pdf", 1, 100.0, 100.0, tmp_path,
        shadow_main=shadow, main_file=main,
    )
    assert found is not None
    assert found.file == main
    assert found.line == 3
