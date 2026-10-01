"""The Sections drawer's Figures list: reading order, numbers, references."""

from nexttex import figures

MAIN = r"""\documentclass{article}
\begin{document}
\begin{figure}
  \includegraphics{figures/a.png}
  \caption{Surfaces of \emph{uracil}, as in~\cite{x}.\label{fig:a}}
\end{figure}
See Figure~\ref{fig:a} and \cref{fig:a,tab:b}.
\input{chapters/two}
% \begin{figure}\caption{Commented out}\end{figure}
\begin{table}
  \caption{Lifetimes}
  \label{tab:c}
  \begin{tabular}{c}x\end{tabular}
\end{table}
\end{document}
"""
TWO = r"""\begin{table*}
  \caption{By solvent}\label{tab:b}
\end{table*}
\begin{figure}
  \begin{subfigure}{0.4\textwidth}\includegraphics{one}\end{subfigure}
  \caption{No label}
\end{figure}
"""


def test_entries_come_in_reading_order_through_inputs_with_their_facts():
    entries = figures.listing({"main.tex": MAIN, "chapters/two.tex": TWO}, "main.tex")
    assert [(e["kind"], e["file"], e["line"]) for e in entries] == [
        ("figure", "main.tex", 3),
        ("table", "chapters/two.tex", 1),
        ("figure", "chapters/two.tex", 4),
        ("table", "main.tex", 10),
    ]
    first = entries[0]
    assert first["caption"] == "Surfaces of uracil, as in."
    assert first["labels"] == ["fig:a"] and first["graphics"] == ["figures/a.png"]
    # Two references to fig:a; one to tab:b; none to tab:c or the unlabelled.
    assert [e["refs"] for e in entries] == [2, 1, 0, 0]
    # A subfigure is part of its figure, not an entry.
    assert entries[2]["labels"] == [] and entries[2]["caption"] == "No label"


def test_numbers_and_pages_come_from_the_last_build():
    numbers = {"fig:a": {"number": "1", "page": "2", "kind": "figure"}}
    entries = figures.listing({"main.tex": MAIN, "chapters/two.tex": TWO}, "main.tex", numbers)
    assert (entries[0]["number"], entries[0]["page"]) == ("1", 2)
    assert (entries[1]["number"], entries[1]["page"]) == (None, None)


def test_resolution_only_where_the_page_holds_one_picture():
    numbers = {"fig:a": {"number": "1", "page": "2", "kind": ""}}
    one = [{"page": "2", "type": "image", "x-ppi": "96", "y-ppi": "100"}]
    entries = figures.listing({"main.tex": MAIN}, "main.tex", numbers, one)
    assert entries[0]["ppi"] == 96 and entries[0]["shared"] is False
    two = one + [{"page": "2", "type": "image", "x-ppi": "300", "y-ppi": "300"}]
    entries = figures.listing({"main.tex": MAIN}, "main.tex", numbers, two)
    assert entries[0]["ppi"] is None and entries[0]["shared"] is True


def test_a_document_that_is_not_there_has_no_entries():
    assert figures.listing({"main.tex": MAIN}, "gone.tex") == []
