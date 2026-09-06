"""Versions of a file, and what may never be lost.

The rules these defend: a version is never composed from anything but the
bytes that were on disk; an editing burst is one version rather than one per
autosave; and thinning may drop routine intermediate saves but never a
version somebody labelled, one the agent made, or a deletion.
"""

import time

from nexttex.history import History, Version, slug_for


def history(tmp_path) -> History:
    return History(tmp_path / "history")


def test_a_version_round_trips_exactly(tmp_path):
    store = history(tmp_path)
    store.record("main.tex", "\\section{One}\nSome prose.\n")
    versions = store.versions("main.tex")
    assert len(versions) == 1
    assert store.content("main.tex", versions[0].sha) == "\\section{One}\nSome prose.\n"


def test_saving_the_same_text_twice_records_once(tmp_path):
    store = history(tmp_path)
    store.record("main.tex", "unchanged")
    assert store.record("main.tex", "unchanged") is None
    assert len(store.versions("main.tex")) == 1


def test_an_editing_burst_collapses_into_one_version(tmp_path):
    store = history(tmp_path)
    for text in ("a", "ab", "abc", "abcd"):
        store.record("main.tex", text)
    versions = store.versions("main.tex")
    assert len(versions) == 1
    assert store.content("main.tex", versions[0].sha) == "abcd"


def test_the_agent_never_shares_a_version_with_the_writer(tmp_path):
    """What Claude changed has to stay separable from what you changed."""
    store = history(tmp_path)
    store.record("main.tex", "yours", by="you")
    store.record("main.tex", "claude's", by="claude", why="fix the reference")
    store.record("main.tex", "yours again", by="you")
    assert [v.by for v in store.versions("main.tex")] == ["you", "claude", "you"]


def test_content_is_shared_between_identical_versions(tmp_path):
    """Reverting to something the file has been before costs no storage."""
    store = history(tmp_path)
    store.record("a.tex", "same text", by="you")
    store.record("b.tex", "same text", by="claude")
    assert len(store.referenced()) == 1


def test_thinning_keeps_what_people_come_looking_for(tmp_path):
    store = history(tmp_path)
    now = time.time() * 1000
    day = 86_400_000
    old = [
        Version(at=now - 60 * day, sha="a" * 64, bytes=1, by="you"),
        Version(at=now - 60 * day + 1000, sha="b" * 64, bytes=1, by="you"),
        Version(at=now - 60 * day + 2000, sha="c" * 64, bytes=1, by="claude"),
        Version(at=now - 60 * day + 3000, sha="d" * 64, bytes=1, by="you",
                label="before the rewrite"),
        Version(at=now - 60 * day + 4000, sha="e" * 64, bytes=1, by="you", op="delete"),
        Version(at=now - 1000, sha="f" * 64, bytes=1, by="you"),
    ]
    kept = {v.sha for v in store._thin(old)}
    assert "c" * 64 in kept, "an agent edit is never thinned"
    assert "d" * 64 in kept, "a labelled version is never thinned"
    assert "e" * 64 in kept, "a deletion is never thinned"
    assert "f" * 64 in kept, "the newest is never thinned"
    assert "a" * 64 in kept, "the oldest is never thinned"


def test_everything_from_the_last_day_is_kept(tmp_path):
    store = history(tmp_path)
    now = time.time() * 1000
    recent = [
        Version(at=now - minutes * 60_000, sha=f"{index:064d}", bytes=1, by="you")
        for index, minutes in enumerate((600, 500, 400, 300, 200, 100))
    ]
    assert len(store._thin(recent)) == len(recent)


def test_a_label_can_be_set_and_survives(tmp_path):
    store = history(tmp_path)
    version = store.record("main.tex", "text")
    assert store.set_label("main.tex", version.sha, "submitted to the committee")
    assert store.versions("main.tex")[0].label == "submitted to the committee"


def test_a_rename_carries_the_past_with_it(tmp_path):
    store = history(tmp_path)
    store.record("draft.tex", "early words")
    store.note_rename("draft.tex", "chapters/02_theory.tex")
    versions = store.versions("chapters/02_theory.tex")
    assert len(versions) == 1
    assert store.content("chapters/02_theory.tex", versions[0].sha) == "early words"
    assert store.versions("draft.tex") == []


def test_moving_a_folder_carries_the_history_of_everything_in_it(tmp_path):
    # A folder move re-slugs the folder, which has no log of its own, so
    # every file underneath used to keep its history filed under a path
    # that no longer existed -- still on disk, but unreachable.
    store = history(tmp_path)
    store.record("chapters/02_theory.tex", "the theory")
    store.record("chapters/figures/plot.tex", "a figure")
    store.note_move("chapters", "parts/chapters")

    moved = store.versions("parts/chapters/02_theory.tex")
    assert len(moved) == 1
    assert store.content("parts/chapters/02_theory.tex", moved[0].sha) == "the theory"

    nested = store.versions("parts/chapters/figures/plot.tex")
    assert len(nested) == 1
    assert store.content("parts/chapters/figures/plot.tex", nested[0].sha) == "a figure"

    assert store.versions("chapters/02_theory.tex") == []
    assert store.versions("chapters/figures/plot.tex") == []


def test_a_folder_move_leaves_a_neighbouring_prefix_alone(tmp_path):
    # `chapters-old` is not inside `chapters`, and a plain prefix test
    # says it is.
    store = history(tmp_path)
    store.record("chapters/02_theory.tex", "moved")
    store.record("chapters-old/02_theory.tex", "left where it was")
    store.note_move("chapters", "parts/chapters")

    assert len(store.versions("chapters-old/02_theory.tex")) == 1
    assert store.versions("parts/chapters-old/02_theory.tex") == []


def test_a_plain_file_rename_still_works_through_note_move(tmp_path):
    store = history(tmp_path)
    store.record("draft.tex", "early words")
    store.note_move("draft.tex", "chapters/02_theory.tex")
    assert len(store.versions("chapters/02_theory.tex")) == 1
    assert store.versions("draft.tex") == []


def test_collection_leaves_referenced_content_alone(tmp_path):
    store = history(tmp_path)
    version = store.record("main.tex", "keep me")
    store.blobs.put(b"nobody refers to this")
    # Backdate everything past the grace period, which exists so collection
    # cannot race a record that has written a blob but not its log line.
    for blob in (store.root / "blobs").rglob("*"):
        if blob.is_file():
            import os
            os.utime(blob, (0, 0))
    store.collect()
    assert store.content("main.tex", version.sha) == "keep me"


def test_a_corrupt_line_does_not_lose_the_rest(tmp_path):
    store = history(tmp_path)
    store.record("main.tex", "first")
    log = store.log_dir / f"{slug_for('main.tex')}.jsonl"
    with log.open("a", encoding="utf-8") as handle:
        handle.write("{not json\n")
    store.record("main.tex", "second", by="claude")
    assert len(store.versions("main.tex")) == 2


def test_asking_for_a_version_of_another_file_gets_nothing(tmp_path):
    """A sha is not a capability: it only reads inside the file it belongs to."""
    store = history(tmp_path)
    secret = store.record("private.tex", "confidential")
    assert store.content("other.tex", secret.sha) is None


def test_the_state_before_nexttex_is_never_coalesced_away(tmp_path):
    """The one version nobody else can reconstruct."""
    store = history(tmp_path)
    store.record("main.tex", "what the file said before", op="create",
                 why="as it was when NextTex first saw it")
    store.record("main.tex", "after one edit")
    store.record("main.tex", "after another")
    versions = store.versions("main.tex")
    assert [v.op for v in versions] == ["create", "edit"]
    assert store.content("main.tex", versions[0].sha) == "what the file said before"


def test_a_version_survives_a_restart(tmp_path):
    """The whole point: history is on disk, not in a session."""
    store = history(tmp_path)
    store.record("main.tex", "before the restart")
    reopened = History(tmp_path / "history")
    versions = reopened.versions("main.tex")
    assert len(versions) == 1
    assert reopened.content("main.tex", versions[0].sha) == "before the restart"


def test_two_windows_do_not_collapse_into_one_version(tmp_path):
    """Two browser tabs are both "you", so an editing burst in one used to
    swallow the version the other had just written -- and with it the only
    copy of the paragraph it overwrote."""
    store = history(tmp_path)
    store.record("main.tex", "what the first window wrote", source="tab-a")
    store.record("main.tex", "what the second window wrote", source="tab-b")
    texts = [
        store.content("main.tex", version.sha)
        for version in store.versions("main.tex")
    ]
    assert texts == ["what the first window wrote", "what the second window wrote"]


def test_one_window_still_collapses_its_own_burst(tmp_path):
    store = history(tmp_path)
    for text in ("a", "ab", "abc"):
        store.record("main.tex", text, source="tab-a")
    assert len(store.versions("main.tex")) == 1
