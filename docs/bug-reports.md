# How a bug report is handled

Every issue on this repository is fixed by a Claude Code session that the
owner starts by hand, with `/fix-issue N`. This is what that session does,
in the order it does it, written so that a person can follow it too and so
that a session on a machine with none of the owner's history has the whole
of it. The writing rules, the test tiers and the git conventions are not
here; they are in `CLAUDE.md` and `docs/testing.md`, and this document
assumes them.

## What arrives

The issue form has five fields. *What happened* and *How to make it happen
again* are the reporter's own words. *Where NextTex runs* and *Commit* are
filled in by the footer's **Report a problem** from the install itself, and
*The report* is the text that control puts on the clipboard, which
`python server/run.py --report` prints from a terminal and
`python -m nexttex.report` prints when the virtual environment is what
broke.

The report is the thing to read first, before the prose. Its sections are
the install (the code commit and the interface commit, which can differ, and
whether the tree is dirty), the settings with a yes or no where a secret
would be, the tools the installer's survey found and where, whether a
service supervises the process, what the Claude CLI says about itself, a
count of projects, what the browser saw (its last twenty errors, including
every answer of 500 or worse with the reference the server logged under),
and the last eighty lines of each log: the user journal on Linux,
`server.log` and `server.err.log` on macOS and Windows, the last run
recorded in `install.log` and `update.log` everywhere, and on Windows the
system's own logs: the scheduled task's history for the last week, which
is the trace a launcher leaves when it never got as far as
`server.err.log`, and the Application log's crash events naming the
interpreter, which is what a process that died with nothing logged leaves
behind. A Windows report that says task history is not enabled is telling
you the machine keeps none, which is the default; ask the reporter to turn
it on in Task Scheduler before the next attempt rather than reading the
absence as evidence. The token, the OpenAI key, the password hash and the
session fingerprints are already gone from it, and so are the home
directory and the account's name. `nexttex/report.py` is the composer;
`docs/architecture.md` under *Reporting a problem* says how.

An intake workflow, `.github/workflows/issues.yml`, has already added the
`triage` label and told the reporter that a person will read it. Nothing
else has happened to the issue.

## Intake

Start with `gh issue view N --comments`. Read the report before the
description, then the description against the report.

Three things the report answers before any code is opened. Whether the code
commit and the interface commit agree: when they do not, the install was
updated and not restarted, or the interface fetch failed, and that is a
known failure with its own line in the footer rather than a new bug. Which
commit the reporter is on at all: a bug already fixed on master is answered
with the commit that fixed it and how to update. And which platform and
launcher, since the log the report quotes depends on both.

Remove `triage` at this point. The issue is being read.

## Triage, and what each label means

`needs-info`: the report is missing, or the steps do not say what the
reporter expected, or the platform cannot be told. Ask for the one thing
that is missing, by name, in a comment. This label promises the reporter
that the issue closes after fourteen days of silence, and the `stale` job in
`issues.yml` keeps that promise on Monday mornings with a comment saying it
can be reopened by replying.

`duplicate`: link the earlier issue and close this one. Say what the earlier
one's state is, since "duplicate of #12" tells a reporter nothing about
whether #12 is fixed.

`cannot-reproduce`: only after actually trying, on the platform the report
names or the nearest thing to it, and the comment says what was tried and
where. It is not a close; it is a question with evidence attached.

`confirmed`: a failing test exists that shows the fault. This is the label
that means the work has started, and it is added when the test is written,
not when the bug is believed.

`wontfix`: with the whole reason, and what the reporter can do instead. A
reason short enough to fit a label is not a reason.

`invalid`: for something that is not NextTex, with a sentence about what it
is instead. Rare; most things that look like a LaTeX problem or a Claude CLI
problem are still worth a line in the README if two people hit them.

`fixed-in-master`: added by hand with the closing comment, below.

## Reproduce it first

The fix begins with a test that fails, in the tier that can see the fault.
This is not ceremony: a fix without a failing test in front of it is a
guess about what the reporter meant, and the test is also what proves the
fix to the next session that touches the same code.

Which tier is decided by what the fault is. A module's behaviour goes in
`tests/`, beside that module's other tests. A route goes in `tests/api/`,
with the path-escape assertion every file there carries for any route that
takes a path. Interface logic with no browser in it goes in
`frontend/src/*.test.ts`. Something only a browser shows, a layout, a
control that does nothing, a state the page gets into, goes in `e2e/specs/`
as a Playwright spec that starts its own server. The installer's tests are
`tests/test_install_*.py`, and a change under `scripts/` or `nexttex/install/`
is checked for real only by dispatching the install lane, below.

When the report quotes a 500, the eight-hex reference in the message is also
in the log line the report quotes, and that line names the route and the
exception type. Start there.

## Fix it, and check it

Fix the cause, not the symptom the reporter described, and fix whatever else
is wrong in the same file while it is open; a tangent gets its own commit
so it stays legible in the log. Then:

```sh
scripts/check.sh            # tsc, vitest, pytest: always
scripts/check.sh --all      # adds the build, the bundle budget and the
                            # browser tier: whenever frontend/ changed, or
                            # a route the browser exercises did
```

`--all` needs `NEXTTEX_NODE_BIN` pointing at a Node 20 or newer when the
system Node is older, a real LaTeX and a Chromium; `docs/testing.md` has the
details. Never set `NEXTTEX_LIVE=1`, never run `e2e/review/` or
`e2e/shots/`, and never touch the `NEXTTEX_CLAUDE_BINARY` line in
`tests/conftest.py`: those are the three things that keep the suite from
reaching a real account. CI runs Python 3.10, so nothing newer than 3.10
goes in.

## The documents, in the same commit

A change owes the documents it made wrong: `docs/architecture.md` when the
mechanics moved, `docs/design.md` when the interface did, `README.md` when
something a reader would act on changed, and `TRACKER.md` for whatever the
fix turned up and left. They go in the commit with the code, because a
documentation commit that trails the change is one nobody writes.
`tests/test_documents_match_the_code.py` checks that every path, route and
`NEXTTEX_*` name the documents use exists.

## Commit and push

One commit per fix, on `master`, with a subject that is a full sentence in
the present tense saying what is now true, and a body that says what the
reporter saw, what the cause was, and what changed, in prose. The last line
of the body is `Fixes #N`, which is what closes the issue when the push
lands.

Then push `master` and watch:

```sh
gh run list --limit 5
```

Three workflows run on every push: `python`, `interface checks` and
`interface`. All three must be green before the issue hears anything. The
third matters more than it looks: the installed app fetches its interface
bundle by commit from the `interface` release, and `scripts/update.sh` on
the reporter's machine asks for the bundle of the commit it just pulled. A
closing comment written before that bundle exists sends the reporter to
update into a 404. Confirm it is there:

```sh
gh release view interface --json assets --jq '.assets[].name' | grep <sha>
```

## Close the loop

GitHub has closed the issue from `Fixes #N`. Add `fixed-in-master` and
comment, in this shape:

> Fixed in `<sha>`. <One sentence on what the cause was.> Update from the
> projects screen's footer, or run `scripts/update.sh` (`scripts\update.ps1`
> on Windows), and restart if the footer says to.

If the fix touched `scripts/` or `nexttex/install/`, dispatch the install
lane for the reporter's platform and wait for it before the comment:

```sh
gh workflow run install.yml -f os=<ubuntu|macos|windows> -f tex=none
gh run watch
```

and say in the comment that it ran.

## More than one issue in a session

A session that takes several issues publishes a tracker Artifact before its
first commit: one row per issue with its state (reading, reproduced, fixed,
pushed, green, closed) and the commit that fixed it, republished after every
push. Sessions are interrupted, and a tracker that is current is what makes
the next session cheap.
