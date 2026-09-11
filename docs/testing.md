# Testing NextTex

Four tiers, and each exists because the one above it cannot see what it
sees.

```bash
scripts/check.sh          # types, frontend and Python: about twenty seconds
scripts/check.sh --all    # adds the browser tier: about two minutes
scripts/check.sh --bench  # what the slow parts cost, on a project shaped like a long document
```

If the Node on your PATH is older than 20, point `NEXTTEX_NODE_BIN` at a
newer one rather than changing the system's.


`tests/` is Python: the retention rules, the path fence, the log parser, the
compile paths, and, under `tests/api/`, every HTTP route, its documented
failures, and a path-escape assertion on everything that takes a path. The
fixtures redirect `XDG_DATA_HOME` and `XDG_CONFIG_HOME` **before** importing
anything under `server/`, because `server/main.py` builds its settings and
its registry at import time and writing a config file there would hand a
different token to whatever tab the writer has open.

The agent is replaced by `nexttex/scripted_agent.py`, which replays a list
of steps from `tests/scripts/*.json` through the same event queue the real
one writes to. Its `edit` step performs a real write, so the version, the
rebuild, the chip and the undo all run for real; its `permission` step
really does block until somebody answers. The real agent needs an account,
costs money and answers differently every time, which is why none of that
had ever been tested.

`e2e/` is the browser. Each spec starts a NextTex of its own: own port, own
state directories, own projects, and a config written before the server so
the token is known rather than scraped out of a log line. Waits are on
observables (a response, a DOM state), never on a clock. It exists mainly
for the things that only exist in a browser: two windows on one project, the
autosave race, the permission card's shield, a reload rebuilding the
conversation from the transcript on disk.

If a browser test needs the agent to do something particular, the first line
of the question names the script: `#script:permission`.

The sign-in screen gets the same treatment from the other direction.
`tests/fake_claude.py` is a real program that answers `auth status` and
`auth login` predictably; pointing `NEXTTEX_CLAUDE_BINARY` at it leaves the
pseudo-terminal, the output pump and the screen running exactly as they do
in earnest. That seam is where the first-run bug was, and mocking either
side of it would have removed the thing worth testing.

For anything the page never displays, `e2e/events.ts` subscribes to the
server's event stream from the test process and counts what arrives. A build
of a short document takes about 130 milliseconds, which is less time than
the status dot can be reliably polled for, so a spec that has to prove a
build did *not* happen counts `compile_start` instead of watching pixels.

`frontend/src/tree.ts` is read by the upload chooser rather than the
server: which folders exist, what is already in one, and what "keep both"
will call the new file are all answerable from the tree the rail is already
drawing, so the chooser opens in the same frame the file picker closes in.
The last of those has to agree with `unique_name` on the server exactly,
the chooser quotes the name back before anything is written, which is why
both are tested against the same cases.

`frontend/src/**/*.test.ts` is vitest over the frontend's pure logic,
finding the maths under the pointer, where a diff begins, which completion
list belongs at the cursor, plus a contrast check that parses the palette
out of `styles.css` and measures every text-on-surface pairing the app uses,
in both themes. It found the readability problem that had already been
caught by eye twice.

`bench/` is not part of any tier. It builds a project shaped like a thesis,
forty source files, two megabytes of LaTeX, a populated build directory, a
`.git` with a working tree, and measures what the slow paths cost against
the budgets in `bench/thresholds.json`. Those are budgets rather than
records: the point is to notice a change that makes typing slower, on the
day it happens.


## The live check that is run by hand

Everything above runs without an account, without a network and without
spending anything, which is what makes it worth running on every change.
The cost is that none of it can tell you whether the model providers still
emit the message shapes the stand-ins replay.

`tests/test_live_agent.py` is that check. It drives the real agent against
a real account and asserts the *vocabulary* rather than the answer, that a
turn still produces `turn_start`, `text`, `text_end` and `done`, and that
`usage` still carries the fields the footer reads. It is skipped unless you
ask for it:

```bash
NEXTTEX_LIVE=1 .venv/bin/python -m pytest tests/test_live_agent.py -q
```

Run it before a release, and after any agent SDK upgrade.

The OpenAI provider has the same limit and no way to close it here: there
is no account to test against, so `tests/test_openai_agent.py` stubs the
transport and runs everything above it for real: the streaming parser, the
tool loop, the path fence, the edits, the usage accounting and the event
vocabulary. Whether OpenAI still returns those shapes is unproven.

## The installer had no tests at all, which is why it had so many bugs

For a long time this repository had four tiers of tests and nothing
whatsoever on the first thing anybody runs. Every divergence between the two
installers survived because a shell script is only assertable by grepping
it, and a grep test would have passed for all of them: `test_cross_platform`
checked that the word `LaunchAgents` appeared somewhere in `install.sh`,
which says nothing about whether the plist it wrote was correct.

The installer is Python now, behind a short bootstrap in each shell, and the
seam that makes it testable is that **`survey()` takes its platform as an
argument rather than detecting it**. So `tests/test_install_survey.py` and
`tests/test_install_plan.py` assert exactly what a Windows machine with
nothing installed would be told, from Linux, with no Windows anywhere.
`tests/test_install_steps.py` runs a whole install with a recording console
in place of the real one and asserts the sequence of argv: uv before the
venv before pip, no certificate for a localhost install, the service last,
and, most importantly, that a step which fails **stops** rather than
reaching "Ready". `tests/test_install_service_files.py` snapshots the
systemd unit, the launchd plist and the Windows helper's arguments.
`tests/test_install_stdlib_only.py` walks the imports and then actually runs
`python -I -S -c "import nexttex.install.steps"`, because the installer runs
on a bare interpreter before there is a virtual environment and the server
imports that same module from inside one.

`tests/test_install_ui.py` covers the progress display, including one case
that has no business passing on Linux: a `TextIOWrapper` opened as `cp1252`,
which is what a Windows console on a legacy code page reports, where the
braille spinner raises `UnicodeEncodeError` inside the draw loop.

**`tests/test_install_bootstrap_sh.py` runs the real script**, under `sh`,
which here and on Debian and Ubuntu is dash, because `curl ... | sh` is the
documented command and in that shape the shebang is never read. The
interactive cases use `pty.fork`, not `pty.openpty` with an inherited
descriptor: only the fork makes the pty a *controlling* terminal, and
without one `tty_available` says no, so a test built the other way would
quietly exercise the unattended branch and assert nothing about the branch
every reported bug has been in.

Writing that file found two bugs that had already shipped. `set -o pipefail`
on line seven, which dash rejects outright, so the documented install
command died before printing a word on the most common Linux there is. And a
`/dev/tty` probe written as `{: < /dev/tty; }`: `:` is a POSIX *special
built-in*, and a redirection error on one of those is defined to end the
shell, so on a machine with no controlling terminal that line did not report
"nobody there", it killed the installer. Neither was visible by reading.

**`pwsh` is not installed on this machine**, so nothing here can execute
`install.ps1`. The PowerShell tests are written behind
`skipif(shutil.which("pwsh") is None)`: they skip locally and run in CI,
where `ubuntu-latest` ships PowerShell 7. What only a real `windows-latest`
job can ever answer is `winget`, `schtasks`, the `WScript.Shell` COM call
and a genuine legacy code page.

And what nothing asserts, on any platform, is a real fresh machine reaching
a served project. The README says so and should go on saying so.

## Two things the browser tier cannot prove

**A drag is the real gesture, and the shortcut nearly cost a feature.**
Headless Chromium ends an HTML5 drag with `dragend` and no `drop` when the
page has refused it, which looks exactly like the harness being unable to
drag, so the first version of the file-tree spec dispatched the events by
hand with a shared `DataTransfer` and passed. A minimal control page proved
the browser could drop perfectly well, and the fault was ours: a row set
`dropEffect` to "move", the event bubbled to the tree body, which asked the
same question about the project root, said no, and set it back to "none".
Chromium reads the last word. Dragging would have shipped looking right and
doing nothing.

The lesson is worth more than the bug: when a browser feature appears not to
work under test, write the smallest page that uses it before concluding the
harness is at fault. `dragRow` now uses `page.dragAndDrop`.

**The scripted agent calls the memory tool because the script says to.**
`remember.json` proves the plumbing end to end: the tool writes, the panel
shows it, a cleared conversation still carries it into the prompt. What it
cannot prove is that a real model reaches for the tool when a writer says
*remember this*, since the stand-in has no judgement to exercise. That
belongs with the live check above: ask the real agent to remember something,
clear the conversation, and see whether the next one knows it.

## Where the line is

Worth its maintenance: anything that asserts a contract, anything that
guards a safety property, path escape, atomic write, undo refusal, the
permission fence, history permanence, an automatic approval still reaching
the record: anything that encodes a bug already paid for, and the handful of
browser specs that prove the core loop still works end to end.

Not worth it: snapshot tests of rendered React, which fail on every
intentional design change and assert nothing about behaviour; a second
browser spec for a variation the first already covers; tests that assert an
exact duration rather than a budget; and anything a unit test can pin down.
Every timing constant in the browser tier is a reason to prefer the layer
below it.

## A stand-in that is kinder than the real thing tests nothing

`ScriptedAgent` exists so the browser tests can drive a whole conversation
without a model, and it stood in faithfully enough that nobody re-read it
when the real agents grew a guard. `ProjectAgent.reset` and
`OpenAIAgent.reset` both refuse while a turn is running, because archiving
the transcript out from under a turn still writing into it leaves the record
and the panel disagreeing. The stand-in did not refuse. So the browser suite
ran the reset path against an agent that allowed exactly the thing the guard
exists to prevent, and would have gone on passing if the guard had been
deleted.

The lesson is not "check the stand-in", which nobody remembers to do. It is
that a duck-typed seam needs one test that runs the same promises against
every implementation behind it. `tests/test_agent_parity.py` is that test:
it asserts the shape, and then the handful of things the interface is
actually built on -- a question always produces a `done`, Stop is never a
silent no-op, a second question while one is running is refused, usage
carries the fields the footer reads. It found three divergences the first
time it ran, in three different classes.

## A curated pair list only covers the pairs somebody thought of

`contrast.test.ts` measures every colour pairing the app uses against WCAG,
and its own comment explains why the list is written by hand: a grep for
every `color` and `background` in the same rule invents pairs that never
meet on screen. That is the right call, and it has a cost that took a while
to surface.

`--surround` is the ground behind the panes, darker than the three surfaces.
The list certified `--ink` against it and stopped there. The projects screen
puts small text on that plane, and `--ink-3` measures **4.17:1** there,
under the 4.5 that small text needs. The unit test could not see it, because
the pairing was not in the list; axe did see it, in the browser, on the real
screen -- and it looked like a flake for a while because the update footer
renders six different states and only some of them carry dim text.

Two lessons rather than one. A hand-curated list needs a rule for what goes
in it: every ground the app paints, against every ink it puts on that
ground. And an intermittent failure in a test that renders a component with
several states is usually the states, not the timing -- calling it flaky and
re-running it is how it survives.

The pairing is now prevented rather than certified: `.nx-on-surround` steps
the dimmest ink up to `--ink-2` (6.04:1), and `["ink-3", "surround"]` is
deliberately absent from the list, with a comment saying that adding it back
is meant to fail.

## Two peers, in one process

Collaboration is the first thing in NextTex that needs *two installs* to test
at all, and the obvious way to arrange that does not work. `NEXTTEX_INSTANCE`
gives a second install its own state directory, port and token, but
`server/main.py` builds `SETTINGS` and `REGISTRY` at import time, which is
why `tests/api/conftest.py` redirects the environment before importing it, so
two of them inside one pytest process is not something that can be arranged.

The seam is lower down instead. Everything above `server/collab/transport.py`
is bytes in and bytes out, so `LoopbackTransport`, two queues and a
module-level hub: is a complete second implementation of "the network", and
`NEXTTEX_COLLAB_TRANSPORT=loopback` selects it in the same way
`NEXTTEX_SCRIPTED_AGENT` selects a stand-in for the model. Both the route
tests and the browser tier set it, so **no test opens a real endpoint or
contacts iroh's discovery and relay hosts**.

It is not only cheaper than the real thing; it can do something the real
thing cannot do on request. `HUB.sever()` and `HUB.heal()` are a network
partition with the messages written during it held and delivered afterwards,
which is exactly the case collaboration exists for, somebody shutting their
laptop on a train, and exactly the case that is impossible to stage against
a real network in a test that has to finish in a second.

What the loopback cannot prove is that iroh works. That has its own test,
`tests/collab/test_iroh_live.py`, behind `NEXTTEX_LIVE` alongside the paid
check against a real model, and it opens genuine endpoints:

    NEXTTEX_LIVE=1 .venv/bin/python -m pytest tests/collab/test_iroh_live.py

Run it after touching `iroh_transport.py`. Two of its details cost an hour
each to find and neither is visible from the outside: `bi.send()` and
`bi.recv()` must be captured once rather than called per use, and the
accepting side has to hold the connection open or the stream resets under a
reader that is still going.

## The bench caught a thirty-four second freeze

`collab.ingest_ms` measures folding an outside change, a `git pull`, an
agent's write, an editor in another terminal, into the shared document. It
was added with a budget of 40 ms and immediately measured **34,000**.

`difflib.SequenceMatcher` is quadratic in the worst case and was being handed
two whole files. Appending one line to a fifty-kilobyte chapter is the most
ordinary thing that can happen to a project, and it would have frozen the
server for over half a minute: on a path with no user-facing progress
indicator, so it would have looked like a hang rather than like slowness.
Trimming the common prefix and suffix first is linear and leaves almost
nothing to compare; it is 3 ms now.

Two things about that are worth keeping. It was not found by a test, because
every test used small files and passed in milliseconds; the bench found it
because the bench builds a project the size of a real thesis. And the
regression guard for it lives in `tests/collab/test_store.py` rather than in
the bench, so an ordinary `scripts/check.sh` would catch it coming back.

## The suite used to sign the developer out of Claude Code

`nexttex/claude_auth.py` looks for the CLI at `NEXTTEX_CLAUDE_BINARY`, then on `PATH`, then at `~/.local/bin/claude`, because a self-hosted install genuinely does sign in with the machine's own `claude`. `tests/api/conftest.py` redirects `XDG_DATA_HOME` and `XDG_CONFIG_HOME` but not `HOME`, so for one day nothing stood between a test and the developer's own login.

The test that did it was `test_the_same_origin_is_not_refused`. It posts to every body-less route to prove the `Origin` check is not a wall in front of the app's own fetches, and one of those routes is `/api/claude/logout`. Being allowed through means reaching the handler, and that handler runs `claude auth logout`, which deletes `~/.claude/.credentials.json`. Nothing failed, because signing out is exactly what the route is for. The whole of the damage was outside the repository, which is why no amount of reading the test output would have shown it.

There are now three guards, and they are deliberately at three different levels.

`tests/conftest.py` points `NEXTTEX_CLAUDE_BINARY` at `tests/fake_claude.py` for the entire session. It is in the root conftest rather than at the call sites so that it covers the tests nobody has written yet.

`test_the_suite_never_reaches_the_real_cli` asserts that `claude_auth._claude()` resolves to the stand-in, so removing that guard fails here rather than on somebody's login.

A session-scoped autouse fixture checks that `~/.claude/.credentials.json` still exists when the run ends. That one is a tripwire around the whole run rather than around the CLI lookup, so it catches a future route or library that reaches the real `claude` by some path nobody has thought of yet. It checks existence and never contents, because a token refresh landing mid-run rewrites the file legitimately and must not fail the suite, whereas a sign-out removes it. On a machine with no Claude Code installed, which is what CI is, it does nothing.

If you are adding a test that exercises signing in or out, point `NEXTTEX_CLAUDE_BINARY` at `tests/fake_claude.py` and set `NEXTTEX_FAKE_CLAUDE_STATE` to a file under `tmp_path`. The browser tier does the same thing in `e2e/server.ts` through `NEXTTEX_FAKE_CLAUDE_AUTH`, which `status` and `logout` both honour.

The way this was found is worth keeping as well, because it generalises to anything that damages the machine rather than the repository. Put a stand-in first on `PATH` that logs its own `argv`, its parent process chain and `PYTEST_CURRENT_TEST`, then run the suite. A full run was reaching the real CLI fifteen times: fourteen `auth status` and one `auth logout`. That turns a theory into a recording, and it is safe, because the suite hits the stand-in rather than the real thing.
