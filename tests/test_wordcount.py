"""Word counts are remembered while their files are unchanged, and the
same count is never running twice at once."""

from __future__ import annotations

import asyncio
import os

import pytest

from nexttex.wordcount import WordCounts, stamps, text_key


def test_an_unchanged_question_is_answered_without_counting_again():
    counts = WordCounts()
    ran = []

    async def count():
        ran.append(1)
        return 120

    async def go():
        assert await counts.get(("file", 1), count) == 120
        assert await counts.get(("file", 1), count) == 120

    asyncio.run(go())
    assert len(ran) == 1


def test_two_asks_while_one_count_runs_share_it():
    """Builds land every few seconds while somebody types, and a count over
    a thesis takes seconds, so asks used to overlap and each started its
    own process."""
    counts = WordCounts()
    ran = []

    async def count():
        ran.append(1)
        await asyncio.sleep(0.05)
        return 7

    async def go():
        return await asyncio.gather(*(counts.get("same", count) for _ in range(3)))

    assert asyncio.run(go()) == [7, 7, 7]
    assert len(ran) == 1


def test_a_failed_count_is_not_remembered():
    counts = WordCounts()
    attempts = []

    async def count():
        attempts.append(1)
        if len(attempts) == 1:
            raise OSError("texcount went away")
        return 3

    async def go():
        with pytest.raises(OSError):
            await counts.get("k", count)
        return await counts.get("k", count)

    assert asyncio.run(go()) == 3
    assert len(attempts) == 2


def test_the_oldest_answers_are_let_go():
    counts = WordCounts(kept=2)

    async def go():
        for key in ("a", "b", "c"):
            await counts.get(key, lambda: asyncio.sleep(0, result=1))

    asyncio.run(go())
    assert list(counts._answers) == ["b", "c"]


def test_a_file_written_again_changes_the_key(tmp_path):
    chapter = tmp_path / "one.tex"
    chapter.write_text("words")
    before = stamps([chapter, tmp_path / "missing.tex"])
    chapter.write_text("more words")
    os.utime(chapter, ns=(1, 1))
    assert stamps([chapter, tmp_path / "missing.tex"]) != before
    assert before[1] == (str(tmp_path / "missing.tex"), None)
    assert text_key("a") != text_key("b")
