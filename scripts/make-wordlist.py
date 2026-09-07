#!/usr/bin/env python3
"""Rebuild the bundled English word list.

Run when the list needs regenerating; the output is committed, so an
ordinary checkout and an ordinary install never need this or its source.

    scripts/make-wordlist.py [/usr/share/dict/american-english]

The source is SCOWL (Spell Checker Oriented Word Lists) by Kevin Atkinson,
as packaged by Debian in `wamerican`.  Its licence is permissive and
requires the copyright notice to travel with the list; that notice is in
frontend/src/dictionary/COPYRIGHT and must stay there.

Three things shrink it, in this order:

  * possessives go.  `abbey's` is `abbey` with a suffix the checker strips
    before it looks anything up, so a third of the list carries no
    information.
  * case goes.  Whether a word is capitalised is grammar, not spelling.
  * the rest is front-coded: a sorted list shares long prefixes with the
    line above, so each word is stored as the number of characters it
    shares followed by the remainder.  That halves the bytes before any
    compression, and compresses better afterwards.

310 kB on disk, 98 kB once the build's brotli pass has been over it, and it
is a lazy chunk -- nothing downloads it until spell checking is switched on.
"""

import sys
from pathlib import Path

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/dict/american-english")
OUT = Path(__file__).resolve().parent.parent / "frontend/src/dictionary/words.txt"


def main() -> int:
    if not SOURCE.exists():
        print(f"no word list at {SOURCE} -- install `wamerican`, or name one", file=sys.stderr)
        return 1
    raw = SOURCE.read_text(encoding="utf-8", errors="replace").split("\n")
    words = sorted({w.strip().lower() for w in raw if w.strip() and "'" not in w})

    lines, previous = [], ""
    for word in words:
        shared = 0
        # Capped at 35 so the count stays one printable character.
        while (
            shared < len(previous)
            and shared < len(word)
            and previous[shared] == word[shared]
            and shared < 35
        ):
            shared += 1
        lines.append(chr(48 + shared) + word[shared:])
        previous = word

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(words)} words -> {OUT.relative_to(Path.cwd())} ({OUT.stat().st_size / 1024:.1f} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
