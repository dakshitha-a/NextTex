"""Grammar findings a project says to leave alone."""

from nexttex.dictionary import GrammarIgnores, ProjectDictionary


def test_a_key_is_kept_evened_out_and_taken_back(client, opened, project_dir):
    url = f"/api/projects/{opened['id']}/grammar-ignored"
    assert client.get(url).json() == {"keys": []}
    added = client.post(url, json={"key": "Repetition:  The   the"}).json()["keys"]
    assert added == ["repetition: the the"]
    # Beside the dictionary, and not in it.
    state = project_dir / ".nexttex"
    assert (state / "grammar-ignored.txt").read_text() == "repetition: the the\n"
    assert not (state / "dictionary.txt").exists() or "the the" not in (state / "dictionary.txt").read_text()
    assert client.delete(url, params={"key": "repetition: the the"}).json() == {"keys": []}


def test_the_word_list_and_the_ignores_clean_differently(tmp_path):
    assert ProjectDictionary(tmp_path).add("'Nitrophenol,") == ["nitrophenol"]
    assert GrammarIgnores(tmp_path).add("Agreement: results is") == ["agreement: results is"]
    assert len(GrammarIgnores.clean("x" * 500)) == 200
