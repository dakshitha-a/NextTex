"""The memo of answers about a built PDF, kept until the PDF changes."""

import os
import threading
import time

from nexttex.pdf_memo import PdfMemo


def test_an_answer_is_kept_until_the_pdf_changes(tmp_path):
    pdf = tmp_path / "main.pdf"
    pdf.write_bytes(b"%PDF one")
    memo = PdfMemo()
    runs = []
    ask = lambda: runs.append(1) or len(runs)
    assert memo.get(pdf, "k", ask) == 1
    assert memo.get(pdf, "k", ask) == 1
    assert memo.get(pdf, "other", ask) == 2
    os.utime(pdf, ns=(pdf.stat().st_atime_ns, pdf.stat().st_mtime_ns + 1_000_000_000))
    assert memo.get(pdf, "k", ask) == 3


def test_a_missing_pdf_or_a_failed_answer_is_not_kept(tmp_path):
    memo = PdfMemo()
    runs = []
    assert memo.get(tmp_path / "none.pdf", "k", lambda: runs.append(1) or "x") == "x"
    assert memo.get(tmp_path / "none.pdf", "k", lambda: runs.append(1) or "x") == "x"
    pdf = tmp_path / "main.pdf"
    pdf.write_bytes(b"%PDF")
    memo.get(pdf, "k", lambda: runs.append(1))
    memo.get(pdf, "k", lambda: runs.append(1))
    assert len(runs) == 4


def test_two_askers_at_once_share_one_run(tmp_path):
    pdf = tmp_path / "main.pdf"
    pdf.write_bytes(b"%PDF")
    memo = PdfMemo()
    runs = []

    def slow():
        runs.append(1)
        time.sleep(0.2)
        return "answer"

    got = []
    threads = [threading.Thread(target=lambda: got.append(memo.get(pdf, "k", slow))) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert got == ["answer"] * 4
    assert len(runs) == 1


def test_the_oldest_answers_go_past_the_limit(tmp_path):
    pdf = tmp_path / "main.pdf"
    pdf.write_bytes(b"%PDF")
    memo = PdfMemo(limit=2)
    runs = []
    for key in ("a", "b", "c", "a"):
        memo.get(pdf, key, lambda: runs.append(key) or key)
    assert runs == ["a", "b", "c", "a"]
