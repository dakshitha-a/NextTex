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
