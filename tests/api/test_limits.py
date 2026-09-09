"""What one request may carry, and what the editor will open.

There was no limit of any kind on either. The upload route streams, so a
large file never exhausted memory, but nothing stopped it filling the disk;
`read_file` and the context route both pull a whole file into memory in one
call on the event loop, so a big enough file does not merely fail slowly, it
stalls every other browser on the install while it is read and then again
while it is encoded.

The limits are lowered here rather than tested at their real values, because
a test that writes a quarter of a gigabyte to disk to prove a comparison is a
test nobody will keep running. `test_the_limits_are_ordered` is what covers
the real numbers.
"""

import pytest

from server import main as server_main


def test_the_limits_are_ordered():
    """The shipped values, which the rest of this file lowers."""
    assert server_main.MAX_TEXT_BYTES < server_main.MAX_UPLOAD_BYTES
    assert server_main.MAX_UPLOAD_BYTES <= server_main.MAX_UPLOAD_TOTAL
    # One drop of files is the largest thing anybody sends this server, so
    # a request may carry a full upload and no more.
    assert server_main.MAX_UPLOAD_TOTAL == server_main.MAX_BODY_BYTES


def test_a_file_too_large_to_open_says_so(client, opened, monkeypatch):
    monkeypatch.setattr(server_main, "MAX_TEXT_BYTES", 64)
    (server_main.session_for(opened["id"]).project.root / "big.tex").write_text(
        "x" * 200, encoding="utf-8"
    )
    answer = client.get(f"/api/projects/{opened['id']}/file", params={"path": "big.tex"})
    assert answer.status_code == 413
    # Both halves, because "too large" without a number is not actionable.
    assert "200 bytes" in answer.json()["detail"]
    assert "64 bytes" in answer.json()["detail"]


def test_a_file_that_fits_still_opens(client, opened, monkeypatch):
    monkeypatch.setattr(server_main, "MAX_TEXT_BYTES", 64)
    (server_main.session_for(opened["id"]).project.root / "small.tex").write_text(
        "x" * 10, encoding="utf-8"
    )
    answer = client.get(f"/api/projects/{opened['id']}/file", params={"path": "small.tex"})
    assert answer.status_code == 200
    assert answer.json()["text"] == "x" * 10


def test_an_oversized_upload_is_refused_per_file(client, opened, monkeypatch):
    """The rest of the drop still lands, the way a refused control file does.

    Losing four good figures because the fifth was too big would be a worse
    answer than the one this gives.
    """
    monkeypatch.setattr(server_main, "MAX_UPLOAD_BYTES", 32)
    answer = client.post(
        f"/api/projects/{opened['id']}/upload",
        files=[
            ("files", ("small.png", b"\x89PNG" + b"." * 10, "image/png")),
            ("files", ("huge.png", b"\x89PNG" + b"." * 500, "image/png")),
        ],
    )
    assert answer.status_code == 200
    outcomes = {r["name"]: r["outcome"] for r in answer.json()["results"]}
    assert outcomes == {"small.png": "written", "huge.png": "too-big"}
    assert answer.json()["written"] == ["small.png"]

    root = server_main.session_for(opened["id"]).project.root
    assert (root / "small.png").exists()
    assert not (root / "huge.png").exists()
    # And nothing half-written was left behind under its working name.
    assert not list(root.glob("*.part"))


def test_a_drop_of_too_many_files_is_refused_whole(client, opened, monkeypatch):
    monkeypatch.setattr(server_main, "MAX_UPLOAD_FILES", 2)
    answer = client.post(
        f"/api/projects/{opened['id']}/upload",
        files=[("files", (f"f{n}.png", b"\x89PNG", "image/png")) for n in range(3)],
    )
    assert answer.status_code == 413
    assert "up to 2" in answer.json()["detail"]


def test_the_running_total_stops_a_drop_that_adds_up(client, opened, monkeypatch):
    """Each file inside the per-file limit, the drop as a whole outside it."""
    monkeypatch.setattr(server_main, "MAX_UPLOAD_BYTES", 1 << 20)
    monkeypatch.setattr(server_main, "MAX_UPLOAD_TOTAL", 60)
    answer = client.post(
        f"/api/projects/{opened['id']}/upload",
        files=[("files", (f"f{n}.png", b"." * 40, "image/png")) for n in range(3)],
    )
    outcomes = [r["outcome"] for r in answer.json()["results"]]
    assert outcomes == ["written", "too-big", "too-big"]


def test_a_request_larger_than_the_install_accepts(client, opened, monkeypatch):
    """The gate in front of everything.

    Starlette spools a multipart body to a temporary file before any route
    sees it, so the per-file limits bound what lands in the project and this
    is what bounds what the machine absorbs getting there.
    """
    monkeypatch.setattr(server_main, "MAX_BODY_BYTES", 8)
    answer = client.post(
        f"/api/projects/{opened['id']}/upload",
        files=[("files", ("f.png", b"." * 100, "image/png"))],
    )
    assert answer.status_code == 413
    assert "larger than this install accepts" in answer.json()["error"]


def test_a_context_file_too_large_is_refused(client, opened, monkeypatch):
    """This route reads the whole file in one call with nothing in front of
    it, which is why it is capped even though the upload route streams."""
    monkeypatch.setattr(server_main, "MAX_UPLOAD_BYTES", 16)
    answer = client.post(
        f"/api/projects/{opened['id']}/context",
        data={"kind": next(iter(server_main.KINDS)), "note": ""},
        files=[("files", ("brief.pdf", b"%PDF" + b"." * 200, "application/pdf"))],
    )
    assert answer.status_code == 413
    assert "brief.pdf" in answer.json()["detail"]
