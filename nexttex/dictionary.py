"""Words this project's writer says are spelled correctly.

A dissertation is full of terms no English word list holds: the molecules it
is about, the methods it uses, the people it cites.  A checker that
underlines every one of them is a checker that gets switched off in five
minutes, so the writer's own words are kept beside the project, one per
line, and the underline goes away for good the first time they say so.

Kept in `.nexttex/` rather than in the project itself, which is the same
choice made for every other piece of per-project state here: that directory
is machine-local and never committed, so a list built while writing does not
turn up in the repository of everyone who clones the document, and the
document stays portable to editors that know nothing about this one.  The
file is plain text on purpose -- a writer who wants to paste in two hundred
species names should not have to click two hundred times.
"""

from __future__ import annotations

from pathlib import Path

#: Long enough for a technical vocabulary, short enough that a runaway loop
#: writing to this file cannot fill a disk.
MAX_WORDS = 20_000
MAX_LENGTH = 64


def _clean(word: str) -> str:
    """A word as it is stored and compared: lower case, no surrounding punctuation.

    The checker lower-cases before it looks anything up, so storing `SORCI`
    and `sorci` as two entries would be two ways of saying one thing.
    """
    return word.strip().strip("'’-.,;:()[]{}").lower()[:MAX_LENGTH]


class ProjectDictionary:
    def __init__(self, state_dir: Path) -> None:
        self.path = state_dir / "dictionary.txt"

    def words(self) -> list[str]:
        try:
            raw = self.path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        seen: dict[str, None] = {}
        for line in raw:
            word = _clean(line)
            if word:
                seen[word] = None
        return list(seen)

    def add(self, word: str) -> list[str]:
        cleaned = _clean(word)
        if not cleaned:
            return self.words()
        current = self.words()
        if cleaned in current:
            return current
        if len(current) >= MAX_WORDS:
            return current
        current.append(cleaned)
        self._save(current)
        return current

    def remove(self, word: str) -> list[str]:
        cleaned = _clean(word)
        current = [w for w in self.words() if w != cleaned]
        self._save(current)
        return current

    def _save(self, words: list[str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Sorted, so a hand edit and a click produce the same file and the
        # diff of one added word is one line.
        body = "\n".join(sorted(words))
        temp = self.path.with_suffix(".txt.tmp")
        try:
            temp.write_text(body + ("\n" if body else ""), encoding="utf-8")
            temp.replace(self.path)
        except OSError:
            temp.unlink(missing_ok=True)
