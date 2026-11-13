"""A rename that arrives first after a project opens is followed on disk.

Found in a throwaway share between dak-n4 and the Windows laptop on
13 November 2026. The laptop had just joined, and its first change from
dak-n4 was a chapter folder renamed there. `settle_paths` follows a
rename by comparing a record's path with `_named`, the path it last
settled, and `_named` was empty when a store opened and was filled
lazily, so the first change to every record was taken as the baseline:
the records moved to the new folder while the files stayed in the old
one, the old files were adopted again under fresh records, and the old
folder came back on both machines. The paths the manifest held when it
was opened are the baseline now.
"""

from nexttex.project import Project
from server.collab.store import CollabStore

PDF = b"%PDF-1.5\n" + bytes(range(256)) * 8


def test_the_first_rename_after_opening_moves_the_files(tmp_path):
    root = tmp_path / "proj"
    (root / "chapters" / "old" / "figures").mkdir(parents=True)
    (root / "main.tex").write_text("\\input{chapters/old/old}\n", encoding="utf-8")
    (root / "chapters" / "old" / "old.tex").write_text("The chapter.\n", encoding="utf-8")
    (root / "chapters" / "old" / "figures" / "plot.pdf").write_bytes(PDF)
    first = CollabStore(Project.open(root))
    first.adopt()
    first.flush()
    first.close()

    store = CollabStore(Project.open(root))
    ids = {p: store.file_id_for(p) for p in
           ("chapters/old/old.tex", "chapters/old/figures/plot.pdf")}
    assert all(ids.values())
    # As a peer's rename lands: the records change their path, nothing else.
    for old in ids:
        store.rename(old, old.replace("chapters/old/", "chapters/new/"))
    for _ in range(2):
        store.flush()

    assert (root / "chapters" / "new" / "old.tex").is_file()
    assert (root / "chapters" / "new" / "figures" / "plot.pdf").is_file()
    assert not (root / "chapters" / "old" / "old.tex").exists()
    assert not (root / "chapters" / "old" / "figures" / "plot.pdf").exists()
    # And the folders it left empty go with it, rather than staying in
    # the tree as an empty chapter.
    assert not (root / "chapters" / "old").exists()
    assert (root / "chapters").is_dir()
    store.adopt()
    live = [r.get("path") for r in store.files.values() if not r.get("trashed")]
    assert not [p for p in live if p.startswith("chapters/old/")], live
    assert store.file_id_for("chapters/new/old.tex") == ids["chapters/old/old.tex"]
    store.close()
