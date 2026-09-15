#!/usr/bin/env python3
"""Rebuild the bundled English word lists.

Run when the lists need regenerating; the output is committed, so an
ordinary checkout and an ordinary install never need this or its sources.

    scripts/make-wordlist.py [AMERICAN] [--british BRITISH]

The sources are SCOWL (Spell Checker Oriented Word Lists) by Kevin
Atkinson, as packaged by Debian in `wamerican` and `wbritish`.  Its licence
is permissive and requires the copyright notice to travel with the lists;
that notice is in frontend/src/dictionary/COPYRIGHT and must stay there.
`wbritish` need not be installed: `apt-get download wbritish` and
`dpkg-deb -x` on the package yield `usr/share/dict/british-english`.

Three things shrink each list, in this order:

  * possessives go.  `abbey's` is `abbey` with a suffix the checker strips
    before it looks anything up, so a third of the list carries no
    information.
  * case goes.  Whether a word is capitalised is grammar, not spelling.
  * the rest is front-coded: a sorted list shares long prefixes with the
    line above, so each word is stored as the number of characters it
    shares followed by the remainder.  That halves the bytes before any
    compression, and compresses better afterwards.

`words.txt` is the American list, 310 kB on disk and 98 kB once the build's
brotli pass has been over it, and it is a lazy chunk: nothing downloads it
until spell checking is switched on.  `british.txt` is not a second list
but the difference: the words British English adds, a line holding `-`,
then the words it takes away, each half front-coded the same way.  A few
thousand words each way, a few kilobytes after brotli, in the same chunk.
The separator can never be mistaken for a word: a front-coded line starts
with the shared count as a printable character from `0` upwards, and `-`
comes before `0`.
"""

import argparse
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend/src/dictionary"


def read(source: Path) -> set[str]:
    raw = source.read_text(encoding="utf-8", errors="replace").split("\n")
    return {w.strip().lower() for w in raw if w.strip() and "'" not in w}


def encode(words: set[str]) -> list[str]:
    lines, previous = [], ""
    for word in sorted(words):
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
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("american", nargs="?", default="/usr/share/dict/american-english")
    parser.add_argument("--british", help="the british-english list, for the delta")
    args = parser.parse_args()

    american_source = Path(args.american)
    if not american_source.exists():
        print(f"no word list at {american_source} -- install `wamerican`, or name one",
              file=sys.stderr)
        return 1
    american = read(american_source)
    target = OUT / "words.txt"
    target.write_text("\n".join(encode(american)), encoding="utf-8")
    print(f"{len(american)} words -> {target.relative_to(Path.cwd())} "
          f"({target.stat().st_size / 1024:.1f} kB)")

    if args.british:
        british_source = Path(args.british)
        if not british_source.exists():
            print(f"no word list at {british_source}", file=sys.stderr)
            return 1
        british = read(british_source)
        adds = british - american
        removes = american - british
        delta = OUT / "british.txt"
        delta.write_text(
            "\n".join(encode(adds) + ["-"] + encode(removes)), encoding="utf-8",
        )
        print(f"{len(adds)} added, {len(removes)} removed -> "
              f"{delta.relative_to(Path.cwd())} ({delta.stat().st_size / 1024:.1f} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
