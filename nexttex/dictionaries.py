"""Word lists for spelling in German, French, Spanish and Portuguese.

The English list ships with NextTex. The others do not, for two reasons:
they are a few megabytes each where most writers need none of them, and
their licences, GPL for German and LGPL or MPL for the rest, are fine to
fetch and use but are not NextTex's MIT to redistribute inside it. So a
list is fetched the first time a project asks for it, from the npm
packages `wooorm/dictionaries` publishes (Hunspell's own `.aff` and `.dic`
files for each language), checked against the hash pinned below, and
kept in the install's state directory, so a machine fetches each one once
whatever number of projects use it.

The browser checks with them through Hunspell compiled to WebAssembly;
the server only fetches, verifies and serves the two files.
"""

from __future__ import annotations

import hashlib
import os
import threading
from dataclasses import dataclass
from pathlib import Path

from .arrive import USER_AGENT
from .atomic import write_atomically
from .paths import state_home

#: The one host they come from unless a test says otherwise.
BASE = "https://cdn.jsdelivr.net/npm"
TIMEOUT = 60
#: Bigger than any list here by a margin; a response past it is not one.
MAX_BYTES = 12 * 1024 * 1024
FILES = ("index.aff", "index.dic")


@dataclass(frozen=True)
class Language:
    code: str
    name: str
    package: str
    version: str
    #: sha256 of index.aff and index.dic at that version.
    hashes: tuple[str, str]
    #: What both files come to, for the one line that says a fetch is on.
    size: int


LANGUAGES = {
    "de": Language(
        "de", "German", "dictionary-de", "3.0.0",
        ("57fdd1b16aac2131003c91e0cf2a488becb970382a402a9ce089307301cb3ef0",
         "b5c781a0cf6f285fb6b9b8ab02fbea104b987104a1efdda8a835837e89e3ec77"),
        19199 + 1118194,
    ),
    "fr": Language(
        "fr", "French", "dictionary-fr", "3.0.0",
        ("05a735d34c912e4e381ff08ee7c747923ccf5cf9dca81d8467982fa1ca51c2b7",
         "984e933237bc1224a48f42828233be9b03228260ef67aa8e2bdddcd03a26230d"),
        199870 + 1229133,
    ),
    "es": Language(
        "es", "Spanish", "dictionary-es", "4.0.0",
        ("892039d59db11d747061b81c3a92a52d48ba0e055b5835af1943cbd3c2fba85b",
         "907f786a8ceb3456722b20ad91dd4dbe99c5c16e45015ea63155e36f26b06d2c"),
        167135 + 706202,
    ),
    "pt": Language(
        "pt", "Portuguese", "dictionary-pt", "4.0.0",
        ("a9f3621b94eb4d6838474bf9982027758e77dcb248815f49409b1a4a477dbd27",
         "32e2edd83541d58613bcc83ef731a79aadf85ed57e977a16c6b5f711a7a36cee"),
        979789 + 4477692,
    ),
}


class DictionaryError(Exception):
    """Why a list could not be had, in a sentence."""


def _base() -> str:
    return os.environ.get("NEXTTEX_DICTIONARY_BASE", BASE).rstrip("/")


def cache_dir() -> Path:
    return state_home() / "dictionaries"


def cached(code: str) -> bool:
    """Whether both of a language's files are already on this machine."""
    language = LANGUAGES.get(code)
    if language is None:
        return False
    folder = cache_dir() / f"{language.package}@{language.version}"
    return all((folder / name).is_file() for name in FILES)


# One fetch per language at a time: two editors opening a German project
# together ask twice, and the second waits for the first's files.
_locks: dict[str, threading.Lock] = {code: threading.Lock() for code in LANGUAGES}


def path_of(code: str, name: str, fetch=None) -> Path:
    """The local copy of one of a language's two files, fetched and
    verified first if this machine does not have it yet.

    `fetch(url) -> bytes` is the network, replaceable in tests.
    """
    language = LANGUAGES.get(code)
    if language is None:
        raise DictionaryError(f"there is no word list for {code!r}")
    if name not in FILES:
        raise DictionaryError(f"{name!r} is not one of a word list's files")
    folder = cache_dir() / f"{language.package}@{language.version}"
    target = folder / name
    if target.is_file():
        return target
    with _locks[code]:
        if target.is_file():
            return target
        getter = fetch or _get
        for index, each in enumerate(FILES):
            if (folder / each).is_file():
                continue
            url = f"{_base()}/{language.package}@{language.version}/{each}"
            data = getter(url)
            if hashlib.sha256(data).hexdigest() != language.hashes[index]:
                raise DictionaryError(
                    f"the {language.name} word list that arrived is not the one expected, so it was not kept"
                )
            folder.mkdir(parents=True, exist_ok=True)
            write_atomically(folder / each, data)
    return target


def _get(url: str) -> bytes:
    import requests

    try:
        answer = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, stream=True)
    except requests.RequestException as error:
        raise DictionaryError(f"could not fetch the word list: {error}")
    if answer.status_code != 200:
        raise DictionaryError(f"the word list's host answered {answer.status_code}")
    chunks: list[bytes] = []
    total = 0
    for chunk in answer.iter_content(1024 * 1024):
        total += len(chunk)
        if total > MAX_BYTES:
            raise DictionaryError("the word list is far larger than any should be")
        chunks.append(chunk)
    return b"".join(chunks)
