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
compile paths, and — under `tests/api/` — every HTTP route, its documented
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

`e2e/` is the browser. Each spec starts a NextTex of its own — own port, own
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
the status dot can be reliably polled for — so a spec that has to prove a
build did *not* happen counts `compile_start` instead of watching pixels.

`frontend/src/tree.ts` is read by the upload chooser rather than the
server: which folders exist, what is already in one, and what "keep both"
will call the new file are all answerable from the tree the rail is already
drawing, so the chooser opens in the same frame the file picker closes in.
The last of those has to agree with `unique_name` on the server exactly —
the chooser quotes the name back before anything is written — which is why
both are tested against the same cases.

`frontend/src/**/*.test.ts` is vitest over the frontend's pure logic —
finding the maths under the pointer, where a diff begins, which completion
list belongs at the cursor — plus a contrast check that parses the palette
out of `styles.css` and measures every text-on-surface pairing the app uses,
in both themes. It found the readability problem that had already been
caught by eye twice.

`bench/` is not part of any tier. It builds a project shaped like a thesis —
forty source files, two megabytes of LaTeX, a populated build directory, a
`.git` with a working tree — and measures what the slow paths cost against
the budgets in `bench/thresholds.json`. Those are budgets rather than
records: the point is to notice a change that makes typing slower, on the
day it happens.


## The live check that is run by hand

Everything above runs without an account, without a network and without
spending anything, which is what makes it worth running on every change.
The cost is that none of it can tell you whether the model providers still
emit the message shapes the stand-ins replay.

`tests/test_live_agent.py` is that check. It drives the real agent against
a real account and asserts the *vocabulary* rather than the answer — that a
turn still produces `turn_start`, `text`, `text_end` and `done`, and that
`usage` still carries the fields the footer reads. It is skipped unless you
ask for it:

```bash
NEXTTEX_LIVE=1 .venv/bin/python -m pytest tests/test_live_agent.py -q
```

Run it before a release, and after any agent SDK upgrade.

The OpenAI provider has the same limit and no way to close it here: there
is no account to test against, so `tests/test_openai_agent.py` stubs the
transport and runs everything above it for real — the streaming parser, the
tool loop, the path fence, the edits, the usage accounting and the event
vocabulary. Whether OpenAI still returns those shapes is unproven.

## Two things the browser tier cannot prove

**A drag is the real gesture, and the shortcut nearly cost a feature.**
Headless Chromium ends an HTML5 drag with `dragend` and no `drop` when the
page has refused it, which looks exactly like the harness being unable to
drag — so the first version of the file-tree spec dispatched the events by
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
`remember.json` proves the plumbing end to end — the tool writes, the panel
shows it, a cleared conversation still carries it into the prompt. What it
cannot prove is that a real model reaches for the tool when a writer says
*remember this*, since the stand-in has no judgement to exercise. That
belongs with the live check above: ask the real agent to remember something,
clear the conversation, and see whether the next one knows it.

## Where the line is

Worth its maintenance: anything that asserts a contract, anything that
guards a safety property — path escape, atomic write, undo refusal, the
permission fence, history permanence, an automatic approval still reaching
the record — anything that encodes a bug already paid for, and the handful of
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
