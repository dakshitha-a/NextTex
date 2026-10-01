"""The project as it stood at a moment, for Changes as PDF from History."""

import pytest

from nexttex import history as history_module
from nexttex.history import History


@pytest.fixture
def clock(monkeypatch):
    """A clock that moves an hour a reading, so no two saves coalesce."""
    now = {"t": 1_000_000.0}

    def tick() -> float:
        now["t"] += 3600
        return now["t"]

    monkeypatch.setattr(history_module.time, "time", tick)
    return now


def test_each_file_stands_as_its_newest_version_then(tmp_path, clock):
    store = History(tmp_path / "history")
    store.record("main.tex", "first")
    moment = store.versions("main.tex")[-1].at
    store.record("main.tex", "second")
    store.record("chapters/new.tex", "made after", op="create")
    state = store.state_at(moment)
    assert state["main.tex"] == b"first"
    # Made after the moment: it did not exist then.
    assert state["chapters/new.tex"] is None


def test_a_file_first_seen_after_the_moment_stood_as_first_seen(tmp_path, clock):
    store = History(tmp_path / "history")
    store.record("main.tex", "v1")
    moment = store.versions("main.tex")[-1].at
    # A chapter NextTex had never changed until later: its seed version is
    # what it held all along.
    store.record("intro.tex", "as found", op="create", why=History.FIRST_SEEN)
    store.record("intro.tex", "rewritten")
    assert store.state_at(moment)["intro.tex"] == b"as found"


def test_a_file_deleted_by_then_is_gone_and_a_file_never_seen_is_not_named(tmp_path, clock):
    store = History(tmp_path / "history")
    store.record("old.tex", "here")
    store.record("old.tex", "here", op="delete")
    moment = store.versions("old.tex")[-1].at
    store.record("main.tex", "later")
    state = store.state_at(moment)
    assert state["old.tex"] is None
    assert "untouched.tex" not in state
