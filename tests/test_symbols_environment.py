"""The scan says which environment a label sits in, and what it holds.

A reference card draws the figure, the table or the equation a
`\\ref` points at, so each label the scan finds carries its innermost
figure, table or maths environment and the parts of it the card needs.
"""

from nexttex.symbols import environment_facts, environment_index

FIGURE = (
    "\\begin{document}\n"
    "\\begin{figure}[t]\n  \\centering\n"
    "  \\includegraphics[width=\\linewidth]{figures/decay.pdf}\n"
    "  \\caption[Short]{The decay of the signal, with error bars.}\n"
    "  \\label{fig:decay}\n"
    "\\end{figure}\n"
    "\\end{document}\n"
)


def position_of(text: str, label: str) -> int:
    return text.index("\\label{" + label + "}")


def test_the_index_lists_balanced_environments_innermost_last():
    index = environment_index(FIGURE)
    names = [entry["name"] for entry in index]
    assert names == ["document", "figure"]
    figure = index[1]
    assert FIGURE[figure["start"]:].startswith("\\begin{figure}")
    assert FIGURE[figure["inner_end"]:].startswith("\\end{figure}")


def test_a_figure_label_carries_its_graphic_and_caption():
    facts = environment_facts(FIGURE, position_of(FIGURE, "fig:decay"))
    assert facts["env"] == "figure"
    assert facts["graphic"] == "figures/decay.pdf"
    assert facts["caption"] == "The decay of the signal, with error bars."
    assert "body" not in facts


def test_a_table_label_carries_its_caption_and_its_tabular():
    text = (
        "\\begin{table}\n\\caption{Rates}\n\\label{tab:rates}\n"
        "\\begin{tabular}{lr}\\toprule a & 1 \\\\ b & 2 \\\\ \\bottomrule\\end{tabular}\n"
        "\\end{table}\n"
    )
    facts = environment_facts(text, position_of(text, "tab:rates"))
    assert facts["env"] == "table"
    assert facts["caption"] == "Rates"
    assert facts["body"].startswith("\\begin{tabular}{lr}")
    assert facts["body"].endswith("\\end{tabular}")
    assert "bodyCut" not in facts


def test_a_maths_label_carries_the_environment_body():
    text = "\\begin{align*}\n  a &= b \\\\\n  c &= d \\label{eq:cd}\n\\end{align*}\n"
    facts = environment_facts(text, position_of(text, "eq:cd"))
    assert facts["env"] == "align*"
    assert facts["body"] == "a &= b \\\\\n  c &= d \\label{eq:cd}"


def test_a_subfigure_is_the_innermost_environment():
    text = (
        "\\begin{figure}\\caption{Both}\\label{fig:both}\n"
        "\\begin{subfigure}{.5\\linewidth}\\includegraphics{a.png}\\caption{A}\\label{fig:a}\\end{subfigure}\n"
        "\\end{figure}\n"
    )
    inner = environment_facts(text, position_of(text, "fig:a"))
    assert inner["env"] == "subfigure" and inner["graphic"] == "a.png" and inner["caption"] == "A"
    outer = environment_facts(text, position_of(text, "fig:both"))
    assert outer["env"] == "figure" and outer["caption"] == "Both"
    # The outer figure's first graphic is the subfigure's.
    assert outer["graphic"] == "a.png"


def test_a_label_inside_the_caption_is_in_the_figure():
    text = "\\begin{figure}\\includegraphics{b.png}\\caption{B\\label{fig:b}}\\end{figure}\n"
    facts = environment_facts(text, position_of(text, "fig:b"))
    assert facts["env"] == "figure" and facts["graphic"] == "b.png"
    assert facts["caption"] == "B\\label{fig:b}"


def test_a_section_label_has_no_environment():
    text = "\\section{Intro}\\label{sec:intro}\n\\begin{figure}\\label{fig:x}\\end{figure}\n"
    assert environment_facts(text, position_of(text, "sec:intro")) == {}


def test_an_unmatched_begin_indexes_what_it_can():
    text = "\\begin{figure}\\begin{center}\\label{fig:open}\n\\end{figure}\n"
    facts = environment_facts(text, position_of(text, "fig:open"))
    assert facts["env"] == "figure"
    assert environment_facts("\\end{figure}\\label{x}", 0) == {}


def test_a_long_body_is_cut_and_says_so():
    rows = "".join(f"r{i} & {i} \\\\\n" for i in range(600))
    text = "\\begin{table}\\label{tab:big}\\begin{tabular}{lr}" + rows + "\\end{tabular}\\end{table}"
    facts = environment_facts(text, position_of(text, "tab:big"))
    assert facts["bodyCut"] is True
    assert len(facts["body"]) == 4000
