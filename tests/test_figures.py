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


def test_a_caption_is_read_whole_however_long():
    # A caption past twelve hundred characters read as empty.
    long = "The routes to the products, " + "and the levels between them, " * 150 + "end."
    texts = {"main.tex": "\\begin{document}\\begin{figure}\\caption{" + long + "}\\end{figure}\\end{document}"}
    [entry] = figures.listing(texts, "main.tex")
    assert entry["caption"].startswith("The routes to the products, and the levels")


def test_a_caption_reads_as_the_page_sets_it():
    # The writer's own macros written out, maths as its letters and small
    # figures, a texorpdfstring once, and a reference as its number.
    texts = {
        "main.tex": r"""\newcommand{\Sz}{\ensuremath{\mathrm{S_0}}}
\newcommand{\methane}{\ensuremath{\mathrm{CH_4}}}
\begin{document}
\begin{figure}
  \caption{\Sz{}/\Sone{} seam to NH + \methane{} at $6.17 \pm 0.09$~eV, $\omega$B97XD,
  1~cm$^{-1}$, eqn~\eqref{eq:k}, \texorpdfstring{$\mathrm{NH}(X\,^3\Sigma^-)$}{NH}, C--N, {\bf g}.}
\end{figure}
\end{document}""",
    }
    [entry] = figures.listing(texts, "main.tex", {"eq:k": {"number": "3", "page": "1"}})
    assert entry["caption"] == "S₀/Sone seam to NH + CH₄ at 6.17 ± 0.09 eV, ωB97XD, 1 cm⁻¹, eqn (3), NH(X³Σ⁻), C–N, g."


def test_an_input_written_with_a_macro_is_followed():
    texts = {
        "paper.tex": "\\newcommand{\\figdir}{figs}\n\\begin{document}\n\\input{\\figdir/one}\n\\end{document}",
        "figs/one.tex": "\\begin{figure}\\caption{Inside}\\end{figure}",
    }
    [entry] = figures.listing(texts, "paper.tex")
    assert (entry["file"], entry["caption"]) == ("figs/one.tex", "Inside")
