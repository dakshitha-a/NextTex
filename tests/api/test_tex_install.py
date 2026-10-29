"""The two routes behind the drawer's Install button.

Driven through `tests/fake_tlmgr.py`, a real program on `NEXTTEX_TLMGR`,
so the argv the server builds is the argv a shell would see.
"""

import json
import sys
from pathlib import Path

import pytest

from nexttex import texpkg, venues

FAKE = Path(__file__).resolve().parent.parent / "fake_tlmgr.py"


@pytest.fixture
def tlmgr(monkeypatch, tmp_path):
    log = tmp_path / "tlmgr.jsonl"
    monkeypatch.setenv("NEXTTEX_TLMGR", str(FAKE))
    monkeypatch.setenv("NEXTTEX_FAKE_TLMGR_LOG", str(log))
    monkeypatch.setattr(texpkg, "_KNOWN", {})
    return log


def calls(log: Path) -> list[list[str]]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


@pytest.mark.skipif(sys.platform == "win32", reason="the stand-in is a script")
def test_the_row_learns_which_package_provides_the_file(client, opened, tlmgr):
    response = client.get(
        f"/api/projects/{opened['id']}/tex/package", params={"file": "mhchem.sty"}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"file": "mhchem.sty", "package": "mhchem-pkg", "manager": "tlmgr"}
    assert calls(tlmgr) == [["search", "--file", "--global", "/mhchem.sty"]]


@pytest.mark.skipif(sys.platform == "win32", reason="the stand-in is a script")
def test_a_file_no_package_provides_gets_no_button(client, opened, tlmgr):
    body = client.get(
        f"/api/projects/{opened['id']}/tex/package", params={"file": "nowhere.sty"}
    ).json()
    assert body["package"] == ""


@pytest.mark.parametrize("bad", ["../x.sty", "x", "x.png", "a b.sty", "--help", ""])
def test_a_name_that_is_not_a_style_file_is_refused(client, opened, tlmgr, bad):
    response = client.get(f"/api/projects/{opened['id']}/tex/package", params={"file": bad})
    assert response.status_code in (400, 422), response.text
    assert calls(tlmgr) == []


@pytest.mark.skipif(sys.platform == "win32", reason="the stand-in is a script")
def test_an_install_runs_the_manager_and_builds_again(client, opened, tlmgr):
    response = client.post(
        f"/api/projects/{opened['id']}/tex/install", json={"package": "mhchem-pkg"}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "err": ""}
    assert calls(tlmgr) == [["install", "mhchem-pkg"]]


@pytest.mark.skipif(sys.platform == "win32", reason="the stand-in is a script")
def test_an_install_makes_the_template_list_ask_the_tex_again(client, opened, tlmgr, monkeypatch):
    """The browser says which package a template needs; once the package
    is in, the next list must not say it again."""
    forgot = []
    monkeypatch.setattr(venues, "forget", lambda: forgot.append(True))
    client.post(f"/api/projects/{opened['id']}/tex/install", json={"package": "mhchem-pkg"})
    assert forgot == [True]
    client.post(f"/api/projects/{opened['id']}/tex/install", json={"package": "stale-pkg"})
    assert forgot == [True]


@pytest.mark.skipif(sys.platform == "win32", reason="the stand-in is a script")
def test_a_failing_install_hands_back_the_managers_words(client, opened, tlmgr):
    body = client.post(
        f"/api/projects/{opened['id']}/tex/install", json={"package": "stale-pkg"}
    ).json()
    assert body["ok"] is False
    assert "Remote repository is newer than local" in body["err"]


@pytest.mark.parametrize("bad", ["--repository=http://evil", "a; rm -rf /", "../x", "", "a b"])
def test_anything_but_a_package_name_is_refused_before_the_manager_sees_it(
    client, opened, tlmgr, bad,
):
    response = client.post(f"/api/projects/{opened['id']}/tex/install", json={"package": bad})
    assert response.status_code == 400, response.text
    assert calls(tlmgr) == []


def test_both_routes_need_a_project_this_server_knows(client, tlmgr):
    assert client.get("/api/projects/nope/tex/package", params={"file": "x.sty"}).status_code == 404
    assert client.post("/api/projects/nope/tex/install", json={"package": "x"}).status_code == 404


@pytest.mark.skipif(sys.platform == "win32", reason="the stand-in is a script")
def test_a_templates_list_is_one_install(client, opened, tlmgr):
    response = client.post(
        f"/api/projects/{opened['id']}/tex/install",
        json={"packages": ["parskip-pkg", "microtype-pkg"]},
    )
    assert response.json() == {"ok": True, "err": ""}
    assert calls(tlmgr) == [["install", "parskip-pkg", "microtype-pkg"]]


def test_a_list_with_anything_but_package_names_is_refused(client, opened, tlmgr):
    response = client.post(f"/api/projects/{opened['id']}/tex/install",
                           json={"packages": ["parskip", "-x"]})
    assert response.status_code == 400
    response = client.post(f"/api/projects/{opened['id']}/tex/install",
                           json={"packages": ["p"] * (texpkg.MAX_AT_ONCE + 1)})
    assert response.status_code == 400
    assert calls(tlmgr) == []


@pytest.mark.skipif(sys.platform == "win32", reason="the stand-in is a script")
def test_the_stand_in_refuses_until_tlmgr_has_updated_itself(client, opened, tlmgr):
    """What the browser tier's fake answers, so a spec can drive the
    drawer's button through the retry."""
    response = client.post(f"/api/projects/{opened['id']}/tex/install",
                           json={"package": "selfupdate-pkg"})
    assert response.json() == {"ok": True, "err": ""}
    assert calls(tlmgr) == [
        ["install", "selfupdate-pkg"], ["update", "--self"], ["install", "selfupdate-pkg"],
    ]


def test_loading_a_template_says_what_this_tex_lacks_for_it(client, opened, monkeypatch):
    monkeypatch.setattr(venues, "_present", lambda names: {n for n in names if n != "parskip.sty"})
    venues.forget()
    from server import main as server_main
    # The route is for a document with nothing in it yet.
    server_main.SESSIONS[opened["id"]].paths.main.write_text(
        "\\documentclass{article}\n\\begin{document}\n\\end{document}\n", encoding="utf-8")
    answer = client.post(f"/api/projects/{opened['id']}/template", json={"name": "basic"})
    venues.forget()
    assert answer.status_code == 200, answer.text
    assert answer.json()["missing"] == ["parskip"]
