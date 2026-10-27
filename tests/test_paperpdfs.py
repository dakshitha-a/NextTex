"""A citation finds its paper's PDF by evidence, and never by a guess.

The writer asked for a citation's hover card and its entry in the typeset
bibliography to open the paper, without a folder name fixed in advance and
without the project being walked on a timer. `nexttex/paperpdfs.py` says
how: a link the writer already made, then the file name, then the DOI on
the PDF's first pages. Step 3's reading is stubbed here, so none of this
needs pdftotext.
"""

from pathlib import Path

from nexttex.library import Paper
from nexttex.paperpdfs import PaperPdfs, allowed_outside, attached_paths, bib_entries, normal_doi


def pdf(path: Path, body: bytes = b"%PDF-1.4\n%%EOF\n") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def index(root: Path, state: Path) -> PaperPdfs:
    found = PaperPdfs(root, state)
    found.seed(_tree(root, root))
    return found


def _tree(root: Path, here: Path) -> dict:
    children = []
    for item in sorted(here.iterdir()):
        if item.is_dir():
            children.append({"type": "dir", "path": item.relative_to(root).as_posix(), "children": _tree(root, item)["children"]})
        else:
            children.append({"type": "file", "path": item.relative_to(root).as_posix()})
    return {"children": children}


BIB = """@article{barbatti2008,
  title = {Ultrafast internal conversion of pyrimidine nucleobases},
  doi = {10.1063/1.2948406},
}
@article{tully1990,
  title = {Molecular dynamics with electronic transitions},
  doi = {https://doi.org/10.1063/1.459170},
}
@book{lamport1994,
  title = {LaTeX},
}
"""


def test_the_file_fields_zotero_jabref_and_mendeley_write():
    assert attached_paths("Full Text PDF:/home/u/Zotero/storage/AB/x.pdf:application/pdf") == ["/home/u/Zotero/storage/AB/x.pdf"]
    # A snapshot listed first is passed over for the PDF after it.
    assert attached_paths("Snapshot:/h/s.html:text/html;Full Text:/h/p.pdf:application/pdf") == ["/h/p.pdf"]
    assert attached_paths(r":C\:\\Users\\me\\a.pdf:PDF") == ["C:\\Users\\me\\a.pdf"]
    assert attached_paths(":home/u/Mendeley/c.pdf:pdf") == ["home/u/Mendeley/c.pdf"]
    assert attached_paths("papers/b.pdf") == ["papers/b.pdf"]
    assert attached_paths("notes.txt") == []


def test_a_doi_compares_without_its_resolver_or_case():
    assert normal_doi("https://doi.org/10.1063/1.459170") == "10.1063/1.459170"
    assert normal_doi("doi:10.1000/ABC.") == "10.1000/abc"


def test_the_bib_is_read_raw_so_a_windows_path_survives():
    entries = bib_entries("@article{k,\n  file = {:C\\:\\\\Users\\\\me\\\\k.pdf:PDF},\n}\n")
    assert entries[0]["files"] == ["C:\\Users\\me\\k.pdf"]


def test_a_pdf_named_after_the_key_is_found_however_deep(tmp_path):
    root = tmp_path / "thesis"
    (root / "refs.bib").parent.mkdir(parents=True)
    (root / "refs.bib").write_text(BIB)
    deep = pdf(root / "literature" / "dynamics" / "2008" / "Barbatti2008.pdf")
    found = index(root, tmp_path / "state")
    links = found.resolve(["refs.bib"], home=tmp_path)
    assert links["barbatti2008"].path == deep.resolve()
    assert links["barbatti2008"].how == "name"
    assert found.as_dict()["barbatti2008"] == {
        "where": "project", "path": "literature/dynamics/2008/Barbatti2008.pdf", "how": "name",
    }


def test_a_pdf_named_after_the_doi_is_found(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    (root / "refs.bib").write_text(BIB)
    pdf(root / "papers" / "10.1063_1.459170.pdf")
    links = index(root, tmp_path / "s").resolve(["refs.bib"], home=tmp_path)
    assert links["tully1990"].how == "name"


def test_the_file_field_wins_and_resolves_against_the_bib(tmp_path):
    root = tmp_path / "p"
    (root / "bib").mkdir(parents=True)
    (root / "bib" / "refs.bib").write_text(
        "@article{tully1990,\n  file = {:../pdfs/T.pdf:PDF},\n}\n"
    )
    target = pdf(root / "pdfs" / "T.pdf")
    pdf(root / "elsewhere" / "tully1990.pdf")
    links = index(root, tmp_path / "s").resolve(["bib/refs.bib"], home=tmp_path)
    assert links["tully1990"].path == target.resolve()
    assert links["tully1990"].how == "file"


def test_a_jabref_name_that_does_not_resolve_is_found_by_its_file_name(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    (root / "refs.bib").write_text("@article{t,\n  file = {:T.pdf:PDF},\n}\n")
    target = pdf(root / "deep" / "down" / "T.pdf")
    links = index(root, tmp_path / "s").resolve(["refs.bib"], home=tmp_path)
    assert links["t"].path == target.resolve()


def test_a_path_outside_is_honoured_only_under_home_or_a_library_folder(tmp_path):
    root = tmp_path / "home" / "p"
    root.mkdir(parents=True)
    inside_home = pdf(tmp_path / "home" / "Zotero" / "storage" / "a.pdf")
    stranger = pdf(tmp_path / "srv" / "b.pdf")
    (root / "refs.bib").write_text(
        f"@article{{a,\n  file = {{PDF:{inside_home}:application/pdf}},\n}}\n"
        f"@article{{b,\n  file = {{PDF:{stranger}:application/pdf}},\n}}\n"
    )
    found = index(root, tmp_path / "s")
    links = found.resolve(["refs.bib"], home=tmp_path / "home")
    assert links["a"].path == inside_home.resolve()
    assert found.as_dict()["a"]["where"] == "outside"
    assert "b" not in links
    # A folder the References drawer has read is honoured too.
    links = found.resolve(["refs.bib"], sources=[str(tmp_path / "srv")], home=tmp_path / "home")
    assert links["b"].path == stranger.resolve()
    assert allowed_outside(Path("/etc/x.pdf"), [], home=tmp_path) is False


def test_a_paper_the_references_drawer_imported_is_linked_by_its_record(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    (root / "refs.bib").write_text(BIB)
    shelf = tmp_path / "Downloads"
    kept = pdf(shelf / "s41586.pdf")
    papers = [Paper(sha="x", path=str(kept), name="s41586.pdf", state="added", key="lamport1994")]
    links = index(root, tmp_path / "s").resolve(["refs.bib"], papers, [str(shelf)], home=tmp_path / "nohome")
    assert links["lamport1994"].how == "library"


def test_the_doi_on_the_first_page_with_its_title(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    (root / "refs.bib").write_text(BIB)
    pdf(root / "a" / "download (3).pdf")
    pdf(root / "b" / "scan.pdf")
    pages = {
        "download (3).pdf": "J. Chem. Phys. 128\ndoi: 10.1063/1.2948406\nUltrafast internal conversion of pyrimidine nucleobases",
        # Cites Tully's DOI without being Tully's paper.
        "scan.pdf": "Some other paper\nReferences\n[1] 10.1063/1.459170",
    }
    reads = []

    def read(path: Path) -> str:
        reads.append(path.name)
        return pages[path.name]

    found = index(root, tmp_path / "s")
    links = found.resolve(["refs.bib"], read=read, home=tmp_path)
    assert links["barbatti2008"].how == "doi"
    assert "tully1990" not in links
    # Read once; a second answer comes from what was kept.
    again = index(root, tmp_path / "s")
    assert again.resolve(["refs.bib"], read=read, home=tmp_path)["barbatti2008"].how == "doi"
    assert sorted(reads) == ["download (3).pdf", "scan.pdf"]


def test_nothing_is_read_while_every_doi_is_matched(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    (root / "refs.bib").write_text("@article{k,\n  doi = {10.1/x},\n}\n")
    pdf(root / "k.pdf")
    pdf(root / "other.pdf")
    found = index(root, tmp_path / "s")
    found.resolve(["refs.bib"], read=lambda p: (_ for _ in ()).throw(AssertionError(p)), home=tmp_path)
    assert found.wanting is False


def test_the_watcher_adds_and_drops_pdfs(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    (root / "refs.bib").write_text(BIB)
    (root / "intro.tex").write_text("x")
    found = index(root, tmp_path / "s")
    assert found.resolve(["refs.bib"], home=tmp_path) == {}
    pdf(root / "new" / "tully1990.pdf")
    assert found.touched(["new/tully1990.pdf"]) == "refresh"
    assert "tully1990" in found.resolve(["refs.bib"], home=tmp_path)
    (root / "new" / "tully1990.pdf").unlink()
    assert found.touched(["new/tully1990.pdf"]) == "refresh"
    assert found.resolve(["refs.bib"], home=tmp_path) == {}
    assert found.touched(["intro.tex"]) == ""
    assert found.touched(["refs.bib"]) == "refresh"


def test_a_new_folder_reported_alone_asks_for_a_fresh_walk(tmp_path):
    """The watcher often reports a folder made with a PDF already in it and
    loses the file's own event; the folder is enough to walk again."""
    root = tmp_path / "p"
    root.mkdir()
    (root / "refs.bib").write_text(BIB)
    found = index(root, tmp_path / "s")
    pdf(root / "literature" / "books" / "tully1990.pdf")
    assert found.touched(["literature", "literature/books"]) == "reseed"
    assert found.resolve(["refs.bib"], home=tmp_path) == {}
    found.seed(_tree(root, root))
    assert "tully1990" in found.resolve(["refs.bib"], home=tmp_path)
    # A folder that is gone asks the same.
    assert found.touched(["old-papers"]) == "reseed"


def test_a_documents_own_output_is_not_a_paper(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    (root / "refs.bib").write_text("@article{main,\n  title={x},\n}\n")
    pdf(root / "main.pdf")
    found = index(root, tmp_path / "s")
    assert found.resolve(["refs.bib"], home=tmp_path, skip={"main.pdf"}) == {}
