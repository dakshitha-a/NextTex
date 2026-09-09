"""One author, one sequence, and one writer at a time.

Collaboration asks a file's history a question it was never built to answer:
"what have you recorded since this moment".  Three things have to be true for
that question to have an answer.

Every record belongs to exactly one author, and no install ever writes a line
under another install's name.  An author's timestamps only ever go up, so the
moment in the question is a real boundary and never a tie.  And a log that is
rewritten in full on every change has one writer at a time, because a peer's
lines arriving while a save was in flight is otherwise a lost update.

The fourth thing here is the floor.  Clearing a file's history is the only
destructive thing this store does, and it is deliberately not told to anybody
else -- one person's decision about their own disk must not reach into
somebody else's copy -- so what makes it stick is refusing the old records on
the way back in.
"""

import json
import threading

import nexttex.history
from nexttex.history import History, now_ms


def store(tmp_path, me: str = "") -> History:
    history = History(tmp_path / "history")
    history.me = me
    return history


def line(at: float, sha: str, peer: str, **rest) -> dict:
    return {"at": at, "sha": sha, "bytes": 1, "peer": peer, **rest}


# -- an author's timestamps only go up --------------------------------------

def test_two_saves_in_one_millisecond_are_two_versions(tmp_path, monkeypatch):
    """Otherwise a mark landing between them can never be moved past one."""
    history = store(tmp_path)
    monkeypatch.setattr(nexttex.history, "now_ms", lambda: 1_700_000_000_000.0)
    history.record("main.tex", "one", source="window-a")
    history.record("main.tex", "two", source="window-b")
    stamps = [version.at for version in history.versions("main.tex")]
    assert len(stamps) == 2
    assert stamps[0] < stamps[1]


def test_a_clock_that_steps_backwards_does_not_rewind_the_log(tmp_path, monkeypatch):
    """An hour of records would otherwise be filed before ones already sent."""
    history = store(tmp_path)
    ticks = [5_000_000.0, 1_000_000.0]
    monkeypatch.setattr(nexttex.history, "now_ms", lambda: ticks.pop(0))
    first = history.record("main.tex", "one", source="window-a")
    second = history.record("main.tex", "two", source="window-b")
    assert second.at > first.at


def test_a_fast_peers_records_do_not_drag_our_clock_forward(tmp_path):
    """The floor is per author, so their clock is only ever their business.

    Taken across every record instead, one collaborator ten hours ahead would
    push this machine's timestamps ten hours into the future and they would
    stay there for as long as the project lived.
    """
    history = store(tmp_path, me="us")
    ahead = now_ms() + 10 * 3600 * 1000
    assert history.absorb("main.tex", [line(ahead, "b" * 64, "them")])
    ours = history.record("main.tex", "ours", peer="us")
    assert ours is not None
    assert ours.at < ahead


# -- one writer at a time ---------------------------------------------------

def test_recording_from_many_threads_loses_nothing(tmp_path):
    """Every change here rewrites the whole log, so two of them race.

    `record` reads the list, appends to it and writes it back.  Without the
    lock the second writer had read the same list as the first and its write
    simply erased the first one's version.
    """
    history = store(tmp_path)

    def burst(worker: int) -> None:
        for index in range(20):
            history.record("main.tex", f"{worker}:{index}", op="create")

    threads = [threading.Thread(target=burst, args=(w,)) for w in range(16)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(history.versions("main.tex")) == 16 * 20


def test_absorbing_while_recording_loses_nothing(tmp_path):
    """The race that matters most: a collaborator's lines during a save."""
    history = store(tmp_path, me="us")
    base = now_ms() - 60_000

    def ours() -> None:
        for index in range(30):
            history.record("main.tex", f"ours {index}", op="create", peer="us")

    def theirs() -> None:
        for index in range(30):
            history.absorb(
                "main.tex", [line(base + index, f"{index:064d}", "them")],
            )

    threads = [threading.Thread(target=ours), threading.Thread(target=theirs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(history.versions("main.tex")) == 60


# -- a log is read as a sequence --------------------------------------------

def test_a_log_written_out_of_order_reads_back_sorted(tmp_path):
    """Repairing on read, because a rename used to leave one in this state."""
    history = store(tmp_path)
    log = history._log_path("main.tex")
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(
        "".join(
            json.dumps(line(at, f"{at:064.0f}", "")) + "\n"
            for at in (3000.0, 1000.0, 2000.0)
        ),
        encoding="utf-8",
    )
    assert [v.at for v in history.versions("main.tex")] == [1000.0, 2000.0, 3000.0]


def test_a_rename_onto_a_name_with_a_past_merges_in_order(tmp_path):
    """Appending one log onto the other left the result out of order.

    Everything downstream reads it as a sequence: `record` takes the last
    entry as the previous version, thinning keeps the last of each bucket,
    and a collaborator asks for everything after a moment.
    """
    history = store(tmp_path)
    history.record("old.tex", "the old file", op="create")
    history.record("new.tex", "something else entirely", op="create")
    history.note_rename("old.tex", "new.tex")
    stamps = [version.at for version in history.versions("new.tex")]
    assert len(stamps) == 2
    assert stamps == sorted(stamps)
    assert history.versions("old.tex") == []


# -- nobody else writes under our name --------------------------------------

def test_a_line_signed_with_our_own_name_is_refused(tmp_path):
    """A member could otherwise put words in our mouth, and we would pass
    them on to everybody else as ours -- and push every other machine's idea
    of how much of "ours" it holds past the end of what we actually wrote."""
    history = store(tmp_path, me="us")
    assert history.absorb("main.tex", [line(now_ms(), "d" * 64, "us")]) == []
    assert history.versions("main.tex") == []


def test_an_unstamped_line_from_elsewhere_is_refused(tmp_path):
    """No peer means "written here", and this one was not."""
    history = store(tmp_path, me="us")
    assert history.absorb("main.tex", [line(now_ms(), "d" * 64, "")]) == []


def test_a_collaborators_line_is_taken_and_kept_as_theirs(tmp_path):
    history = store(tmp_path, me="us")
    added = history.absorb("main.tex", [line(now_ms(), "e" * 64, "them", who="Ada")])
    assert [v.peer for v in added] == ["them"]
    assert [v.who for v in history.versions("main.tex")] == ["Ada"]


def test_absorbing_the_same_line_twice_adds_it_once(tmp_path):
    history = store(tmp_path, me="us")
    lines = [line(now_ms(), "e" * 64, "them")]
    assert len(history.absorb("main.tex", lines)) == 1
    assert history.absorb("main.tex", lines) == []


def test_a_file_known_only_from_a_peer_is_in_the_timeline(tmp_path):
    """Absorbing used to skip the path map, and the timeline reads that map,
    so a co-author's chapter was in its own panel and nowhere else."""
    history = store(tmp_path, me="us")
    history.absorb("chapters/03.tex", [line(now_ms(), "f" * 64, "them")])
    assert [entry["path"] for entry in history.timeline()] == ["chapters/03.tex"]


def test_absorbing_thins_what_it_takes(tmp_path):
    """A co-author's chapter you never open used to grow without bound.

    Safe now in a way it was not before: a mark that only moves forward means
    that once these are thinned away, the author will not offer them again.
    """
    history = store(tmp_path, me="us")
    base = now_ms() - 60 * 24 * 3600 * 1000
    arriving = [
        line(base + index * 60_000, f"{index:064d}", "them") for index in range(50)
    ]
    assert history.absorb("chapters/03.tex", arriving)
    assert 0 < len(history.versions("chapters/03.tex")) < 50


# -- a cleared history stays cleared -----------------------------------------

def test_a_cleared_history_does_not_come_back_from_a_collaborator(tmp_path):
    history = store(tmp_path, me="us")
    theirs = [line(now_ms() - 5_000, "b" * 64, "them")]
    assert history.absorb("main.tex", theirs)
    history.record("main.tex", "ours", op="create", peer="us")
    history.forget("main.tex")
    assert history.versions("main.tex") == []
    assert history.absorb("main.tex", theirs) == []
    assert history.versions("main.tex") == []


def test_clearing_does_not_block_what_a_collaborator_writes_next(tmp_path):
    """The floor is a boundary, not a wall."""
    history = store(tmp_path, me="us")
    history.absorb("main.tex", [line(now_ms() - 5_000, "b" * 64, "them")])
    history.forget("main.tex")
    later = [line(now_ms() + 5_000, "c" * 64, "them")]
    assert len(history.absorb("main.tex", later)) == 1


def test_one_authors_floor_does_not_hold_back_another(tmp_path):
    """The reason the floor is per author and not one number for the file.

    A collaborator whose clock runs fast would otherwise set it into our own
    future, and everybody else's next records would be dropped on arrival
    until real time caught up with a stranger's clock.
    """
    history = store(tmp_path, me="us")
    ahead = now_ms() + 10 * 3600 * 1000
    history.absorb("main.tex", [line(ahead, "b" * 64, "fast")])
    history.forget("main.tex")
    assert history.purged_before("main.tex")["fast"] == ahead
    steady = [line(now_ms(), "c" * 64, "steady")]
    assert len(history.absorb("main.tex", steady)) == 1


def test_a_floor_survives_a_rename(tmp_path):
    history = store(tmp_path, me="us")
    theirs = [line(now_ms() - 5_000, "b" * 64, "them")]
    history.absorb("old.tex", theirs)
    history.forget("old.tex")
    history.record("old.tex", "starting again", op="create", peer="us")
    history.note_rename("old.tex", "new.tex")
    assert history.absorb("new.tex", theirs) == []


# -- splitting a history at the deletion --------------------------------------

def test_a_split_at_the_deletion_takes_only_what_came_before(tmp_path):
    """What a restore under a taken name needs.

    History is keyed by path, so the log at the old name holds the deleted
    file's past *and* the past of whatever took the name after it.  Renaming
    it across would hand one file's history to another.
    """
    history = store(tmp_path)
    history.record("ch.tex", "first draft", op="create")
    history.record("ch.tex", "second draft", by="claude")
    history.record("ch.tex", "second draft", op="delete", why="deleted")
    history.record("ch.tex", "a different file with the same name", op="create")

    assert history.split_at_delete("ch.tex", "ch (restored).tex") == 3
    assert [v.op for v in history.versions("ch (restored).tex")] == [
        "create", "edit", "delete",
    ]
    assert [v.op for v in history.versions("ch.tex")] == ["create"]


def test_a_split_with_nothing_to_split_on_moves_nothing(tmp_path):
    history = store(tmp_path)
    history.record("ch.tex", "first draft", op="create")
    assert history.split_at_delete("ch.tex", "elsewhere.tex") == 0
    assert len(history.versions("ch.tex")) == 1


# -- a blob is its contents, or it is nothing --------------------------------

def test_a_blob_that_will_not_decompress_is_not_trusted_for_ever(tmp_path):
    """What a power loss used to leave: the right name, the right length,
    and zeroes.  `put` short circuits on a name that exists, so leaving it
    made that version unopenable for good with no way back."""
    history = store(tmp_path)
    version = history.record("main.tex", "the chapter")
    blob = history.blobs.path_for(version.sha)
    blob.write_bytes(b"\x00" * blob.stat().st_size)

    assert history.blobs.get(version.sha) is None
    assert not blob.exists()
    assert history.blobs.put(b"the chapter") == version.sha
    assert history.blobs.get(version.sha) == b"the chapter"


def test_a_blob_name_that_could_not_be_a_sha_is_refused(tmp_path):
    """It is joined straight onto a directory, and it arrives in a query."""
    history = store(tmp_path)
    for made_up in ("../../../etc/passwd", "..", "", "not-a-sha", "a" * 63):
        assert history.blobs.get(made_up) is None
        assert history.blobs.has(made_up) is False


def test_re_referencing_an_old_blob_keeps_it_out_of_the_next_sweep(tmp_path):
    """The grace window is keyed on mtime, so the mtime has to move.

    A blob whose last referring line was thinned away is unreferenced and
    waiting to be swept.  Saving the same content again used to leave its
    mtime alone, so the sweep could take it between that moment and the log
    line about to name it.
    """
    history = store(tmp_path)
    version = history.record("main.tex", "the chapter")
    blob = history.blobs.path_for(version.sha)
    import os
    old = now_ms() / 1000 - 4 * 3600
    os.utime(blob, (old, old))
    history.blobs.put(b"the chapter")
    assert blob.stat().st_mtime > old
