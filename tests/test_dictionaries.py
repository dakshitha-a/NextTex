"""Word lists fetched once per machine, verified, and kept."""

import hashlib

import pytest

from nexttex import dictionaries


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    return tmp_path


def fake_language(monkeypatch, aff=b"SET UTF-8\n", dic=b"1\nWort\n"):
    language = dictionaries.Language(
        "de", "German", "dictionary-de", "3.0.0",
        (hashlib.sha256(aff).hexdigest(), hashlib.sha256(dic).hexdigest()), len(aff) + len(dic),
    )
    monkeypatch.setitem(dictionaries.LANGUAGES, "de", language)
    return {"index.aff": aff, "index.dic": dic}


def test_a_list_is_fetched_once_verified_and_kept(home, monkeypatch):
    monkeypatch.delenv("NEXTTEX_DICTIONARY_BASE")
    files = fake_language(monkeypatch)
    asked: list[str] = []

    def fetch(url):
        asked.append(url)
        return files[url.rsplit("/", 1)[1]]

    assert not dictionaries.cached("de")
    path = dictionaries.path_of("de", "index.dic", fetch)
    assert path.read_bytes() == files["index.dic"]
    assert dictionaries.cached("de")
    # Both files in one go, from the pinned package and version.
    assert asked == [
        "https://cdn.jsdelivr.net/npm/dictionary-de@3.0.0/index.aff",
        "https://cdn.jsdelivr.net/npm/dictionary-de@3.0.0/index.dic",
    ]
    # And never again.
    dictionaries.path_of("de", "index.aff", fetch)
    assert len(asked) == 2
    assert path.is_relative_to(home)


def test_a_list_that_is_not_the_pinned_one_is_not_kept(home, monkeypatch):
    fake_language(monkeypatch)
    with pytest.raises(dictionaries.DictionaryError, match="not the one expected"):
        dictionaries.path_of("de", "index.aff", lambda url: b"something else")
    assert not dictionaries.cached("de")


def test_the_host_can_be_named_for_a_test(home, monkeypatch):
    files = fake_language(monkeypatch)
    monkeypatch.setenv("NEXTTEX_DICTIONARY_BASE", "http://127.0.0.1:9/npm/")
    asked = []
    dictionaries.path_of("de", "index.aff", lambda url: asked.append(url) or files[url.rsplit("/", 1)[1]])
    assert asked[0] == "http://127.0.0.1:9/npm/dictionary-de@3.0.0/index.aff"


@pytest.mark.parametrize("code,name", [("xx", "index.aff"), ("../de", "index.aff"), ("de", "../x"), ("de", "index.txt")])
def test_only_the_four_languages_and_their_two_files(home, code, name):
    with pytest.raises(dictionaries.DictionaryError):
        dictionaries.path_of(code, name, lambda url: b"")


def test_every_pin_is_a_sha256():
    for language in dictionaries.LANGUAGES.values():
        assert all(len(h) == 64 and int(h, 16) >= 0 for h in language.hashes)
        assert language.size > 100_000
