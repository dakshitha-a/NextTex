"""A published page wears an icon from the set in its tab."""

from nexttex import page_icons


def test_the_set_is_named_and_each_icon_is_an_svg():
    assert {"tracker", "timer", "explanation", "page"} <= set(page_icons.ICONS)
    for name in page_icons.ICONS:
        drawn = page_icons.svg(name)
        assert drawn.startswith("<svg") and page_icons.PEN in drawn


def test_the_icon_goes_in_the_head_and_a_pages_own_is_kept():
    worn = page_icons.wear("<!doctype html><html><head><title>t</title></head><body></body></html>", "timer")
    assert worn.index('rel="icon"') < worn.index("<title>")
    own = '<html><head><link rel="icon" href="data:,x"></head></html>'
    assert page_icons.wear(own, "timer") == own
    assert page_icons.wear("<p>bare</p>", "page").startswith('<link rel="icon"')


def test_the_choices_say_what_each_is_for():
    assert "timer (a countdown or a schedule of steps)" in page_icons.choices()
