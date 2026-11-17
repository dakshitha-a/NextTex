"""Answers about a built PDF, kept until the PDF changes.

The Sections drawer's Figures list asks `pdfimages -list` for the
resolution of every picture, and its Typeset list asks the forward search
for the page of each starred heading. Both answers are facts about one
PDF, and both were asked again every time the drawer opened or the file
tree refreshed. On a 32 MB thesis `pdfimages` takes about three seconds
and a forward search about a tenth of one, so the lists sat empty for that
long on every visit although nothing had been built in between.

A memo is keyed by the PDF's path, modification time and size, so a new
build is a new key and the old answers simply stop being asked for. The
routes run their work in threads, so the store is locked, and two requests
for the same answer while it is being worked out share the one run rather
than each starting their own.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from pathlib import Path
from typing import Callable, Hashable, TypeVar

T = TypeVar("T")


class PdfMemo:
    def __init__(self, limit: int = 512) -> None:
        self._limit = limit
        self._lock = threading.Lock()
        self._answers: OrderedDict[tuple, object] = OrderedDict()
        self._running: dict[tuple, threading.Lock] = {}

    def get(self, pdf: Path, key: Hashable, compute: Callable[[], T]) -> T:
        """The answer `compute` gives for this PDF as it is now. An answer
        of `None` is a failure, such as a missing tool, and is not kept."""
        try:
            stat = pdf.stat()
        except OSError:
            return compute()
        full = (str(pdf), stat.st_mtime_ns, stat.st_size, key)
        with self._lock:
            if full in self._answers:
                self._answers.move_to_end(full)
                return self._answers[full]  # type: ignore[return-value]
            running = self._running.setdefault(full, threading.Lock())
        with running:
            with self._lock:
                if full in self._answers:
                    return self._answers[full]  # type: ignore[return-value]
            value = None
            try:
                value = compute()
            finally:
                with self._lock:
                    if value is not None:
                        self._answers[full] = value
                        while len(self._answers) > self._limit:
                            self._answers.popitem(last=False)
                    self._running.pop(full, None)
            return value
