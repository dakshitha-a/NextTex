"""Arriving with a project: a zip, an arXiv e-print or a git URL into a
new folder, with the fence an upload has."""

import gzip
import io
import tarfile
import zipfile

import pytest

from nexttex import arrive


def zipped(entries: dict[str, bytes], symlink: str | None = None) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, body in entries.items():
            archive.writestr(name, body)
        if symlink:
            info = zipfile.ZipInfo(symlink)
            info.external_attr = (0o120777 << 16)
            archive.writestr(info, "/etc/passwd")
    return out.getvalue()


def tarred(entries: dict[str, bytes], gz: bool = True, link: str | None = None) -> bytes:
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz" if gz else "w") as archive:
        for name, body in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(body)
            archive.addfile(info, io.BytesIO(body))
        if link:
            info = tarfile.TarInfo(link)
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            archive.addfile(info)
    return out.getvalue()


# -- the zip -----------------------------------------------------------------

def test_a_zip_is_unpacked_and_a_single_root_folder_is_stripped(tmp_path):
    data = zipped({"paper/main.tex": b"\\documentclass{article}", "paper/figures/a.png": b"png"})
    state = arrive.unpack_zip(data, tmp_path)
    assert state.written == 2 and state.skipped == []
    assert (tmp_path / "main.tex").read_bytes().startswith(b"\\documentclass")
    assert (tmp_path / "figures" / "a.png").is_file()


def test_two_top_level_things_keep_their_names(tmp_path):
    data = zipped({"main.tex": b"x", "chapters/one.tex": b"y"})
    arrive.unpack_zip(data, tmp_path)
    assert (tmp_path / "main.tex").is_file() and (tmp_path / "chapters" / "one.tex").is_file()


def test_an_entry_that_leaves_the_folder_is_skipped_and_named(tmp_path):
    data = zipped({"main.tex": b"x", "../escape.tex": b"no", "/etc/cron.d/job": b"no"})
    state = arrive.unpack_zip(data, tmp_path)
    assert state.written == 1
    assert sorted(state.skipped) == ["../escape.tex", "/etc/cron.d/job"]
    assert not (tmp_path.parent / "escape.tex").exists()


def test_a_symlink_entry_is_never_written(tmp_path):
    data = zipped({"main.tex": b"x"}, symlink="passwd")
    state = arrive.unpack_zip(data, tmp_path)
    assert "passwd" in state.skipped and not (tmp_path / "passwd").exists()


def test_control_paths_are_skipped_and_named(tmp_path):
    data = zipped({
        "paper/main.tex": b"x",
        "paper/.claude/settings.json": b'{"hooks": {}}',
        "paper/Makefile": b"all:",
        "paper/.git/config": b"[core]",
        "paper/.nexttex/history/x": b"",
        "paper/latexmkrc": b"$pdf_mode = 1;",
    })
    state = arrive.unpack_zip(data, tmp_path)
    assert state.written == 1
    assert sorted(state.skipped) == [
        ".claude/settings.json", ".git/config", ".nexttex/history/x", "Makefile", "latexmkrc",
    ]
    assert not (tmp_path / ".claude").exists() and not (tmp_path / "Makefile").exists()


def test_too_many_entries_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(arrive, "MAX_ENTRIES", 3)
    data = zipped({f"f{i}.tex": b"x" for i in range(4)})
    with pytest.raises(arrive.ArriveError, match="more than 3 files"):
        arrive.unpack_zip(data, tmp_path)


def test_the_size_cap_is_enforced_while_writing_not_from_the_headers(tmp_path, monkeypatch):
    """A small compressed member that inflates past the cap: the headers
    say the true size, but a hostile zip can lie, so the count is taken
    from what is written."""
    monkeypatch.setattr(arrive, "MAX_BYTES", 5000)
    data = zipped({"big.tex": b"a" * 10_000})
    with pytest.raises(arrive.ArriveError, match="gigabyte"):
        arrive.unpack_zip(data, tmp_path)


def test_a_zip_that_is_not_one_is_a_bad_zip(tmp_path):
    with pytest.raises(zipfile.BadZipFile):
        arrive.unpack_zip(b"not a zip", tmp_path)


# -- the tar and arXiv --------------------------------------------------------

def test_a_gzipped_tar_from_arxiv_is_unpacked(tmp_path):
    data = tarred({"main.tex": b"x", "fig.pdf": b"%PDF", ".git/config": b"no"}, link="evil")
    state = arrive.unpack_arxiv(data, "2301.01234", tmp_path)
    assert state.written == 2 and sorted(state.skipped) == [".git/config", "evil"]
    assert (tmp_path / "main.tex").is_file() and not (tmp_path / "evil").exists()


def test_a_gzipped_single_file_becomes_the_paper(tmp_path):
    data = gzip.compress(b"\\documentclass{article}\\begin{document}x\\end{document}")
    state = arrive.unpack_arxiv(data, "math/0601001", tmp_path)
    assert state.written == 1
    assert (tmp_path / "math-0601001.tex").read_bytes().startswith(b"\\documentclass")


def test_a_pdf_only_submission_is_refused(tmp_path):
    with pytest.raises(arrive.ArriveError, match="only the PDF"):
        arrive.unpack_arxiv(b"%PDF-1.5 ...", "2301.01234", tmp_path)
    with pytest.raises(arrive.ArriveError, match="only the PDF"):
        arrive.unpack_arxiv(gzip.compress(b"%PDF-1.5 ..."), "2301.01234", tmp_path)


def test_a_gzip_bomb_is_stopped_at_the_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(arrive, "MAX_BYTES", 5000)
    with pytest.raises(arrive.ArriveError, match="gigabyte"):
        arrive.unpack_arxiv(gzip.compress(b"a" * 100_000), "2301.01234", tmp_path)


@pytest.mark.parametrize("typed, expected", [
    ("2301.01234", "2301.01234"),
    ("2301.01234v2", "2301.01234v2"),
    ("math/0601001", "math/0601001"),
    ("cs.LG/0601001v1", "cs.LG/0601001v1"),
    ("https://arxiv.org/abs/2301.01234", "2301.01234"),
    ("https://arxiv.org/pdf/2301.01234v3.pdf", "2301.01234v3"),
    ("arxiv.org/abs/2301.01234", None),
    ("2301.012", None),
    ("https://example.org/2301.01234", None),
    ("", None),
])
def test_an_arxiv_id_in_its_spellings(typed, expected):
    assert arrive.arxiv_id(typed) == expected


def test_fetch_arxiv_asks_the_e_print_with_a_user_agent(monkeypatch):
    import requests

    seen = {}

    class Answer:
        status_code = 200

        def iter_content(self, size):
            yield b"abc"

    def fake_get(url, headers=None, timeout=None, stream=None):
        seen.update(url=url, headers=headers, timeout=timeout)
        return Answer()

    monkeypatch.setattr(requests, "get", fake_get)
    assert arrive.fetch_arxiv("2301.01234") == b"abc"
    assert seen["url"] == "https://arxiv.org/e-print/2301.01234"
    assert "NextTex" in seen["headers"]["User-Agent"] and seen["timeout"] == arrive.ARXIV_TIMEOUT
    monkeypatch.setenv("NEXTTEX_ARXIV_BASE", "http://127.0.0.1:9/")
    arrive.fetch_arxiv("x")
    assert seen["url"] == "http://127.0.0.1:9/e-print/x"


def test_fetch_arxiv_refuses_a_missing_paper_and_an_oversize_answer(monkeypatch):
    import requests

    class Missing:
        status_code = 404

    monkeypatch.setattr(requests, "get", lambda *a, **k: Missing())
    with pytest.raises(arrive.ArriveError, match="no paper"):
        arrive.fetch_arxiv("2301.00000")

    class Huge:
        status_code = 200

        def iter_content(self, size):
            while True:
                yield b"x" * 1024 * 1024

    monkeypatch.setattr(arrive, "ARXIV_MAX_BYTES", 3 * 1024 * 1024)
    monkeypatch.setattr(requests, "get", lambda *a, **k: Huge())
    with pytest.raises(arrive.ArriveError, match="over 200 MB"):
        arrive.fetch_arxiv("2301.00000")


# -- git and the folder -------------------------------------------------------

@pytest.mark.parametrize("url", [
    "https://github.com/dakshitha-a/NextTex",
    "https://github.com/dakshitha-a/NextTex.git",
    "http://example.org/repo.git",
    "ssh://git@github.com/dakshitha-a/NextTex.git",
    "git://example.org/repo.git",
    "git@github.com:dakshitha-a/NextTex.git",
])
def test_a_git_url_on_a_transport_that_reaches_a_host(url):
    assert arrive.is_git_url(url)


@pytest.mark.parametrize("url", [
    "file:///home/me/repo", "/home/me/repo", "~/repo", "ext::sh -c 'id'",
    "-oProxyCommand=id", "--upload-pack=id", "", "github.com/x/y", "https://",
])
def test_a_path_a_local_transport_or_an_option_is_not_a_git_url(url):
    assert not arrive.is_git_url(url)


def test_the_folder_must_be_absent_or_empty(tmp_path):
    made = arrive.empty_folder(str(tmp_path / "new"))
    assert made.is_dir()
    (made / "x").write_text("")
    with pytest.raises(arrive.ArriveError, match="already has files"):
        arrive.empty_folder(str(made))
    arrive.discard(made)
    assert not made.exists()
