"""The soft check of the venue templates against CTAN (`scripts/check_templates.py`).

Driven with recorded answers, so the suite never reaches CTAN; the script
itself is run by the release workflow and never fails it.
"""

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_templates.py"
spec = importlib.util.spec_from_file_location("check_templates", SCRIPT)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

# CTAN's own answer for one package, as `/json/2.0/pkg/acmart` gave it.
ACMART = b'{"id":"acmart","version":{"number":"2.21","date":"2026-11-02"}}'


def test_ctan_version_is_read_from_the_package_answer():
    assert check.ctan_version(ACMART) == "2.21"
    assert check.ctan_version(b'{"errors":["Not found"]}') == ""
    assert check.ctan_version(b"not json") == ""


def test_only_a_package_that_moved_is_reported():
    checked = {"acm": {"acmart": "2.20"}, "lncs": {"llncs": "2.26"}}
    lines = check.compare(checked, {"acmart": "2.21", "llncs": "2.26"})
    assert lines == ["- acm: acmart is 2.21 on CTAN; the template was checked against 2.20."]
    assert check.compare(checked, {"acmart": "2.20", "llncs": "2.26"}) == []


def test_a_package_ctan_did_not_answer_for_is_said_not_hidden():
    lines = check.compare({"acm": {"acmart": "2.20"}}, {"acmart": ""})
    assert lines == ["- acm: CTAN did not say which version of acmart is current."]


def test_a_guide_behind_a_bot_wall_is_unsure_and_a_gone_page_is_reported():
    assert check.guide_line("icml", "https://icml.cc", 200) is None
    assert check.guide_line("icml", "https://icml.cc", 301) is None
    assert "would not answer a script" in check.guide_line("aaai", "https://aaai.org", 403)
    assert check.guide_line("x", "https://x.org", 404) == "- x: https://x.org answered 404."


def test_every_shipped_venue_records_what_it_was_checked_against():
    from nexttex import venues

    for template in venues.templates():
        if template.cls:
            assert template.checked, f"{template.name} names a class and no checked version"
