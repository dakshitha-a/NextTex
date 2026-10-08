#!/usr/bin/env python3
"""Rebuild the bundled English word lists.

Run when the lists need regenerating; the output is committed, so an
ordinary checkout and an ordinary install never need this or its sources.

    scripts/make-wordlist.py [AMERICAN] [--british BRITISH]
        [--science COUNTS --american-insane LIST --british-insane LIST]

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

`science.txt` is the vocabulary of papers that the American list lacks:
"eigenvector", "enthalpy", "mitochondria", "fermion", "dataset".  SCOWL's
size-50 list missed 57 of 80 such words.  Three parts, separated by `-`
lines: the words both Englishes share, the words only British English
has, the words only American English has, so the Variety setting means
the same with it as without it.  Two sources, each with its own job.
SCOWL's largest lists, `wamerican-insane` and `wbritish-insane` from
Debian (`apt-get download` and `dpkg-deb -x` again), vouch that a spelling
is real.  `scripts/count-corpus.py`'s table of 3.4 million arXiv and PubMed
abstracts says which of SCOWL's half a million words papers use, and adds
the ones SCOWL is too old for, "proteome" and "hyperparameter"; `science`
below says how and what guards it.

Chosen in October 2026 against the whole of arXiv's 2021 abstracts and 48
of PubMed's 2026 baseline files, with the thresholds below: 24,801 words,
160 kB on disk and 63 kB after brotli, in the same lazy chunk as the rest.
Measured on the way:

  * a sample of 403 words from mathematics, statistics, computing,
    chemistry, biology and physics, written before the list was: 99.8 %
    accepted, against 34 % by the bundled lists alone;
  * a second sample of 132 rarer terms, written after the first tuning
    and never tuned against: 93 %, against 5 %;
  * 136 common misspellings, "accross", "wiht", "eigenvetor", none of
    them in `MISSPELT`: none accepted;
  * 200 words drawn at random from each source and read by hand: 199
    real words from SCOWL's, 196 from the corpus's, whose misses are
    notation such as `vsini` and joins such as `threedimensional`.

Raising the thresholds until the list was 45 kB after brotli cost the
rarer sample seven points, 93 % to 86 %, for 18 kB nobody waits for, so
they stayed where they are.
"""

import argparse
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend/src/dictionary"


def read(source: Path) -> set[str]:
    raw = source.read_text(encoding="utf-8", errors="replace").split("\n")
    return {w.strip().lower() for w in raw if w.strip() and "'" not in w}


# The science list.  Its thresholds, and what each guard is for, are in the
# docstring of `science`.

#: Documents a SCOWL word needs, documents a word SCOWL lacks needs, and
#: documents a word that is nearly always capitalised needs, a name.
VOUCHED, UNVOUCHED, NAMED = 20, 100, 500
#: How much more often a near spelling must be used before this one is
#: taken for a typo of it, or for a piece of it.
RATIO = 20

#: Misspellings common enough in papers that a corpus of them can carry
#: one past every count.  A guard, not a list the checker reads.
MISSPELT = frozenset("""
    accomodate accomodation acheive acheived aquire aqueos arguement begining
    beleive boundry calender catagory catalist coefficent coeficient comming
    commited concensus concious consistant convergance decieve definately
    dependance derivitive dimention dissapear embarass enviroment equilibirum
    equiptment equlibrium existance exagerate excercise experiement explaination
    familar finaly flourescence fluorescense fluoresence foriegn fourty freind
    goverment grammer harrass hemorrage hieght hypothesys immediatly incidently
    independant innoculate integeral interupt knowlege lenght liason libary
    logarithim maintainance medecine millenium mitocondria molecue neccessary
    neucleus noticable nucleous occassion occurance occured occurence orthagonal
    paralell paramter parmeter parralel perpindicular persistant pharmacuetical
    phenomenom phenomenas polinomial posession preceeding prefered presense
    probabilty proceedure protien publically quantitiy quantitive realy reccomend reciever
    recieve recomend refered relevent remeber resevoir resistence rythm seive
    seperate seperately seperation simultanous similiar specimin succesful
    stochastical sucessful supercede suprise supress symetric symmetic sythesis temprature
    temperture theorm therom thermodinamics threshhold transfered truely untill
    vaccum vaccuum vacum varience vecotr visable wavelenght wether wich widht
    wierd writting algorithim analagous anaylsis heigth
""".split())


def _variant(a: str, b: str, plural: bool = True) -> bool:
    """Whether two spellings one edit apart are one word's forms rather
    than a word and its typo: a plural, unless `plural` is false, s and z,
    a dropped or doubled letter of the British and American kind, `-re`
    and `-er`."""
    if a + "s" == b or b + "s" == a or a + "es" == b or b + "es" == a:
        return plural
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        if len(diff) == 1:
            return {a[diff[0]], b[diff[0]]} == {"s", "z"}
        return len(diff) == 2 and a.endswith(("re", "er")) and b.endswith(("re", "er"))
    short, long_ = sorted((a, b), key=len)
    if len(long_) != len(short) + 1:
        return False
    i = next((k for k in range(len(short)) if short[k] != long_[k]), len(short))
    if long_[:i] + long_[i + 1:] != short:
        return False
    extra = long_[i]
    # Only the consonants the two Englishes double differently:
    # `labelled`, `focussed`, `benefitted`; `occuring` is a typo.
    doubled = extra in "lst" and (
        (i > 0 and long_[i - 1] == extra) or (i + 1 < len(long_) and long_[i + 1] == extra)
    )
    before_e = extra in "ao" and i + 1 < len(long_) and long_[i + 1] == "e"
    return extra in "ue" or doubled or before_e


def _englishes(a: str, b: str) -> bool:
    """Whether two spellings are one word in British and in American
    English, by the stricter test that decides which English a word
    belongs to: s and z, `-re` and `-er`, `-our` and `-or`, `ae` and `oe`
    inside a word, a doubled l or t.  Stricter than `_variant`, since a
    word wrongly taken for British is underlined in American documents,
    and one wrongly taken for both is only not underlined in either; so
    `amygdalae` and `tetrachloroethylene` are no English's own."""
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        if len(diff) == 1:
            return {a[diff[0]], b[diff[0]]} == {"s", "z"}
        return len(diff) == 2 and {a[-2:], b[-2:]} == {"re", "er"} and a[:-2] == b[:-2]
    short, long_ = sorted((a, b), key=len)
    if len(long_) != len(short) + 1:
        return False
    i = next((k for k in range(len(short)) if short[k] != long_[k]), len(short))
    if long_[:i] + long_[i + 1:] != short:
        return False
    extra, after = long_[i], long_[i + 1:i + 2]
    before = long_[i - 1] if i else ""
    if extra == "u":
        return before == "o" and after == "r"
    if extra in "lt":
        return extra in (before, after)
    if after == "e" and i + 2 < len(long_):
        return extra == "a" or (extra == "o" and before in ("", "h", "m", "n", "f"))
    return False


def _edits(word: str):
    letters = "abcdefghijklmnopqrstuvwxyz"
    for i in range(len(word) + 1):
        head, tail = word[:i], word[i:]
        if tail:
            yield head + tail[1:]
            if len(tail) > 1:
                yield head + tail[1] + tail[0] + tail[2:]
        for c in letters:
            if tail:
                yield head + c + tail[1:]
            yield head + c + tail


def science(
    counts: dict[str, tuple[int, int, int]],
    shipped: set[str],
    american95: set[str],
    british95: set[str],
    vouched: int = VOUCHED,
    unvouched: int = UNVOUCHED,
    named: int = NAMED,
    ratio: int = RATIO,
    misspelt: frozenset[str] = MISSPELT,
) -> tuple[set[str], set[str], set[str]]:
    """The science vocabulary: words both Englishes share, words only
    British English has, words only American English has.

    `counts` is what `scripts/count-corpus.py` wrote: for each word, the
    documents that use it, the ones that write it in lower case, and the
    ones that only write it with a capital inside it.  `shipped` is every
    word the bundled lists already hold, in either English, so nothing here
    repeats them and nothing here undoes the Variety setting.

    A word is in if it is used by `vouched` documents and SCOWL's largest
    list has it, or by `unvouched` and SCOWL does not, which is how
    "proteome" and "hyperparameter" arrive.  Then five guards, each from
    something a hand-read sample showed:

      * a capital inside the word in most documents: an acronym, `TUNEL`,
        or a formula, `SrTiO`;
      * written in lower case by fewer than half its documents: a name, and
        only a name used by `named` documents stays, which keeps Lyapunov
        and Toeplitz and leaves Ulsan and Kowalski;
      * one edit from a spelling `ratio` times as common, unless the two
        are one word's forms: `goup` beside `group`.  An edit to the first
        letter is not asked about, since a writer seldom gets that one
        wrong and physics has `squark` beside `quark`;
      * the tail of a word `ratio` times as common, which is a word broken
        by a hyphen, `mol-ecules`; asked only of a word SCOWL lacks or one
        of five letters or fewer, since "sorption" is the tail of
        "absorption" and a word;
      * a known misspelling.
    """
    docs = {word: row[0] for word, row in counts.items()}
    tails: dict[str, int] = {}
    for word, n in docs.items():
        for k in range(1, min(5, len(word) - 3)):
            tail = word[k:]
            if n > tails.get(tail, 0):
                tails[tail] = n
    known = american95 | british95
    chosen = set()
    for word, (n, lower, mixed) in counts.items():
        if word in shipped or word in misspelt or not word.isascii() or not word.isalpha():
            continue
        if n < (vouched if word in known else unvouched):
            continue
        if mixed * 2 > n:
            continue
        if lower * 2 < n and n < named:
            continue
        if (word not in known or len(word) <= 5) and tails.get(word, 0) >= ratio * n:
            continue
        if any(
            docs.get(near, 0) >= ratio * n and not _variant(word, near)
            for near in set(_edits(word))
            if near != word and near[1:] != word[1:] and near[1:] != word and near != word[1:]
        ):
            continue
        chosen.add(word)
    # SCOWL leaves some words out of one English for no reason of
    # spelling, "aerogel" among them, so a word is one English's alone
    # only when the other has its other spelling beside it.
    def other(word: str, there: set[str]) -> bool:
        return any(near in there and _englishes(word, near) for near in _edits(word))

    british = {w for w in chosen if w in british95 and w not in american95 and other(w, american95)}
    american = {w for w in chosen if w in american95 and w not in british95 and other(w, british95)}
    return chosen - british - american, british, american


def read_counts(source: Path) -> dict[str, tuple[int, int, int]]:
    counts = {}
    for line in source.read_text(encoding="utf-8").splitlines():
        word, n, lower, mixed = line.split("\t")
        counts[word] = (int(n), int(lower), int(mixed))
    return counts


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
    parser.add_argument("--science", metavar="COUNTS",
                        help="scripts/count-corpus.py's table, for the science list")
    parser.add_argument("--american-insane", help="SCOWL's largest American list")
    parser.add_argument("--british-insane", help="SCOWL's largest British list")
    args = parser.parse_args()
    if args.science and not (args.british and args.american_insane and args.british_insane):
        parser.error("--science needs --british, --american-insane and --british-insane")

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

    if args.science:
        sources = [Path(p) for p in (args.science, args.american_insane, args.british_insane)]
        for source in sources:
            if not source.exists():
                print(f"no file at {source}", file=sys.stderr)
                return 1
        shared, only_british, only_american = science(
            read_counts(sources[0]), american | british, read(sources[1]), read(sources[2]),
        )
        target = OUT / "science.txt"
        target.write_text(
            "\n".join(encode(shared) + ["-"] + encode(only_british) + ["-"] + encode(only_american)),
            encoding="utf-8",
        )
        print(f"{len(shared)} shared, {len(only_british)} British, {len(only_american)} American -> "
              f"{target.relative_to(Path.cwd())} ({target.stat().st_size / 1024:.1f} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
