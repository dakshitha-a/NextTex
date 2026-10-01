"""Write the reply letter: the route."""


def test_no_open_comments_is_a_sentence(client, opened):
    answer = client.post(f"/api/projects/{opened['id']}/reply", json={})
    assert answer.status_code == 409
    assert "no open comments" in answer.json()["detail"]
