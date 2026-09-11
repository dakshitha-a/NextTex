"""Inserting at the user's cursor.

The cursor is wherever the writer left it, which in a new project is the
last line of the file -- past \\end{document}, where LaTeX typesets nothing.
An insert that lands there looks like it worked: there is a diff, there is a
chip, and the page does not change.
"""

import asyncio
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


def figure_agent(tmp_path):
    """An agent with a real image in its project and a file open."""
    project = tmp_path / "p"
    (project / ".nexttex").mkdir(parents=True)
    (project / "figures").mkdir()
    (project / "figures" / "plot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (project / "main.tex").write_text(DOCUMENT, encoding="utf-8")
    written = {}

    def apply(path: Path, text: str) -> None:
        path.write_text(text, encoding="utf-8")
        written["text"] = text

    agent = ProjectAgent(
        project,
        project / ".nexttex",
        editor_state=lambda: {"file": "main.tex", "line": 4},
        apply_edit=apply,
    )
    return agent, written, project


def test_a_figure_in_the_project_is_inserted(tmp_path):
    agent, written, _ = figure_agent(tmp_path)
    asyncio.run(agent.insert_figure_tool({
        "path": "figures/plot.png", "caption": "A plot", "label": "fig:plot",
    }))
    assert "\\includegraphics[width=0.8\\linewidth]{figures/plot.png}" in written["text"]
    assert "\\caption{A plot}" in written["text"]


def test_a_figure_outside_the_project_is_refused(tmp_path):
    """`(root / path).resolve()` confines nothing: an absolute path replaces
    the root outright.  The tool wrote `\\includegraphics{/etc/passwd}` into
    the document, and LaTeX reads that path at build time."""
    agent, written, _ = figure_agent(tmp_path)
    outside = tmp_path / "elsewhere.png"
    outside.write_bytes(b"\x89PNG\r\n\x1a\n")

    answer = asyncio.run(agent.insert_figure_tool({"path": str(outside)}))
    assert "outside this project" in answer["content"][0]["text"]
    assert "text" not in written


def test_a_figure_reached_by_dots_is_refused_too(tmp_path):
    agent, written, project = figure_agent(tmp_path)
    (tmp_path / "secret.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    answer = asyncio.run(agent.insert_figure_tool({"path": "../secret.png"}))
    assert "outside this project" in answer["content"][0]["text"]
    assert "text" not in written


def test_an_absolute_path_inside_the_project_is_written_relative(tmp_path):
    """A path that only exists on this machine does not travel to Overleaf."""
    agent, written, project = figure_agent(tmp_path)
    inside = project / "figures" / "plot.png"

    asyncio.run(agent.insert_figure_tool({"path": str(inside)}))
    assert "{figures/plot.png}" in written["text"]
    assert str(tmp_path) not in written["text"]


def test_a_figure_whose_name_has_a_space_is_inserted_and_flagged(tmp_path):
    r"""A space compiles to a puzzle rather than to a message.

    `\includegraphics{a b.pdf}` sends TeX looking for `a` and then
    complaining that `b.pdf` has an unknown extension, which names neither
    the file nor the problem. The write is not refused, because the file
    does exist and refusing would be worse than saying so.
    """
    import asyncio

    subject, written = agent(tmp_path, 3)
    (subject.root / "figures").mkdir(exist_ok=True)
    (subject.root / "figures" / "old scan.pdf").write_bytes(b"%PDF-1.4")
    result = asyncio.run(
        subject.insert_figure_tool({"path": "figures/old scan.pdf", "caption": "A scan"})
    )
    said = result["content"][0]["text"]
    assert "space in its name" in said
    assert "old scan.pdf" in written["text"]
