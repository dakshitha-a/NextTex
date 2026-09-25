"""The completion index, and when it is allowed to be rebuilt.

The rule this defends: compiling changes nothing a writer can complete to.
The stamp walk counted every .pdf in the project, and `build/main.pdf` is
rewritten by every build -- so the cache missed on every compile, and a
compile happens 1.6 seconds after the writer stops typing.
"""

from pathlib import Path

from nexttex.symbols import SymbolCache, scan, walk_project


def project(tmp_path) -> Path:
    root = tmp_path / "thesis"
    (root / "chapters").mkdir(parents=True)
    (root / "build").mkdir()
    (root / "figures").mkdir()
    (root / ".git" / "objects").mkdir(parents=True)
    (root / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}\\label{fig:one}\\end{document}",
        encoding="utf-8",
    )
    (root / "chapters" / "one.tex").write_text("\\label{sec:one}", encoding="utf-8")
    (root / "figures" / "plot.pdf").write_bytes(b"%PDF-1.4")
    (root / "build" / "main.pdf").write_bytes(b"%PDF-1.4")
    (root / ".git" / "objects" / "blob.tex").write_text("\\label{no}", encoding="utf-8")
    return root


def test_compiling_does_not_invalidate_the_cache(tmp_path, monkeypatch):
    root = project(tmp_path)
    cache = SymbolCache(root)
    build = root / "build"

    scans = []
    import nexttex.symbols as symbols

    real = symbols.scan
    monkeypatch.setattr(symbols, "scan", lambda *a, **k: (scans.append(1), real(*a, **k))[1])

    cache.get(build_dir=build)
    (build / "main.pdf").write_bytes(b"%PDF-1.4 rebuilt, twice as long")
    (build / "main.aux").write_text("\\relax", encoding="utf-8")
    cache.get(build_dir=build)
    assert len(scans) == 1, "a build must not force a rescan"


def test_editing_a_chapter_does_invalidate_the_cache(tmp_path):
    root = project(tmp_path)
    cache = SymbolCache(root)
    first = cache.get(build_dir=root / "build")
    import os, time

    chapter = root / "chapters" / "one.tex"
    chapter.write_text("\\label{sec:renamed}", encoding="utf-8")
    os.utime(chapter, (time.time() + 5, time.time() + 5))
    second = cache.get(build_dir=root / "build")
    assert first is not second
    assert "sec:renamed" in [label["name"] for label in second.labels]


def test_the_walk_never_descends_into_git_or_the_build(tmp_path):
    root = project(tmp_path)
    walked = walk_project(root, build_dir=root / "build")
    assert not [p for p in walked if ".git" in p.parts]
    assert not [p for p in walked if "build" in p.parts]
    assert root / "figures" / "plot.pdf" in walked


def test_a_scan_still_finds_what_it_used_to(tmp_path):
    root = project(tmp_path)
    found = scan(root, build_dir=root / "build")
    assert sorted(label["name"] for label in found.labels) == ["fig:one", "sec:one"]
    assert found.images == ["figures/plot.pdf"]
    assert sorted(found.texfiles) == ["chapters/one.tex", "main.tex"]


def test_the_english_a_preamble_declares_is_read_off_it():
    """The spell checker follows the document: a British thesis is checked
    as British for everyone who opens it, with nobody setting anything.
    babel's main language is the last one listed, and its plain `english`
    is American, as polyglossia's is."""
    from nexttex.symbols import english_of

    assert english_of("\\usepackage[french,british]{babel}\n\\begin{document}") == "british"
    # The last language listed is babel's main one; French says nothing
    # about which English, so the British before it stands.
    assert english_of("\\usepackage[british,french]{babel}") == "british"
    assert english_of("\\usepackage[english]{babel}") == "american"
    assert english_of("\\usepackage[UKenglish]{babel}") == "british"
    assert english_of("\\usepackage{babel}") is None
    assert english_of("\\setmainlanguage[variant=british]{english}") == "british"
    assert english_of("\\setdefaultlanguage[variant=us]{english}") == "american"
    assert english_of("\\setmainlanguage{english}") == "american"
    assert english_of("\\setmainlanguage{french}") is None
    # Only the preamble: a chapter has none, and a package loaded after
    # \begin{document} is not a declaration.
    assert english_of("\\begin{document}\\usepackage[british]{babel}") is None
    assert english_of("\\section{One}\nSome prose.") is None


def test_the_scan_carries_each_documents_english(tmp_path):
    from nexttex.symbols import scan

    (tmp_path / "main.tex").write_text(
        "\\documentclass{article}\\usepackage[british]{babel}\\begin{document}x\\end{document}",
        encoding="utf-8",
    )
    (tmp_path / "notes.tex").write_text("\\section{Notes}", encoding="utf-8")
    found = scan(tmp_path)
    assert found.english == {"main.tex": "british"}
    assert found.as_dict()["english"] == {"main.tex": "british"}


def test_a_citation_carries_its_authors_venue_and_doi(tmp_path):
    """The hover card draws the whole entry, so the scan keeps more of it
    than the first author: everyone who wrote it, capped at three, the
    journal (or the book, or the publisher), and the DOI."""
    from nexttex.symbols import _bib_entries

    entries = _bib_entries(
        "@article{schuurman2018,\n"
        "  author = {Schuurman, Michael S. and Stolow, Albert},\n"
        "  title = {Dynamics at conical intersections},\n"
        "  journal = {Annual Review of Physical Chemistry},\n"
        "  year = {2018},\n"
        "  doi = {10.1146/annurev-physchem-052516-050721},\n"
        "}\n"
        "@inproceedings{many2020,\n"
        "  author = {A One and B Two and C Three and D Four and E Five},\n"
        "  booktitle = {Proceedings of Something},\n"
        "  year = {2020},\n"
        "}\n"
    )
    first, second = entries
    assert first["author"] == "Schuurman"
    assert first["authors"] == "Schuurman, Stolow"
    assert first["venue"] == "Annual Review of Physical Chemistry"
    assert first["doi"] == "10.1146/annurev-physchem-052516-050721"
    assert second["authors"] == "One, Two, Three and 2 more"
    assert second["venue"] == "Proceedings of Something"
    assert second["doi"] == ""


def test_deleting_a_file_that_is_not_the_newest_drops_its_labels(tmp_path):
    """Q-018: the stamp was the newest modification time alone, and a
    deletion of any other file left it where it was, so a chapter a pull
    removed kept its labels in completion until something else changed."""
    import os, time

    root = project(tmp_path)
    old = time.time() - 100
    os.utime(root / "chapters" / "one.tex", (old, old))
    cache = SymbolCache(root)
    first = cache.get(build_dir=root / "build")
    assert "sec:one" in [label["name"] for label in first.labels]
    (root / "chapters" / "one.tex").unlink()
    second = cache.get(build_dir=root / "build")
    assert "sec:one" not in [label["name"] for label in second.labels]
