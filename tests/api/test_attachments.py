"""Images a writer hands to the agent.

The bytes go on disk and the question carries the path, which is the one
section 27 of the design document was written about: an image on this wire
is base64, the hook ships a tool result twice, and that is how a 290 KB
figure measured 1.15 MB and killed the reader mid-turn.  The agent already
reads images from disk, so there is no second image path to keep working.
"""

import io
import zlib

from tests.api.conftest import wait_idle


def png(colour: int = 0) -> bytes:
    """The smallest real PNG, so the route's own checks are what is tested
    rather than an image library's."""
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            len(payload).to_bytes(4, "big") + kind + payload
            + zlib.crc32(kind + payload).to_bytes(4, "big")
        )

    header = (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    pixel = zlib.compress(bytes([0, colour, colour, colour]))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", pixel)
        + chunk(b"IEND", b"")
    )


def attach(client, project_id, data=None, name="paste.png", kind="image/png"):
    return client.post(
        f"/api/projects/{project_id}/agent/attachment",
        files={"file": (name, io.BytesIO(data if data is not None else png()), kind)},
    )


def test_an_image_lands_on_disk_and_says_where(client, opened):
    response = attach(client, opened["id"])
    assert response.status_code == 200
    body = response.json()
    assert body["path"].startswith(".nexttex/attachments/")
    assert body["path"].endswith(".png")
    assert body["bytes"] > 0


def test_the_same_image_twice_costs_one_file(client, opened, project_dir):
    """Content addressed, like everything else this app keeps."""
    first = attach(client, opened["id"]).json()["path"]
    second = attach(client, opened["id"]).json()["path"]
    assert first == second
    kept = list((project_dir / ".nexttex" / "attachments").iterdir())
    assert len(kept) == 1


def test_something_that_is_not_an_image_is_refused(client, opened):
    """A file the model cannot look at is better refused here than turned
    into a tool call that fails."""
    response = attach(
        client, opened["id"], data=b"\\documentclass{article}",
        name="main.tex", kind="text/x-tex",
    )
    assert response.status_code == 400
    assert "image" in response.json()["detail"].lower()


def test_an_image_too_large_for_the_model_is_refused_with_a_number(client, opened):
    """The upload path allows 256 MB, which is right for a dataset and
    wrong here: the model has its own limit, so a huge screenshot is a
    failed turn rather than a slow one."""
    from nexttex import attachments

    response = attach(client, opened["id"], data=b"x" * (attachments.LIMIT + 1))
    # Refused on size before it is refused on not being a PNG, because size
    # is the thing worth telling the writer about.
    assert response.status_code in (400, 413)


def test_an_empty_file_is_refused(client, opened):
    assert attach(client, opened["id"], data=b"").status_code == 400


def test_the_question_carries_the_path_and_the_panel_does_not(client, opened):
    """`turn_start` shows what was typed, not the question with a list of
    paths stapled to it. The chips under the composer are what say an image
    went with it."""
    path = attach(client, opened["id"]).json()["path"]
    client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={"prompt": "What is wrong with this table?", "attached": [path]},
    )
    wait_idle(opened["id"])
    items = client.post(f"/api/projects/{opened['id']}/open").json()["transcript"]
    asked = [item for item in items if item["kind"] == "user"]
    assert asked and asked[0]["text"] == "What is wrong with this table?"
    assert ".nexttex" not in asked[0]["text"]


def test_a_path_nobody_attached_is_dropped(client, opened):
    """A list of strings out of an HTTP body, and the one thing it must not
    become is a way to make the agent read an arbitrary path."""
    response = client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={
            "prompt": "Look at this.",
            "attached": [
                "../../../../etc/passwd",
                ".nexttex/attachments/never-existed.png",
                "/etc/hosts",
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["attached"] == []
    wait_idle(opened["id"])


def test_only_so_many_are_taken(client, opened):
    from nexttex import attachments

    paths = [
        attach(client, opened["id"], data=png(index)).json()["path"]
        for index in range(attachments.MOST + 3)
    ]
    response = client.post(
        f"/api/projects/{opened['id']}/agent/ask",
        json={"prompt": "All of these.", "attached": paths},
    )
    assert len(response.json()["attached"]) == attachments.MOST
    wait_idle(opened["id"])
