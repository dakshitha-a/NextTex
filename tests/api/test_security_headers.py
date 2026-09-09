"""The headers on every answer, including the answers that skip a route.

The security aspect added a content policy, a framing rule, nosniff and a
referrer policy, and no test covered any of them. That is how the ordering
went unnoticed: Starlette builds its middleware stack with the last one added
on the outside, `authenticate` was added last, and so its refusals went back
to the browser without ever passing through the middleware that adds these.
The sign-in page is one of those refusals. It is the one page an
unauthenticated visitor sees, it takes a password, and it was the page with no
framing rule on it.
"""

import logging

import pytest
from starlette.testclient import TestClient

from server import main as server_main

# The four this app sets, and the one it computes per install.
EXPECTED = {
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
}


def missing(response) -> set:
    return EXPECTED - {name.lower() for name in response.headers}


@pytest.fixture
def raw():
    """A client that returns the 500 rather than re-raising it.

    `raise_server_exceptions` defaults to true, which is right for every other
    test: an unexpected exception should fail the test that caused it. Here
    the response *is* the subject.
    """
    with TestClient(server_main.app, raise_server_exceptions=False) as c:
        c.cookies.set(server_main.COOKIE, server_main.SETTINGS.token)
        yield c


def test_an_ordinary_answer_carries_them(client):
    assert not missing(client.get("/api/auth"))


def test_the_sign_in_page_carries_them():
    """The regression. No token at all, so `authenticate` answers with the
    sign-in page and never calls a route."""
    with TestClient(server_main.app) as anonymous:
        answer = anonymous.get("/")
    assert answer.status_code == 401
    assert not missing(answer)
    assert answer.headers["x-frame-options"] == "DENY"


def test_a_refused_origin_carries_them():
    """The other early return, for the same reason."""
    with TestClient(server_main.app) as anonymous:
        answer = anonymous.post(
            "/api/logout",
            headers={"origin": "http://127.0.0.1:5173", "host": "127.0.0.1:8450"},
        )
    assert answer.status_code == 403
    assert not missing(answer)


def test_a_failure_nothing_anticipated_carries_them(raw, monkeypatch):
    """An unhandled exception is turned into a response *above* the
    middleware, in Starlette's own error handling, so it needs the headers
    stamped on it too rather than inherited."""
    def explode(force=False):
        raise RuntimeError("a test, deliberately unhandled")

    monkeypatch.setattr(server_main.UPDATES, "get", explode)
    answer = raw.get("/api/update")
    assert answer.status_code == 500
    assert not missing(answer)


def test_a_failure_is_readable_by_the_browser(raw, monkeypatch, caplog):
    """Starlette answers the plain text "Internal Server Error", which is not
    JSON, so `api.ts` could not read it and fell back to the status line. The
    writer was told "Internal Server Error" and given nothing to go on."""
    def explode(force=False):
        raise RuntimeError("a test, deliberately unhandled")

    monkeypatch.setattr(server_main.UPDATES, "get", explode)
    with caplog.at_level(logging.ERROR, logger="nexttex.server"):
        answer = raw.get("/api/update")

    assert answer.headers["content-type"].startswith("application/json")
    shown = answer.json()["error"]

    # The reference is the point: what is on screen and what is in the
    # terminal have to name each other, or the log is unreachable from the
    # only place the writer is looking.
    reference = shown.rsplit(" ", 1)[-1].rstrip(".")
    assert len(reference) == 8
    assert reference in caplog.text
    assert "GET /api/update" in caplog.text
    assert "RuntimeError" in caplog.text

    # And nothing about the inside of the server is handed to the browser.
    assert "deliberately unhandled" not in shown
    assert "Traceback" not in answer.text
