"""A page on another origin must not be able to act as the writer.

`SameSite=lax` on the session cookie is not the defence it looks like, because
a "site" is a scheme and a host and *not* a port.  A page served from
http://127.0.0.1:5173 -- a Vite dev server, a Jupyter notebook, whatever some
other project's `npm start` put there -- is same-site with NextTex, and the
browser sends the cookie with its requests.

Most routes were saved by accident rather than on purpose: they take a JSON
body, which makes the request non-simple, which means a preflight, which CORS
refuses because there is no CORS middleware.  The routes that take no body or
a form body had no such accident.  The worst of them writes a named file into
the project, and a file named `latexmkrc` is arbitrary Perl at the next full
build; another runs the update script.

The rule is the one `authorise_socket` already applies to WebSockets: same
origin, or no origin at all.  Absence is safe because a page cannot forge it,
and it is what curl, the installer and this test client send.
"""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from server import main as server_main

# A page on the same host and a different port: same-site, cross-origin.
NEIGHBOUR = "http://127.0.0.1:5173"


@pytest.fixture
def client():
    with TestClient(server_main.app) as c:
        c.headers.update({"x-nexttex-token": server_main.SETTINGS.token})
        yield c


# Every route reachable without a JSON body, which is every route that was
# reachable from a neighbouring page.  Each is asked for with a body-less
# POST, because what is asserted is the refusal, not the route's own reply.
BODYLESS = [
    "/api/logout",
    "/api/update",
    "/api/claude/logout",
    "/api/claude/login/cancel",
]


@pytest.mark.parametrize("path", BODYLESS)
def test_a_neighbouring_page_is_refused(client, path):
    answer = client.post(path, headers={"origin": NEIGHBOUR, "host": "127.0.0.1:8450"})
    assert answer.status_code == 403
    assert "another page" in answer.json()["error"]


@pytest.mark.parametrize("path", BODYLESS)
def test_the_same_origin_is_not_refused(client, path):
    """The check must not be a wall in front of the app's own fetches."""
    answer = client.post(path, headers={"origin": "http://testserver", "host": "testserver"})
    assert answer.status_code != 403


@pytest.mark.parametrize("site, refused", [
    ("cross-site", True),
    ("same-site", True),      # the different-port case, and the whole point
    ("same-origin", False),
    ("none", False),          # the address bar or a bookmark, which is a person
])
def test_sec_fetch_site_is_believed_when_it_is_sent(client, site, refused):
    answer = client.post("/api/logout", headers={"sec-fetch-site": site})
    assert (answer.status_code == 403) is refused


def test_a_request_with_neither_header_is_allowed(client):
    """curl, the install script and this suite send neither, and a page in a
    browser cannot arrange to send neither."""
    assert client.post("/api/logout").status_code != 403


def test_reading_is_never_refused(client):
    """The check is about acting, not about reading; a GET cannot be made
    unsafe by where it came from, and refusing one would break the printed
    link that arrives with no headers at all."""
    answer = client.get("/api/auth", headers={"origin": NEIGHBOUR})
    assert answer.status_code == 200


def test_an_upload_from_a_neighbouring_page_is_refused(client, opened):
    """The route this was found through.  A multipart body needs no preflight,
    and `Path(filename).name` of `latexmkrc` lands in the project root."""
    answer = client.post(
        f"/api/projects/{opened['id']}/upload",
        files={"files": ("latexmkrc", b"system('touch /tmp/pwned');", "text/plain")},
        headers={"origin": NEIGHBOUR, "host": "127.0.0.1:8450"},
    )
    assert answer.status_code == 403


def opened_root(opened):
    return Path(opened["root"])


def test_a_control_file_is_refused_even_from_the_right_origin(client, opened):
    """The origin check and the file rule are two answers to one question, and
    neither is the only thing standing there.  A writer's own browser, on the
    right origin, still cannot upload arbitrary Perl that the next build runs
    -- and the answer says so per file rather than failing the whole upload,
    because the rest of a multi-file drop is fine."""
    answer = client.post(
        f"/api/projects/{opened['id']}/upload",
        files=[
            ("files", ("latexmkrc", b"system('id');", "text/plain")),
            ("files", ("figure.png", b"\x89PNG\r\n\x1a\n", "image/png")),
        ],
    )
    assert answer.status_code == 200
    outcomes = {r["name"]: r["outcome"] for r in answer.json()["results"]}
    assert outcomes["latexmkrc"] == "refused"
    assert outcomes["figure.png"] == "written"
    assert not (opened_root(opened) / "latexmkrc").exists()
