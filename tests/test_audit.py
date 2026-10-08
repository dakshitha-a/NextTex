"""The audit trail's report stays quick on a long history."""

import zipfile

from nexttex import audit
from nexttex.history import History


def test_past_the_budget_the_report_points_at_the_files(tmp_path, monkeypatch):
    store = History(tmp_path / "history")
    store.record("a.tex", "one\n", by="you", source="a")
    store.record("a.tex", "one\ntwo\n", by="you", source="b")
    monkeypatch.setattr(audit, "DIFF_BUDGET_LINES", 1)
    out = tmp_path / "trail.zip"
    assert audit.build(store, "a.tex", out, keep_all=False) == 2
    archive = zipfile.ZipFile(out)
    assert "Diff skipped" in archive.read("report.html").decode()
    assert len([n for n in archive.namelist() if n.startswith("versions/")]) == 2
