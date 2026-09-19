"""Arriving with a project through the route: a zip, an arXiv id or a
git URL into a new folder."""

import gzip
import io
import tarfile
import zipfile

from nexttex import arrive, gitrepo


def zipped(entries: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, body in entries.items():
            archive.writestr(name, body)
    return out.getvalue()


def test_a_zip_becomes_a_registered_project_with_the_skipped_named(client, tmp_path):
    data = zipped({
        "paper/main.tex": b"\\documentclass{article}\\begin{document}x\\end{document}",
        "paper/.claude/settings.json": b"{}",
        "paper/../out.tex": b"no",
    })
    into = tmp_path / "arrived"
    answer = client.post(
        "/api/projects/arrive",
        data={"path": str(into), "source": ""},
        files={"file": ("paper.zip", data, "application/zip")},
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["way"] == "zip" and body["id"]
    assert sorted(body["skipped"]) == [".claude/settings.json", "paper/../out.tex"]
    assert (into / "main.tex").is_file() and not (into / ".claude").exists()
    assert not (tmp_path / "out.tex").exists()
    listed = client.get("/api/projects").json()["projects"]
    assert any(project["id"] == body["id"] for project in listed)


def test_an_arxiv_id_is_fetched_from_the_seam_and_unpacked(client, tmp_path, monkeypatch):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as archive:
        body = b"\\documentclass{article}\\begin{document}arXiv\\end{document}"
        info = tarfile.TarInfo("main.tex")
        info.size = len(body)
        archive.addfile(info, io.BytesIO(body))
    seen = {}

    def fake_fetch(identifier):
        seen["id"] = identifier
        return out.getvalue()

    monkeypatch.setattr(arrive, "fetch_arxiv", fake_fetch)
    into = tmp_path / "arxiv"
    answer = client.post("/api/projects/arrive", data={"path": str(into), "source": "https://arxiv.org/abs/2301.01234v2"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["way"] == "arxiv" and seen["id"] == "2301.01234v2"
    assert (into / "main.tex").read_bytes().startswith(b"\\documentclass")


def test_a_pdf_only_paper_is_refused_and_the_folder_is_not_left_behind(client, tmp_path, monkeypatch):
    monkeypatch.setattr(arrive, "fetch_arxiv", lambda identifier: gzip.compress(b"%PDF-1.4"))
    into = tmp_path / "pdfonly"
    answer = client.post("/api/projects/arrive", data={"path": str(into), "source": "2301.01234"})
    assert answer.status_code == 400 and "only the PDF" in answer.json()["detail"]
    assert not into.exists()


def test_a_git_url_is_cloned_with_the_url_after_a_double_dash(client, tmp_path, monkeypatch):
    seen = {}

    def fake_run(root, *arguments, timeout=gitrepo.TIMEOUT):
        seen["root"], seen["arguments"], seen["timeout"] = root, arguments, timeout
        (root / "main.tex").write_text("\\documentclass{article}\\begin{document}git\\end{document}")
        (root / ".git").mkdir()
        return ""

    monkeypatch.setattr(gitrepo, "_run", fake_run)
    into = tmp_path / "cloned"
    answer = client.post("/api/projects/arrive", data={"path": str(into), "source": "https://github.com/x/y.git"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["way"] == "git" and seen["root"] == into
    assert seen["arguments"][:5] == ("-c", "protocol.file.allow=never", "clone", "--", "https://github.com/x/y.git")
    assert seen["timeout"] == gitrepo.CLONE_TIMEOUT
    # A clone keeps its .git: the one control directory this way in accepts.
    assert (into / ".git").is_dir()


def test_a_url_that_is_not_one_and_a_folder_that_is_not_empty(client, tmp_path):
    for hostile in ("file:///etc", "/etc/passwd", "ext::sh -c id", "-oProxyCommand=id", "my thesis", ""):
        answer = client.post("/api/projects/arrive", data={"path": str(tmp_path / "x"), "source": hostile})
        assert answer.status_code == 400, (hostile, answer.text)
        assert not (tmp_path / "x").exists()
    full = tmp_path / "full"
    full.mkdir()
    (full / "there.txt").write_text("")
    answer = client.post("/api/projects/arrive", data={"path": str(full), "source": "2301.01234"})
    assert answer.status_code == 400 and "already has files" in answer.json()["detail"]


def test_a_zip_over_the_cap_or_not_a_zip_is_refused(client, tmp_path, monkeypatch):
    from server import main as server_main

    monkeypatch.setattr(server_main, "MAX_UPLOAD_BYTES", 100)
    into = tmp_path / "big"
    answer = client.post(
        "/api/projects/arrive", data={"path": str(into), "source": ""},
        files={"file": ("big.zip", b"x" * 200, "application/zip")},
    )
    assert answer.status_code == 400 and "over" in answer.json()["detail"]
    assert not into.exists()
    answer = client.post(
        "/api/projects/arrive", data={"path": str(into), "source": ""},
        files={"file": ("bad.zip", b"not a zip", "application/zip")},
    )
    assert answer.status_code == 400 and "not a zip" in answer.json()["detail"]
    assert not into.exists()
