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
    # Nothing to connect to unless the page's storage route is named, and
    # then that route by its path alone: the key rides in the request.
    assert "connect-src 'none';" in sent
    reaching = policy("http://127.0.0.1:8450/", "http://127.0.0.1:8450/api/projects/p/pages/t/state?key=k")
    assert "connect-src http://127.0.0.1:8450/api/projects/p/pages/t/state;" in reaching
    assert "key=k" not in reaching


def test_a_page_keeps_its_storage_beside_it(tmp_path):
    """`localStorage` throws in a page's sandbox, so the ticks on a tracker
    were gone on every reload; what a page stores is kept here, by patch,
    survives a republish and goes with a delete."""
    from nexttex.pages import MAX_STATE_BYTES, Pages

    pages = Pages(tmp_path)
    assert pages.state("tracker") == {} and pages.key("tracker") is None
    pages.save("tracker", "<p>one</p>")
    assert pages.merge_state("tracker", {"done": "1", "note": "<b>"}) == {"done": "1", "note": "<b>"}
    # A patch: the other reader's key stays, a None removes, clear empties first.
    assert pages.merge_state("tracker", {"note": None, "later": "x"}) == {"done": "1", "later": "x"}
    assert pages.merge_state("tracker", {"fresh": "y"}, clear=True) == {"fresh": "y"}
    assert pages.state("tracker") == {"fresh": "y"}
    pages.save("tracker", "<p>two</p>")
    assert pages.state("tracker") == {"fresh": "y"}
    key = pages.key("tracker")
    assert key and len(key) >= 32 and pages.key("tracker") == key
    with pytest.raises(ValueError):
        pages.merge_state("tracker", {"big": "x" * (MAX_STATE_BYTES + 1)})
    assert pages.state("tracker") == {"fresh": "y"}
    with pytest.raises(ValueError):
        pages.merge_state("../tracker", {"a": "b"})
    assert pages.delete("tracker")
    assert pages.state("tracker") == {} and not (tmp_path / "pages" / ".state" / "tracker.json").exists()
    assert pages.key("tracker") is None


def test_a_served_page_gets_its_storage_first_in_its_head():
    from nexttex.pages import stored

    page = stored(b'<!doctype html><html><head><script>var x=localStorage.getItem("a")</script></head>',
                  {"a": "</script><b>"}, "http://h/api/projects/p/pages/t/state?key=k")
    head = page.index(b"<head>") + len(b"<head>")
    assert page[head:head + 8] == b"<script>"
    assert b"__STATE__" not in page and b"__URL__" not in page
    # The value cannot close the script, and the page's own script comes after.
    assert b"</script><b>" not in page and b"\\u003c/script>\\u003cb>" in page
    assert page.index(b'localStorage.getItem("a")') > page.index(b'url="http://h/api/projects/p/pages/t/state?key=k"')
    # No head: after the html tag, after the doctype, or first of all.
    assert stored(b"<!doctype html><html><body>", {}, None).startswith(b"<!doctype html><html><script>")
    assert stored(b"<!doctype html><p>", {}, None).startswith(b"<!doctype html><script>")
    assert stored(b"<p>", {}, None).startswith(b"<script>")
    assert b"url=null" in stored(b"<p>", {}, None)
    # On one line, so a script error's line number is the page's own.
    assert stored(b"<p>\n<script>x(</script>", {"k": "v"}, "http://h/s").count(b"\n") == 1


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
