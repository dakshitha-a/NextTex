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
        ("Which surface carries the NH + CH₄ channel?", "chapters/methods.tex", 3),
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


def test_a_starred_heading_with_its_own_contents_line_shifts_nothing():
    # Paired by kind alone, Introduction took Abstract's line and every
    # heading after it the number and page of the one before.
    texts = {"m.tex": "\\begin{document}\n\\section*{Abstract}\\addcontentsline{toc}{section}{Abstract}\n"
             "\\section{Introduction}\n\\section{Methods}\n\\end{document}"}
    toc = (r"\contentsline {section}{Abstract}{1}{section*.1}" "\n"
           r"\contentsline {section}{\numberline {1}Introduction}{2}{section.1}" "\n"
           r"\contentsline {section}{\numberline {2}Methods}{3}{section.2}")
    found = headings.listing(texts, "m.tex", toc)
    assert [(h["title"], h["number"], h["page"]) for h in found] == [
        ("Abstract", None, 1), ("Introduction", "1", 2), ("Methods", "2", 3),
    ]


def test_a_heading_made_by_a_macro_is_listed():
    # A class's back matter, `\rscbackmattersection{Data availability}`.
    texts = {
        "main.tex": "\\usepackage{house}\n\\begin{document}\n\\section{Conclusions}\n"
                    "\\backmatter{Data availability}\n\\end{document}",
        "house.sty": "\\newcommand{\\backmatter}[1]{%\n  \\section*{#1}\\addcontentsline{toc}{section}{#1}}",
    }
    toc = (r"\contentsline {section}{\numberline {1}Conclusions}{4}{section.1}" "\n"
           r"\contentsline {section}{Data availability}{5}{section*.2}")
    found = headings.listing(texts, "main.tex", toc)
    assert [(h["title"], h["line"], h["number"], h["page"]) for h in found] == [
        ("Conclusions", 3, "1", 4), ("Data availability", 4, None, 5),
    ]


def test_a_title_reads_as_the_page_sets_it():
    texts = {"m.tex": "\\begin{document}\n"
             "\\subsection{\\texorpdfstring{Population Dynamics with $\\omega$B97XD.}{Population Dynamics with wB97XD.}}\n"
             "\\section{What this means for the $\\mathrm{NH}(X\\,^3\\Sigma^-)$ signal}\n\\end{document}"}
    assert [h["title"] for h in headings.listing(texts, "m.tex")] == [
        "Population Dynamics with ωB97XD.", "What this means for the NH(X³Σ⁻) signal",
    ]
