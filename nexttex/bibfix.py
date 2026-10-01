r"""Mechanical repairs for a `.bib` file, each one a row's verb.

`bibcheck` reports; this repairs what has one right answer. Every repair
edits the text it was given by span, never by writing an entry back out
from parsed fields, so the writer's own layout, comments, field order and
the entries around it are left exactly as they were. Nothing here invents
a value: capitals are braced, fields are taken away, a key is made from
the entry's own author and year, and of two entries with one DOI the
fuller is kept.

The four repairs:

- `title-caps`: a title word with a capital after its first letter,
  `BERT`, `DNA`, `LaTeX`, `McDonald`, not already inside braces, is
  wrapped in them, since most styles lowercase a title.
- `bulky-fields`: every `abstract` field, and a `url` in an entry that
  has a `doi`, is taken out of the file.
- `key-style`: an entry's key becomes its first author's surname and its
  year, in the case the file's other author-year keys use, with a letter
  after it when that is taken; every citation follows.
- `duplicate-doi`: of two entries with one DOI, the one with more filled
  fields stays, the first in the file on a tie; the other is deleted and
  every citation of it points at the one kept.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from . import rename

#: An entry's head, `@type{key,` as `verify_bib.parse_bib` reads it.
HEAD = re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,")
FIELD = re.compile(r"(\w[\w-]*)\s*=\s*")
#: Not entries.
DIRECTIVES = {"comment", "string", "preamble"}
#: A key in author and year form: a surname, four digits, and at most a
#: letter or a word after them, `lee2019`, `Lee2019b`, `lee2019hopping`.
AUTHOR_YEAR = re.compile(r"^[A-Za-z][A-Za-z-]*\d{4}[A-Za-z]*$")
#: A word of a title, letters and digits.
WORD = re.compile(r"[A-Za-z0-9]+")
FIX_KINDS = ("title-caps", "bulky-fields", "key-style", "duplicate-doi")


@dataclass
class Field:
    name: str
    value: str
    #: The field from its name to the comma after its value, or to the end
    #: of its value when it is the last.
    start: int
    end: int
    #: The value's own span, without its braces or quotes.
    value_start: int
    value_end: int


@dataclass
class Entry:
    kind: str
    key: str
    start: int          # the `@`
    end: int            # one past the closing brace
    line: int
    key_start: int
    fields: list[Field] = field(default_factory=list)

    def get(self, name: str) -> Field | None:
        for item in self.fields:
            if item.name == name:
                return item
        return None

    def filled(self) -> int:
        return sum(1 for item in self.fields if item.value.strip())


def entries(text: str) -> list[Entry]:
    """Every entry with the spans a repair needs, in file order."""
    found: list[Entry] = []
    for head in HEAD.finditer(text):
        kind, key = head.group(1).lower(), head.group(2)
        open_at = text.index("{", head.start())
        depth, i = 0, open_at
        while i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        close = min(i, len(text) - 1)
        entry = Entry(
            kind=kind, key=key, start=head.start(), end=close + 1,
            line=text.count("\n", 0, head.start()) + 1,
            key_start=head.start(2),
        )
        if kind not in DIRECTIVES:
            entry.fields = _fields(text, head.end(), close)
        found.append(entry)
    return found


def _fields(text: str, start: int, stop: int) -> list[Field]:
    fields: list[Field] = []
    pos = start
    while True:
        match = FIELD.search(text, pos, stop)
        if not match:
            break
        j = match.end()
        if j < stop and text[j] == "{":
            depth, k = 0, j
            while k < stop:
                if text[k] == "{":
                    depth += 1
                elif text[k] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                k += 1
            value_start, value_end, after = j + 1, k, k + 1
        elif j < stop and text[j] == '"':
            k = text.find('"', j + 1, stop)
            k = stop if k == -1 else k
            value_start, value_end, after = j + 1, k, k + 1
        else:
            k = text.find(",", j, stop)
            k = stop if k == -1 else k
            value_start, value_end, after = j, k, k
        # Through the comma after the value, so taking a field out leaves
        # its neighbours punctuated as they were.
        end = after
        comma = text.find(",", after, stop)
        if comma != -1 and not text[after:comma].strip():
            end = comma + 1
        fields.append(Field(
            name=match.group(1).lower(), value=text[value_start:value_end],
            start=match.start(), end=end,
            value_start=value_start, value_end=value_end,
        ))
        pos = max(end, after)
    return fields


# ---------------------------------------------------------------------------
# What a row needs to know: whether its repair applies.


def _shielded(word: str) -> bool:
    """A word a style would lowercase wrongly: a capital after its first
    letter, as in BERT, LaTeX, McDonald, pH or 2D."""
    return any(char.isupper() for char in word[1:])


def _top_words(value: str):
    """The words of a field value outside every brace, as (start, end),
    skipping a word that is a command's name."""
    depth = 0
    i = 0
    while i < len(value):
        char = value[i]
        if char == "{":
            depth += 1
        elif char == "}":
            depth = max(0, depth - 1)
        elif depth == 0:
            match = WORD.match(value, i)
            if match:
                if not (i and value[i - 1] == "\\"):
                    yield match.start(), match.end()
                i = match.end()
                continue
        i += 1


def unprotected_capitals(title: str) -> list[str]:
    """The words of a title that a style would lowercase and should not,
    outside any braces, each once."""
    words: list[str] = []
    for start, end in _top_words(title):
        word = title[start:end]
        if _shielded(word) and word not in words:
            words.append(word)
    return words


def bulky(entry: Entry) -> list[Field]:
    """The fields `bulky-fields` takes out of this entry."""
    has_doi = bool((entry.get("doi") or Field("", "", 0, 0, 0, 0)).value.strip())
    return [
        item for item in entry.fields
        if item.name == "abstract" or (item.name == "url" and has_doi)
    ]


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^A-Za-z]", "", re.sub(r"\\[a-zA-Z]+|[{}\\]", "", stripped))


def _surname(author: str) -> str:
    first = re.split(r"\s+and\s+", author.strip(), maxsplit=1)[0].strip()
    if not first:
        return ""
    name = first.split(",")[0] if "," in first else first.split()[-1]
    return _fold(name)


def styled_keys(all_entries: list[Entry]) -> tuple[int, int, bool]:
    """How many of the file's keys are in author and year form, out of how
    many, and whether most of those start with a capital."""
    real = [entry for entry in all_entries if entry.kind not in DIRECTIVES]
    styled = [entry.key for entry in real if AUTHOR_YEAR.match(entry.key)]
    capital = sum(1 for key in styled if key[0].isupper())
    return len(styled), len(real), capital * 2 > len(styled)


def proposed_key(entry: Entry, all_entries: list[Entry]) -> str | None:
    """The author and year key for an entry, or None when it has no author
    or no four-digit year to make one from."""
    author = entry.get("author") or entry.get("editor")
    year_field = entry.get("year")
    surname = _surname(author.value) if author else ""
    year = re.search(r"\d{4}", year_field.value) if year_field else None
    if not surname or not year:
        return None
    _, _, capital = styled_keys(all_entries)
    base = (surname[0].upper() + surname[1:].lower()) if capital else surname.lower()
    base += year.group(0)
    taken = {other.key for other in all_entries if other is not entry}
    if base not in taken:
        return base
    for letter in "abcdefghijklmnopqrstuvwxyz":
        if base + letter not in taken:
            return base + letter
    return None


def wants_key_style(entry: Entry, all_entries: list[Entry]) -> bool:
    """Whether to raise `key-style` on an entry: its key is not in author
    and year form while at least half the file's keys are, and one can be
    made for it."""
    if entry.kind in DIRECTIVES or AUTHOR_YEAR.match(entry.key):
        return False
    styled, total, _ = styled_keys(all_entries)
    return total >= 2 and styled * 2 >= total and proposed_key(entry, all_entries) is not None


def _normal_doi(value: str) -> str:
    return re.sub(r"^(?:https?://)?(?:dx\.)?doi\.org/", "", value.strip(), flags=re.I).strip().lower()


def merge_pair(all_entries: list[Entry], key: str) -> tuple[Entry, Entry] | None:
    """For the entry `key`, which shares a DOI with an earlier one: the
    entry kept and the entry dropped."""
    target = next((entry for entry in all_entries if entry.key == key), None)
    if target is None or target.kind in DIRECTIVES:
        return None
    doi_field = target.get("doi")
    doi = _normal_doi(doi_field.value) if doi_field else ""
    if not doi:
        return None
    for other in all_entries:
        if other is target:
            break
        theirs = other.get("doi")
        if theirs and _normal_doi(theirs.value) == doi:
            # The fuller one stays; on a tie, the first in the file.
            if target.filled() > other.filled():
                return target, other
            return other, target
    return None


# ---------------------------------------------------------------------------
# The repairs. Each takes every text in the project, path to text, and
# gives back the ones that change.


class NotApplicable(ValueError):
    """The row's repair no longer applies: the entry changed or went."""


def _entry(text: str, key: str) -> Entry:
    for entry in entries(text):
        if entry.key == key and entry.kind not in DIRECTIVES:
            return entry
    raise NotApplicable(f"there is no entry {key}")


def protect_capitals(text: str, key: str) -> str:
    entry = _entry(text, key)
    title = entry.get("title")
    if not title or not unprotected_capitals(title.value):
        raise NotApplicable(f"{key}'s title has nothing to protect")
    value = title.value
    for start, end in reversed(list(_top_words(value))):
        if _shielded(value[start:end]):
            value = value[:start] + "{" + value[start:end] + "}" + value[end:]
    return text[:title.value_start] + value + text[title.value_end:]


def drop_bulky(text: str) -> str:
    spans = [(item.start, item.end) for entry in entries(text) for item in bulky(entry)]
    if not spans:
        raise NotApplicable("no entry carries an abstract, or a url beside its DOI")
    for start, end in sorted(spans, reverse=True):
        # The whole line when the field had it to itself.
        line_start = text.rfind("\n", 0, start) + 1
        line_end = text.find("\n", end)
        line_end = len(text) if line_end == -1 else line_end
        if not text[line_start:start].strip() and not text[end:line_end].strip():
            start, end = line_start, min(line_end + 1, len(text))
        text = text[:start] + text[end:]
    # A field taken from the end of an entry leaves the one before it with
    # a trailing comma, which BibTeX accepts; nothing more to tidy.
    return text


def _dedupe_cites(text: str, key: str) -> str:
    """`\\cite{lee2019,lee2019}` after a merge, said once."""
    commands = "|".join(rename.CITE_COMMANDS)
    pattern = re.compile(r"(\\(?:" + commands + r")\*?(?:\s*\[[^\]]*\]){0,2}\s*\{)([^{}]*)(\})")

    def once(match: re.Match) -> str:
        parts = match.group(2).split(",")
        seen, kept = False, []
        for part in parts:
            if part.strip() == key:
                if seen:
                    continue
                seen = True
            kept.append(part)
        return match.group(1) + ",".join(kept) + match.group(3)

    return pattern.sub(once, text)


def repair(texts: dict[str, str], path: str, kind: str, key: str = "") -> dict[str, str]:
    """The files `kind`'s repair changes, with their new text.

    `path` is the `.bib` file the row is on and `key` the entry it names;
    `bulky-fields` is the whole file's and takes no key. Raises
    `NotApplicable` when the repair no longer applies."""
    text = texts.get(path)
    if text is None:
        raise NotApplicable(f"{path} is not in the project")
    if kind == "title-caps":
        return {path: protect_capitals(text, key)}
    if kind == "bulky-fields":
        return {path: drop_bulky(text)}
    if kind == "key-style":
        all_entries = entries(text)
        entry = _entry(text, key)
        if not wants_key_style(entry, all_entries):
            raise NotApplicable(f"{key} needs no new key")
        to = proposed_key(entry, all_entries)
        if not to or not rename.valid("cite", to):
            raise NotApplicable(f"no author and year key can be made for {key}")
        return rename.rename(texts, "cite", key, to)
    if kind == "duplicate-doi":
        pair = merge_pair(entries(text), key)
        if pair is None:
            raise NotApplicable(f"{key} shares its DOI with no earlier entry")
        kept, dropped = pair
        start, end = dropped.start, dropped.end
        # The entry and the blank line after it.
        while end < len(text) and text[end] in " \t":
            end += 1
        if text[end:end + 1] == "\n":
            end += 1
            if text[end:end + 1] == "\n":
                end += 1
        without = dict(texts)
        without[path] = text[:start] + text[end:]
        changed = rename.rename(
            {name: body for name, body in without.items() if not name.lower().endswith(".bib")},
            "cite", dropped.key, kept.key,
        )
        changed = {name: _dedupe_cites(body, kept.key) for name, body in changed.items()}
        changed[path] = without[path]
        return changed
    raise NotApplicable(f"no repair for {kind}")
