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
    # An origin of its own, and nothing fetched.
    assert "sandbox allow-scripts" in policy and "allow-same-origin" not in policy
    assert "connect-src 'none'" in policy

    assert client.delete(f"/api/projects/{opened['id']}/pages/three-fits").status_code == 200
    assert client.get(f"/api/projects/{opened['id']}/pages/three-fits").status_code == 404


def test_a_page_name_cannot_leave_the_pages_folder(client, opened):
    state = server_main.SESSIONS[opened["id"]].project.state_dir
    (state / "secret.html").write_text("not a page")
    for name in ("..%2Fsecret", "%2E%2E%2Fsecret", "../secret", "..", "secret.html", "Three-Fits"):
        served = client.get(f"/api/projects/{opened['id']}/pages/{name}")
        assert served.status_code == 404, name
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
