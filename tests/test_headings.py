"""The Typeset list: every heading of a document, across its files, in
reading order, with the last build's numbers and pages."""

from nexttex import headings

MAIN = r"""\documentclass{article}
\begin{document}
\section{Introduction}
\input{chapters/methods}
\section*{Acknowledgements}
\input{chapters/results}
% \section{Commented out}
\end{document}
"""
METHODS = r"""\subsection{Which surface carries the NH + CH$_4$ channel?}
\subsubsection{The search on the ground state}
\input{chapters/table}
"""
RESULTS = r"""\section{Results}
\subsection[short]{The triplet is not entered}
"""
TABLE = r"\begin{table}\caption{A table}\end{table}"
TOC = r"""\contentsline {section}{\numberline {1}Introduction}{1}{section.1}%
\contentsline {subsection}{\numberline {1.1}Which surface carries the NH + CH$_4$ channel?}{2}{subsection.1.1}%
\contentsline {subsubsection}{\numberline {1.1.1}The search on the ground state}{2}{subsubsection.1.1.1}%
\contentsline {section}{\numberline {2}Results}{5}{section.2}%
\contentsline {subsection}{\numberline {2.1}The triplet is not entered}{6}{subsection.2.1}%
"""
TEXTS = {"main.tex": MAIN, "chapters/methods.tex": METHODS, "chapters/results.tex": RESULTS, "chapters/table.tex": TABLE}


def test_walks_every_included_file_in_reading_order():
    found = headings.listing(TEXTS, "main.tex")
    assert [(h["title"], h["file"], h["level"]) for h in found] == [
        ("Introduction", "main.tex", 2),
        ("Which surface carries the NH + CH4 channel?", "chapters/methods.tex", 3),
        ("The search on the ground state", "chapters/methods.tex", 4),
        ("Acknowledgements", "main.tex", 2),
        ("Results", "chapters/results.tex", 2),
        ("The triplet is not entered", "chapters/results.tex", 3),
    ]
    assert found[1]["line"] == 1 and found[4]["line"] == 1


def test_takes_numbers_and_pages_from_the_toc_and_skips_starred_headings():
    found = headings.listing(TEXTS, "main.tex", TOC)
    assert [(h["number"], h["page"]) for h in found] == [
        ("1", 1), ("1.1", 2), ("1.1.1", 2), (None, None), ("2", 5), ("2.1", 6),
    ]


def test_answers_before_a_build_and_for_a_document_with_no_headings():
    assert all(h["number"] is None and h["page"] is None for h in headings.listing(TEXTS, "main.tex"))
    assert headings.listing({"main.tex": "\\begin{document}Text.\\end{document}"}, "main.tex") == []


def test_reads_a_toc_line_with_braces_in_its_title():
    lines = headings.contents(r"\contentsline {section}{\numberline {3}The {\em real} case}{12}{section.3}%")
    assert lines == [{"kind": "section", "number": "3", "title": "The real case", "page": "12", "anchor": "section.3"}]


def test_reads_the_contents_lines_from_the_aux_files_in_order(tmp_path):
    # LaTeX writes a .toc only for a document with \tableofcontents; the
    # lines are in the .aux of every build, a chapter's in its own.
    (tmp_path / "chapters").mkdir()
    (tmp_path / "main.aux").write_text(
        "\\relax\n\\@writefile{toc}{\\contentsline {section}{\\numberline {1}One}{1}{section.1}}\n"
        "\\@input{chapters/two.aux}\n"
        "\\@writefile{toc}{\\contentsline {section}{\\numberline {3}Three}{9}{section.3}}\n",
        encoding="utf-8",
    )
    (tmp_path / "chapters" / "two.aux").write_text(
        "\\@writefile{toc}{\\contentsline {section}{\\numberline {2}Two}{4}{section.2}}\n", encoding="utf-8",
    )
    lines = headings.contents(headings.read_toc(tmp_path, "main"))
    assert [(line["number"], line["title"], line["page"]) for line in lines] == [
        ("1", "One", "1"), ("2", "Two", "4"), ("3", "Three", "9"),
    ]
    assert headings.read_toc(tmp_path / "nothing", "main") == ""
