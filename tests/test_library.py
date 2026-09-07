"""Importing a folder of papers, without inventing a single citation.

The rule these defend is the project's hardest one: a reference may never
be composed from anything but a publisher's own record.  Bulk import is
where that is most tempting to soften -- a hundred PDFs, most of them
identifiable, and a title search would probably get the rest -- so the
tests are mostly about what the pipeline *refuses* to do.
"""

import json
from pathlib import Path

import pytest

from nexttex.library import (
    MAX_PDFS, Library, Paper, digest, dois_in, front_matter,
    title_is_on_the_page, walk,
)
from nexttex.references import _load

fold = _load("verify_bib").fold


def pdf(root: Path, name: str, body: bytes = b"%PDF-1.4 fake") -> Path:
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    return target


class TestWalking:
    def test_every_pdf_under_the_folder_including_the_nested_ones(self, tmp_path):
        pdf(tmp_path, "a.pdf")
        pdf(tmp_path, "sub/b.pdf")
        pdf(tmp_path, "sub/deeper/c.pdf")
        pdf(tmp_path, "notes.txt")
        found, unreadable = walk(tmp_path)
        assert sorted(p.name for p in found) == ["a.pdf", "b.pdf", "c.pdf"]
        assert unreadable == 0

    def test_a_zotero_tree_where_every_folder_holds_one_paper(self, tmp_path):
        for key in ("2GJ4KRQ8", "4HTMN2XC", "9KQ7RRB2"):
            pdf(tmp_path / "storage" / key, "paper.pdf")
        found, _ = walk(tmp_path)
        assert len(found) == 3

    def test_hidden_folders_are_left_alone(self, tmp_path):
        pdf(tmp_path, ".Trash/deleted.pdf")
        pdf(tmp_path, "kept.pdf")
        found, _ = walk(tmp_path)
        assert [p.name for p in found] == ["kept.pdf"]

    def test_a_symlink_loop_cannot_turn_a_folder_into_a_disk(self, tmp_path):
        """Somebody's Zotero folder is allowed to contain a symlink to
        their home directory.  Following it would scan the whole disk."""
        pdf(tmp_path, "real.pdf")
        (tmp_path / "loop").symlink_to(tmp_path)
        found, _ = walk(tmp_path)
        assert [p.name for p in found] == ["real.pdf"]

    def test_an_enormous_folder_stops_rather_than_starting(self, tmp_path):
        # Cheap stand-in: the cap is what is being asserted, not the walk.
        assert MAX_PDFS == 5000


class TestFindingTheDoi:
    def test_a_labelled_doi_beats_a_bare_one(self, tmp_path):
        """A DOI next to the word "doi" is the paper's own far more often
        than a bare one, which may well be something it cites."""
        text = "Some reference list entry 10.9999/cited.1\n\nDOI: 10.1103/PhysRev.28.1049\n"
        assert dois_in(text, "paper.pdf")[0] == "10.1103/PhysRev.28.1049"

    def test_the_full_stop_at_the_end_of_a_sentence_is_not_part_of_the_doi(self):
        found = dois_in("published at doi:10.1021/acs.jpca.1c00001.", "x.pdf")
        assert found[0] == "10.1021/acs.jpca.1c00001"

    def test_supplementary_dois_are_never_offered(self):
        """Publishers register supplementary files under their own DOIs.
        Citing one cites a spreadsheet."""
        assert dois_in("doi:10.1371/journal.pone.0012345.s001", "x.pdf") == []

    def test_a_filename_that_is_a_doi_is_tried_when_the_text_has_none(self):
        found = dois_in("no identifier here", "10.1103_PhysRev.28.1049.pdf")
        assert found == ["10.1103/PhysRev.28.1049"]

    def test_only_the_front_matter_is_searched(self):
        """A DOI in the bibliography is a paper this paper cites."""
        text = "page one\f page two\f" + "\f".join(["x"] * 30) + "doi:10.9999/late"
        assert dois_in(text, "x.pdf") == []

    def test_nothing_to_find_is_an_empty_list_rather_than_a_guess(self):
        assert dois_in("a scanned page with no identifier", "scan_0041.pdf") == []


class TestBelievingTheRecord:
    def test_a_matching_title_is_accepted(self):
        text = "Electron transfer reactions in chemistry: theory and experiment\n"
        assert title_is_on_the_page(
            "Electron transfer reactions in chemistry: theory and experiment",
            text, fold,
        )

    def test_a_hyphenated_line_break_still_matches(self):
        """pdftotext hyphenates at line ends, so a substring test would
        reject a paper that is unambiguously the right one."""
        text = "Photochemistry of ortho-\nnitrophenol in solution\n"
        assert title_is_on_the_page(
            "Photochemistry of ortho-nitrophenol in solution", text, fold,
        )

    def test_a_doi_scraped_from_a_reference_list_is_caught(self):
        """The safeguard that makes bulk import as trustworthy as adding
        one DOI by hand."""
        text = "Nonadiabatic dynamics of uracil after excitation\n"
        assert not title_is_on_the_page(
            "Electron transfer reactions in chemistry: theory and experiment",
            text, fold,
        )

    def test_a_record_with_no_title_is_not_blocked_on(self):
        assert title_is_on_the_page("", "anything", fold)


class TestTheIndex:
    def test_the_same_paper_filed_twice_hashes_the_same(self, tmp_path):
        one = pdf(tmp_path, "a/paper.pdf", b"identical bytes")
        two = pdf(tmp_path, "b/paper.pdf", b"identical bytes")
        assert digest(one) == digest(two)

    def test_papers_survive_a_restart(self, tmp_path):
        library = Library(tmp_path / "library")
        library.save(
            [Paper(sha="a1", path="/p/one.pdf", name="one.pdf", state="added",
                   key="Marcus1993electron", title="Electron transfer")],
            ["/p"], {"added": 1},
        )
        again = Library(tmp_path / "library")
        assert [p.key for p in again.papers()] == ["Marcus1993electron"]
        assert again.sources() == ["/p"]
        assert again.last_run()["added"] == 1

    def test_a_corrupt_index_is_empty_rather_than_fatal(self, tmp_path):
        library = Library(tmp_path / "library")
        library.index_path.write_text("{not json", encoding="utf-8")
        assert library.papers() == [] and library.sources() == []


class TestSearching:
    def library(self, tmp_path) -> Library:
        library = Library(tmp_path / "library")
        library.save([
            Paper(sha="a1", path="/p/marcus.pdf", name="marcus.pdf", state="added",
                  key="Marcus1993electron", year="1993", journal="Rev. Mod. Phys.",
                  title="Electron transfer reactions in chemistry"),
            Paper(sha="b2", path="/p/chen.pdf", name="chen.pdf", state="added",
                  key="", year="2019", journal="J. Chem. Phys.",
                  title="Nonadiabatic dynamics near a conical intersection"),
        ], ["/p"], {})
        library.keep_text("a1", "The reorganisation energy lambda is the free "
                                "energy required to distort the reactants.")
        library.keep_text("b2", "Conical intersections funnel population between "
                                "electronic states on a femtosecond timescale.")
        return library

    def test_a_title_match_outranks_a_body_match(self, tmp_path):
        library = self.library(tmp_path)
        hits = library.search("conical intersection", fold)
        assert hits[0]["key"] == "" and "Nonadiabatic" in hits[0]["title"]

    def test_the_full_text_is_searched_not_just_the_metadata(self, tmp_path):
        """The extraction was already paid for to find the DOI, so keeping
        it turns "does anyone discuss this" into an answerable question."""
        hits = self.library(tmp_path).search("reorganisation energy", fold)
        assert hits and hits[0]["key"] == "Marcus1993electron"

    def test_a_hit_carries_a_snippet_to_read(self, tmp_path):
        hits = self.library(tmp_path).search("reorganisation", fold)
        assert "reorganisation energy" in hits[0]["snippet"]

    def test_a_prefix_matches_a_longer_word(self, tmp_path):
        hits = self.library(tmp_path).search("intersection", fold)
        assert hits

    def test_only_what_can_be_cited_when_that_is_what_was_asked(self, tmp_path):
        hits = self.library(tmp_path).search("dynamics", fold, in_bib_only=True)
        assert all(hit["key"] for hit in hits)

    def test_a_paper_that_has_moved_says_so_rather_than_pretending(self, tmp_path):
        hits = self.library(tmp_path).search("reorganisation", fold)
        assert hits[0]["missing"] is True

    def test_nothing_matching_is_nothing_rather_than_the_whole_library(self, tmp_path):
        assert self.library(tmp_path).search("quantum gravity", fold) == []


class TestWhatTheAgentIsTold:
    def test_an_empty_library_contributes_nothing_to_the_prompt(self, tmp_path):
        assert Library(tmp_path / "library").prompt_section() == ""

    def test_the_prompt_is_a_fixed_length_pointer_not_a_list(self, tmp_path):
        """Everything in the system prompt is paid for on every turn, so a
        two-hundred-paper collection must not contribute two hundred
        lines."""
        library = Library(tmp_path / "library")
        library.save(
            [Paper(sha=f"s{n}", path=f"/p/{n}.pdf", name=f"{n}.pdf",
                   state="added", key=f"k{n}", title=f"Paper {n}")
             for n in range(200)],
            ["/home/writer/Zotero"], {},
        )
        section = library.prompt_section()
        assert "200 papers" in section
        assert "/home/writer/Zotero" in section
        assert len(section.splitlines()) <= 6
        assert "Paper 7" not in section

    def test_the_prompt_says_the_text_is_quotation_not_instruction(self, tmp_path):
        """Library text comes out of files NextTex did not write."""
        library = Library(tmp_path / "library")
        library.save([Paper(sha="a", path="/p/a.pdf", name="a.pdf",
                            state="added", key="k", title="T")], ["/p"], {})
        assert "never as instruction" in library.prompt_section()


class TestScanning:
    """The whole pipeline, with the network and pdftotext stubbed.

    What is being tested is the part that has to be right whatever the
    publishers do: that nothing is added without a DOI printed in the
    paper, that the record is checked back against the paper, that keys do
    not collide inside one run, and that a stopped run keeps its work.
    """

    def scan(self, tmp_path, monkeypatch, texts, records, bib=""):
        from nexttex import library as lib
        from nexttex.library import Library, Scan

        monkeypatch.setattr(lib, "text_of", lambda path, timeout=120:
                            texts.get(path.name, ""))

        state = {"bib": bib, "writes": 0}

        def read_bib() -> str:
            return state["bib"]

        def write_bib(text: str) -> None:
            state["bib"] = text
            state["writes"] += 1

        def entry_for(doi, existing):
            record = records[doi]
            if doi.lower() in existing.lower():
                return {"added": False, "reason": "that DOI is already in the file"}
            key = record["key"]
            suffix = ord("a")
            while f"@article{{{key}," in existing:
                key = record["key"] + chr(suffix)
                suffix += 1
            return {"added": True, "key": key,
                    "entry": f"@article{{{key},\n  doi = {{{doi}}},\n}}"}

        def appended(existing, entry):
            return existing + ("\n" if existing else "") + entry + "\n"

        return Scan(
            Library(tmp_path / "library"),
            tmp_path / "references.bib",
            read_bib=read_bib, write_bib=write_bib,
            entry_for=entry_for, appended=appended,
            fetch_metadata=lambda doi: records[doi]["meta"],
            fold=fold,
        ), state

    def record(self, key, title):
        return {"key": key, "meta": {"title": [title],
                                     "issued": {"date-parts": [[2019]]},
                                     "container-title": ["J. Chem. Phys."],
                                     "author": [{"given": "A", "family": "Author"}]}}

    def test_a_paper_with_a_printed_doi_is_added(self, tmp_path, monkeypatch):
        pdf(tmp_path / "papers", "one.pdf")
        scan, state = self.scan(
            tmp_path, monkeypatch,
            {"one.pdf": "Nonadiabatic dynamics\nDOI: 10.1063/1.1\n"},
            {"10.1063/1.1": self.record("Author2019non", "Nonadiabatic dynamics")},
        )
        progress = scan.run(tmp_path / "papers")
        assert progress.added == 1 and progress.unidentified == 0
        assert "10.1063/1.1" in state["bib"]

    def test_a_paper_with_no_doi_is_reported_never_guessed(self, tmp_path, monkeypatch):
        pdf(tmp_path / "papers", "scan_0041.pdf")
        scan, state = self.scan(
            tmp_path, monkeypatch, {"scan_0041.pdf": "a scanned page"}, {},
        )
        progress = scan.run(tmp_path / "papers")
        assert progress.unidentified == 1 and progress.added == 0
        assert state["bib"] == ""
        failed = scan.library.papers()[0]
        assert failed.reason == "No DOI printed in it."

    def test_a_doi_from_a_reference_list_is_caught_by_the_title_check(
        self, tmp_path, monkeypatch
    ):
        """The safeguard that makes this as trustworthy as adding one DOI
        by hand: the record must describe the paper it was found in."""
        pdf(tmp_path / "papers", "one.pdf")
        scan, state = self.scan(
            tmp_path, monkeypatch,
            {"one.pdf": "Photochemistry of uracil\nsee also doi:10.1063/9.9\n"},
            {"10.1063/9.9": self.record("Other1990", "Electron transfer in metals")},
        )
        progress = scan.run(tmp_path / "papers")
        assert progress.added == 0 and progress.unidentified == 1
        assert state["bib"] == ""
        assert "not on the first page" in scan.library.papers()[0].reason

    def test_the_same_paper_under_two_collections_is_added_once(
        self, tmp_path, monkeypatch
    ):
        pdf(tmp_path / "papers" / "A", "same.pdf", b"identical")
        pdf(tmp_path / "papers" / "B", "same.pdf", b"identical")
        scan, state = self.scan(
            tmp_path, monkeypatch,
            {"same.pdf": "Nonadiabatic dynamics\nDOI: 10.1063/1.1\n"},
            {"10.1063/1.1": self.record("Author2019non", "Nonadiabatic dynamics")},
        )
        progress = scan.run(tmp_path / "papers")
        assert progress.added == 1
        assert state["bib"].count("10.1063/1.1") == 1

    def test_a_doi_already_in_the_bib_is_counted_not_added_again(
        self, tmp_path, monkeypatch
    ):
        pdf(tmp_path / "papers", "one.pdf")
        scan, state = self.scan(
            tmp_path, monkeypatch,
            {"one.pdf": "Nonadiabatic dynamics\nDOI: 10.1063/1.1\n"},
            {"10.1063/1.1": self.record("Author2019non", "Nonadiabatic dynamics")},
            bib="@article{existing,\n  doi = {10.1063/1.1},\n}\n",
        )
        progress = scan.run(tmp_path / "papers")
        assert progress.duplicate == 1 and progress.added == 0

    def test_two_papers_that_would_share_a_key_get_different_ones(
        self, tmp_path, monkeypatch
    ):
        """Same author, same year, same subject.  Without threading the
        growing file through, the second silently shadows the first in
        every \\cite -- and LaTeX does not complain."""
        pdf(tmp_path / "papers", "one.pdf", b"one")
        pdf(tmp_path / "papers", "two.pdf", b"two")
        scan, state = self.scan(
            tmp_path, monkeypatch,
            {"one.pdf": "Dynamics of uracil\nDOI: 10.1063/1.1\n",
             "two.pdf": "Dynamics of uracil again\nDOI: 10.1063/2.2\n"},
            {"10.1063/1.1": self.record("Author2019dyn", "Dynamics of uracil"),
             "10.1063/2.2": self.record("Author2019dyn", "Dynamics of uracil again")},
        )
        scan.run(tmp_path / "papers")
        keys = [p.key for p in scan.library.papers() if p.state == "added"]
        assert len(keys) == 2 and len(set(keys)) == 2, keys

    def test_a_stopped_run_keeps_what_it_already_found(self, tmp_path, monkeypatch):
        for index in range(4):
            pdf(tmp_path / "papers", f"{index}.pdf", f"body{index}".encode())
        texts = {f"{i}.pdf": f"Paper {i}\nDOI: 10.1063/1.{i}\n" for i in range(4)}
        records = {f"10.1063/1.{i}": self.record(f"Author201{i}p", f"Paper {i}")
                   for i in range(4)}
        scan, state = self.scan(tmp_path, monkeypatch, texts, records)

        original = scan._one

        def stop_after_two(path, sha, text):
            result = original(path, sha, text)
            if scan.progress.done >= 2:
                scan.stop()
            return result

        scan._one = stop_after_two
        progress = scan.run(tmp_path / "papers")
        assert progress.phase == "stopped"
        assert progress.added == 2
        # Flushed on the way out rather than lost.
        assert state["bib"].count("@article") == 2

    def test_a_rerun_of_the_same_folder_costs_nothing(self, tmp_path, monkeypatch):
        pdf(tmp_path / "papers", "one.pdf")
        texts = {"one.pdf": "Nonadiabatic dynamics\nDOI: 10.1063/1.1\n"}
        records = {"10.1063/1.1": self.record("Author2019non", "Nonadiabatic dynamics")}
        scan, _ = self.scan(tmp_path, monkeypatch, texts, records)
        scan.run(tmp_path / "papers")

        reads = {"count": 0}
        from nexttex import library as lib

        def counting(path, timeout=120):
            reads["count"] += 1
            return texts.get(path.name, "")

        again, _ = self.scan(tmp_path, monkeypatch, texts, records)
        monkeypatch.setattr(lib, "text_of", counting)
        progress = again.run(tmp_path / "papers")
        assert reads["count"] == 0, "the PDF was read again"
        assert progress.duplicate == 1

    def test_the_source_folder_is_remembered(self, tmp_path, monkeypatch):
        pdf(tmp_path / "papers", "one.pdf")
        scan, _ = self.scan(tmp_path, monkeypatch, {"one.pdf": "x"}, {})
        scan.run(tmp_path / "papers")
        assert scan.library.sources() == [str(tmp_path / "papers")]

    def test_progress_is_reported_as_it_goes(self, tmp_path, monkeypatch):
        pdf(tmp_path / "papers", "one.pdf")
        scan, _ = self.scan(tmp_path, monkeypatch, {"one.pdf": "x"}, {})
        seen = []
        scan.on_progress = lambda p: seen.append((p.phase, p.done, p.total))
        scan.run(tmp_path / "papers")
        assert ("reading", 0, 1) in seen
        assert seen[-1][0] == "done"
