"""The project's spelling language: the key, the preamble's hint, the
setting, and the routes that hand the browser a word list."""

import hashlib

import pytest

from nexttex import dictionaries
from nexttex.project import ProjectConfig
from nexttex.symbols import language_of


@pytest.mark.parametrize("preamble,code", [
    (r"\usepackage[english,ngerman]{babel}", "de"),
    (r"\usepackage[main=brazilian]{babel}", "pt"),
    (r"\usepackage{polyglossia}\setmainlanguage{french}", "fr"),
    (r"\usepackage{polyglossia}\setdefaultlanguage[variant=mexican]{spanish}", "es"),
    (r"\usepackage[ngerman,english]{babel}", None),     # English is the main one
    (r"\usepackage[british]{babel}", None),
    (r"\usepackage[italian]{babel}", None),             # no list for it
    ("", None),
])
def test_the_preamble_suggests_a_language(preamble, code):
    found = language_of(f"\\documentclass{{article}}\n{preamble}\n\\begin{{document}}\n")
    assert (found or {}).get("code") == code
    if found:
        assert found["line"] in preamble


def test_a_babel_line_in_the_body_says_nothing():
    assert language_of("\\begin{document}\n\\usepackage[ngerman]{babel}") is None


def test_the_key_round_trips_and_nonsense_is_english(tmp_path):
    config = ProjectConfig(name="x", language="de")
    config.save(tmp_path)
    assert 'language = "de"' in (tmp_path / "nexttex.toml").read_text()
    assert ProjectConfig.load(tmp_path).language == "de"
    (tmp_path / "nexttex.toml").write_text('[project]\nlanguage = "../x"\n')
    assert ProjectConfig.load(tmp_path).language == ""
    ProjectConfig(name="x").save(tmp_path)
    assert "language" not in (tmp_path / "nexttex.toml").read_text()


def test_the_setting_is_one_of_the_four_or_english(client, opened, project_dir):
    url = f"/api/projects/{opened['id']}/settings"
    assert client.post(url, json={"language": "fr"}).json()["language"] == "fr"
    assert ProjectConfig.load(project_dir).language == "fr"
    assert client.post(url, json={"language": "en"}).json()["language"] == "en"
    assert client.post(url, json={"language": "xx"}).status_code == 400
    assert client.post(url, json={"language": ""}).json()["language"] == ""


@pytest.fixture
def fake_german(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    aff, dic = b"SET UTF-8\n", b"1\nWort\n"
    monkeypatch.setitem(dictionaries.LANGUAGES, "de", dictionaries.Language(
        "de", "German", "dictionary-de", "3.0.0",
        (hashlib.sha256(aff).hexdigest(), hashlib.sha256(dic).hexdigest()), 20,
    ))
    files = {"index.aff": aff, "index.dic": dic}
    monkeypatch.setattr(dictionaries, "_get", lambda url: files[url.rsplit("/", 1)[1]])
    return files


def test_the_routes_list_the_languages_and_serve_a_list(client, fake_german):
    listed = client.get("/api/dictionaries").json()["languages"]
    assert {l["code"] for l in listed} == {"de", "fr", "es", "pt"}
    assert next(l for l in listed if l["code"] == "de")["cached"] is False
    served = client.get("/api/dictionaries/de/index.dic")
    assert served.status_code == 200 and served.content == fake_german["index.dic"]
    assert "immutable" in served.headers["cache-control"]
    assert next(l for l in client.get("/api/dictionaries").json()["languages"] if l["code"] == "de")["cached"]


@pytest.mark.parametrize("path", ["xx/index.aff", "de/index.txt", "de/..%2F..%2Fsecret", "..%2Fde/index.aff"])
def test_nothing_but_the_four_lists_is_served(client, fake_german, path):
    assert client.get(f"/api/dictionaries/{path}").status_code == 404


def test_a_list_that_cannot_be_had_says_why(client, monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    def refuse(url):
        raise dictionaries.DictionaryError("could not fetch the word list: offline")
    monkeypatch.setattr(dictionaries, "_get", refuse)
    answer = client.get("/api/dictionaries/fr/index.aff")
    assert answer.status_code == 502 and "offline" in answer.json()["detail"]
