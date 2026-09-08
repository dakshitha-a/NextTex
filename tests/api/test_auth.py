"""Signing in.

The property worth protecting here is that the cookie a browser holds is no
longer the instance token.  Before, they were the same string: a copied
cookie was a copied install, and there was nothing to revoke because there
was nothing per-browser to revoke.  Most of these tests are about that
distinction holding under each way in.
"""

import pytest
from starlette.testclient import TestClient

from nexttex import auth
from server import main as server_main


@pytest.fixture(autouse=True)
def _clean_credentials():
    """Every test starts with no password and nobody signed in."""
    settings = server_main.SETTINGS
    before = (settings.password_hash, settings.password_salt,
              list(settings.sessions), settings.display_name)
    settings.password_hash = settings.password_salt = ""
    settings.sessions = []
    settings.display_name = ""
    auth._FAILURES.clear()
    yield
    (settings.password_hash, settings.password_salt,
     settings.sessions, settings.display_name) = before
    auth._FAILURES.clear()


@pytest.fixture
def anon():
    """A client carrying no credentials at all."""
    with TestClient(server_main.app) as client:
        yield client


# --- the password itself ---------------------------------------------------


def test_scrypt_round_trip():
    stored, salt = auth.hash_password("correct horse battery")
    assert auth.verify_password("correct horse battery", stored, salt)
    assert not auth.verify_password("Correct horse battery", stored, salt)
    assert not auth.verify_password("", stored, salt)


def test_no_password_set_verifies_nothing():
    """An install with no password must not be openable with a guess of ''."""
    assert not auth.verify_password("", "", "")
    assert not auth.verify_password("anything", "", "")


def test_a_salt_is_per_password():
    first, salt_a = auth.hash_password("same")
    second, salt_b = auth.hash_password("same")
    assert salt_a != salt_b and first != second


# --- what an unauthenticated browser gets ----------------------------------


def test_api_without_credentials_is_401(anon):
    assert anon.get("/api/projects").status_code == 401


def test_a_page_without_credentials_gets_the_sign_in_screen(anon):
    response = anon.get("/", headers={"accept": "text/html"})
    assert response.status_code == 401
    assert "NextTex" in response.text
    # With no password set it must say so, and name the recovery command,
    # rather than showing a password box nothing can answer.
    assert "no password yet" in response.text
    assert "--print-url" in response.text


def test_the_sign_in_screen_offers_a_password_box_once_one_is_set(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("hunter2 hunter2"))
    response = anon.get("/", headers={"accept": "text/html"})
    assert response.status_code == 401
    assert 'type=password' in response.text
    assert "--set-password" in response.text


def test_login_is_reachable_without_credentials(anon):
    """It has to be: it is how a browser stops being unauthenticated."""
    response = anon.post("/api/login", json={"password": "x"})
    assert response.status_code != 401 or "password" in response.text.lower()


# --- signing in ------------------------------------------------------------


def test_login_with_no_password_set_is_refused(anon):
    response = anon.post("/api/login", json={"password": ""})
    assert response.status_code == 403
    assert "no password" in response.json()["error"].lower()


def test_a_wrong_password_is_refused_and_sets_no_cookie(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("the right one"))
    response = anon.post("/api/login", json={"password": "the wrong one"})
    assert response.status_code == 401
    assert server_main.COOKIE not in response.cookies


def test_the_right_password_issues_a_session_that_is_not_the_token(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("the right one"))
    response = anon.post("/api/login", json={"password": "the right one"})
    assert response.status_code == 200

    cookie = response.cookies[server_main.COOKIE]
    # The whole point of the change.
    assert cookie != server_main.SETTINGS.token
    assert len(server_main.SETTINGS.sessions) == 1
    # And what is stored is a fingerprint, not the credential.
    assert server_main.SETTINGS.sessions[0]["hash"] != cookie
    assert server_main.SETTINGS.sessions[0]["hash"] == auth.token_fingerprint(cookie)

    # That session then works on its own.
    assert anon.get("/api/projects").status_code == 200


def test_a_session_is_httponly_so_script_cannot_read_it(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("the right one"))
    response = anon.post("/api/login", json={"password": "the right one"})
    header = response.headers["set-cookie"]
    assert "HttpOnly" in header and "SameSite=lax" in header


def test_a_forged_session_is_refused(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("the right one"))
    anon.post("/api/login", json={"password": "the right one"})
    anon.cookies.set(server_main.COOKIE, "not-a-real-session-token")
    assert anon.get("/api/projects").status_code == 401


# --- the instance token stays the recovery path ----------------------------


def test_the_token_still_works_as_a_query_parameter(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("forgotten"))
    response = anon.get(f"/api/projects?token={server_main.SETTINGS.token}")
    assert response.status_code == 200


def test_the_token_still_works_as_a_header(anon):
    response = anon.get("/api/projects",
                        headers={"x-nexttex-token": server_main.SETTINGS.token})
    assert response.status_code == 200


def test_a_header_request_is_not_given_a_cookie(anon):
    """A script does not need a session, and minting one per call would fill
    the config file with rows nobody can act on."""
    response = anon.get("/api/projects",
                        headers={"x-nexttex-token": server_main.SETTINGS.token})
    assert server_main.COOKIE not in response.cookies
    assert server_main.SETTINGS.sessions == []


def test_a_browser_holding_the_old_token_cookie_is_upgraded(anon):
    """Installs that predate this feature gave the browser the instance token
    as its cookie.  Those browsers must keep working, and quietly stop
    holding the master credential."""
    anon.cookies.set(server_main.COOKIE, server_main.SETTINGS.token,
                     domain="testserver.local")
    response = anon.get("/", headers={"accept": "text/html"})
    assert response.status_code == 200
    assert len(server_main.SETTINGS.sessions) == 1
    # The reply replaces the cookie with a session, so the browser stops
    # holding the instance token from here on.
    issued = response.headers["set-cookie"]
    assert server_main.COOKIE in issued
    assert server_main.SETTINGS.token not in issued


# --- setting and changing the password -------------------------------------


def test_setting_a_first_password_needs_no_current_one(client):
    response = client.post("/api/auth/password",
                           json={"password": "eight or more", "display_name": "Dakshitha"})
    assert response.status_code == 200
    assert server_main.SETTINGS.display_name == "Dakshitha"
    assert auth.verify_password("eight or more",
                                server_main.SETTINGS.password_hash,
                                server_main.SETTINGS.password_salt)


def test_a_short_password_is_refused(client):
    response = client.post("/api/auth/password", json={"password": "short"})
    assert response.status_code == 400
    assert server_main.SETTINGS.password_hash == ""


def test_changing_a_password_needs_the_current_one(client):
    client.post("/api/auth/password", json={"password": "the first one"})
    response = client.post("/api/auth/password",
                           json={"password": "the second one", "current": "wrong"})
    assert response.status_code == 403
    assert auth.verify_password("the first one",
                                server_main.SETTINGS.password_hash,
                                server_main.SETTINGS.password_salt)


def test_changing_a_password_signs_other_browsers_out(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("the first one"))

    # Two browsers, each with its own session.
    other = TestClient(server_main.app)
    other.post("/api/login", json={"password": "the first one"})
    anon.post("/api/login", json={"password": "the first one"})
    assert len(server_main.SETTINGS.sessions) == 2

    anon.post("/api/auth/password",
              json={"password": "the second one", "current": "the first one"})

    # The one that changed it stays in; the other is out.
    assert anon.get("/api/projects").status_code == 200
    assert other.get("/api/projects").status_code == 401


def test_the_instance_token_can_change_a_forgotten_password(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("long forgotten"))
    response = anon.post(f"/api/auth/password?token={server_main.SETTINGS.token}",
                         json={"password": "a fresh one"})
    assert response.status_code == 200
    assert auth.verify_password("a fresh one",
                                server_main.SETTINGS.password_hash,
                                server_main.SETTINGS.password_salt)


# --- managing sessions -----------------------------------------------------


def test_sign_out_other_browsers_keeps_this_one(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("the password"))
    other = TestClient(server_main.app)
    other.post("/api/login", json={"password": "the password"})
    anon.post("/api/login", json={"password": "the password"})

    response = anon.delete("/api/auth/sessions")
    assert response.status_code == 200
    assert anon.get("/api/projects").status_code == 200
    assert other.get("/api/projects").status_code == 401


def test_logout_forgets_this_session(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("the password"))
    anon.post("/api/login", json={"password": "the password"})
    assert len(server_main.SETTINGS.sessions) == 1

    anon.post("/api/logout")
    assert server_main.SETTINGS.sessions == []


def test_the_session_list_never_carries_a_usable_credential(anon):
    server_main.SETTINGS.password_hash, server_main.SETTINGS.password_salt = (
        auth.hash_password("the password"))
    anon.post("/api/login", json={"password": "the password"})

    listed = anon.get("/api/auth").json()
    assert listed["hasPassword"] is True
    row = listed["sessions"][0]
    assert row["current"] is True
    # Twelve characters of a sha256, which identifies a row and opens nothing.
    assert len(row["id"]) == 12
    assert "hash" not in row


def test_sessions_are_capped(anon):
    records = [auth.new_session(f"browser {n}")[1] for n in range(auth.MAX_SESSIONS + 5)]
    assert len(auth.prune(records)) == auth.MAX_SESSIONS


def test_an_expired_session_is_not_accepted():
    token, record = auth.new_session()
    record["created"] = record["created"] - auth.SESSION_TTL_SECONDS - 1
    assert auth.find_session([record], token) is None


# --- throttling ------------------------------------------------------------


def test_repeated_failures_start_costing_time():
    assert auth.failure_delay("10.0.0.1") == 0.0
    for _ in range(3):
        auth.note_failure("10.0.0.1")
    assert auth.failure_delay("10.0.0.1") > 0
    # And a success clears it, so the person at the keyboard is not punished
    # for the rest of the evening.
    auth.note_success("10.0.0.1")
    assert auth.failure_delay("10.0.0.1") == 0.0


def test_the_failure_table_cannot_grow_without_bound():
    for n in range(700):
        auth.note_failure(f"10.1.{n // 256}.{n % 256}")
    assert len(auth._FAILURES) <= 512


# --- browser labels --------------------------------------------------------


@pytest.mark.parametrize("ua, expected", [
    ("Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/128.0", "Firefox on Linux"),
    ("Mozilla/5.0 (Macintosh) AppleWebKit Chrome/120 Safari/537", "Chrome on macOS"),
    ("Mozilla/5.0 (Windows NT 10.0) Edg/120", "Edge on Windows"),
    ("", "A browser"),
])
def test_a_session_row_names_the_browser(ua, expected):
    assert auth.label_for(ua) == expected


# --- the printed link is loaded again and again ----------------------------


def test_reloading_the_printed_link_does_not_pile_up_sessions(anon):
    """The `?token=` URL is the one people bookmark, so it is loaded on every
    visit.  Each load used to file another row in the settings card for the
    same browser, and "sign out 1 other browser" then meant yourself."""
    url = f"/?token={server_main.SETTINGS.token}"
    for _ in range(5):
        assert anon.get(url, headers={"accept": "text/html"}).status_code == 200
    assert len(server_main.SETTINGS.sessions) == 1


def test_a_second_browser_still_gets_its_own_session(anon):
    """The de-duplication must be per browser, not per install."""
    url = f"/?token={server_main.SETTINGS.token}"
    anon.get(url, headers={"accept": "text/html"})
    other = TestClient(server_main.app)
    other.get(url, headers={"accept": "text/html"})
    assert len(server_main.SETTINGS.sessions) == 2
