"""Pages the agent publishes, through the routes that list, serve and
delete them. Every route that takes a path gets a path-escape test, and a
page's name is a path."""

from conftest import use_script, wait_idle

from nexttex.pages import Pages
from server import main as server_main


def pages_of(opened):
    return Pages(server_main.SESSIONS[opened["id"]].project.state_dir)


def test_a_published_page_is_listed_served_sandboxed_and_deleted(client, opened):
    pages_of(opened).save("Three Fits!", "<!doctype html><title>Fits</title><p>182 fs</p>")
    listed = client.get(f"/api/projects/{opened['id']}/pages").json()["pages"]
    assert [page["name"] for page in listed] == ["three-fits"]

    page = client.get(f"/api/projects/{opened['id']}/pages/three-fits")
    assert page.status_code == 200
    assert "182 fs" in page.text
    assert page.headers["content-type"].startswith("text/html")
    policy = page.headers["content-security-policy"]
    # An origin of its own, and nothing reached but the page's own storage.
    assert "sandbox allow-scripts" in policy and "allow-same-origin" not in policy
    assert f"connect-src http://testserver/api/projects/{opened['id']}/pages/three-fits/state;" in policy

    assert client.delete(f"/api/projects/{opened['id']}/pages/three-fits").status_code == 200
    assert client.get(f"/api/projects/{opened['id']}/pages/three-fits").status_code == 404


def test_a_page_name_cannot_leave_the_pages_folder(client, opened):
    state = server_main.SESSIONS[opened["id"]].project.state_dir
    (state / "secret.html").write_text("not a page")
    for name in ("..%2Fsecret", "%2E%2E%2Fsecret", "../secret", "..", "secret.html", "Three-Fits"):
        served = client.get(f"/api/projects/{opened['id']}/pages/{name}")
        # 405 where the client folded `..` into the project's own address
        # before sending, which depends on the HTTP library's version: not
        # a page either way, which is the point.
        assert served.status_code in (404, 405), name
        assert "not a page" not in served.text
        # A bare `..` is resolved by the client before it is sent, to the
        # project's own address, so only the forms that reach this route
        # are tried; the encoded ones are those.
        if name != "..":
            assert client.delete(f"/api/projects/{opened['id']}/pages/{name}").status_code in (404, 405), name
    assert (state / "secret.html").exists()


def test_the_agent_publishes_a_page_into_the_turn(client, opened):
    use_script(opened["id"], "page")
    client.post(f"/api/projects/{opened['id']}/agent/ask", json={"prompt": "A page, please."})
    wait_idle(opened["id"])
    items = client.post(f"/api/projects/{opened['id']}/open").json()["transcript"]
    assert {"kind": "page", "name": "three-fits"}.items() <= next(
        item for item in items if item.get("kind") == "page"
    ).items()
    assert client.get(f"/api/projects/{opened['id']}/pages/three-fits").status_code == 200


def test_a_sandboxed_page_may_read_katex_and_nothing_else_of_this_server(client, opened):
    """A published page's sandbox makes its every load cross-site, and the
    guard that refuses cross-site requests refused KaTeX too: the maths
    stayed source. Only the KaTeX folder is let through, only to read."""
    away = {"sec-fetch-site": "cross-site"}
    assert client.get("/assets/katex/katex.min.js", headers=away).status_code != 403
    assert client.get("/assets/index.js", headers=away).status_code == 403
    assert client.get(f"/api/projects/{opened['id']}/pages", headers=away).status_code == 403
    assert client.post("/assets/katex/katex.min.js", headers=away).status_code == 403


def test_the_page_policy_names_this_servers_katex(client, opened):
    pages_of(opened).save("p", "<!doctype html><p>x</p>")
    policy = client.get(f"/api/projects/{opened['id']}/pages/p").headers["content-security-policy"]
    assert "script-src 'unsafe-inline' http://testserver/assets/katex/;" in policy


def test_open_carries_the_installs_theme_onto_the_page(client, opened):
    pages_of(opened).save("p", "<!doctype html><html><body>x</body></html>")
    dark = client.get(f"/api/projects/{opened['id']}/pages/p?theme=dark").text
    assert '<html data-theme="dark">' in dark
    assert "data-theme" not in client.get(f"/api/projects/{opened['id']}/pages/p").text


def test_a_page_posts_its_storage_with_its_key_and_reads_it_back_on_the_next_load(client, opened):
    """`localStorage` throws in the sandbox, so the tracker the writer kept
    lost its ticks on every reload. The served page carries its storage
    and the address, key included, it posts changes to; the post is
    cross-site and cookieless, as the sandbox makes it, and the key is
    what opens the storage. A patch, so another reader's key stays."""
    pages_of(opened).save("tracker", "<!doctype html><html><head><title>T</title></head><body></body></html>")
    first = client.get(f"/api/projects/{opened['id']}/pages/tracker").text
    assert "var data={}," in first
    key = pages_of(opened).key("tracker")
    route = f"/api/projects/{opened['id']}/pages/tracker/state"
    assert f'url="http://testserver{route}?key={key}"' in first

    away = {"sec-fetch-site": "cross-site", "origin": "null", "content-type": "text/plain"}
    client.cookies.clear()
    posted = client.post(f"{route}?key={key}", content='{"set":{"done":"1","note":"<b>"},"clear":false}', headers=away)
    assert posted.status_code == 200, posted.text
    assert posted.headers["access-control-allow-origin"] == "*"
    assert client.post(f"{route}?key={key}", content='{"set":{"note":null,"other":"2"}}', headers=away).json() == {"keys": 2}
    assert pages_of(opened).state("tracker") == {"done": "1", "other": "2"}

    client.cookies.set(server_main.COOKIE, server_main.SETTINGS.token)
    again = client.get(f"/api/projects/{opened['id']}/pages/tracker").text
    assert 'var data={"done": "1", "other": "2"},' in again
    # Still there after the agent changes the page, gone with the page.
    pages_of(opened).save("tracker", "<!doctype html><p>v2</p>")
    assert 'var data={"done": "1", "other": "2"},' in client.get(f"/api/projects/{opened['id']}/pages/tracker").text
    client.delete(f"/api/projects/{opened['id']}/pages/tracker")
    assert pages_of(opened).state("tracker") == {}


def test_only_the_pages_own_key_opens_its_storage(client, opened):
    """The cookie, the instance token and another page's key open nothing
    here, and a bad patch or an oversized one writes nothing."""
    pages_of(opened).save("a", "<p>a</p>")
    pages_of(opened).save("b", "<p>b</p>")
    route = f"/api/projects/{opened['id']}/pages/a/state"
    away = {"sec-fetch-site": "cross-site", "origin": "null", "content-type": "text/plain"}
    body = '{"set":{"x":"1"}}'
    # The signed-in client's cookie is not a key.
    assert client.post(route, content=body, headers=away).status_code == 403
    assert client.post(f"{route}?key={server_main.SETTINGS.token}", content=body, headers=away).status_code == 403
    assert client.post(f"{route}?key={pages_of(opened).key('b')}", content=body, headers=away).status_code == 403
    assert client.post(f"/api/projects/{opened['id']}/pages/none/state?key=x", content=body, headers=away).status_code == 403
    assert pages_of(opened).state("a") == {}
    key = pages_of(opened).key("a")
    assert client.post(f"{route}?key={key}", content="not json", headers=away).status_code == 400
    assert client.post(f"{route}?key={key}", content='{"set":[1]}', headers=away).status_code == 400
    assert client.post(f"{route}?key={key}", content='[1]', headers=away).status_code == 400
    big = '{"set":{"x":"' + "y" * (300 * 1024) + '"}}'
    assert client.post(f"{route}?key={key}", content=big, headers=away).status_code == 400
    assert client.post(f"{route}?key={key}", content=big * 3, headers=away).status_code == 413
    # A body sent without its length is read no further than the cap.
    assert client.post(f"{route}?key={key}", content=iter([big.encode()] * 3), headers=away).status_code == 413
    assert pages_of(opened).state("a") == {}
    # Reading the storage route, or any other route, from the sandbox is
    # still refused: only the post is let past the cross-site check.
    assert client.get(f"{route}?key={key}", headers=away).status_code == 403
    assert client.post(f"/api/projects/{opened['id']}/pages/a/state/../../../open", headers=away).status_code in (403, 404, 405)


def test_a_storage_name_cannot_leave_the_pages_folder(client, opened):
    state = server_main.SESSIONS[opened["id"]].project.state_dir
    (state / "secret.json").write_text('{"s": "1"}')
    away = {"sec-fetch-site": "cross-site", "origin": "null", "content-type": "text/plain"}
    for name in ("..%2Fsecret", "%2E%2E%2Fsecret", "../secret", "secret.json", "Three-Fits", ".."):
        posted = client.post(f"/api/projects/{opened['id']}/pages/{name}/state?key=x",
                             content='{"set":{"s":"2"}}', headers=away)
        assert posted.status_code in (403, 404, 405), name
    assert (state / "secret.json").read_text() == '{"s": "1"}'
    assert not (state / "pages" / ".state").exists() or not list((state / "pages" / ".state").glob("*"))
