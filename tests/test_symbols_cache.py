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
