"""The consistency checks: a row only where two forms coexist."""

from nexttex import consistency
from nexttex.prose import mask


def doc(body: str) -> str:
    return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n"


def kinds(rows):
    return [(row["kind"], row["line"]) for row in rows]


def test_the_mask_keeps_prose_and_its_lines():
    text = doc("We ran it~\\cite{lee} on $x$ % data set\nand \\emph{data set} \\label{s:a}.")
    masked = mask(text)
    assert len(masked) == len(text) and masked.count("\n") == text.count("\n")
    assert "We ran it" in masked and "data set" in masked.split("\n")[3]
    assert "lee" not in masked and "s:a" not in masked and "x" not in masked.split("\n")[2]
    assert "documentclass" not in masked


def test_a_compound_written_two_ways_is_a_row_on_each_and_names_the_other():
    texts = {"a.tex": doc("The data set is here."), "b.tex": "The dataset is there.\n"}
    here = consistency.check(texts, "a.tex")
    assert kinds(here) == [("compound", 3)]
    assert here[0]["message"] == '"data set" here, "dataset" once elsewhere'
    assert here[0]["other"] == {"file": "b.tex", "line": 1}
    there = consistency.check(texts, "b.tex")
    assert there[0]["other"] == {"file": "a.tex", "line": 3}


def test_one_form_throughout_is_quiet():
    assert consistency.check({"a.tex": doc("The data set. The data set again.")}, "a.tex") == []
    assert consistency.check({"a.tex": doc("The dataset. The dataset again.")}, "a.tex") == []


def test_a_phrase_that_is_also_a_word_is_left_alone():
    # "in to" and "into", "may be" and "maybe": both are right where they are.
    assert consistency.check({"a.tex": doc("Give in to it. Go into it. It may be so; maybe.")}, "a.tex") == []


def test_comments_maths_and_commands_are_not_prose():
    text = doc("The data set. % the dataset\n$\\mathrm{dataset}$ \\label{dataset}")
    assert consistency.check({"a.tex": text}, "a.tex") == []


def test_an_abbreviation_beside_its_full_form_mid_sentence():
    text = doc("As in Fig.~\\ref{a}, it rises; as in Figure~\\ref{b}, it falls.")
    rows = consistency.check({"a.tex": text}, "a.tex")
    assert [row["message"] for row in rows] == [
        '"Fig." here, "Figure" once elsewhere mid-sentence',
        '"Figure" here, "Fig." once elsewhere mid-sentence',
    ]


def test_only_the_less_common_form_is_marked():
    # Three "Eq." and one "Equation": the one is the inconsistency, and the
    # three are the writer's convention.
    text = doc("As in Eq.~1, then Eq.~2; as in Eq.~3, and as in Equation~4, so.")
    rows = consistency.check({"a.tex": text}, "a.tex")
    assert [row["message"] for row in rows] == ['"Equation" here, "Eq." 3 times elsewhere mid-sentence']
    assert rows[0]["other"] == {"file": "a.tex", "line": 3}


def test_the_full_form_at_a_sentence_s_start_is_the_style_and_not_counted():
    text = doc("As in Fig.~\\ref{a}, it rises. Figure~\\ref{b} shows the fall. Eq.~(1) and Eqs.~(2).")
    assert consistency.check({"a.tex": text}, "a.tex") == []


def test_us_and_uk_spelling_of_one_word_but_not_of_two():
    assert kinds(consistency.check({"a.tex": doc("The colour. The color.")}, "a.tex")) == [
        ("spelling-variant", 3), ("spelling-variant", 3),
    ]
    # Oxford spelling: British colour, -ize endings. Each word is its own
    # question, and none of them is mixed.
    assert consistency.check({"a.tex": doc("The colour of the organized behaviour.")}, "a.tex") == []


def test_an_acronym_defined_and_never_used():
    rows = consistency.check({"a.tex": doc("We use surface hopping (SH) here.")}, "a.tex")
    assert [row["message"] for row in rows] == ["SH is defined here and never used again"]
    used = doc("We use surface hopping (SH) here. SH works.")
    assert consistency.check({"a.tex": used}, "a.tex") == []


def test_an_acronym_defined_as_a_plural_is_used_in_the_singular():
    text = doc("Conical intersections (CIs) matter; one CI is enough.")
    assert consistency.check({"a.tex": text}, "a.tex") == []


def test_an_undefined_acronym_only_where_the_document_defines_most_of_its_others():
    defined = doc("Density functional theory (DFT) and DFT again, coupled cluster (CC) and CC, and CASSCF and NMR.")
    rows = consistency.check({"a.tex": defined}, "a.tex")
    assert [row["message"] for row in rows] == ["CASSCF is used here without being defined"]
    # A document that defines none of its acronyms is not asked to, nor
    # one that defines a few and names its methods by acronym throughout.
    assert consistency.check({"a.tex": doc("CASSCF and CASPT2 throughout.")}, "a.tex") == []
    few = doc("Density functional theory (DFT), DFT, CASSCF, CASPT2, NEVPT2, ORCA.")
    assert consistency.check({"a.tex": few}, "a.tex") == []


def test_only_the_file_asked_about_gets_rows():
    texts = {"a.tex": doc("The data set."), "b.tex": "The dataset.\n", "c.tex": "Nothing.\n"}
    assert consistency.check(texts, "c.tex") == []
    assert consistency.check(texts, "notes.md") == []
