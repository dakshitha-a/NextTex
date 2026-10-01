r"""What a copy editor sends back, found without a model.

Four checks over the prose of every `.tex` in the project, each the same
shape: two forms of one thing coexist in the document. None of them is a
preference. A paper written throughout as "data set", or throughout in
British spelling, or with "Fig." everywhere, gets nothing; it is the mix
that a reader notices and an editor marks. That rule is what keeps these
from reopening what section 74 of `docs/design.md` turned off: the
grammar checker's style rules were off because they were choices, and
these are not choices, they are inconsistencies.

- **One word written two ways**: "dataset" beside "data set" or
  "data-set".
- **An abbreviation beside its full form** in front of a reference:
  "Fig.~\ref" beside "Figure~\ref" mid-sentence, and the same for
  equations, sections and tables. A sentence that begins with the word in
  full is not counted, since many styles ask for exactly that.
- **US and UK spelling of one word**: "color" beside "colour". Each word
  is its own question, so Oxford spelling, British with -ize, is not a mix.
- **Acronyms**: one defined as "long words (ABC)" and never used again,
  and, in a project that defines its acronyms that way, one used and
  never defined.

A missing `~` before `\cite` or `\ref` was on the roadmap's list too, and
is chktex's warning 2, which the lint already runs: chktex's own list of
commands that want a tie is `\ref \vref \pageref \eqref \cite`.

Rows are for one file, the one the drawer is on, but each check reads
the whole project, so the other form can be in another chapter; the row
names where.
"""

from __future__ import annotations

import functools
import re
from collections import defaultdict

from .prose import line_of, mask

#: Words that make a two-word phrase that is also a word in its own right,
#: "in to" and "into", "may be" and "maybe", and are left alone.
FUNCTION_WORDS = {
    "a", "an", "the", "in", "to", "on", "at", "by", "of", "be", "may", "can",
    "no", "not", "any", "some", "every", "there", "where", "here", "with",
    "out", "over", "up", "for", "as", "is", "it", "so", "all", "one", "how",
    "what", "who", "when", "ever", "per", "non", "co", "re", "pre", "after",
    "under", "with", "him", "her", "them", "your", "our", "my", "its",
}
#: Abbreviation and full form, in front of a reference.
ABBREVIATIONS = {
    "figure": ("Fig.", "Figure"), "equation": ("Eq.", "Equation"),
    "section": ("Sec.", "Section"), "table": ("Tab.", "Table"),
}
ABBREVIATED = re.compile(r"\b(Figs?\.|Eqs?\.|Secs?\.|Tabs?\.|Figures?|Equations?|Sections?|Tables?)(?=\s)")
#: One word in US and UK spelling, the pairs academic writing meets.
SPELLINGS = [
    ("color", "colour"), ("behavior", "behaviour"), ("center", "centre"),
    ("analyze", "analyse"), ("analyzed", "analysed"), ("analyzing", "analysing"),
    ("modeling", "modelling"), ("modeled", "modelled"), ("labeled", "labelled"),
    ("labeling", "labelling"), ("favor", "favour"), ("favorable", "favourable"),
    ("neighbor", "neighbour"), ("neighboring", "neighbouring"), ("flavor", "flavour"),
    ("fiber", "fibre"), ("liter", "litre"), ("meter", "metre"), ("gray", "grey"),
    ("aluminum", "aluminium"), ("sulfur", "sulphur"), ("program", "programme"),
    ("catalog", "catalogue"), ("dialog", "dialogue"), ("defense", "defence"),
    ("license", "licence"), ("traveled", "travelled"), ("signaling", "signalling"),
    ("fueled", "fuelled"), ("tumor", "tumour"), ("vapor", "vapour"),
    ("honor", "honour"), ("rumor", "rumour"), ("harbor", "harbour"),
    ("enroll", "enrol"), ("fulfill", "fulfil"), ("skeptical", "sceptical"),
    ("artifact", "artefact"), ("orthopedic", "orthopaedic"), ("estrogen", "oestrogen"),
    ("anemia", "anaemia"), ("hemoglobin", "haemoglobin"), ("pediatric", "paediatric"),
    ("leukemia", "leukaemia"), ("esophagus", "oesophagus"), ("diarrhea", "diarrhoea"),
    ("maneuver", "manoeuvre"), ("plow", "plough"), ("tire", "tyre"),
]
#: Acronyms nobody defines.
COMMON_ACRONYMS = {
    "PDF", "DNA", "RNA", "USA", "UK", "US", "EU", "UN", "NASA", "CPU", "GPU",
    "HTML", "URL", "API", "PhD", "MSc", "BSc", "OK", "TV", "AI", "IT", "ID",
    "ISBN", "DOI", "PNG", "SVG", "XML", "JSON", "CSV", "SQL", "USB", "LED",
    "GPS", "NMR", "MRI", "HIV", "AIDS", "CEO", "LaTeX", "TeX", "AM", "PM",
    "BC", "AD", "UV", "IR", "II", "III", "IV", "VI", "VII", "VIII", "IX",
    "XI", "XII", "ATP", "pH", "NATO", "UNESCO", "WHO", "IEEE", "ACM", "ISO",
}
ACRONYM = re.compile(r"\b([A-Z][A-Z0-9]{1,6})s?\b")
DEFINED = re.compile(r"((?:[A-Za-z][\w-]*\s+){1,8})\(\s*([A-Z][A-Za-z0-9]{1,7})s?\s*\)")
WORD = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)*")

EXPLAIN = {
    "compound": {
        "title": "One word written two ways",
        "detail": "The document writes this compound closed in one place and open or hyphenated in another. Either is fine; both is what a copy editor marks.",
        "fix": "Choose one form and use it throughout. The project search finds every place.",
    },
    "abbreviation": {
        "title": "An abbreviation beside its full form",
        "detail": "References to the same kind of thing are abbreviated in one place and written out in another, mid-sentence. Many styles write the word in full only at the start of a sentence, which is not counted here.",
        "fix": "Use one form mid-sentence throughout, the one the venue's style asks for.",
    },
    "spelling-variant": {
        "title": "US and UK spelling of one word",
        "detail": "The same word is spelt the American way in one place and the British way in another.",
        "fix": "Choose the venue's spelling and use it throughout.",
    },
    "acronym-unused": {
        "title": "An acronym defined and never used",
        "detail": "The acronym is introduced in brackets after its long form and not used again, so the reader is asked to remember it for nothing.",
        "fix": "Drop the brackets, or use the acronym where the long form is repeated.",
    },
    "acronym-undefined": {
        "title": "An acronym never defined",
        "detail": "The document defines its other acronyms as the long form followed by the acronym in brackets, and this one is used without that.",
        "fix": "Write the long form with the acronym in brackets where it is first used.",
    },
}


def _row(kind: str, message: str, path: str, line: int, other: str = "") -> dict:
    row = {
        "severity": "info",
        "message": message,
        "file": path,
        "line": line,
        "column": None,
        "source": "style",
        "kind": kind,
        "explain": EXPLAIN[kind],
    }
    # The other form's place, `file:line`, which the drawer offers as a
    # way there under the message.
    if other:
        file, _, at = other.rpartition(":")
        row["other"] = {"file": file, "line": int(at)}
    return row


@functools.lru_cache(maxsize=256)
def _masked(text: str) -> str:
    return mask(text)


def check(texts: dict[str, str], path: str) -> list[dict]:
    """Every row `path` earns, reading the prose of every `.tex` in
    `texts`, path to text."""
    sources = {name: body for name, body in texts.items() if name.lower().endswith(".tex")}
    if path not in sources:
        return []
    masked = {name: _masked(body) for name, body in sources.items()}
    rows: list[dict] = []
    rows += _compounds(masked, path)
    rows += _abbreviations(masked, path)
    rows += _spellings(masked, path)
    rows += _acronyms(masked, path)
    return sorted(rows, key=lambda row: row["line"])


Place = tuple  # (file, offset, line)


def _times(count: int) -> str:
    return "once" if count == 1 else "twice" if count == 2 else f"{count} times"


def _minority(
    path: str, kind: str, forms: list[tuple[str, list[Place]]], where_said: str = "",
) -> list[dict]:
    """Rows for the less common of two forms, in `path`: the inconsistency
    is the form the document uses less, and marking the other as well
    doubled the rows and marked the writer's own convention. Two forms used
    equally often are both marked."""
    (one, ones), (two, twos) = forms
    rows: list[dict] = []
    for said, mine, other_said, theirs in ((one, ones, two, twos), (two, twos, one, ones)):
        if len(mine) > len(theirs):
            continue
        first = theirs[0]
        for where, _, line in mine:
            if where == path:
                rows.append(_row(
                    kind,
                    f"\"{said}\" here, \"{other_said}\" {_times(len(theirs))} elsewhere{where_said}",
                    path, line, f"{first[0]}:{first[2]}",
                ))
    return rows


def _compounds(masked: dict[str, str], path: str) -> list[dict]:
    closed: dict[str, list[Place]] = defaultdict(list)
    split: dict[str, list[Place]] = defaultdict(list)
    spelled: dict[str, str] = {}

    def part(word: str) -> bool:
        # Both halves words of three letters or more, and not the small
        # words that make a phrase with a meaning of its own.
        return len(word) >= 3 and word not in FUNCTION_WORDS

    for name, text in masked.items():
        words = list(WORD.finditer(text))
        for index, match in enumerate(words):
            low = match.group(0).lower()
            place = (name, match.start(), line_of(text, match.start()))
            if "-" in low:
                parts = low.split("-")
                if len(parts) == 2 and all(part(w) for w in parts):
                    split["".join(parts)].append(place)
                    spelled.setdefault("".join(parts) + "-", low)
                continue
            closed[low].append(place)
            if index + 1 < len(words):
                after = words[index + 1]
                between = text[match.end():after.start()]
                nxt = after.group(0).lower()
                if between.strip(" \t") == "" and "\n\n" not in between and "-" not in nxt \
                        and part(low) and part(nxt):
                    split[low + nxt].append(place)
                    spelled.setdefault(low + nxt + " ", f"{low} {nxt}")
    rows = []
    for joined, places in split.items():
        if len(joined) < 6 or not closed.get(joined):
            continue
        apart = spelled.get(joined + " ") or spelled.get(joined + "-") or joined
        rows += _minority(path, "compound", [(apart, places), (joined, closed[joined])])
    return rows


def _sentence_start(text: str, offset: int) -> bool:
    before = text[:offset].rstrip()
    return not before or before[-1] in ".!?" or before.endswith("\n\n")


def _abbreviations(masked: dict[str, str], path: str) -> list[dict]:
    short: dict[str, list[Place]] = defaultdict(list)
    full: dict[str, list[Place]] = defaultdict(list)
    for name, text in masked.items():
        for match in ABBREVIATED.finditer(text):
            word = match.group(1)
            if _sentence_start(text, match.start()):
                continue
            kind = next(k for k in ABBREVIATIONS if word.lower().startswith(k[:2]))
            (short if word.endswith(".") else full)[kind].append(
                (name, match.start(), line_of(text, match.start())),
            )
    rows = []
    for kind, (abbreviated, written) in ABBREVIATIONS.items():
        if short[kind] and full[kind]:
            rows += _minority(
                path, "abbreviation",
                [(abbreviated, short[kind]), (written, full[kind])], " mid-sentence",
            )
    return rows


def _spellings(masked: dict[str, str], path: str) -> list[dict]:
    lookup = {}
    for us, uk in SPELLINGS:
        lookup[us] = (us, 0)
        lookup[uk] = (us, 1)
    found: dict[str, tuple[list[Place], list[Place]]] = defaultdict(lambda: ([], []))
    for name, text in masked.items():
        for match in WORD.finditer(text):
            hit = lookup.get(match.group(0).lower())
            if hit:
                found[hit[0]][hit[1]].append((name, match.start(), line_of(text, match.start())))
    rows = []
    british = dict(SPELLINGS)
    for us, (american, uk) in found.items():
        if american and uk:
            rows += _minority(
                path, "spelling-variant",
                [(f"{us}", american), (f"{british[us]}", uk)],
            )
    return rows


def _initials_fit(long_form: str, acronym: str) -> bool:
    """Whether the words before the brackets can be what the acronym
    abbreviates: its letters, in order, start words or sit in them."""
    words = [w for w in re.split(r"[\s-]+", long_form.strip()) if w]
    letters = [c for c in acronym.upper() if c.isalpha()]
    if not words or not letters:
        return False
    initials = "".join(w[0].upper() for w in words)
    # The acronym's first letter starts one of the last few words, and the
    # rest follow in the long form's letters in order.
    joined = "".join(words).upper()
    k = 0
    for char in joined:
        if k < len(letters) and char == letters[k]:
            k += 1
    return letters[0] in initials and k == len(letters)


def _acronyms(masked: dict[str, str], path: str) -> list[dict]:
    defined: dict[str, tuple[str, int, int]] = {}
    for name, text in masked.items():
        for match in DEFINED.finditer(text):
            acronym = match.group(2)
            # "(CIs)" defines CI, used as CIs and as CI.
            if len(acronym) > 2 and acronym.endswith("s") and acronym[:-1].isupper():
                acronym = acronym[:-1]
            if acronym in COMMON_ACRONYMS or not _initials_fit(match.group(1)[-80:], acronym):
                continue
            defined.setdefault(acronym, (name, match.start(2), line_of(text, match.start(2))))
    uses: dict[str, list[tuple[str, int, int]]] = defaultdict(list)
    for name, text in masked.items():
        for match in ACRONYM.finditer(text):
            acronym = match.group(1)
            # Its own definition is not a use.
            if acronym in defined and defined[acronym][:2] == (name, match.start(1)):
                continue
            uses[acronym].append((name, match.start(1), line_of(text, match.start(1))))
    rows = []
    for acronym, (where, _, line) in defined.items():
        if where == path and not uses.get(acronym):
            rows.append(_row(
                "acronym-unused", f"{acronym} is defined here and never used again", path, line,
            ))
    # Undefined only where defining is the document's own habit: most of
    # the acronyms it uses are defined. A paper that defines a handful and
    # names forty methods and programs by their acronyms is not asked to
    # define the forty.
    candidates = {
        acronym for acronym in uses
        if acronym not in COMMON_ACRONYMS and len(acronym) >= 3
    } | set(defined)
    if defined and len(defined) * 2 > len(candidates):
        for acronym, places in uses.items():
            if acronym in defined or acronym in COMMON_ACRONYMS or len(acronym) < 3:
                continue
            if not any(c.isalpha() for c in acronym) or acronym.isdigit():
                continue
            where, _, line = places[0]
            if where == path:
                many = f", and used {len(places)} times" if len(places) > 1 else ""
                rows.append(_row(
                    "acronym-undefined",
                    f"{acronym} is used here without being defined{many}",
                    path, line,
                ))
    return rows
