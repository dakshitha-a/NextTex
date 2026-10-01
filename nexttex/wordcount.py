"""texcount's answers, remembered while the files they counted are unchanged.

The browser asks for a word count after every build, and again when the
caret crosses a heading with the count scoped to the section. Each ask was
a texcount process, and over a whole thesis that takes seconds; builds
arrive every few seconds while somebody types, so counts overlapped and
the same unchanged section was counted again each time the caret came back
to it. Two things change:

- **An answer is kept** under the command and the size and modification
  time of every file it read, so asking again about files nobody has
  touched costs a `stat` per file and no process.
- **One count per question runs at a time.** A second ask for the same
  thing while one is running waits for that one rather than starting
  another.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from collections import OrderedDict
from typing import Awaitable, Callable, Hashable, Sequence

#: Answers kept per project. A key is one scope over one set of files, so
#: this is generous: a writer moving between sections of one chapter uses a
#: handful.
KEPT = 64


def stamps(paths: Sequence[str | os.PathLike]) -> tuple:
    """Size and modification time of each file, in order; a missing file
    is part of the key too, so it appearing changes the answer."""
    found = []
    for path in paths:
        try:
            info = os.stat(path)
        except OSError:
            found.append((str(path), None))
            continue
        found.append((str(path), info.st_mtime_ns, info.st_size))
    return tuple(found)


def text_key(text: str) -> str:
    """A selection or a section is counted from its text, so its text is
    its key."""
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


class WordCounts:
    """Remembered counts and the counts running now, for one project."""

    def __init__(self, kept: int = KEPT) -> None:
        self._kept = kept
        self._answers: OrderedDict[Hashable, int | None] = OrderedDict()
        self._running: dict[Hashable, asyncio.Future] = {}

    async def get(
        self, key: Hashable, count: Callable[[], Awaitable[int | None]],
    ) -> int | None:
        if key in self._answers:
            self._answers.move_to_end(key)
            return self._answers[key]
        running = self._running.get(key)
        if running is not None:
            return await asyncio.shield(running)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._running[key] = future
        try:
            total = await count()
        except BaseException as error:
            # Not remembered: a timeout or a missing tool says nothing
            # about the next attempt.
            if not future.done():
                future.set_exception(error)
                # Retrieved here so a failure nobody else waited on is not
                # reported as never retrieved.
                future.exception()
            raise
        finally:
            self._running.pop(key, None)
        self._answers[key] = total
        self._answers.move_to_end(key)
        while len(self._answers) > self._kept:
            self._answers.popitem(last=False)
        if not future.done():
            future.set_result(total)
        return total
