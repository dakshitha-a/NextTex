#!/usr/bin/env python3
"""Compare the shipped venue templates with their sources, and say what moved.

Each `template.toml` under `nexttex/templates` records, under `[checked]`,
the version of the class's TeX Live package it was last compared with.
This asks CTAN for each package's current version and lists the ones that
moved, and asks each guide's official page in `catalogue.toml` whether it
still answers.  A moved class is a reason to build the skeleton against
the new one and update `checked`; it is never a reason to refuse a push,
so this always exits 0.

The `release` workflow runs it when a tag's z is 0, that is once per y
bump, and puts the report in the run's summary.  Run it by hand with
`.venv/bin/python scripts/check_templates.py`.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from nexttex import venues  # noqa: E402

CTAN = "https://ctan.org/json/2.0/pkg/{}"
TIMEOUT = 20
#: Answers that say a site would not talk to a script, not that the page
#: is gone: several publishers sit behind a bot wall.
UNSURE = {401, 403, 429, 503}


def fetch(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "NextTex template check"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as answer:
            return answer.status, answer.read()
    except urllib.error.HTTPError as error:
        return error.code, b""
    except (urllib.error.URLError, OSError):
        return 0, b""


def ctan_version(body: bytes) -> str:
    """The version number in CTAN's JSON for one package, or "" when the
    answer has none, as for a package CTAN does not know."""
    try:
        data = json.loads(body or b"{}")
    except ValueError:
        return ""
    version = data.get("version") or {}
    return str(version.get("number") or "") if isinstance(version, dict) else ""


def compare(checked: dict[str, dict[str, str]], current: dict[str, str]) -> list[str]:
    """One line per package whose CTAN version is not the one recorded.

    `checked` is template name to package to recorded version; `current`
    is package to CTAN's version, "" when CTAN did not say."""
    lines = []
    for name, packages in sorted(checked.items()):
        for package, recorded in sorted(packages.items()):
            now = current.get(package, "")
            if not now:
                lines.append(f"- {name}: CTAN did not say which version of {package} is current.")
            elif now != recorded:
                lines.append(f"- {name}: {package} is {now} on CTAN; the template was checked against {recorded}.")
    return lines


def guide_line(name: str, url: str, status: int) -> str | None:
    """A line for a guide whose page did not answer, or None."""
    if 200 <= status < 400:
        return None
    if status in UNSURE:
        return f"- {name}: {url} would not answer a script ({status}); look by hand."
    return f"- {name}: {url} answered {status or 'nothing'}."


def main() -> int:
    checked = {t.name: dict(t.checked) for t in venues.templates() if t.checked}
    packages = sorted({p for each in checked.values() for p in each})
    current = {}
    for package in packages:
        status, body = fetch(CTAN.format(package))
        current[package] = ctan_version(body) if status == 200 else ""
    moved = compare(checked, current)
    pages = [
        line for guide in venues.guides()
        if (line := guide_line(guide.name, guide.official, fetch(guide.official)[0]))
    ]
    report = ["## Venue templates against their sources", ""]
    report += moved or ["Every class is the version its template was checked against."]
    report += ["", "## Guides' official pages", ""]
    report += pages or ["Every guide's page answered."]
    text = "\n".join(report) + "\n"
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
