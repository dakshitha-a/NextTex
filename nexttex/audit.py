"""One file's history as a ZIP a reader can keep: an audit trail.

Built on request, into a file the caller names, and never stored: the
history already holds everything in it.  The archive is

- `versions/`, every stored version's bytes, oldest first, named by its
  number, its moment in UTC and the file's name;
- `log.csv` and `log.json`, one row per version: who, when, what kind of
  change and why, its sha256 and size, and whether its bytes were here;
- `SHA256SUMS`, in the form `sha256sum -c` reads, so the trail checks
  itself without NextTex;
- `report.html`, the same rows in order with the change from the version
  before, for reading.

The versions and the sums are the trail.  The report is the convenience,
which is why its diffs have a budget and the files do not.
"""

from __future__ import annotations

import csv
import difflib
import html
import io
import json
import time
import zipfile
from pathlib import Path, PurePosixPath

from .history import COALESCE_SECONDS, DAILY_DAYS, HOURLY_DAYS, KEEP_ALL_HOURS, History, Version

#: How many lines, old and new together, the report diffs before it stops
#: diffing.  `difflib` is slow on long files, and five hundred versions of
#: a twelve-thousand-line chapter would take minutes on the thread; past
#: this the report names the pair and points at `versions/` instead.
DIFF_BUDGET_LINES = 400_000

FIELDS = ["number", "time_utc", "author", "role", "peer", "op", "why", "label",
          "sha256", "bytes", "file", "here"]


def _utc(at_ms: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at_ms / 1000))


def author(version: Version, me: str, my_name: str) -> str:
    """A name for whoever made a version, as the History drawer says it but
    without "you", which means nothing to whoever reads the export later."""
    mine = not version.peer or version.peer == me
    name = (my_name or "this install") if mine else (version.who or version.peer[:6])
    if version.by == "outside":
        return f"on {name}'s disk"
    if version.by == "claude":
        return f"{name}'s Claude"
    return name


def retention(history: History, path: str, keep_all: bool) -> list[str]:
    """What the history kept and did not, in sentences for the report and
    the log, so nobody reads a thinned trail as a complete one."""
    lines = []
    if keep_all:
        lines.append(
            "This project keeps every version. Versions from before that setting "
            "was turned on may already have been thinned."
        )
    else:
        lines.append(
            f"This project thins its history: every version from the last "
            f"{KEEP_ALL_HOURS} hours is kept, then one an hour to {HOURLY_DAYS} days, "
            f"one a day to {DAILY_DAYS} days, and one a week after that. Labelled "
            "versions, Claude's edits, deletions and restores are never thinned."
        )
    lines.append(
        f"Edits by one author within {int(COALESCE_SECONDS)} seconds of each other "
        "are recorded as one version."
    )
    lines.append(
        "On a shared project, a collaborator whose NextTex does not know the "
        "keep-every-version setting still thins what they send."
    )
    floors = history.purged_before(path)
    if floors:
        earliest = min(float(at) for at in floors.values())
        lines.append(f"This file's history was cleared on {_utc(earliest)}; nothing before that is kept.")
    return lines


def _text(data: bytes | None) -> list[str] | None:
    if data is None or b"\0" in data[:8192]:
        return None
    try:
        return data.decode("utf-8").splitlines(keepends=True)
    except UnicodeDecodeError:
        return None


def build(history: History, path: str, out: Path, *, keep_all: bool, me: str = "",
          my_name: str = "", program: str = "", now: float | None = None) -> int:
    """Write `path`'s history to `out` as a ZIP; returns how many versions."""
    versions = history.versions(path)
    name = PurePosixPath(path).name
    exported = _utc((now if now is not None else time.time()) * 1000)
    notes = retention(history, path, keep_all)
    rows: list[dict] = []
    sums: list[str] = []
    budget = DIFF_BUDGET_LINES
    sections: list[str] = []
    before: list[str] | None = None

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for number, version in enumerate(versions, start=1):
            data = history.blobs.get(version.sha)
            stamp = _utc(version.at)
            member = f"versions/{number:04d}_{stamp.replace(':', '-')}_{name}"
            here = data is not None
            if here:
                archive.writestr(member, data)
                sums.append(f"{version.sha}  {member}")
            row = {
                "number": number, "time_utc": stamp,
                "author": author(version, me, my_name), "role": version.by,
                "peer": version.peer, "op": version.op, "why": version.why,
                "label": version.label or "", "sha256": version.sha,
                "bytes": version.bytes, "file": member if here else "", "here": here,
            }
            rows.append(row)

            lines = _text(data)
            if not here:
                change = "<p class=note>This version's contents are not on this machine.</p>"
            elif lines is None:
                change = f"<p class=note>Not text: {version.bytes} bytes.</p>"
            elif before is None:
                change = ("<p class=note>First version.</p>" if number == 1 else
                          "<p class=note>No diff: the version before is not text, "
                          "or is not on this machine.</p>")
            else:
                cost = len(before) + len(lines)
                if cost > budget:
                    change = ("<p class=note>Diff skipped to keep this report quick. "
                              "Compare the files in versions/.</p>")
                else:
                    budget -= cost
                    diff = "".join(difflib.unified_diff(
                        before, lines, f"version {number - 1}", f"version {number}", n=2,
                    ))
                    change = (f"<pre>{html.escape(diff)}</pre>" if diff
                              else "<p class=note>Same contents as the version before.</p>")
            before = lines
            facts = " · ".join(html.escape(str(part)) for part in (
                stamp, row["author"], version.op, version.why, version.label or "",
            ) if part)
            sections.append(
                f"<section><h2>Version {number}</h2><p class=meta>{facts}</p>"
                f"<p class=sha>sha256 {version.sha} · {version.bytes} bytes</p>{change}</section>"
            )

        table = io.StringIO()
        writer = csv.DictWriter(table, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        archive.writestr("log.csv", table.getvalue())
        archive.writestr("log.json", json.dumps({
            "file": path, "exported": exported, "program": program,
            "keep_all_versions": keep_all, "retention": notes, "versions": rows,
        }, indent=2, ensure_ascii=False) + "\n")
        archive.writestr("SHA256SUMS", "".join(f"{line}\n" for line in sums))
        archive.writestr("report.html", _report(path, exported, program, notes, rows, sections))
    return len(versions)


def _report(path: str, exported: str, program: str, notes: list[str], rows: list[dict],
            sections: list[str]) -> str:
    missing = sum(1 for row in rows if not row["here"])
    summary = f"{len(rows)} versions" + (f", {missing} not on this machine" if missing else "")
    retention_html = "".join(f"<li>{html.escape(note)}</li>" for note in notes)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>History of {html.escape(path)}</title>
<style>
:root {{ color-scheme: light dark; --ink: #1d1b18; --ink-2: #6b665e; --paper: #fbfaf7; --rule: #e4e0d8; --add: #1f6f43; --del: #a3352b; }}
@media (prefers-color-scheme: dark) {{ :root {{ --ink: #ece8e1; --ink-2: #a39e95; --paper: #1b1a18; --rule: #34322e; --add: #7cc79c; --del: #e58a80; }} }}
body {{ background: var(--paper); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 16px; }}
h1 {{ font-size: 1.4rem; margin: 0 0 .25rem; }} h2 {{ font-size: 1rem; margin: 0; }}
.meta, .sha, .note, header p {{ color: var(--ink-2); margin: .25rem 0; }} .sha {{ font: 12px ui-monospace, monospace; overflow-wrap: anywhere; }}
section {{ border-top: 1px solid var(--rule); padding: 1rem 0; }}
pre {{ font: 12px/1.45 ui-monospace, monospace; overflow-x: auto; white-space: pre; border: 1px solid var(--rule); padding: .5rem; }}
</style></head><body>
<header><h1>History of {html.escape(path)}</h1>
<p>Exported {exported}{' by NextTex ' + html.escape(program) if program else ''}. {summary}.</p>
<p>Each version's file is in versions/. SHA256SUMS checks them: run <code>sha256sum -c SHA256SUMS</code> in this folder.</p>
<ul>{retention_html}</ul></header>
{''.join(sections)}
</body></html>
"""
