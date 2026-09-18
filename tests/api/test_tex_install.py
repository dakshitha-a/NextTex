"""The two routes behind the drawer's Install button.

Driven through `tests/fake_tlmgr.py`, a real program on `NEXTTEX_TLMGR`,
so the argv the server builds is the argv a shell would see.
"""

import json
import sys
from pathlib import Path

import pytest

from nexttex import texpkg

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
