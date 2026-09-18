r"""What every label's number is, read from the build's `.aux` files.

The fixtures are copied from a real pdflatex build on this machine of a
main file with a figure, an equation and a section, under hyperref and
cleveref, and an `\include`d chapter with a table and a subsection.  Not
typed: the shapes are the ones the packages write.
"""

from pathlib import Path

from nexttex import auxlabels

MAIN_AUX = r"""\relax
\providecommand\hyper@newdestlabel[2]{}
\providecommand\HyField@AuxAddToFields[1]{}
\providecommand\HyField@AuxAddToCoFields[2]{}
\@writefile{lof}{\contentsline {figure}{\numberline {1}{\ignorespaces A box}}{1}{figure.1}\protected@file@percent }
\newlabel{fig:one}{{1}{1}{A box}{figure.1}{}}
\newlabel{fig:one@cref}{{[figure][1][]1}{[1][1][]1}{}{}{}}
\@writefile{toc}{\contentsline {section}{\numberline {1}Intro}{1}{section.1}\protected@file@percent }
\newlabel{sec:intro}{{1}{1}{Intro}{section.1}{}}
\newlabel{sec:intro@cref}{{[section][1][]1}{[1][1][]1}{}{}{}}
\newlabel{eq:main}{{1}{1}{Intro}{equation.1}{}}
\newlabel{eq:main@cref}{{[equation][1][]1}{[1][1][]1}{}{}{}}
\@input{chapters/two.aux}
\gdef \@abspage@last{2}
"""

CHAPTER_AUX = r"""\relax
\providecommand\hyper@newdestlabel[2]{}
\@writefile{lot}{\contentsline {table}{\numberline {1}{\ignorespaces T}}{2}{table.1}\protected@file@percent }
\newlabel{tab:t}{{1}{2}{T}{table.1}{}}
\newlabel{tab:t@cref}{{[table][1][]1}{[1][2][]2}{}{}{}}
\@writefile{toc}{\contentsline {section}{\numberline {2}Two}{2}{section.2}\protected@file@percent }
\newlabel{sec:two}{{2}{2}{Two}{section.2}{}}
\newlabel{sec:two@cref}{{[section][2][]2}{[1][2][]2}{}{}{}}
\@writefile{toc}{\contentsline {subsection}{\numberline {2.1}Sub}{2}{subsection.2.1}\protected@file@percent }
\newlabel{sec:two:sub}{{2.1}{2}{Sub}{subsection.2.1}{}}
\newlabel{sec:two:sub@cref}{{[subsection][1][2]2.1}{[1][2][]2}{}{}{}}
\@setckpt{chapters/two}{
\setcounter{page}{3}
\setcounter{section}{2}
}
"""


def test_every_label_gets_its_number_page_and_kind_and_cref_entries_are_skipped():
    found = auxlabels.parse(MAIN_AUX)
    assert found == {
        "fig:one": {"number": "1", "page": "1", "kind": "figure"},
        "sec:intro": {"number": "1", "page": "1", "kind": "section"},
        "eq:main": {"number": "1", "page": "1", "kind": "equation"},
    }


def test_a_label_without_hyperref_has_a_number_and_a_page_and_no_kind():
    assert auxlabels.parse(r"\newlabel{x}{{2}{5}}") == {
        "x": {"number": "2", "page": "5", "kind": ""}
    }


def test_texs_own_noise_is_stripped_and_a_braced_caption_does_not_confuse_the_count():
    found = auxlabels.parse(
        r"\newlabel{y}{{\relax 3.2}{7}{A \emph{nice} caption}{subsection.3.2}{}}"
    )
    assert found["y"] == {"number": "3.2", "page": "7", "kind": "subsection"}


def test_an_included_chapters_aux_is_followed_from_the_main_one(tmp_path):
    build = tmp_path / "build"
    (build / "chapters").mkdir(parents=True)
    (build / "main.aux").write_text(MAIN_AUX, encoding="utf-8")
    (build / "chapters" / "two.aux").write_text(CHAPTER_AUX, encoding="utf-8")
    found = auxlabels.read(build, "main")
    assert found["tab:t"] == {"number": "1", "page": "2", "kind": "table"}
    assert found["sec:two:sub"] == {"number": "2.1", "page": "2", "kind": "subsection"}
    assert "fig:one" in found and "fig:one@cref" not in found


def test_a_build_that_has_not_happened_answers_nothing(tmp_path):
    assert auxlabels.read(tmp_path / "build", "main") == {}


def test_an_input_that_points_outside_the_build_directory_is_not_read(tmp_path):
    build = tmp_path / "build"
    build.mkdir()
    (tmp_path / "secret.aux").write_text(r"\newlabel{leak}{{1}{1}}", encoding="utf-8")
    (build / "main.aux").write_text(r"\@input{../secret.aux}", encoding="utf-8")
    assert auxlabels.read(build, "main") == {}


def test_a_loop_of_inputs_ends(tmp_path):
    build = tmp_path / "build"
    build.mkdir()
    (build / "main.aux").write_text(r"\@input{main.aux}" + "\n" + r"\newlabel{a}{{1}{1}}", encoding="utf-8")
    assert auxlabels.read(build, "main") == {"a": {"number": "1", "page": "1", "kind": ""}}


def test_the_hover_words_for_each_kind():
    assert auxlabels.describe("3", "figure") == "Figure 3"
    assert auxlabels.describe("2.1", "subsection") == "Section 2.1"
    assert auxlabels.describe("4", "AMS") == "Equation 4"
    assert auxlabels.describe("7", "mystery") == "7"
