r"""Renaming a label, a citation key or a macro knows the syntax."""

import pytest

from nexttex.rename import references_to, rename, valid

MAIN = "\n".join([
    r"\section{Intro}\label{fig:a}",
    r"See \ref{fig:a} and \cref{fig:a,fig:ab} and \autoref{fig:ab}.",
    r"Also \eqref{fig:a}. % but not \ref{fig:a} here",
    r"\cite{knuth,lamport} and \citep[p. 3]{knuth} and \parencite{knuthx}.",
    r"\newcommand{\vec}{\mathbf} then $\vec{x}$ and \vector{y}.",
    r"% \vec{z} in a comment",
])
BIB = "\n".join([
    "@book{knuth,",
    "  title = {The TeXbook},",
    "}",
    "@article{knuthx, title = {Not this}}",
])
TEXTS = {"main.tex": MAIN, "refs.bib": BIB}


def places(kind: str, name: str):
    return [(h.path, h.line, h.column, h.commented) for h in references_to(TEXTS, kind, name)]


def test_a_label_is_found_in_its_definition_and_every_reference_family_but_not_in_a_longer_name():
    assert places("label", "fig:a") == [
        ("main.tex", 1, 23, False),
        ("main.tex", 2, 10, False),
        ("main.tex", 2, 27, False),
        ("main.tex", 3, 13, False),
        ("main.tex", 3, 36, True),
    ]
    assert places("label", "fig:ab") == [("main.tex", 2, 33, False), ("main.tex", 2, 54, False)]


def test_a_citation_key_is_found_in_the_bib_and_in_every_cite_command_with_its_options():
    assert places("cite", "knuth") == [
        ("main.tex", 4, 7, False),
        ("main.tex", 4, 39, False),
        ("refs.bib", 1, 7, False),
    ]


def test_a_macro_is_found_at_its_definition_and_its_uses_but_not_as_the_head_of_a_longer_one():
    assert places("macro", "vec") == [
        ("main.tex", 5, 14, False),
        ("main.tex", 5, 35, False),
        ("main.tex", 6, 4, True),
    ]


def test_renaming_a_label_leaves_the_longer_name_and_the_comment_alone():
    changed = rename(TEXTS, "label", "fig:a", "fig:overview")
    assert list(changed) == ["main.tex"]
    lines = changed["main.tex"].split("\n")
    assert lines[0] == r"\section{Intro}\label{fig:overview}"
    assert lines[1] == r"See \ref{fig:overview} and \cref{fig:overview,fig:ab} and \autoref{fig:ab}."
    assert lines[2] == r"Also \eqref{fig:overview}. % but not \ref{fig:a} here"


def test_the_comment_is_rewritten_only_when_asked():
    changed = rename(TEXTS, "label", "fig:a", "fig:overview", comments=True)
    assert changed["main.tex"].split("\n")[2] == r"Also \eqref{fig:overview}. % but not \ref{fig:overview} here"


def test_renaming_a_citation_key_reaches_the_bib_and_not_the_key_that_shares_its_prefix():
    changed = rename(TEXTS, "cite", "knuth", "knuth1984")
    assert changed["refs.bib"].split("\n")[0] == "@book{knuth1984,"
    assert "knuthx" in changed["refs.bib"]
    line = changed["main.tex"].split("\n")[3]
    assert line == r"\cite{knuth1984,lamport} and \citep[p. 3]{knuth1984} and \parencite{knuthx}."


def test_renaming_a_macro_keeps_the_backslash_and_the_longer_macro():
    changed = rename(TEXTS, "macro", "vec", "vect")
    line = changed["main.tex"].split("\n")[4]
    assert line == r"\newcommand{\vect}{\mathbf} then $\vect{x}$ and \vector{y}."


def test_a_name_with_regex_characters_is_taken_literally():
    texts = {"a.tex": r"\ref{eq:a.b} \ref{eq:axb} \label{eq:a.b}"}
    assert [h.column for h in references_to(texts, "label", "eq:a.b")] == [6, 34]
    assert rename(texts, "label", "eq:a.b", "eq:c")["a.tex"] == r"\ref{eq:c} \ref{eq:axb} \label{eq:c}"


def test_nothing_changes_when_the_name_is_not_there():
    assert rename(TEXTS, "label", "fig:nope", "x") == {}
    assert references_to(TEXTS, "cite", "nobody") == []


@pytest.mark.parametrize("kind,name,ok", [
    ("label", "fig:a", True),
    ("label", "a{b", False),
    ("label", "a,b", False),
    ("label", "", False),
    ("label", "x" * 121, False),
    ("cite", "knuth1984", True),
    ("macro", "vec", True),
    ("macro", "vec2", False),
    ("macro", "\\vec", False),
    ("nope", "x", False),
])
def test_what_counts_as_a_name(kind, name, ok):
    assert valid(kind, name) is ok
