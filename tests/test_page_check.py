"""A published page is opened in a headless browser under its own sandbox,
and what went wrong comes back to the agent.

The thesis's agent published a derivation whose one stray parenthesis
blanked all 52 equations, and was told it had worked. These run with
whatever Chrome, Chromium, Edge or headless shell the machine has, and
are skipped where there is none."""

import pytest

from nexttex import page_check, page_parts

BROWSER = page_check.find_browser()
needs_browser = pytest.mark.skipif(BROWSER is None, reason="no Chromium-family browser here")
KATEX = page_check.katex_files()
needs_katex = pytest.mark.skipif(KATEX is None, reason="KaTeX is neither built nor installed")


def page(body: str, maths: bool = False) -> str:
    tags = page_parts.maths_tags({"\\Ham": "\\hat{H}"}) if maths else ""
    themes = "<style>:root[data-theme=dark]{color-scheme:dark}</style>"
    return f"<!doctype html><html><head><title>t</title>{themes}</head><body>{body}{tags}</body></html>"


@needs_browser
def test_a_script_that_does_not_parse_is_reported_with_its_line():
    found = page_check.look(page(
        '<div id="eq"></div>\n<script>\ndocument.getElementById("eq").innerHTML = m("a"));\n</script>'), None)
    assert not found.clean
    assert any("SyntaxError" in error and "(line 3)" in error for error in found.errors), found.errors
    assert "has problems" in page_check.report(found)


@needs_browser
def test_maths_drawn_by_hand_that_comes_out_empty_is_reported():
    found = page_check.look(page("<p><math></math></p>"), None)
    assert found.blanks == ["An equation (a <math> element) came out empty."]


@needs_browser
@needs_katex
def test_katex_sets_the_maths_with_the_projects_macros_and_says_when_it_cannot():
    clean = page_check.look(page("<p>$E = mc^2$ and $\\Ham$ and $\\ce{H2O}$ \\[\\int_0^1 x\\,dx\\]</p>", True), KATEX)
    assert clean.clean, page_check.report(clean)
    assert clean.picture and clean.picture.startswith(b"\x89PNG")

    broken = page_check.look(page("<p>$\\frac{1}{2$</p><p>$\\nosuchmacro$</p>", True), KATEX)
    assert any("KaTeX" in blank for blank in broken.blanks), broken.blanks


@needs_browser
@needs_katex
def test_maths_left_as_text_after_katex_ran_is_reported():
    found = page_check.look(page("<p>$a$ then $\\frac{1}{$ then $\\Ham$</p>", True), KATEX)
    assert any(blank.startswith("Maths left as text") for blank in found.blanks), found.blanks


@needs_browser
@needs_katex
def test_a_page_without_a_doctype_is_told_why_katex_refused():
    found = page_check.look("<p>$a$</p>" + page_parts.maths_tags({}), KATEX)
    assert any("quirks mode" in error for error in found.errors), found.errors


def test_with_no_browser_the_agent_is_told_the_page_was_not_looked_at(monkeypatch):
    monkeypatch.setattr(page_check, "find_browser", lambda: None)
    found = page_check.look(page("<p>x</p>"), None)
    assert found.unchecked.startswith("No Chrome, Chromium or Edge")
    assert page_check.report(found).startswith("Not checked:")


def test_a_named_browser_that_is_not_there_is_not_guessed_past(monkeypatch, tmp_path):
    monkeypatch.setenv("NEXTTEX_BROWSER", str(tmp_path / "nothing"))
    assert page_check.find_browser() is None


@needs_browser
def test_a_page_with_no_dark_colours_is_told_how_to_follow_the_theme():
    found = page_check.look("<!doctype html><html><body><p>light only</p></body></html>", None)
    assert found.themeless and not found.clean
    assert ':root[data-theme="dark"]' in page_check.report(found)


def test_a_browser_that_never_reads_the_page_back_is_named(monkeypatch, tmp_path):
    """On 26 October 2026 a CI run said only that "the browser" had not
    read the page back; which browser it was is the first question."""
    import sys

    silent = tmp_path / "google-chrome"
    silent.write_text(f"#!{sys.executable}\nimport time\ntime.sleep(30)\n", encoding="utf-8")
    silent.chmod(0o755)
    monkeypatch.setattr(page_check, "TIMEOUT", 1)
    found = page_check.look(page("<p>x</p>"), None, browser=str(silent))
    assert found.unchecked.endswith("after 1 seconds (google-chrome).")
