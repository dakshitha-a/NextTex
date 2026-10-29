#!/usr/bin/env python3
"""Summarise an install's diagnostics log for a review.

    .venv/bin/python scripts/diag-review.py [--state DIR] [--since 2026-10-18]
                                            [--unit nexttex] [--no-journal]

Reads `diagnostics.log` and its rotated files in the state directory (see
nexttex/diag.py), and on Linux the service's restarts from the user
journal, and prints what a review needs: how each server ended, what was
raised and how often, which routes were slow, when the loop stalled, how
memory went, how long builds and agent turns took, and what the browser
saw. Standard library only, so it runs from any Python on the machine.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nexttex.paths import state_home  # noqa: E402

PROJECT_ID = re.compile(r"/projects/[^/]+")


def read(state: Path, since: str) -> list[dict]:
    files = sorted(state.glob("diagnostics.log*"),
                   key=lambda p: int(p.suffix[1:]) if p.suffix[1:].isdigit() else 0,
                   reverse=True)
    rows = []
    for path in files:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and str(row.get("at", "")) >= since:
                rows.append(row)
    return rows


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(fraction * (len(ordered) - 1)))]


def last_frame(trace: str) -> str:
    frames = re.findall(r'File "([^"]+)", line (\d+), in (\S+)', trace or "")
    ours = [f for f in frames if "site-packages" not in f[0]] or frames
    if not ours:
        return ""
    path, line, name = ours[-1]
    return f"{Path(path).name}:{line} {name}"


def section(title: str) -> None:
    print(f"\n## {title}\n")


def lifetimes(rows: list[dict]) -> None:
    section("Servers")
    starts = [r for r in rows if r["kind"] == "start"]
    stops = [r for r in rows if r["kind"] == "stopped"]
    if not starts:
        print("No start in the window.")
    for row in starts:
        print(f"{row['at'][:19]}  started {row.get('version')} at {row.get('commit')}, "
              f"pid {row.get('pid')}; before it: {row.get('previous')}")
    for why, count in Counter(r.get("why", "?") for r in stops).most_common():
        print(f"  stopped {count}x: {why}")
    silent = [r for r in starts if "without saying why" in str(r.get("previous"))]
    if silent:
        print(f"  {len(silent)} start(s) followed a server that ended without a word.")


def journal(unit: str, since: str) -> None:
    section(f"systemd restarts of {unit}")
    binary = shutil.which("journalctl")
    if not binary:
        print("No journalctl here.")
        return
    try:
        out = subprocess.run(
            [binary, "--user", "-u", unit, "--no-pager", "-q", "-o", "short-iso",
             "--since", since.replace("T", " ") or "-7d"],
            capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError) as error:
        print(f"journalctl failed: {error}")
        return
    exits = Counter(m.group(1) for m in re.finditer(r"code=\w+, status=(\S+)", out))
    if not exits:
        print("None.")
    for status, count in exits.most_common():
        meaning = " (the update restart)" if status.startswith("3/") else ""
        print(f"  exit {status}{meaning}: {count}")
    tracebacks = out.count("Traceback (most recent call last)")
    if tracebacks:
        print(f"  {tracebacks} traceback(s) in the journal; the diagnostics log "
              "has the same ones under `log` below.")


def problems(rows: list[dict]) -> None:
    section("Errors and exceptions")
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        kind = row["kind"]
        if kind == "log":
            first = (row.get("message") or "").splitlines()[0][:120]
            key = (f"{row.get('level')} {row.get('logger')}", first, last_frame(row.get("trace", "")))
        elif kind in ("exception", "sync-error"):
            key = (f"{kind} ({row.get('where', 'editing socket')})",
                   str(row.get("error", ""))[:120], last_frame(row.get("trace", "")))
        elif kind == "request" and row.get("status", 0) >= 500:
            key = (f"HTTP {row.get('status')}", f"{row.get('method')} {row.get('route')}", "")
        elif kind == "agent-error":
            key = ("agent error", str(row.get("message", ""))[:120], "")
        else:
            continue
        groups[key].append(row)
    if not groups:
        print("None.")
    for (what, message, frame), hits in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"{len(hits):>4}x  {what}: {message}")
        if frame:
            print(f"        at {frame}")
        print(f"        first {hits[0]['at'][:19]}, last {hits[-1]['at'][:19]}")


def routes(rows: list[dict]) -> None:
    section("Routes, slowest 95th percentile first")
    merged: dict[str, dict] = defaultdict(lambda: {"n": 0, "errors": 0, "p95": [], "p50": [], "max": 0})
    for row in rows:
        if row["kind"] != "routes":
            continue
        for key, stats in row.get("routes", {}).items():
            into = merged[key]
            into["n"] += stats["n"]
            into["errors"] += stats["errors"]
            into["p50"].extend([stats["p50"]] * min(stats["n"], 50))
            into["p95"].extend([stats["p95"]] * min(stats["n"], 50))
            into["max"] = max(into["max"], stats["max"])
    if not merged:
        print("No requests summarised yet.")
        return
    print(f"{'route':<64} {'n':>6} {'5xx':>4} {'p50':>6} {'p95':>6} {'max':>7}")
    ranked = sorted(merged.items(), key=lambda kv: -percentile(kv[1]["p95"], 0.5))
    for key, stats in ranked[:25]:
        print(f"{key[:64]:<64} {stats['n']:>6} {stats['errors']:>4} "
              f"{percentile(stats['p50'], 0.5):>5.0f}ms {percentile(stats['p95'], 0.5):>5.0f}ms "
              f"{stats['max']:>6}ms")
    slow = [r for r in rows if r["kind"] == "request" and r.get("status", 0) < 500]
    if slow:
        print(f"\nSlow single requests ({len(slow)}):")
        for key, count in Counter(f"{r['method']} {r['route']}" for r in slow).most_common(10):
            worst = max(r["ms"] for r in slow if f"{r['method']} {r['route']}" == key)
            print(f"  {count:>4}x  {key}, worst {worst} ms")


def lag(rows: list[dict]) -> None:
    section("Event-loop stalls")
    stalls = [r for r in rows if r["kind"] == "lag"]
    if not stalls:
        print("None over the threshold.")
        return
    print(f"{len(stalls)} stalls; worst {max(r['ms'] for r in stalls)} ms, "
          f"median {percentile([r['ms'] for r in stalls], 0.5):.0f} ms.")
    blamed = Counter()
    for row in stalls:
        for item in row.get("inflight", []):
            blamed[PROJECT_ID.sub("/projects/*", item.rsplit(" ", 1)[0])] += 1
    for what, count in blamed.most_common(8):
        print(f"  in flight during {count}: {what}")
    for row in sorted(stalls, key=lambda r: -r["ms"])[:5]:
        load = row.get("load") or []
        busy = f", host load {load[0]:.0f}" if load else ""
        print(f"  {row['at'][:19]}  {row['ms']} ms{busy}  "
              f"{', '.join(row.get('inflight', [])) or 'nothing in flight'}")


def resources(rows: list[dict]) -> None:
    section("Memory, files and CPU")
    samples = [r for r in rows if r["kind"] == "sample"]
    if not samples:
        print("No samples yet.")
        return
    for name in ("rss_mb", "fds", "threads", "children", "cpu_pct", "sessions",
                 "event_streams", "sync_sockets", "worst_lag_ms"):
        values = [r[name] for r in samples if isinstance(r.get(name), (int, float))]
        if not values:
            continue
        print(f"  {name:<14} first {values[0]:>7}  last {values[-1]:>7}  "
              f"min {min(values):>7}  max {max(values):>7}")
    # Per server life, since a restart resets memory.
    lives, current = [], []
    for row in rows:
        if row["kind"] == "start" and current:
            lives.append(current)
            current = []
        if row["kind"] == "sample" and isinstance(row.get("rss_mb"), int):
            current.append(row)
    if current:
        lives.append(current)
    for life in lives:
        if len(life) >= 30:
            hours = (len(life) - 1) / 60
            growth = (life[-1]["rss_mb"] - life[0]["rss_mb"]) / hours
            print(f"  a life of {hours:.1f} h from {life[0]['at'][:16]}: "
                  f"memory moved {growth:+.1f} MB an hour, fds {life[0].get('fds')} -> {life[-1].get('fds')}")


def work(rows: list[dict]) -> None:
    section("Builds and agent turns")
    every = [r for r in rows if r["kind"] == "build"]
    builds = [r for r in every if r["outcome"] != "cancelled"]
    if builds:
        by = defaultdict(list)
        for row in builds:
            by[(row.get("project"), row.get("engine_pass"))].append(row)
        print(f"{'project':<28} {'pass':<5} {'n':>5} {'p50':>7} {'p95':>7} {'max':>7} {'wait p95':>9} outcomes")
        for (project, kind), hits in sorted(by.items(), key=lambda kv: -len(kv[1])):
            ms = [r["ms"] for r in hits]
            waits = [r.get("waited_ms", 0) for r in hits]
            outcomes = Counter(r["outcome"] for r in hits)
            print(f"{str(project)[:28]:<28} {str(kind):<5} {len(hits):>5} "
                  f"{percentile(ms, .5):>6.0f}ms {percentile(ms, .95):>6.0f}ms {max(ms):>6}ms "
                  f"{percentile(waits, .95):>8.0f}ms {dict(outcomes)}")
    else:
        print("No builds.")
    causes = Counter(r["cause"] for r in builds if r.get("cause"))
    if causes:
        print(f"\nWhat asked for them: {dict(causes.most_common())}")
    cancelled = [r for r in every if r["outcome"] == "cancelled"]
    if cancelled:
        lost = defaultdict(int)
        replaced = Counter()
        for row in cancelled:
            lost[row.get("project")] += row.get("ms", 0)
            replaced[(row.get("cause") or "?", row.get("superseded_by") or "?")] += 1
        print(f"\n{len(cancelled)} builds cancelled before they finished:")
        for project, ms in sorted(lost.items(), key=lambda kv: -kv[1]):
            print(f"  {str(project)[:28]:<28} {ms / 1000:>7.1f} s of work thrown away")
        for (was, by), count in replaced.most_common(8):
            print(f"  {count:>4}x  a build for {was} replaced by one for {by}")
    turns = [r for r in rows if r["kind"] == "turn"]
    if turns:
        ms = [r["ms"] for r in turns]
        first = [r["first_ms"] for r in turns if r.get("first_ms")]
        print(f"\n{len(turns)} agent turns: median {percentile(ms, .5) / 1000:.1f} s, "
              f"p95 {percentile(ms, .95) / 1000:.1f} s; first word median "
              f"{percentile(first, .5) / 1000:.1f} s; endings {dict(Counter(r['ended'] for r in turns))}")
    slow_sync = [r for r in rows if r["kind"] == "sync-slow"]
    if slow_sync:
        print(f"\n{len(slow_sync)} slow editing messages, worst {max(r['ms'] for r in slow_sync)} ms")


def browser(rows: list[dict]) -> None:
    section("What the browser saw")
    errors = [r for r in rows if r["kind"] == "client"]
    if not errors:
        print("No browser errors.")
    for (kind, message), count in Counter(
            (r.get("error_kind"), PROJECT_ID.sub("/projects/*", str(r.get("message", "")))[:140])
            for r in errors).most_common(15):
        print(f"{count:>4}x  {kind}: {message}")
    noise = Counter()
    for row in rows:
        if row["kind"] == "client-noise":
            noise.update(row.get("counts") or {})
    if noise:
        print("Counted as harmless: " + ", ".join(f"{n}x {what}" for what, n in noise.most_common()))
    perf = [r for r in rows if r["kind"] == "client-perf"]
    if perf:
        tasks = sum(r.get("long_tasks", 0) for r in perf)
        worst = max(r.get("long_task_max_ms", 0) for r in perf)
        print(f"\n{tasks} long tasks over 200 ms in the page, worst {worst} ms.")
        slow = Counter()
        worst_call: dict[str, int] = {}
        for row in perf:
            for call in row.get("slow", []):
                key = PROJECT_ID.sub("/projects/*", call["path"])
                slow[key] += 1
                worst_call[key] = max(worst_call.get(key, 0), call["ms"])
        for key, count in slow.most_common(10):
            print(f"  {count:>4}x slow call {key}, worst {worst_call[key]} ms")
        causes: dict[str, dict] = defaultdict(lambda: {"n": 0, "ms": 0, "max": 0})
        for row in perf:
            for frame in row.get("frames", []):
                into = causes[frame["cause"]]
                into["n"] += frame["n"]
                into["ms"] += frame["ms"]
                into["max"] = max(into["max"], frame["max"])
        if causes:
            print("\nLong frames by what held them, most time first:")
            for cause, stats in sorted(causes.items(), key=lambda kv: -kv[1]["ms"])[:10]:
                print(f"  {stats['n']:>4}x  {stats['ms'] / 1000:>6.1f} s, worst {stats['max']} ms  {cause}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--state", type=Path, default=None,
                        help="the state directory (default: this install's)")
    parser.add_argument("--since", default="", help="an ISO date or time to start from")
    parser.add_argument("--unit", default="nexttex" + (
        "-" + os.environ["NEXTTEX_INSTANCE"] if os.environ.get("NEXTTEX_INSTANCE") else ""))
    parser.add_argument("--no-journal", action="store_true")
    arguments = parser.parse_args()
    state = arguments.state or state_home()
    rows = read(state, arguments.since)
    print(f"# Diagnostics for {state}")
    if rows:
        print(f"{len(rows)} lines, {rows[0]['at'][:19]} to {rows[-1]['at'][:19]}")
    else:
        print("The log is empty or missing.")
    lifetimes(rows)
    if not arguments.no_journal and sys.platform.startswith("linux"):
        journal(arguments.unit, arguments.since or (rows[0]["at"][:19] if rows else ""))
    problems(rows)
    routes(rows)
    lag(rows)
    resources(rows)
    work(rows)
    browser(rows)


if __name__ == "__main__":
    main()
