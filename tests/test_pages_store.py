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
