"""Which documents a file belongs to.

The point of this module is to stop a save rebuilding documents that have
never heard of the saved file, so most of these tests are about the negative
case: what should *not* be attributed to a document.
"""

import pytest

from pathlib import Path

from nexttex.deps import DependencyGraph, is_standalone, references, resolve


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class TestReferences:
    def test_include_and_input(self):
        found = references(r"\include{chapters/one}" "\n" r"\input{preamble}")
        assert ("inc", "chapters/one") in found
        assert ("inc", "preamble") in found

    def test_input_without_braces(self):
        # Legal, and common in older preambles.
        assert ("inc", "settings.tex") in references(r"\input settings.tex")

    def test_subfile_and_includestandalone(self):
        found = references(r"\subfile{ch1}" "\n" r"\includestandalone{figures/plot}")
        assert ("inc", "ch1") in found
        assert ("inc", "figures/plot") in found

    def test_import_joins_its_two_arguments(self):
        assert ("imp", "parts/intro") in references(r"\import{parts/}{intro}")

    def test_bibliography_takes_a_list(self):
        found = references(r"\bibliography{refs,extra}")
        assert ("bib", "refs") in found and ("bib", "extra") in found

    def test_graphics_with_an_optional_argument(self):
        found = references(r"\includegraphics[width=0.8\textwidth]{figures/pes}")
        assert ("gfx", "figures/pes") in found

    def test_a_commented_line_names_nothing(self):
        assert references(r"% \include{chapters/old}") == []

    def test_packages_are_not_dependencies(self):
        # They resolve into the TeX tree, not into the project.
        assert references(r"\usepackage{amsmath}") == []


class TestResolve:
    def test_relative_to_the_including_file_first(self, tmp_path):
        write(tmp_path, "parts/ch1.tex", "")
        source = write(tmp_path, "parts/main.tex", "")
        assert resolve(tmp_path, source, "inc", "ch1") == (tmp_path / "parts/ch1.tex").resolve()

    def test_then_relative_to_the_project_root(self, tmp_path):
        write(tmp_path, "shared.tex", "")
        source = write(tmp_path, "parts/main.tex", "")
        assert resolve(tmp_path, source, "inc", "shared") == (tmp_path / "shared.tex").resolve()

    def test_a_reference_that_leaves_the_project_is_dropped(self, tmp_path):
        source = write(tmp_path, "main.tex", "")
        assert resolve(tmp_path, source, "inc", "../outside") is None

    def test_a_reference_to_nothing_is_dropped(self, tmp_path):
        source = write(tmp_path, "main.tex", "")
        assert resolve(tmp_path, source, "inc", "nosuchfile") is None


class TestStandalone:
    def test_both_markers_are_needed(self):
        assert is_standalone("\\documentclass{article}\n\\begin{document}\nx\n")
        # A figure written for the standalone class is a document by the
        # letter of it and never one anybody wants a preview tab for.
        assert not is_standalone("\\documentclass{standalone}\n")
        assert not is_standalone("\\begin{document}\n")


class TestOwners:
    def build(self, tmp_path):
        write(tmp_path, "main.tex", "\\documentclass{report}\n\\begin{document}\n"
              "\\include{chapters/one}\n\\bibliography{refs}\n\\end{document}\n")
        write(tmp_path, "chapters/one.tex", "A chapter.\n")
        write(tmp_path, "refs.bib", "")
        write(tmp_path, "esi.tex", "\\documentclass{article}\n\\begin{document}\n"
              "\\input{shared}\n\\end{document}\n")
        write(tmp_path, "shared.tex", "Shared prose.\n")
        return DependencyGraph(tmp_path), ["main.tex", "esi.tex"]

    def test_a_chapter_belongs_to_the_document_that_includes_it(self, tmp_path):
        graph, docs = self.build(tmp_path)
        assert graph.owners("chapters/one.tex", docs) == ["main.tex"]

    def test_a_standalone_belongs_only_to_itself(self, tmp_path):
        graph, docs = self.build(tmp_path)
        assert graph.owners("esi.tex", docs) == ["esi.tex"]

    def test_a_file_two_documents_read_belongs_to_both(self, tmp_path):
        graph, docs = self.build(tmp_path)
        write(tmp_path, "main.tex", "\\documentclass{report}\n\\begin{document}\n"
              "\\input{shared}\n\\end{document}\n")
        graph.invalidate()
        assert graph.owners("shared.tex", docs) == ["main.tex", "esi.tex"]

    def test_a_bibliography_belongs_to_the_document_that_names_it(self, tmp_path):
        graph, docs = self.build(tmp_path)
        assert graph.owners("refs.bib", docs) == ["main.tex"]

    def test_an_unknown_tex_file_goes_to_the_first_document_only(self, tmp_path):
        # The usual unknown is a file just created and not yet \input
        # anywhere.  Rebuilding everything for it would be a regression for
        # the commonest case there is.
        graph, docs = self.build(tmp_path)
        write(tmp_path, "scratch.tex", "notes\n")
        assert graph.owners("scratch.tex", docs) == ["main.tex"]

    def test_an_unknown_asset_goes_to_every_document(self, tmp_path):
        # Under-attributing an asset leaves a preview that silently stops
        # updating, which is worse than a background build nobody waits on.
        graph, docs = self.build(tmp_path)
        write(tmp_path, "house.sty", "")
        assert graph.owners("house.sty", docs) == ["main.tex", "esi.tex"]


class TestCacheAndDiscovery:
    def test_an_edit_is_noticed(self, tmp_path):
        write(tmp_path, "main.tex", "\\documentclass{report}\n\\begin{document}\n\\end{document}\n")
        write(tmp_path, "later.tex", "x\n")
        graph = DependencyGraph(tmp_path)
        docs = ["main.tex"]
        assert graph.owners("later.tex", docs) == ["main.tex"]   # by the fallback
        write(tmp_path, "main.tex", "\\documentclass{report}\n\\begin{document}\n"
              "\\input{later}\n\\end{document}\n")
        graph.note_changed("main.tex")
        assert "later.tex" in graph.reachable(docs)              # now by the graph

    def test_a_cycle_does_not_hang(self, tmp_path):
        write(tmp_path, "a.tex", "\\input{b}\n")
        write(tmp_path, "b.tex", "\\input{a}\n")
        graph = DependencyGraph(tmp_path)
        assert graph.reachable(["a.tex"]) == {"a.tex", "b.tex"}

    def test_the_reverse_map_names_every_reader(self, tmp_path):
        write(tmp_path, "main.tex", "\\input{shared}\n")
        write(tmp_path, "esi.tex", "\\input{shared}\n")
        write(tmp_path, "shared.tex", "x\n")
        graph = DependencyGraph(tmp_path)
        assert graph.reverse(["main.tex", "esi.tex"])["shared.tex"] == ["main.tex", "esi.tex"]

    def test_a_file_something_already_reads_is_not_offered_as_a_document(self, tmp_path):
        # A subfiles chapter carries \documentclass and \begin{document} and
        # is still not a document anybody wants a preview tab for.
        write(tmp_path, "main.tex", "\\documentclass{book}\n\\begin{document}\n"
              "\\subfile{ch1}\n\\end{document}\n")
        write(tmp_path, "ch1.tex", "\\documentclass[../main]{subfiles}\n"
              "\\begin{document}\nA chapter.\n\\end{document}\n")
        write(tmp_path, "esi.tex", "\\documentclass{article}\n\\begin{document}\n"
              "Supplementary.\n\\end{document}\n")
        graph = DependencyGraph(tmp_path)
        assert graph.standalone_candidates(["main.tex"]) == ["esi.tex"]


def test_our_own_stand_in_is_never_offered_as_a_document(tmp_path):
    """Caught against a real dissertation.

    NextTex writes `.nexttex-preview-<name>.tex` beside the main file when
    it builds part of a document.  It is a copy of main.tex, so it has a
    documentclass and a begin{document} and nothing reads it -- which is
    exactly the shape of a document worth previewing, and it was being
    offered as one.
    """
    write(tmp_path, "main.tex", "\\documentclass{report}\n\\begin{document}\nx\n\\end{document}\n")
    write(tmp_path, ".nexttex-preview-main.tex",
          "\\documentclass{report}\n\\includeonly{a}\n\\begin{document}\nx\n\\end{document}\n")
    write(tmp_path, ".hidden/scratch.tex",
          "\\documentclass{article}\n\\begin{document}\ny\n\\end{document}\n")
    graph = DependencyGraph(tmp_path)
    assert graph.standalone_candidates(["main.tex"]) == []


ESCAPED_PERCENT = [
    # `\%` prints a percent sign; the line goes on. `^[^%\n]*` read it as a
    # comment, so every command after it on that line vanished from the
    # dependency scan and from the chapter scoping: a chapter silently
    # stopped being rebuilt because its parent line gained a percentage.
    (r"We recovered 95\% of it. \input{chapters/one}", True),
    (r"Yield was 40\%, see \include{results}", True),
    (r"A backslash then a percent: \\\% \input{x}", True),
    # A real comment still hides what follows it.
    (r"% \input{chapters/one}", False),
    (r"text before % \input{x}", False),
    # And a comment after the command hides nothing before it.
    (r"\input{chapters/one} % the first chapter", True),
]


@pytest.mark.parametrize("line,reachable", ESCAPED_PERCENT)
def test_a_printed_percent_does_not_hide_the_rest_of_the_line(line, reachable):
    # Through `references` rather than the patterns, because the comment
    # guard is no longer in the patterns: they are plain scanners, and the
    # prefix of the line is checked per hit.
    found = bool(references(line))
    assert found is reachable, f"{line!r} was read as {'reachable' if found else 'commented out'}"


@pytest.mark.parametrize("line,reachable", ESCAPED_PERCENT)
def test_the_chapter_scan_reads_the_same_lines_the_same_way(line, reachable):
    """`compile.py` had its own copy of the guard, and the two must agree:
    one decides what a build depends on and the other decides which chapter
    a fast build is scoped to."""
    from nexttex.compile import included_targets, supports_partial

    if "\\include{" not in line:
        return
    assert supports_partial(line) is reachable
    assert bool(included_targets(line)) is reachable


def test_two_commands_on_one_line_are_both_found():
    # The line-anchored guard could match once per line, so the second of
    # two \include commands on a line was invisible to the dependency scan
    # and the fast build was scoped to a chapter that was not the one being
    # edited. The prefix check has no such limit.
    from nexttex.compile import included_targets

    line = r"\include{one} \include{two}"
    assert [ref for _, ref in references(line)] == ["one", "two"]
    assert included_targets(line) == ["one", "two"]
    # And a comment between them hides only the second.
    assert included_targets(r"\include{one} % \include{two}") == ["one"]
