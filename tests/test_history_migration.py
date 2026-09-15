"""A history keyed by path slug becomes one keyed by file id.

The invariant the migration rests on: under the old scheme every record's
log lives at the slug of its *current* path, because `note_move` kept it
there, and the target is the record's id.  The case that breaks the rule
that first looked right, "only records whose id differs from their slug
need moving", is the first test here, because it is the one that would
have shipped corrupted: a file renamed away and a new file under its old
name, where the new file's random id and the old file's log at the new
slug make the naive rule hand the first file the second file's past.
"""

import json
from pathlib import Path

import pytest

from nexttex.history import FORMAT, History, Version, slug_for


def line(at: float, sha: str, op: str = "edit") -> str:
    return json.dumps(Version(at=at, sha=sha, bytes=1, by="you", op=op).as_dict()) + "\n"


def v1_store(root: Path, logs: dict[str, str], paths: dict[str, dict]) -> Path:
    """A history laid out the old way: `log/<slug>.jsonl` and `paths.json`."""
    (root / "log").mkdir(parents=True)
    (root / "blobs").mkdir()
    for path, text in logs.items():
        (root / "log" / f"{slug_for(path)}.jsonl").write_text(text, encoding="utf-8")
    (root / "paths.json").write_text(json.dumps(paths), encoding="utf-8")
    return root


def shas(versions) -> list[str]:
    return [v.sha for v in versions]


def test_a_file_renamed_away_and_a_new_file_under_its_old_name_keep_their_own_pasts(tmp_path):
    # main.tex (id = slug("main.tex")) was renamed to old.tex, so its log
    # sits at slug("old.tex"); a new main.tex, minted a random id because
    # the old file still holds slug("main.tex"), writes at slug("main.tex").
    old_id = slug_for("main.tex")
    new_id = "abcdefabcdefabcd"
    root = v1_store(
        tmp_path / "history",
        logs={
            "old.tex": line(1, "a1") + line(2, "a2"),
            "main.tex": line(3, "b1"),
        },
        paths={
            slug_for("old.tex"): {"path": "old.tex", "aliases": ["main.tex"], "purged_before": {}},
            slug_for("main.tex"): {"path": "main.tex", "aliases": [], "purged_before": {}},
        },
    )
    history = History(root)
    assert history.migrate([(old_id, "old.tex", False), (new_id, "main.tex", False)]) is True
    assert shas(history.versions_of(old_id)) == ["a1", "a2"]
    assert shas(history.versions_of(new_id)) == ["b1"]
    files = json.loads((root / "files.json").read_text(encoding="utf-8"))
    assert files[old_id]["path"] == "old.tex" and files[old_id]["aliases"] == ["main.tex"]
    assert files[new_id]["path"] == "main.tex"
    assert (root / "format").read_text(encoding="utf-8").strip() == FORMAT
    assert not (root / "paths.json").exists()
    assert not (root / "log" / ".migrating").exists()


def test_a_trashed_file_and_the_live_file_under_its_name_are_cut_at_the_deletion(tmp_path):
    # One log held both pasts under the old scheme, which is what
    # split_at_delete cut on the way back from the trash.
    trashed_id = slug_for("ch.tex")
    live_id = "0123456789abcdef"
    root = v1_store(
        tmp_path / "history",
        logs={"ch.tex": line(1, "t1") + line(2, "t2", "delete") + line(3, "l1") + line(4, "l2")},
        paths={slug_for("ch.tex"): {"path": "ch.tex", "aliases": [], "purged_before": {"a" * 64: 1.5}}},
    )
    history = History(root)
    history.migrate([(trashed_id, "ch.tex", True), (live_id, "ch.tex", False)])
    assert shas(history.versions_of(trashed_id)) == ["t1", "t2"]
    assert shas(history.versions_of(live_id)) == ["l1", "l2"]
    files = json.loads((root / "files.json").read_text(encoding="utf-8"))
    assert files[trashed_id]["purged_before"] == {"a" * 64: 1.5}
    assert files[live_id]["path"] == "ch.tex"


def test_two_trashed_files_under_one_name_take_their_segments_in_order(tmp_path):
    first, second, live = "1111111111111111", "2222222222222222", slug_for("x.tex")
    root = v1_store(
        tmp_path / "history",
        logs={"x.tex": line(1, "p1", "delete") + line(2, "q1") + line(3, "q2", "delete") + line(4, "r1")},
        paths={slug_for("x.tex"): {"path": "x.tex", "aliases": [], "purged_before": {}}},
    )
    history = History(root)
    history.migrate([(first, "x.tex", True), (second, "x.tex", True), (live, "x.tex", False)])
    assert shas(history.versions_of(first)) == ["p1"]
    assert shas(history.versions_of(second)) == ["q1", "q2"]
    assert shas(history.versions_of(live)) == ["r1"]


def test_a_forgotten_files_floor_and_an_orphan_log_survive(tmp_path):
    forgotten = slug_for("gone.tex")
    root = v1_store(
        tmp_path / "history",
        logs={"stray.tex": line(1, "s1")},
        paths={
            forgotten: {"path": "gone.tex", "aliases": [], "purged_before": {"b" * 64: 9.0}},
        },
    )
    history = History(root)
    history.migrate([(slug_for("main.tex"), "main.tex", False)])
    files = json.loads((root / "files.json").read_text(encoding="utf-8"))
    assert files[forgotten]["purged_before"] == {"b" * 64: 9.0}
    assert shas(history.versions_of(slug_for("stray.tex"))) == ["s1"]


def test_running_it_twice_changes_nothing_and_an_interruption_restarts_cleanly(tmp_path, monkeypatch):
    old_id = slug_for("main.tex")
    new_id = "abcdefabcdefabcd"
    records = [(old_id, "old.tex", False), (new_id, "main.tex", False)]
    root = v1_store(
        tmp_path / "history",
        logs={"old.tex": line(1, "a1"), "main.tex": line(3, "b1")},
        paths={
            slug_for("old.tex"): {"path": "old.tex", "aliases": ["main.tex"], "purged_before": {}},
            slug_for("main.tex"): {"path": "main.tex", "aliases": [], "purged_before": {}},
        },
    )
    history = History(root)

    # Interrupted after the targets are in place and before the marker:
    # the sources are half destroyed, which is the state the staged copies
    # exist for.
    import nexttex.history as module

    real = module.write_atomically
    calls = {"n": 0}

    def failing(path, data):
        calls["n"] += 1
        if str(path).endswith("files.json"):
            raise OSError("disk full")
        return real(path, data)

    monkeypatch.setattr(module, "write_atomically", failing)
    with pytest.raises(OSError):
        history.migrate(records)
    assert not history.migrated
    monkeypatch.setattr(module, "write_atomically", real)

    assert history.migrate(records) is True
    assert shas(history.versions_of(old_id)) == ["a1"]
    assert shas(history.versions_of(new_id)) == ["b1"]
    before = {p.name: p.read_bytes() for p in (root / "log").iterdir()}
    assert history.migrate(records) is False
    after = {p.name: p.read_bytes() for p in (root / "log").iterdir()}
    assert before == after
    assert not (root / "paths.json").exists()
    assert not (root / "log" / ".migrating").exists()


def test_an_interruption_between_the_moves_loses_neither_past(tmp_path, monkeypatch):
    """The dangerous moment: one target has overwritten another record's
    source and the second target is not in place yet.  The staged copies
    of the sources are what the rerun reads, so neither past is lost."""
    old_id = slug_for("main.tex")
    new_id = "abcdefabcdefabcd"
    records = [(old_id, "old.tex", False), (new_id, "main.tex", False)]
    root = v1_store(
        tmp_path / "history",
        logs={"old.tex": line(1, "a1") + line(2, "a2"), "main.tex": line(3, "b1")},
        paths={
            slug_for("old.tex"): {"path": "old.tex", "aliases": ["main.tex"], "purged_before": {}},
            slug_for("main.tex"): {"path": "main.tex", "aliases": [], "purged_before": {}},
        },
    )
    history = History(root)
    real = Path.replace
    moved = {"n": 0}

    def failing(self, target):
        if str(target).startswith(str(root / "log")) and ".migrating" not in str(target):
            moved["n"] += 1
            if moved["n"] == 2:
                raise OSError("pulled the plug")
        return real(self, target)

    monkeypatch.setattr(Path, "replace", failing)
    with pytest.raises(OSError):
        history.migrate(records)
    monkeypatch.setattr(Path, "replace", real)
    assert moved["n"] == 2
    assert not history.migrated
    # Exactly one target landed, over a source another target still needs.
    assert (root / "log" / ".migrating" / "src").exists()

    assert history.migrate(records) is True
    assert shas(history.versions_of(old_id)) == ["a1", "a2"]
    assert shas(history.versions_of(new_id)) == ["b1"]
    assert not (root / "log" / ".migrating").exists()


def test_an_unbound_history_still_reads_and_writes_the_old_layout(tmp_path):
    """The bench and a bare test build a History with no store and no
    migration; they keep the slug keys and paths.json exactly as they were."""
    history = History(tmp_path / "history")
    history.record("main.tex", "one\n")
    history.note_rename("main.tex", "paper.tex")
    assert (tmp_path / "history" / "paths.json").exists()
    assert not (tmp_path / "history" / "files.json").exists()
    assert (tmp_path / "history" / "log" / f"{slug_for('paper.tex')}.jsonl").exists()
    assert [v.sha for v in history.versions("paper.tex")]


def test_a_bound_history_keeps_its_log_where_it_was_across_a_rename(tmp_path):
    """With keys that are the file's own, a rename is a map update."""
    history = History(tmp_path / "history")
    keys = {"main.tex": "feedfacefeedface"}

    def resolver(path):
        return keys.get(path)

    history.bind(resolver, records=[("feedfacefeedface", "main.tex", False)])
    history.record("main.tex", "one\n")
    log = tmp_path / "history" / "log" / "feedfacefeedface.jsonl"
    assert log.exists()
    keys.pop("main.tex")
    keys["paper.tex"] = "feedfacefeedface"
    history.note_rename("main.tex", "paper.tex")
    assert log.exists()
    assert [v.sha for v in history.versions("paper.tex")] == [v.sha for v in history.versions_of("feedfacefeedface")]
    assert history.path_of("feedfacefeedface") == "paper.tex"
    files = json.loads((tmp_path / "history" / "files.json").read_text(encoding="utf-8"))
    assert files["feedfacefeedface"]["aliases"] == ["main.tex"]
