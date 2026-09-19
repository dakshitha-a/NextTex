"""Which labels and keys a project defines and uses, by the syntax."""

from nexttex import usage


def test_every_reference_family_counts_as_a_use():
    texts = {"a.tex": "\n".join([
        r"\label{one}\label{two}\label{three}\label{four}\label{five}\label{six}",
        r"\ref{one} \eqref{two} \cref{three,four} \Cref*{five} \autoref{six}",
        r"\label{seven} \pageref{seven} \label{eight} \vref{eight}",
        r"\label{nine} \nameref{nine} \label{ten} \labelcref{ten}",
    ])}
    found = usage.scan(texts)
    assert found.referenced == {"one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"}
    assert not found.unused


def test_a_label_is_not_a_reference_to_itself():
    found = usage.scan({"a.tex": r"\label{alone}"})
    assert "alone" not in found.referenced
    assert list(found.unused) == ["alone"]


def test_optional_arguments_and_comma_lists_in_citations():
    texts = {"a.tex": r"\cite[p.~3]{knuth84, lamport94} \citep{a} \textcite{b} \nocite{c}"}
    assert usage.scan(texts).cited == {"knuth84", "lamport94", "a", "b", "c"}


def test_a_use_or_a_definition_in_a_comment_does_not_count():
    texts = {"a.tex": "\n".join([
        r"\label{real}",
        r"% \label{real} an old copy",
        r"% \ref{real} \cite{ghost}",
        r"text \% \cite{escaped} % \cite{after}",
    ])}
    found = usage.scan(texts)
    assert found.definitions["real"] and len(found.definitions["real"]) == 1
    assert "real" not in found.referenced
    assert found.cited == {"escaped"}


def test_a_duplicate_is_the_second_definition():
    texts = {"a.tex": r"\label{x}", "b.tex": "\n\n" + r"\label{x}"}
    found = usage.scan(texts)
    places = found.duplicates["x"]
    assert [(where.path, where.line) for where in places] == [("a.tex", 1), ("b.tex", 3)]


def test_a_bib_file_is_not_read_for_labels_or_uses():
    texts = {"refs.bib": r"@article{k, note={\cite{k} \label{l}}}"}
    found = usage.scan(texts)
    assert not found.cited and not found.definitions


def test_nocite_star_means_everything_is_cited():
    assert usage.cited_keys({"a.tex": r"\nocite{*}"}) is None
    assert usage.cited_keys({"a.tex": r"\nocite{one}"}) == {"one"}
