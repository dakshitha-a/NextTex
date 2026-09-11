# A review of NextTex, September 2026

This is a review in progress, not documentation. Like `TRACKER.md` it lives
here rather than in `docs/` because it describes what is wrong and what is
missing, which is the opposite of what the documents are for. It is deleted
when the fixes that come out of it have landed, because the commit log is the
record of what was done.

## How this review is being run

The suites are green and have been for every commit this week. They guard
contracts that earlier bugs paid for. What they cannot see is what this review
is for: a screen that is correct line by line and wrong in a case nobody had in
front of them, a control that works on the path it was written for and latches
on the others, a feature a writer would expect and nobody has asked for, and a
slow path that is slow only on a real thesis.

**Four ways a fault is found, and each finds a different kind.** A *test* finds
a broken contract, and the suites already do that. A *screen* finds what is
drawn wrong, missing, truncated or stale, and is found by photographing every
surface at every width in both themes and reading each against
`docs/design.md`. A *reading* finds a correct line doing what it says in a case
its author did not have in front of them, and is found by asking one question
of every piece of state on a screen: what sets this back. A *measurement* finds
the path that is fine on a fixture and slow on a thesis. The two sweeps in the
log this week, `2cf7861` and `d11da03`, are where this method comes from.

A fifth way finds the things that are not faults: using the app as a writer for
a stretch with the question *what did I just do twice, wait for, or reach for
and not find*. The README's own comparison is the standard, a Jupyter notebook:
what would somebody who lives in one expect here.

**Record, never fix.** Every finding, however trivial, is a record below and
nothing is repaired during the review. The repository's own sweep method says
why: a list fixed as it is found is a list that stops at the first hard item.
The fixes are a separate plan, written from this document when it is finished.

**The questions that find things here.** Asked of every area.

- What sets this back? For a dismissal, an error, a busy flag, an answer read
  once on mount, a cached value.
- How many ways can this job end, and does each ending reach the screen?
  Success, failure, timeout, cancel, the server restarting underneath it, the
  tab reloading in the middle.
- Does the replayed version equal the live version? The panel after a reload,
  the transcript, the tree after `files_changed`, the tabs after a restore.
- Does every implementation behind this seam keep the promise? Three agents,
  two transports, two installers, six page colours, two themes, four widths.
- What happens on the thesis rather than the fixture? Forty files, two
  megabytes, four hundred versions, a multi-megabyte log.
- What happens on the second one? A second tab, project, browser, peer,
  instance.
- What does the document say, and is it still true?
- Can it be done from the keyboard, and does a screen reader hear what a
  sighted person sees?

**A document's claim is a lead, not a finding.** `docs/design.md` narrates the
state at the time each section was written and is appended rather than revised,
so a sentence saying the app cannot do something is checked against the code
before it is recorded.

**Nothing touches the writer's own install.** It runs as a `systemd --user`
service from `~/apps/NextTex` on port 8450 and keeps its token, password and
project registry in `~/.local/share/nexttex/`. Every server this review starts
redirects `XDG_DATA_HOME` and `XDG_CONFIG_HOME` into a scratch sandbox and
takes a port of its own, the way `e2e/server.ts` does. `scripts/dev.sh` and
`scripts/devserver.sh` do not redirect state and are not used here.

**Nothing reaches the real `claude` binary by accident.** Every server that is
not a deliberate live session sets `NEXTTEX_SCRIPTED_AGENT=reply`,
`NEXTTEX_FAKE_CLAUDE_AUTH=1` and `NEXTTEX_COLLAB_TRANSPORT=loopback`. The
sign-out control is never pressed: `/api/claude/logout` runs `claude auth
logout` against this machine's own login, which is how the suite once signed
the developer out. Live sessions choose `claude-sonnet-5` in the panel's model
menu before the first question.

**The record format.** One record per finding, numbered across the whole run.
Categories are `bug`, `comfort`, `performance`, `accessibility`, `docs` and
`security`. Severity is `blocker` (loses work or exposes the machine), `high`
(a feature does not work in an ordinary case), `medium` (works, and is wrong in
a case a writer will meet), or `low` (cosmetic or rare). Confidence is
`confirmed` (reproduced), `likely` (read in the code and consistent with a
screen) or `suspected` (a reading only). A confirmed blocker or security
finding is also reported to the writer at once rather than waiting here.

## Baseline

Recorded at `5942653` on 11 September 2026, before anything was looked at, so
that this review can separate what it found from what was already broken.

**Everything is green.** `scripts/check.sh --all` passed in 12 minutes and 12
seconds with nothing skipped that was not meant to be.

| tier | result | wall time |
|---|---|---|
| Types (`tsc --noEmit`) | pass | |
| Frontend (vitest) | 700 passed, 29 files | 4 s |
| Python (pytest) | 1279 passed, 16 skipped | 136 s |
| Frontend build and precompression | pass | |
| Bundle budget (`bench.bench --bundle-only`) | pass | |
| Browser (playwright) | 228 passed | 9 m 18 s |

GitHub Actions is green on all three workflows at this commit: `python`,
`interface` and `interface checks`, from `gh run list`. The `python` workflow
took 3 m 44 s there.

**Nothing was already broken, so every finding below belongs to this review.**

The benchmark numbers are in their own section, because the README quotes a
measured column beside the budgets and the transcription is worth checking.

## Findings

*Pending.*

## Unverifiable here

- **The OpenAI provider against OpenAI.** There is no key on this machine.
  Everything above the transport runs for real against a stub.
- **`install.ps1` under a real PowerShell.** `pwsh` is not installed here. The
  Windows laptop covers the real thing.
- **A genuine legacy code page, `winget`, `schtasks`.** Windows only.
- **macOS.** Nothing here can run it.
- **`openin_any`.** `docs/architecture.md` records that a hostile source file
  can read what the server's user can read. No code here closes it, and it is
  written down rather than claimed. Recorded as known, not re-found.

## What the findings have in common

*Written last.*

## Cost and time

*Written last.*
