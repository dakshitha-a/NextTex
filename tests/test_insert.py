"""Inserting at the user's cursor.

The cursor is wherever the writer left it, which in a new project is the
last line of the file -- past \\end{document}, where LaTeX typesets nothing.
An insert that lands there looks like it worked: there is a diff, there is a
chip, and the page does not change.
"""

from pathlib import Path

from nexttex.agent import ProjectAgent

DOCUMENT = """\\documentclass{article}
\\begin{document}
\\section{Results}

\\end{document}
"""


def agent(tmp_path, line: int):
    project = tmp_path / "p"
    (project / ".nexttex").mkdir(parents=True)
    (project / "main.tex").write_text(DOCUMENT, encoding="utf-8")
    written = {}

    def apply(path: Path, text: str) -> None:
        path.write_text(text, encoding="utf-8")
        written["text"] = text

    return (
        ProjectAgent(
            project,
            project / ".nexttex",
            editor_state=lambda: {"file": "main.tex", "line": line},
            apply_edit=apply,
        ),
        written,
    )


def test_text_goes_in_at_the_cursor(tmp_path):
    fence, written = agent(tmp_path, line=3)
    fence._insert("New prose.")
    assert written["text"].splitlines()[3] == "New prose."


def test_a_cursor_past_the_end_is_pulled_back_inside(tmp_path):
    fence, written = agent(tmp_path, line=6)
    result = fence._insert("New prose.")
    lines = written["text"].splitlines()
    assert lines.index("New prose.") < lines.index("\\end{document}")
    assert "typeset" in result["content"][0]["text"]


def test_it_says_so_when_no_file_is_open(tmp_path):
    project = tmp_path / "p"
    (project / ".nexttex").mkdir(parents=True)
    fence = ProjectAgent(project, project / ".nexttex", editor_state=lambda: {})
    assert "No file is open" in fence._insert("x")["content"][0]["text"]
