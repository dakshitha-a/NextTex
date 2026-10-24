"""A page's name is its address, and nothing else gets through."""

import pytest

from nexttex.pages import MAX_BYTES, Pages, clean_name


def test_a_name_is_made_safe_for_an_address():
    assert clean_name("Three Fits, final!") == "three-fits-final"
    assert clean_name("../../etc/passwd") == "etc-passwd"
    assert clean_name("...") == ""


def test_a_page_replaces_one_of_the_same_name(tmp_path):
    pages = Pages(tmp_path)
    pages.save("fits", "<p>one</p>")
    pages.save("fits", "<p>two</p>")
    assert [page["name"] for page in pages.list()] == ["fits"]
    assert pages.read("fits") == b"<p>two</p>"


def test_an_empty_name_and_an_oversized_page_are_refused(tmp_path):
    pages = Pages(tmp_path)
    with pytest.raises(ValueError):
        pages.save("!!!", "<p>x</p>")
    with pytest.raises(ValueError):
        pages.save("big", "x" * (MAX_BYTES + 1))


def test_only_a_pages_own_name_reads_or_deletes(tmp_path):
    pages = Pages(tmp_path)
    (tmp_path / "secret.html").write_text("no")
    for name in ("../secret", "..", "secret.html", ""):
        assert pages.read(name) is None
        assert pages.delete(name) is False
    assert (tmp_path / "secret.html").exists()


def test_what_the_agent_wrote_is_kept_beside_what_is_served(tmp_path):
    """A figure filled in at publishing is base64, and reading a page back
    to change one string should not deal in it."""
    pages = Pages(tmp_path)
    pages.save("fits", "<img src=\"{{figure:a.png}}\">", "<img src=\"data:image/png;base64,AAAA\">")
    assert pages.read("fits") == b"<img src=\"data:image/png;base64,AAAA\">"
    assert pages.source("fits") == "<img src=\"{{figure:a.png}}\">"
    assert [page["name"] for page in pages.list()] == ["fits"]
    pages.delete("fits")
    assert pages.source("fits") is None


def test_a_page_published_before_sources_were_kept_reads_back_as_itself(tmp_path):
    (tmp_path / "pages").mkdir()
    (tmp_path / "pages" / "old.html").write_text("<p>old</p>", encoding="utf-8")
    assert Pages(tmp_path).source("old") == "<p>old</p>"


def test_the_policy_lets_a_page_load_katex_from_this_server_and_nothing_else_of_it():
    from nexttex.pages import policy

    sent = policy("http://127.0.0.1:8450/")
    assert "script-src 'unsafe-inline' http://127.0.0.1:8450/assets/katex/;" in sent
    assert "font-src http://127.0.0.1:8450/assets/katex/ https://fonts.gstatic.com;" in sent
    # Not `'self'` among the sources, which would admit every script of
    # the interface; only the frame ancestors may be this server.
    assert sent.count("'self'") == 1 and "frame-ancestors 'self'" in sent
    assert "allow-same-origin" not in sent


def test_a_page_is_told_the_theme_of_the_nextex_that_opened_it():
    from nexttex.pages import themed

    assert themed(b'<!doctype html><html lang="en"><body>', "dark") == \
        b'<!doctype html><html lang="en" data-theme="dark"><body>'
    # After the doctype, never before it, which would be quirks mode.
    assert themed(b"<!doctype html><p>x</p>", "light") == b'<!doctype html><html data-theme="light"><p>x</p>'
    assert themed(b"<p>x</p>", "dark") == b'<html data-theme="dark"><p>x</p>'
    own = b'<html data-theme="light"><body>'
    assert themed(own, "dark") == own
    assert themed(b"<html><body>", "sepia") == b"<html><body>"
