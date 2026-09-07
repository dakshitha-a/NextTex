"""The writer's own words.

The point of the feature is that a technical term stops being underlined
once and for good, so what these check is that a word survives the round
trip and that nothing about how it was typed decides whether it matches.
"""

import server.main as server_main


def words(client, project):
    return client.get(f"/api/projects/{project['id']}/dictionary").json()["words"]


def test_a_project_starts_with_no_words_of_its_own(client, project):
    assert words(client, project) == []


def test_a_word_added_is_a_word_kept(client, project):
    added = client.post(
        f"/api/projects/{project['id']}/dictionary", json={"word": "nitrophenol"}
    ).json()["words"]
    assert added == ["nitrophenol"]
    assert words(client, project) == ["nitrophenol"]


def test_case_and_stray_punctuation_do_not_make_a_second_word(client, project):
    for typed in ["Matsika", "matsika", "  MATSIKA  ", "matsika,"]:
        client.post(f"/api/projects/{project['id']}/dictionary", json={"word": typed})
    assert words(client, project) == ["matsika"]


def test_a_word_can_be_taken_back(client, project):
    for word in ["sorci", "conical"]:
        client.post(f"/api/projects/{project['id']}/dictionary", json={"word": word})
    left = client.request(
        "DELETE",
        f"/api/projects/{project['id']}/dictionary",
        params={"word": "SORCI"},
    ).json()["words"]
    assert left == ["conical"]


def test_an_empty_word_is_not_a_word(client, project):
    client.post(f"/api/projects/{project['id']}/dictionary", json={"word": "   "})
    assert words(client, project) == []


def test_the_list_is_plain_text_a_writer_can_edit(client, project):
    # Two hundred species names should be a paste, not two hundred clicks.
    # The session is reached through a request rather than built here: it
    # starts the agent pump, which needs the loop the request runs on.
    client.post(f"/api/projects/{project['id']}/dictionary", json={"word": "seed"})
    store = server_main.SESSIONS[project["id"]].dictionary
    store.path.parent.mkdir(parents=True, exist_ok=True)
    store.path.write_text("Adiabatic\nsorci\n\nAdiabatic\n", encoding="utf-8")
    assert words(client, project) == ["adiabatic", "sorci"]
