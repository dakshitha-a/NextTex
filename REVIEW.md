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
`confirmed` (reproduced in the running app, or read line by line in the source
with the mechanism established), `likely` (read in the code and consistent
with a screen, with a step not yet pinned down) or `suspected` (a reading
only). The protocol as written reserved `confirmed` for reproduction; the
definition is widened here rather than relabelling, because a bug read off the
source with its mechanism named is not a guess, and every record's "Found by"
line says which of the two it was. A confirmed blocker or security
finding is also reported to the writer at once rather than waiting here.

**One thing this review got wrong, recorded because the rule above is the one
it broke.** The writer's own NextTex, the `systemd --user` service on port
8450, stopped at 15:42 during this session and did not come back. The journal
shows it running from 13:32 and then nothing but a CPU accounting line at
15:42:30, with no exit code and no restart, which is the shape of a process
killed from outside rather than one that failed. This review was clearing port
conflicts between its own servers at about that time, and while each one was
identified by reading `XDG_DATA_HOME` out of `/proc/<pid>/environ` first, that
is not proof it never got one wrong. The service was started again at the end
of the session and answers on 8450. A second careless moment near the end of
the run makes the first one more likely rather than less: a `pkill -f
XDG_DATA_HOME` intended to find the review's own servers matched the shell
running it and killed that instead. It touched nothing else, and every server
stopped after it was identified by reading `/proc/<pid>/environ` and named by
its number. Nothing in the writer's state directory
was written to at any point, and their login to Claude Code is byte-identical
to the fingerprint taken before the first live session.

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

Numbered across the whole run, in the order they were found. Grouped by
mechanism at the end rather than here, because a list grouped as it is written
is a list that decides too early what a thing has in common.

### Compile, diagnostics and the preview

### ~~R-001 · Compile · bug · medium · likely~~

**Fixed.** The same first frame is the fourth ending the flag was missing: it is
sent on every automatic reconnection, so a `compile_done` lost while the stream was
down is corrected the moment it comes back. Held by
`frontend/src/compile-state.test.ts`, which stages the dropped stream a browser
cannot.

Found by: reading. Where: `frontend/src/store.ts:794` and `:809`, with
`frontend/src/panes/Status.tsx:33`.

What happens: `compiling` is raised by a `compile_start` event and there is
exactly one thing that lowers it, a `compile_done` for the same document. The
job has a fourth ending that sends neither: the server going away while a
build is in flight. `reconcile()` at `store.ts:683` exists for exactly this
class of problem and restores only the agent's `thinking` and its permission
cards, and `source.onopen` calls it only `if (state.thinking)`, so a stream
that reconnects after a lost `compile_done` restores nothing. The strip then
reads `Compiling` with a breathing dot for as long as the tab is open.

Reproduce: open a project, cause a build, stop the server while it runs, let
the browser's event stream reconnect.

Expected: the strip says what is true. `docs/design.md` section 10 argues the
dot exists to answer *does the picture match the text*, and a dot that
breathes for ever answers nothing.

Mechanism: a busy flag with fewer ways down than the job has endings, which
is the family `d11da03` named.

### ~~R-002 · Preview · bug · medium · likely~~

**Fixed.** The two failure paths in the PDF fetch check `cancelled` like the
success path already did.

Found by: reading. Where: `frontend/src/panes/Pdf.tsx:546` and `:564`.

What happens: the effect that fetches the PDF checks its `cancelled` flag on
the success path, twice, and on neither failure path. A superseded fetch that
404s or throws therefore calls `setAbsence` after its replacement has already
drawn, and the pane covers a rendered document with *Nothing has been typeset
yet* or *The preview could not be fetched*. The effect re-runs on `stamp`,
which changes on every build, and on `showing`, which changes when the writer
picks another previewed document, so two in flight at once is ordinary rather
than exotic.

Reproduce: switch between two previewed documents quickly while builds are
landing, with one of them not yet built.

Expected: an answer about a document that is no longer on screen changes
nothing.

Mechanism: an asymmetric cancellation check. The success path was hardened and
the failure paths beside it were not.

### ~~R-003 · Compile · accessibility · low · confirmed~~

**Fixed.** The status control is disabled in the four states where it opens nothing.
Held by `e2e/specs/a11y.spec.ts` and `e2e/specs/clipping.spec.ts`, both of which now have to earn an error before the drawer will open.

Found by: reading. Where: `frontend/src/panes/Status.tsx:80`.

What happens: the status dot and its label are a `<button>` whose handler is
`clickable && onToggleDrawer()`. In four of the seven states `clickable` is
false, and the control is then a focusable button that does nothing when
pressed or activated from the keyboard, with no `disabled` and no
`aria-disabled`. Somebody tabbing through the editor stops on it and gets no
answer.

Expected: a control that cannot be used says so, or is not a tab stop.

### ~~R-004 · Compile · bug · high · confirmed~~

**Fixed.** `summarise` takes the first error the log gave, which is the order the
engine read the document in. Two existing tests encoded the alphabetical order and
are rewritten with their reasoning.

Found by: reading, then reproduced against the real function. Where:
`nexttex/explain.py:246`.

What happens: `summarise` picks the error to start from with
`min(errors, key=where)`, and `where` is `(str(file or ""), line)`. That is
**alphabetical order by filename**, not document order. Its own docstring says
"this names the first error in document order, which is nearly always the
cause", and the README's highlight says "Errors explained in English, with the
one to start from named". Neither is what the code does.

Three cases, each run against the real function:

```
main.tex:12   File `nonexistent.sty' not found     <- the cause
chapters/01_introduction.tex:40  Undefined control sequence
  named as the one to start from: chapters/01_introduction.tex:40
```

```
chapters/01_introduction.tex:5   Undefined control sequence
appendices/permissions.tex:900   Missing $ inserted
  named as the one to start from: appendices/permissions.tex
```

```
main.tex:3    Emergency stop
(no file):     Something with no file
  named as the one to start from: (no file)
```

The first is the ordinary case and the worst of the three. A missing package
in the preamble produces a cascade in every chapter after it, and `chapters/`
sorts before `main.tex`, so the app points the writer at the consequence and
calls it the cause. The third says that any error the parser could not
attribute to a file wins over every error that has one, because `""` sorts
first.

Expected: the first error in document order. It is already available:
`nexttex/latexlog.py:207` appends diagnostics as it feeds the log line by
line, and TeX writes its log in document order, so `errors[0]` is the answer
and the sort is not only wrong but unnecessary.

Mechanism: a comparison written for a tuple that looks ordered and is not.
Nothing tests it, because every test project has one file.

There is a test, and it is part of the finding.
`tests/test_explain.py:89`, `test_the_summary_orders_by_file_then_line`, asserts
that `chapters/01.tex` is named ahead of `chapters/02.tex`. It passes for the
wrong reason: those two filenames sort the same way alphabetically and in the
document, so the case cannot tell the two orders apart. The test is named
after the implementation rather than after the intent, which is how the
behaviour came to be certified rather than caught.

### ~~R-005 · Compile · bug · medium · confirmed~~

**Fixed.** One `LINE_START` in `deps.py`, imported by `compile.py`, replacing six
copies of a guard that read `\%` as a comment.

Found by: reading, then reproduced against the real pattern. Where:
`nexttex/deps.py:34`, the `SCAN` pattern.

What happens: the pattern strips comments with `^[^%\n]*` before the command,
which says "no percent sign earlier on this line". An **escaped** percent
sign, `\%`, is a literal percent in the writer's prose and is one of the most
ordinary things in a scientific document, and it hides every `\input`,
`\include`, `\subfile`, `\bibliography` and `\includegraphics` that follows it
on the same line.

```
HIT   \input{chapters/one}
MISS  We recovered 95\% of it. \input{chapters/one}
HIT   \includegraphics[width=0.5\linewidth]{figures/a.png}
MISS  Yield was 80\% \includegraphics{figures/a.png}
```

Expected: `\%` is not a comment. The scan should treat a percent preceded by a
backslash as ordinary text.

Consequence: a file hidden this way is not attributed to the document that
includes it, so it falls to the module's own fallback, which sends an
unrecognised `.tex` to the first document only. On a project with two
previewed documents, editing that chapter then rebuilds the wrong one and the
right one silently stops updating. `docs/design.md` section 19 names that
exact failure as the thing the asymmetric fallbacks exist to prevent.

The same `^[^%\n]*` guard is written six times: `nexttex/deps.py:36`, `:48`,
`:50`, `:51` and `nexttex/compile.py:89`, `:91`. So this is one mistake in six
places rather than six mistakes. `INCLUDE_RE` in the compiler is the second
one that matters: a chapter hidden this way drops out of `included_targets`,
so `chapter_for` cannot place a file in it and every edit to that chapter
takes the full build path instead of the scoped one.

The browser answered the same question correctly. `frontend/src/outline.ts:133`
carries the comment "a commented-out heading is not a heading. `\%` is a
percent sign" and handles the escape. The two sides of the app disagree about
what a comment is.

### ~~R-006 · Compile · bug · medium · confirmed~~

**Fixed.** A tie between chapters sharing a directory returns not-scoped, which the
caller already builds the whole document for, instead of the first chapter.

Found by: reading, then reproduced against the real function. Where:
`nexttex/compile.py:196`, `chapter_for`.

What happens: when a file is not itself an `\include` target, the function
attributes it to a target that shares its directory, longest directory first.
When the chapters are flat files in one folder, which is the ordinary layout
and the one this repository's own sweep spec seeds, every target has the same
directory, so the tie is broken by whichever `\include` appears first in the
main file.

```
chapters/01_introduction.tex  ->  chapters/01_introduction
chapters/03_results.tex       ->  chapters/03_results
chapters/figures/spectrum.tex ->  chapters/01_introduction
chapters/macros.tex           ->  chapters/01_introduction
appendices/a.tex              ->  None
```

The last row is the correct answer for a file nothing claims: no scope, so a
full build. Rows three and four get a confident wrong answer instead.

Reproduce: a thesis whose chapters are `chapters/01_*.tex` through
`chapters/07_*.tex`, with a figure or a macro file beside them that chapter
five uses. Edit that file. The build is scoped to chapter one and the preview
shows chapter one's pages, without the change.

Expected: a file that could belong to several targets belongs to none of them,
which is what the appendix row already gets and what the module's own
asymmetric fallback rule argues for in `docs/design.md` section 19.

Mechanism: the comment beside the loop explains the case it does handle, a
chapter with a subdirectory of its own, and the code reads as though that is
the only case there is.

### ~~R-008 · Compile · bug · medium · confirmed~~

**Fixed.** The open row and the selection are keyed by the diagnostic, on the same
fields the server's `Diagnostic.key()` uses, rather than by position in a list that
is rebuilt on every build.

Found by: reading. Where: `frontend/src/panes/Diagnostics.tsx:36`, `:37`,
`:148`, `:165`.

What happens: the drawer keeps `expanded` and `selected` as **indices into
`rows`**, and `rows` is a `useMemo` recomputed from `compile` and `lint`. A
build lands, the list is rebuilt with different contents in different
positions, and the two indices are not cleared. The row drawn as expanded and
the row carrying the selection bar are then whichever diagnostics happen to
sit at those positions now, which is a row the writer never opened and never
chose.

Reproduce: open the drawer on a document with several errors, expand the third
row, then type something that changes the error list and wait for the build. A
different row is expanded, showing an explanation for an error the writer was
not reading.

Expected: a selection survives a rebuild by naming its diagnostic, or it does
not survive at all. Keeping it by position is the one answer that is wrong
without looking wrong.

Mechanism: identity by position in a list that is replaced on a timer. The
same file already has the right key available: file, line and message
together are what `nexttex/latexlog.py`'s own `Diagnostic.key()` uses to
deduplicate.

### ~~R-009 · Compile · bug · medium · confirmed~~

**Fixed with R-004.** `orderRows` keeps errors before warnings and otherwise leaves
the log's order alone. Held by `frontend/src/panes/diagnostic-rows.test.ts`.

Found by: reading. Where: `frontend/src/panes/Diagnostics.tsx:44`.

What happens: the drawer sorts its rows `(a.file ?? "").localeCompare(b.file)`
then by line, with the comment "errors first, then by file and line: the first
row is always the one most worth reading". That is the same alphabetical sort
as R-004 and it is wrong for the same reason: alphabetical order by filename
is not document order, so the row at the top of the drawer is not the error to
start from.

This makes R-004 a mistake in two places rather than one, on both sides of the
wire, which matters for the fix: correcting only the server would leave the
drawer disagreeing with the headline above it.

### ~~R-010 · Compile · accessibility · medium · likely~~

**Fixed.** With R-028: the diagnostics row is a div with a real button over the message and Fix beside it.
Held by `e2e/specs/a11y.spec.ts`.

Found by: reading. Where: `frontend/src/panes/Diagnostics.tsx:151` and `:197`.

What happens: each diagnostic row is a `div` with `role="button"` and
`tabIndex={0}`, and the `Fix` control is a real `<button>` **inside** it. A
button inside a button is a nested interactive control: assistive technology
is told the outer element is a single button, and the inner one is either
unreachable or reported as part of its name. This is the axe rule
`nested-interactive`, whose impact is serious, and `e2e/specs/a11y.spec.ts`
never opens this drawer, so its sweep has never looked at it.

### ~~R-028 · Accessibility · accessibility · medium · confirmed~~

**Amended and fixed.** Three surfaces, and two of them were not on this list. The record names five; the sweep opened each one and found the fault on the diagnostics drawer and the history panel, found the papers panel carrying it too, and cleared the other three. The file tree is not one: a treeitem is not a role whose children are presentational, and restructuring it introduced `aria-required-children`, impact critical, before the sweep caught that. The download menu is a real `<button>` with a `role="menu"` of real `<button>`s and has never had the fault. The agent panel does not carry it now, which is the honest statement: pass 8 rebuilt parts of it, so this run cannot say what it looked like when the record was written. What the original run almost certainly saw is one page carrying an open drawer, reported once per surface visible at the time.
Held by `e2e/specs/a11y.spec.ts`, which now opens each of the five named surfaces rather than sweeping what is on arrival.

Found by: axe, on the real screens, in both themes. Where: five surfaces, one
mechanism.

What happens: `nested-interactive`, impact serious, fires on the diagnostics
drawer, the download menu, the history panel, a file row's menu and the agent
panel, in the light theme and again in the dark. The shape is the same
everywhere: an element carrying `role="button"` with `tabIndex={0}` that has a
real `<button>` inside it. Assistive technology is told the outer element is
one button, and the inner control is either unreachable or folded into its
name.

```
AXE  diagnostics drawer light: nested-interactive (serious)
AXE  download menu light:      nested-interactive (serious)
AXE  history panel light:      nested-interactive (serious)
AXE  file row menu light:      nested-interactive (serious)
AXE  agent panel light:        nested-interactive (serious)
```

The reason none of this has been caught is in `e2e/specs/a11y.spec.ts`: it
sweeps the project list, the editor, the permission card, the upload chooser,
the folder list and the tutorial. It has never opened a drawer, a menu or a
rail panel. Four surfaces that this review's sweep did visit came back clean,
the sections panel, the folded file list, the settings sheet and the share
panel, which says the app is mostly in good order here and that the gap is in
where the sweep looks rather than in how it looks.

The allowlist in that spec is the right pattern and the argument for extending
its reach rather than its exceptions.

### ~~R-040 · Interface · bug · high · confirmed~~

**Fixed.** `worthReloading` asks whether the message names a module and whether the
socket already says the server is unreachable, and the bare `Failed to fetch`
alternative is gone. The failure screen also says which of the two failures it is
rather than blaming an update that did not happen. Held by
`frontend/src/boundary-cause.test.ts` and `e2e/specs/server-gone.spec.ts`.

Found by: driving a real browser and stopping the server underneath it.
Where: `frontend/src/Boundary.tsx:36` and `:63`.

What happens: the error boundary reloads the tab once, automatically, when it
decides a failure "looks like a stale chunk". The test is a regular expression
over the error's message, and one of its five alternatives is the bare
`Failed to fetch`, which is what a browser says about **any** failed request,
not only a module import.

So when the server stops rather than updates, the boundary reloads into a
server that is not there, and the writer is left on the browser's own error
page:

```
AFTER 6s:  strip=(strip gone) editors=0
  body: This site can't be reached | 127.0.0.1 refused to connect. |
        ERR_CONNECTION_REFUSED | Reload | Details
```

Every open tab, the layout, the caret and the panel are gone from view, and
nothing anywhere says what happened or what to do. The app's own message for
this boundary is the opposite of what is true here: "Nothing you have written
is affected: your work is on disk, and the server is still running."

The comment above the pattern argues the trade honestly and gets one side of
it wrong: "A false positive here costs one reload; a false negative costs the
black window this exists to prevent." A false positive costs one reload when
the server is up. When the server is the thing that has gone, it costs the
writer their whole session view, and the once-per-tab guard cannot help,
because after the reload the app never runs again to show anything.

The fix is a narrower question rather than a narrower pattern: a stale chunk
is a request that 404s while the server answers, and a stopped server is a
request that does not connect at all. The app can tell those apart.

This also masks R-001. The compiling latch is real in the code, and killing
the server cannot be used to see it, because the tab reloads itself first.

### ~~R-044 · Preview · bug · high · confirmed~~

**Fixed.** `absenceFrom` takes the document's build state and answers four states
instead of two, so a build in flight and a project nobody has built are no longer
drawn as an empty document. Held by `frontend/src/panes/pdf-absence.test.ts` and
`e2e/specs/compile-state.spec.ts`.

Found by: driving a real browser and watching the disk beside the screen.
Where: `frontend/src/panes/pdf-absence.ts:17` with
`frontend/src/panes/Pdf.tsx:944`.

What happens: for the whole of a project's first build, the preview asserts
that the writer's document is empty.

```
 2.5s  strip=ready "Ready"  pdf=194745B  pane="Nothing has been typeset yet.
                                                An empty document produces no pages..."
 5.0s  strip=ready "Ready"  pdf=228767B  pane="Nothing has been typeset yet..."
 7.5s  strip=built "Built 6.39s"  pane="A Working Title  Your Name  Abstract..."
```

The document has a title, an abstract, three sections, an equation, a figure
and a table. The build is running, and the PDF is being written on disk as the
pane says there are no pages. Under the sentence is a button offering to
**Load a basic document**, which the server would refuse with "this document
already has something in it; the template would overwrite it".

`absenceFrom` maps a 404 from the PDF route to `empty`, on the reasoning in
its own docstring that "a 404 from this route means exactly one thing, and its
own message says so: nothing has been built yet". A 404 does mean nothing has
been built yet. It does not mean the document is empty, and those are the same
answer only for a project whose first build has already finished.

That docstring is worth quoting in full, because this is the mistake it was
written to prevent, one case over: "The pane set one state for both, so a
dropped connection told the writer *Nothing has been typeset yet. An empty
document produces no pages.* That is a false statement about their work, made
at the moment they are least able to check it, and it invites them to go
looking for a fault in a document that is fine." Splitting `unreachable` out
of `empty` fixed one half and left the other.

This is what a new writer sees in their first minute. The README's own
walkthrough is "add `examples/minimal-article` as a project. It typesets as it
opens", and for the six seconds that takes, the app says their document is
empty and offers to replace it.

### ~~R-045 · Compile · bug · medium · confirmed~~

**Fixed.** The event stream's first frame is `compile_state`, so a subscriber that
arrived after `compile_start` went out is told what is running. Held by
`tests/api/test_compile_state.py` and the browser spec above.

Found by: the same run. Where: `frontend/src/App.tsx:359` and `:419`, with
`server/session.py`'s event fan-out.

What happens: the status strip says **Ready** for the whole of the first
build, when it should say Compiling. `openProject` calls `connect(id)`, which
constructs an `EventSource`, and then calls `api.compile` a few lines later.
The constructor returns before the connection is established, so the compile
request regularly reaches the server before the browser is a subscriber, and
`compile_start` is published to nobody. There is no backlog, so it is simply
lost.

`compile_done` arrives, because by then the stream is up, which is why the
strip jumps straight from `Ready` to `Built 6.39s` with nothing in between.

So the first thing a writer does, opening a project, is the one case where the
strip cannot say what is happening. It is also the same family as R-001 seen
from the other side: there, an event that never comes leaves a flag up; here,
an event that arrives too early leaves it down.

### The files rail: tree, history, trash and git

### ~~R-011 · Files rail · bug · high · confirmed~~

**Fixed.** `act` returns whether this action worked, and the push is gated on
that rather than on the store's session-wide error slot.

Found by: reading. Where: `frontend/src/panes/GitPanel.tsx:235`.

What happens: **Commit and push** commits, then reads `if (get().error) return;`
and skips the push. The intent is plainly "the commit just failed, do not
push", but `error` is a single field on the whole store, written by about
thirty call sites: a refused upload, a rename collision, a failed version
restore, a trash entry that came back under another name. `act` at
`GitPanel.tsx:36` sets it on failure and clears it on nothing, so it is also
not cleared by the commit succeeding.

So: anything anywhere in the session has errored, the writer presses **Commit
and push**, the commit lands, the push is skipped, and nothing is said. The
button then reads `Push 1`, because the tree is clean and the branch is ahead,
and pressing it calls `act("push")` with no gate at all and works. The
symptom a writer would describe is that it needs two goes.

Expected: the push is skipped when this commit failed, which is what the
commit's own result says.

This also settles a `TRACKER.md` backlog item against itself. That item leaves
`dismissNotice`'s stale `state.error` alone on the reasoning that it "is
harmless because nothing in the app reads `s.error` directly". One thing does,
and this is it: `GitPanel.tsx:235` is the only direct read of `error` in the
interface, and the gate it guards is exactly what the stale value breaks.

### ~~R-012 · Files rail · bug · high · confirmed~~

**Fixed.** The viewing banner is keyed by the version, so its confirmation dies
with the version that raised it.

Found by: reading. Where: `frontend/src/panes/History.tsx:353` with
`frontend/src/App.tsx:1651`.

What happens: the banner over a version being viewed asks *Replace the file
with this?* and holds the answer in its own `confirming` flag. `<ViewingBanner>`
is rendered without a `key`, so React keeps the same instance when
`viewing.version` changes, and `confirming` survives. `onRestore` is
`restoreVersion`, which restores whatever `viewing` is **now**.

Reproduce: view version A, press *Restore this*, do not answer, click version B
in the history panel, press *Restore*. The file is replaced with B. The writer
confirmed a question about A.

Expected: a confirmation belongs to the thing it was asked about. A `key` on
the version's sha is the whole of the fix.

Severity: this is a destructive action taken on a target nobody confirmed. The
work is recoverable, because the replaced text is itself recorded as a
version first, which is the only reason this is not a blocker.

### ~~R-013 · Files rail · bug · high · confirmed~~

**Fixed.** `_destroy` returns the reason it failed, `purge` records nothing when it
did, and the route answers 500 rather than reporting success. Held by
`tests/test_trash.py`.

Found by: reading. Where: `nexttex/trash.py:392` and `:407`.

What happens: `_destroy` carries a docstring that says "deliberately not
`ignore_errors`: the ledger is about to record that this happened, and a purge
that quietly did nothing is how *delete for good* becomes a lie". The code
below it catches `OSError`, writes a line to the log, and returns. `purge`
then calls `_forget`, appends the tombstone and returns `True` whatever
happened, and the route answers `{"ok": true}`.

So the entry leaves the trash panel, the writer is told it is gone for good,
and the payload is still on disk under an id that nothing now lists, which
means it can never be found again through the interface either. `ignore_errors`
and this differ only by a log line nobody reads.

Expected: **Delete for good** either deletes or says it could not.

### ~~R-014 · Files rail · bug · medium · confirmed~~

**Fixed.** `empty` appends a tombstone per entry and compacts by re-reading the
ledger, so a delete that lands while the rmtrees run is not erased, and it returns
what it could not destroy.

Found by: reading. Where: `nexttex/trash.py:422`.

What happens: `empty()` reads the ledger, destroys every payload, and then
rewrites the ledger empty. `purge`'s own comment eight lines above says
compaction was taken out of it for exactly this reason: "it read the ledger
and wrote the whole thing back, so a delete landing between the read and the
rename was erased, its payload left on disk under an id nothing knew about."
`empty` still does it, and holds the window open far longer, because it
`rmtree`s a whole folder of figures between the read and the write.

Expected: the fix already applied to `purge`, applied here.

### ~~R-015 · Files rail · performance · medium · confirmed~~

**Fixed.** The trash purge, the empty and the history collect that follows each are
off the loop.

Found by: reading. Where: `server/main.py:1840` and `:1851`.

What happens: `purge_trash` and `empty_trash` call `session.trash.purge()`,
`session.trash.empty()` and `session.history.collect()` **synchronously in the
route**. Emptying the trash is an `rmtree` of every deleted payload and a
sweep of every unreferenced history blob, both real filesystem work on a
project with a year behind it.

`docs/architecture.md` opens with the rule this breaks: one process and one
event loop, so "anything synchronous in a request handler stops every other
browser, every autosave and every collaborator". Emptying a large trash
therefore freezes every open tab and every peer for as long as it takes, with
nothing on screen to say so.

### ~~R-016 · Files rail · accessibility · medium · confirmed~~

**Fixed.** The tab stop is chosen from the rows actually on screen, and the sections index is clamped and reset with the file.
Held by `frontend/src/tree.test.ts` and `e2e/specs/a11y.spec.ts`.

Found by: reading. Where: `frontend/src/panes/FileTree.tsx:114`, `:458`.

What happens: the tree is one tab stop, and which row carries it is
`(focusPath ?? activePath ?? first child) === node.path ? 0 : -1`. `focusPath`
is written in four places and cleared in none, so once it names a path that no
longer exists, deleted, or renamed, since `commitRename` refreshes the tree
without touching it, the expression matches no row and **the file tree has no
tab stop at all**. It cannot be reached with Tab again until the writer clicks
a row with the mouse, which is the one thing the person this affects cannot do.

`frontend/src/panes/SectionsPanel.tsx:45` has the same shape with an index
into `headings` that is not reset when the open file changes, so a heading
number from a long chapter leaves a three-heading file with no tab stop.

### ~~R-017 · Files rail · bug · medium · confirmed~~

**Fixed.** A Back up control in the git panel's header is the way back in after Not
now.

Found by: reading. Where: `frontend/src/panes/GitPanel.tsx:21`, `:71`.

What happens: **Not now** on the *Back this up to GitHub* card sets
`dismissed` and writes `nexttex.backup.dismissed.<project>` to localStorage.
Nothing anywhere removes that key, and at `:53` the card is the only thing
that renders for a project with no repository, so once it is dismissed the
setup wizard has no entry point left in the app. A writer who says *not now*
has said *never*, per project, with no way back.

`docs/design.md` section 5 describes this card as "dismissible, and once
dismissed or configured it never returns", so the interface is doing what was
asked. The finding is that what was asked has no *later*, which is the same
shape as the update card that `0ec4c0d` fixed a week ago by adding one.

### ~~R-018 · Files rail · bug · medium · confirmed~~

**Fixed.** Each of the three panels has a failed state, drawn, rather than storing a
failure as an empty list.

Found by: reading. Where: `frontend/src/store.ts:1151`, `:1158`, `:1165`.

What happens: `refreshHistory`, `refreshTrash` and `refreshGit` each turn a
failed request into an empty value. The three panels then make confident
false statements. The history panel prints "Nothing yet for chapter.tex.
Versions are kept from the moment you first change it", about a file with
four hundred versions. The trash panel and the git section disappear from the
rail entirely.

Expected: a panel that could not ask says it could not ask. "There is nothing
here" and "I could not find out" are different answers, and this is the same
argument `nexttex/compile.py`'s `_read_log` makes for the opposite case.

### ~~R-019 · Files rail · bug · medium · confirmed~~

**Fixed.** Both awaits are caught and set the error. The record's second half was
wrong: the label route already answers 404 for an unknown sha, so both cases were
one missing try.

Found by: reading. Where: `frontend/src/panes/FileTree.tsx:671` and
`frontend/src/panes/History.tsx:312`.

What happens: two awaited calls with no `try`, in a file where every other
call has one. Clearing a file's history closes the menu, awaits
`api.purgeHistory`, and on failure the promise rejects unhandled: the
confirmation line never appears, no notice is raised, and the writer sees an
action that did nothing and said nothing. Naming a version is the same shape,
and has a second way to fail quietly: `set_label` in `nexttex/history.py`
returns `False` when the sha is not in that file's log, and the route's answer
is not read either way, so the row refreshes without the name that was typed.

### ~~R-020 · Files rail · bug · medium · confirmed~~

**Fixed.** The ssh agent's socket is passed through when there is one, and `LC_ALL`
is stated rather than being an accident of the empty environment. Held by
`tests/test_gitrepo.py`, which did not exist.

Found by: reading. Where: `nexttex/gitrepo.py:38`.

What happens: `_run` builds git's environment from scratch, keeping only
`GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`, `PATH` and `HOME`. `SSH_AUTH_SOCK` is
not among them, so a push to an `ssh://` or `git@` remote cannot use a key
held by an agent or protected by a passphrase. It works only for a bare,
unencrypted key file in `~/.ssh`. The same push from the writer's own terminal
works, which makes this look like NextTex being broken rather than like a
missing variable.

The fixed environment is right about the rest, and usefully forces the C
locale, which is what keeps the English substring matches at `:124` honest.

### ~~R-021 · Files rail · bug · medium · confirmed~~

**Fixed.** A repository the writer made themselves gets the ignores, appended to
their own `.gitignore` rather than replacing it.

Found by: reading. Where: `nexttex/gitrepo.py:145`.

What happens: `initialise` returns early when `.git` already exists, before
writing the `.gitignore`, and `commit` runs `git add -A`. A writer who points
NextTex at a repository they already had therefore commits `build/` on every
commit: every `.pdf`, `.aux`, `.log` and `.synctex.gz`. `.nexttex/` is safe,
because `nexttex/project.py` drops a `*` ignore file inside it, and `build/`
has no such protection.

### ~~R-022 · Files rail · bug · low · confirmed~~

**Fixed.** `status` asks for `-z`, so a rename reports the name it has now and a
non-ASCII path comes back as itself.

Found by: reading. Where: `nexttex/gitrepo.py:105`.

What happens: the changed-files list is parsed from `git status --porcelain=v1`
as `line[3:]`, with no `-z` and no `-c core.quotePath=false`. A rename arrives
as `old -> new` and any non-ASCII filename arrives C-quoted with escapes. Each
becomes a clickable row in `GitPanel.tsx:207` that calls `onOpen(change.path)`,
so clicking a renamed file, or any file with an accent in its name, opens
nothing.

### ~~R-023 · Files rail · bug · low · confirmed~~

**Fixed.** The folder name's error clears as it is retyped.

Found by: reading. Where: `frontend/src/panes/FolderChooser.tsx:125`.

What happens: the new-folder input sets `problem` in its catch and clears it
only on Escape or on success. There is no `onChange`, so the red underline and
*There is already a figures folder here* stay on screen while the writer types
a different name, and reopening the chooser shows the input still carrying the
old failure. `NewName` in `FileTree.tsx:1274` clears on every keystroke, which
is the behaviour this one should have.

### ~~R-024 · Files rail · bug · low · confirmed~~

**Fixed.** Changing project resets the whole panel, not only the dismissal.

Found by: reading. Where: `frontend/src/panes/GitPanel.tsx:18`.

What happens: `message`, `url`, `token`, `wizard` and `open` are reset by
nothing when the project changes; only `dismissed` re-reads. A half-written
commit message follows the writer into the next project, and so does a pasted
personal access token, which sits in a password field belonging to a project
it was not issued for.

### The editor

### ~~R-029 · Editor · bug · blocker · confirmed~~

**Fixed.** `yUndoManagerKeymap` is bound beside `yCollab`, and CodeMirror's
`history()` has come out of the extensions a live editor shares with the
read-only panes. Held by `frontend/src/panes/editor-undo.test.ts` and
`e2e/specs/undo.spec.ts`, both of which fail without it.

Found by: reading, then reproduced in a real browser twice. Where:
`frontend/src/panes/editor-setup.ts:390` and `:408`, with
`frontend/src/collab.ts:406` and `frontend/src/panes/Editor.tsx:506`.

**What happens: Ctrl+Z empties the file, on disk, for everyone.**

```
ON DISK BEFORE:                3563 characters
IN EDITOR AFTER SIX UNDOS:        1 character
ON DISK AFTER:                    0 characters
```

And past the writer's own typing:

```
ON DISK AFTER TYPING:          3581 characters
ON DISK AFTER TWELVE UNDOS:       0 characters
STILL HAS documentclass:       false
```

Both runs opened a freshly seeded project, waited for the document to appear,
clicked in the editor and pressed Ctrl+Z. Nothing else. No collaborator, no
agent, no version being viewed.

Reproduce: open any project, click in the editor, press Ctrl+Z six times.

The chain, each link checked against the installed source:

1. `yCollab` does not install `yUndoManagerKeymap`. Its own
   `node_modules/y-codemirror.next/src/index.js` exports that keymap
   separately and installs only a `beforeinput` handler for the browser's
   `historyUndo` input type. Nothing in `frontend/src` imports it.
2. `editor-setup.ts` installs CodeMirror's own `history()` and
   `historyKeymap`, so Mod-z is handled by CodeMirror. The carefully scoped
   `Y.UndoManager` built at `collab.ts:422`, whose comment says undo must
   never walk back through a collaborator's typing, is unreachable from the
   keyboard.
3. `collab.ts:414` returns the document without awaiting its first sync, so
   `opened.text.toString()` at `Editor.tsx:506` is the empty string and the
   buffer is created empty.
4. The whole file then arrives as one remote transaction, dispatched by
   `y-sync.js:121` carrying `ySyncAnnotation` and **not**
   `addToHistory.of(false)`. CodeMirror's history records it as one undoable
   event: *insert the entire document*.
5. Undoing it is a local transaction, so the sync plugin pushes the deletion
   into the `Y.Text`, the server writes the empty file to disk, and every
   collaborator's copy follows.

Severity: this is the only finding in this review that loses work. It is not
permanent, because the text that was replaced is recorded as a version first
and can be restored from the history panel, and that is the only reason it is
not worse. But it is silent, it happens on the most reflexive keystroke in any
editor, and the writer has no reason to connect an empty document with a key
they press a hundred times a day.

It also makes the app's own promise untrue. The README says "Nothing is ever
unsaved. A keystroke goes into the document as it is made and the file follows
a moment later, so there is no save to lose". The same mechanism that removes
the save removes the protection that an unsaved buffer used to give.

Nothing in any tier presses Ctrl+Z. `e2e/specs/` has no undo spec, and the
agent's own undo, which is a different mechanism entirely, is the only undo
the suite exercises.

### ~~R-067 · Editor · bug · high · likely~~

**Fixed.** `viewVersion` goes back to now before parking, so a second version cannot
park the read-only state of the first. Held by `e2e/specs/history-trash.spec.ts`.

Found by: reading. Where: `frontend/src/App.tsx:579` with
`frontend/src/panes/Editor.tsx:526`.

What happens: clicking a second version in the history panel, without going
back to now first, destroys the live buffer and leaves a tab that looks live
and is not. `App.tsx` calls `editor.current.view(path, sha)` without
`backToNow()`. Inside `viewVersion`, `current.current` is null while a version
is parked, so the branch that would reopen the buffer is skipped and
`buffer.state = editor.state` overwrites the parked live state, its
collaborative binding, its undo history and its caret, with the read-only
historical one.

`backToNow` then restores that as "now": the tab shows the previous version's
text with the banner gone, `EditorState.readOnly` still in force, and typing
reaching nothing.

Clicking two versions in a row is the ordinary use of a history panel.

### ~~R-068 · Editor · bug · high · likely~~

**Amended and fixed in pass 5.** `ec74aaa`. Half the record does not happen; the other half reproduces exactly as written. The heading went unstruck when the rest of that pass was marked, and the correction below was written at the time.
Held by `e2e/specs/spelling.spec.ts`.

Found by: reading. Where: `frontend/src/panes/editor-setup.ts:419` with
`frontend/src/panes/Editor.tsx:724`.

What happens: spell checking never comes back once turned off. Every fresh
state gets `spellCompartment.of([])`, and the effect that would reconfigure it
takes an early branch when the module is already loaded, dispatching an effect
into a state that has no field to receive it. So turning the setting off and
on again does not restore the underlines on any tab for the rest of the
session.

**Half of this record was wrong and is corrected here.** It also said a second
tab is never checked. A browser test that opens a second file with spelling
already on finds it checked, on the commit before the fix and after it, so
that half does not happen: something else re-runs the effect when a tab opens.
The off-and-on half reproduces exactly as written, and
`e2e/specs/spelling.spec.ts` fails on it without the fix.

**Fixed.** The question is asked of the state, `spellCompartment.get(state)`,
rather than of a module-level ref.

### ~~R-069 · Editor · bug · medium · likely~~ partly

**Two of three fixed.** The selection verb row and the spelling menu are cleared
when the editor swaps to another file, held by `e2e/specs/navigation.spec.ts`.
The caret readout is **not** fixed and is in the `TRACKER.md` backlog with its
reason: writing the caret from the parked state stopped later keystrokes reaching
the readout at all, which is worse than the bug and which I could not account for.

Found by: reading. Where: `frontend/src/panes/Editor.tsx:518`, and four
consequences of one fact.

`EditorView.setState` does not build a `ViewUpdate` and does not run update
listeners, so swapping documents never fires the editor's own listener. Four
things therefore carry over from the file the writer just left:

- the status strip's `Ln, Col`, which is written only from that listener, so
  it shows the previous file's position until the caret moves. Cmd-Enter in
  that window sends the new file's path with the old file's line to forward
  search, and the preview reveals the wrong place.
- the selection verb row, cleared only inside the cursor handler, so it floats
  over the new document still reading "Lines 12 to 40", and pressing Reword
  seeds a prompt for a selection that was cleared.
- a jump flash left in a parked buffer, because the two teardown timers
  dispatch to whatever document is on screen when they fire, and the
  highlight is a static background rather than an animation that ends. The
  three-second hold on the agent's announcement makes this the ordinary case
  rather than a race.
- the spelling menu, cleared only by accepting a word or pressing the
  backdrop, so it can be left offering to add a word to the dictionary over an
  unrelated file.

### ~~R-070 · Editor · accessibility · medium · confirmed~~

**Fixed.** Shift-F10 and Mod-. open the menu on the word the caret is in, focus enters it, the arrows and Home and End walk it, Escape closes it and gives the caret back.
Held by `e2e/specs/spelling.spec.ts`.

Found by: reading, and counted. Where: `frontend/src/panes/Editor.tsx:830`.

What happens: the spelling menu claims `role="menu"` and a keyboard user meets
nothing at all. Focus never enters it, so an arrow key moves the caret in the
document behind the veil while the menu stays open over a page that is now
scrolling underneath it. Escape does nothing, because the dismissal is a
pointer-only backdrop. And it cannot be opened from the keyboard in the first
place: Shift-F10 fires `contextmenu` on the content rather than on the word,
so the test for a misspelled word fails. A screen reader is told "menu, one
item" about something only a mouse can reach and only a mouse can close.

`TRACKER.md` records five menus claiming the role. A literal grep finds four:
`Editor.tsx:836`, `PreviewTabs.tsx:146`, `chrome.tsx:103` and `Chat.tsx:974`,
with `Chat.tsx` carrying one rather than two, so the tracker's count is one
high and its entry is worth correcting along with the code.

### ~~R-071 · Editor · bug · medium · likely~~

**Fixed.** A failed load of the maths renderer clears the cached promise, the way
`spellcheck.ts` already did.

Found by: reading. Where: `frontend/src/panes/math-hover.ts:17` and
`frontend/src/panes/Editor.tsx:643`.

Two caches that never recover.

The maths renderer's loading promise is assigned once and not reset on
rejection, so a single hover made while offline leaves a rejected promise
cached and every later hover says "Could not load the maths renderer" with no
retry. `spellcheck.ts:66` resets its equivalent on catch, which is the
intended pattern in the same directory.

`symbols.current` is never cleared when the project changes, and its fetch
swallows failure. Between projects, and permanently if the new fetch fails,
completion offers the previous project's citation keys, labels and figure
paths, and maths hovers render with the previous project's macros.

### ~~R-072 · Editor · bug · medium · likely~~

**Fixed.** Releasing a file re-reads the connection, and leaving a project calls
`closeCollab`, which was exported and called from nowhere.

Found by: reading. Where: `frontend/src/collab.ts:452`, `:502`, `:341`.

Three in the collaboration client, each small and each visible.

Releasing the file whose socket dropped never calls `noteConnection`, so if the
project was offline only because of that file, closing the tab leaves the app
reporting offline for ever.

`closeCollab` is exported and called by nothing, so leaving a project without
opening a file, or signing out, leaves this browser in the old project's
collaborator strip until the next project's first file is opened.

A collaborator who stops typing stays marked as writing, because the
forty-five second decay is computed only inside `collaborators()`, which runs
only on a presence or manifest event, and nothing ticks.

### Sign-in and the front door

### ~~R-025 · Sign-in · accessibility · medium · confirmed~~

**Fixed.** The sign-in page opens `<html lang=en>` and closes it.
Held by `tests/test_palette_matches_the_stylesheet.py`.

Found by: axe, on the real screen, in both themes. Where: `server/main.py:753`.

What happens: the sign-in page is server-rendered, because it has to draw
before the bundle is authorised, and it is written as a string starting
`<!doctype html><meta charset=utf-8>`. There is no `<html>` element, so the
browser synthesises one with **no `lang` attribute**. A screen reader
announces the front door in whatever language the reader's machine defaults
to. `frontend/index.html` carries `lang="en"` and the app proper is fine; it
is the one page a new writer meets first that is not.

```
AXE  sign-in light: html-has-lang (serious) <html> element must have a lang attribute
AXE  sign-in dark:  html-has-lang (serious) <html> element must have a lang attribute
```

### ~~R-026 · Sign-in · accessibility · medium · confirmed~~

**Fixed.** The page carries `--ink-2` and the recovery command uses it, since `.nx-on-surround` cannot reach a page that cannot import the stylesheet.
Held by `tests/test_palette_matches_the_stylesheet.py`, which also asserts every colour it copies against `styles.css`.

Found by: axe, on the real screen. Where: `server/main.py:788`, the `pre` and
`code` rules.

What happens: the recovery command is `--ink-3` on `--surround` at 12px, which
measures **4.16:1** against the 4.5 that small text needs.

```
AXE  sign-in light: color-contrast (serious)
       pre > code
       insufficient color contrast of 4.16 (foreground #4e534d, background
       #b9beb8, font size 9.0pt (12px), font weight: normal)
```

This is the same pairing, to the second decimal place, that `docs/testing.md`
already records being found on the projects screen: "`--ink-3` measures
**4.17:1** there, under the 4.5 that small text needs." That one was fixed by
preventing the pairing rather than certifying it, with `.nx-on-surround`
stepping the dimmest ink up to `--ink-2`.

The fix could not reach here, and the reason is in this function's own
docstring: "the palette, the scale and the radii here are the app's, written
out rather than imported... It is a copy, kept small on purpose." So is the
bug. `frontend/src/contrast.test.ts` parses `styles.css` and this page's
stylesheet is a Python string, so neither the test nor the fix has ever seen
it.

The text this affects is the one line on the page that matters most: the
command that gets a locked-out writer back in.

### ~~R-027 · Sign-in · docs · medium · confirmed~~

**Fixed.** The guard reads three spellings now, not one, which is what let two of them past it. The sign-in page's `&mdash;` went with the sign-in work in pass 10; the status strip's escape is an en dash, matching the file name's fallback a few rows above it.
Held by `tests/test_cross_platform.py`. The section list's rendering of the writer's own `---` is exempt with its reason, since that is their punctuation and not the app's.


Found by: reading, after axe sent me to the file. Where: `server/main.py:748`.

What happens: the sign-in page's own prose contains an em dash, written
`&mdash;`, in the sentence a writer with no password reads: "the only way in
is the address the server printed &mdash; the one ending `?token=...`".

The repository bans the em dash without exception, and `7d56ed0` removed about
three hundred of them. `tests/test_cross_platform.py:441` guards the rule and
looks at this very file. It cannot see this one, because it tests for the
character and this is an HTML entity.

`frontend/src/panes/Status.tsx:180` evades the same guard the other way, with
a dash written as an escape as the placeholder for an unknown word count. That one is a
judgement rather than a slip, since a dash standing for *no value* in a
tabular field is not punctuation between clauses, but it is the app's own text
and the rule as stated has no exceptions, so it belongs in front of the
writer rather than in a reviewer's head.

`frontend/src/outline.ts:77` is a third hit and is not a finding: it turns the
writer's own `---` into an em dash for display in the section list, which is
their text and their punctuation.

### The agent

### ~~R-046 · Agent · security · high · confirmed~~

**Fixed.** The middle position holds back a figure script now: the exclusion set names `script` beside the other three.
Held by `tests/test_permissions.py`.

Found by: reading, checked against three documents and the writer-facing copy.
Where: `nexttex/agent.py:749` and `:1159`.

What happens: the tool that runs a figure script is silently approved at the
middle permission position. `_holds_back` returns a fifth answer, `"script"`,
for `run_plot_script`, and `_by_mode`'s test is `held not in {"outside",
"control", "network"}`, which `"script"` is not in. So it is auto-approved.

That is a tool that runs arbitrary Python the model wrote. `docs/design.md`
section 28 describes the middle position to the writer as: "Two things still
ask: a write that leaves the writing... and anything that reaches the
internet." The control's own note in the interface says the same, at
`frontend/src/panes/Chat.tsx:1226`: "Still asked about: writing outside this
project, and anything reaching the internet." A Python script can do both.

The card this tool would have shown says so itself: its consequence text at
`nexttex/agent.py:833` names the network among the things the script can
reach.

`docs/architecture.md` is the one document that agrees with the code, saying
the figure tool is "asked at the first permission position with the script as
the card's literal text, silent at the other two", and it was written in the
same commit as the code. So this is a disagreement between documents rather
than a clear slip, and which one is wrong is the author's call.

One piece of evidence says the code is the side that moved. `_reason`'s
`"script"` branch at `:903` is unreachable, because `_reason` speaks only when
`mode == "project"`, which is the one position where this tool never puts up a
card. A sentence written for a card that cannot appear is what a set that was
meant to grow and did not looks like. `_holds_back`'s own docstring still says
there are four answers.

### ~~R-047 · Agent · security · medium · confirmed~~

**Fixed.** The three own-tools that reach the network ask wherever a network tool asks, each with a card of its own.
Held by `tests/test_permissions.py`.

Found by: reading. Where: `nexttex/agent.py:1057` with `:157`.

What happens: `_decide` waves every tool whose name starts `mcp__nexttex__`
straight through, at all three permission positions, except the two script
tools. Three of those reach the internet:

- `find_papers` sends a query to Crossref, OpenAlex or Semantic Scholar
  (`:1639`, into `nexttex/references.py:42`), and the query is composed by the
  model from the project's own files.
- `add_reference` fetches the publisher's record for a DOI.
- `check_references` re-fetches every entry in the bibliography.

`NETWORK_TOOLS` contains `WebFetch` and `WebSearch` and nothing else. The
first permission position promises "A card for every command, every fetch and
every write that leaves this project", and these are fetches that leave the
machine with text from the writer's project in them.

The comment above the allow-list says these tools can "ask a public catalogue
about a DOI", which is true of `add_reference` and not of `find_papers`. The
same file already made this exact argument in the other direction: `WebFetch`
was moved out of the always-allowed set because of what travels with it.

### ~~R-048 · Agent · bug · high · confirmed~~

**Fixed.** `reconcile` raises the thinking state when the server says a turn is running, so a reload mid-turn gets its Stop button back.
Held by `frontend/src/agent-state.test.ts` and `e2e/specs/reload.spec.ts`.

Found by: reading. Where: `frontend/src/store.ts:728` with
`frontend/src/panes/Chat.tsx:208`.

What happens: a browser that reloads while a turn is running gets a panel that
cannot say a turn is running. The comment at `Chat.tsx:208` states the design:
a browser reconnecting mid-turn "finds out from `reconcile`". `reconcile`
raises `thinking` only when the server reports an **open permission card**;
with a turn running and no card it reaches `if (report.busy || !state.thinking)
return;` and returns having changed nothing, because `busy` is true.

So the writer reloads during a long answer and sees text arriving into a panel
with no working dot, no activity line, no elapsed count and no Stop button.
Pressing Send is refused by the server with a 409, which is the guard doing
its job and is the only thing that tells them a turn is in flight.

`thinking` has two ways up, `turn_start` and `reconcile`-with-a-card, and the
reload case is a third that nothing covers.

### ~~R-049 · Agent · bug · high · confirmed~~

**Fixed.** A card that times out says so, and the panel draws "Not answered" rather than "Denied".
Held by `tests/test_transcript.py`.

Found by: reading. Where: `nexttex/agent.py:1247` with
`frontend/src/panes/Chat.tsx:1682` and `server/main.py:3436`.

Two halves of one problem, at the two ends of a card that timed out.

**The card is never taken off the screen.** When the wait expires the agent
emits a notice, returns `deny`, and drops its own copy. Nothing tells the
browser, so the card keeps its four buttons, `awaitingPermission` stays true,
and the header's warn dot and the floating pill go on saying the agent is
waiting for you until the turn ends.

**Answering it is recorded as an approval that never happened.** The browser
resolves the card optimistically and never reads the `{"resolved": false}`
the route returns for a card the server has forgotten. `note_decision` is
skipped, so nothing is written. The row reads **Allowed** for the rest of the
session, and a reload replays it as **Denied**, because the replay marks an
unanswered card denied.

`docs/design.md` section 28 records an inversion of exactly this kind as the
worst thing that run found. This is the same inversion reached from the other
end.

### ~~R-050 · Agent · bug · medium · confirmed~~

**Fixed.** Changing your mind back to the model already in use clears both flags.
Held by `tests/test_agent_model.py`.

Found by: reading. Where: `nexttex/agent.py:2606` and `:2628`.

What happens: changing the model mid-turn is deferred, and changing your mind
back leaves the project on Default. `set_model` returns early when the new
model equals the current one and clears `_model_pending` but not
`_model_deferred`, which the previous call raised. `_apply_deferred_model` then
runs at the end of the turn with `_model_pending` at `None` and sets the model
to `None`.

Reproduce: while an answer is streaming, pick Haiku, then change back to Opus
before it finishes. When the turn ends the model chip reads Default and the
client is torn down.

Mechanism: one flag, two writers and one clearer, which is the family this
review keeps finding.

### ~~R-051 · Agent · bug · medium · confirmed~~

**Fixed.** A silent approval carries no reason, because there was no card to have a reason for.
Held by `tests/test_permissions.py`.

Found by: reading. Where: `nexttex/agent.py:870` with `:1184`.

What happens: an action nobody was asked about is written into the audit trail
with a sentence saying it was asked about. `_settled` records a silent
approval with the full `describe()` payload, and `describe` includes `reason`,
and `_reason` returns "Asked at this setting: ..." for every call whenever the
position is the middle one. At that position every compound shell command is
auto-approved, so each is recorded with `decision: "auto"` **and** a reason
explaining why the writer was asked.

The resolved row in the panel does not draw `reason`, so this lives only in
`.nexttex/transcript.jsonl`. That file is the one `docs/design.md` section 28
asks somebody to read by hand as the whole case for trusting the quiet
positions, and it is the file that is wrong.

### ~~R-052 · Agent · bug · medium · confirmed~~

**Fixed.** A fold that fails is logged and says so in the panel, naming the file to reload.
Held by `tests/test_agent_robustness.py`.

Found by: reading. Where: `nexttex/agent.py:1364`.

What happens: the call that folds an agent edit into the shared document is
wrapped in `except Exception: pass`. The fold's own failure is logged, with a
comment at `server/session.py:812` saying why silence there is unacceptable,
but anything raised *before* the fold, recording the version on a full disk
for instance, is caught by this outer handler and written nowhere.

The writer then sees the agent report an edit their editor does not show,
which that same comment calls indistinguishable from a turn that did nothing.

### ~~R-053 · Agent · bug · medium · confirmed~~

**Fixed.** The composer's bubble is marked pending and the turn's own event adopts it, so the question appears once in every window.
Held by `frontend/src/store.test.ts` and `e2e/specs/two-tabs.spec.ts`.

Found by: reading. Where: `frontend/src/store.ts:917` and
`frontend/src/panes/Chat.tsx:386`.

What happens: the writer's own question is pushed into the panel by the tab
that sent it, and `turn_start` draws nothing. The transcript does record it, so
a reload is right. A **second tab** open on the same project never sees the
question at all, and its panel reads as the agent answering nobody.

The same line has a second ending. A question that failed to send leaves its
bubble on screen while the draft is restored to the box, so the writer sees it
twice, and a reload makes it vanish, because the server never had it.

### ~~R-054 · Agent · bug · medium · confirmed~~

**Fixed.** A finished turn writes `turn_end`, so an interrupted transcript can be told from a complete one.
Held by `tests/test_transcript.py` and `frontend/src/store.test.ts`.

Found by: reading. Where: `server/transcript.py:164` with
`frontend/src/store.ts:445`.

What happens: nothing records that a turn ended, so the replay has to guess
from the last item's kind, and only `user`, `tool` and `edit` count as
interrupted. A turn that died after its prose, which is the ordinary shape of
a turn killed by a restart, replays as a completed answer with no notice at
all. Live, it was a turn still in flight.

### ~~R-055 · Agent · bug · medium · confirmed~~

**Fixed.** Both remaining agents emit `done` exactly once however the turn ended, and all four answer `pending_cards`.
Held by `tests/test_agent_parity.py`.

Found by: reading. Where: `tests/test_agent_parity.py:13` with
`nexttex/openai_agent.py:413` and `nexttex/scripted_agent.py:200`.

What happens: the parity test's own docstring names the promise it exists for,
"above all that a question always produces a `done`", and the file asserts it
in one place only, for `interrupt` with nothing running. `ProjectAgent` keeps
the promise with a `finally`. `OpenAIAgent._run` and `ScriptedAgent._run` have
none: they emit `done` on the fall-through, after two save calls that catch
only `OSError`, and re-raise `CancelledError` above it. Both cover Stop,
because their `interrupt` emits `done` itself, so the gap is a cancellation
from anywhere else.

`pending_cards` is the second half. It exists only on `ProjectAgent`;
`server/main.py:3504` reads it through `getattr` with a default, so the route
never breaks and always answers `[]` for the other two. `ScriptedAgent` does
put cards up, so the browser tier cannot exercise the reload-restores-the-card
path at all. Neither `CONTRACT` nor `ATTRIBUTES` lists it, and the parity
test's own preamble describes this failure mode in the abstract.

### ~~R-056 · Agent · bug · low · likely~~

**Fixed.** The SDK is started with `strict_mcp_config`, so a project's own `.mcp.json` cannot add tool servers.
Held by `tests/test_agent_prompt.py`.

Found by: reading. Where: `nexttex/agent.py:2116`.

What happens: `strict_mcp_config` is not set and defaults to false, so the CLI
loads MCP servers declared by the project alongside NextTex's own. A project
folder arrives from a clone, a template or a co-author, which is this
repository's stated threat model, and `.mcp.json` travels in it. A tool from
such a server asks at the first position like anything else, which is fine. A
server named literally `nexttex` would produce tool names beginning
`mcp__nexttex__` and meet the wave-past at `:1057` at every position, with no
card and no record.

Marked likely rather than confirmed because how a name collision with the
in-process server resolves could not be established from the SDK source.
`setting_sources=["project"]` at `:2130` raises the neighbouring question of
whether a project's `.claude/settings.json` can shadow the hook, which
`docs/architecture.md` records was settled for `allowed_tools` by testing
rather than by reading. It has not been settled for this.

### ~~R-073 · Agent · bug · medium · confirmed~~

**Fixed.** With R-049: `expired` is a third decision in the record, beside allowed and refused.
Held by `tests/test_transcript.py`.

Found by: a real turn against a real account, then reading the transcript on
disk. Where: `server/transcript.py:155` with `nexttex/agent.py:1247`.

What happens: a permission card nobody answered is written into the audit
trail with **no `decision` field at all**, and the panel draws that as
*Denied*.

The two records a live turn left behind, with everything they carry:

```json
{"kind": "permission", "tool": "Bash", "rule": "Bash:find",
 "headline": "Run a shell command", "detail": "find ... -name \"*.tex\"",
 "consequence": "List LaTeX files in project", "reason": "", "at": ...}
```

There is no `decision`. `_settled` writes one for every action approved
silently, and `note_decision` writes one when a person answers. Nothing writes
one when the card expires, so the file cannot say whether the writer refused
this or never saw it.

`docs/architecture.md` describes this file as "the record of what was done to
the document: every edit with its diff, every reverted edit, every command
allowed or refused". A command that was neither allowed nor refused is the
case it has no word for, and it is recorded as refused.

Taken with R-049, the audit trail has the same gap from both directions: a
card answered after the server gave up is recorded as allowed and replays as
denied, and a card nobody answered is recorded as nothing and replays as
denied. The one thing it cannot say is that nobody answered.

### ~~R-074 · Agent · bug · low · confirmed~~

**Fixed.** The row says "Rewrote lines" and names them, rather than claiming the writer selected anything.
Held by `frontend/src/panes/tool-verb.test.ts`.

Found by: a real turn against a real account, watching the panel. Where:
`frontend/src/panes/Chat.tsx:1190`.

What happens: the panel labels every `replace_range` call **"Rewrote what you
selected"**, and the model reaches for that tool whether or not anything was
selected. In the live turn recorded below, nothing was selected at any point,
and the panel said so anyway.

The tool's own description tells the model to "use this when the user has
selected something and asked you to change, reword or expand it", which is
guidance rather than a constraint: the tool takes a line range, and replacing
lines 33 to 33 is exactly what it is for. So the model is not misusing it; the
label is asserting something the panel cannot know.

This is the same class as the welcome message `2cf7861` corrected, where the
panel made a promise in the agent's own voice that was true on one path and
false on the others. A writer reading their own account of what was done to
their document is told they did something they did not do.

### What worked, recorded because a review that lists only faults is not a
### picture of the app

A clean live turn against a real account on Sonnet, on a project with a real
paper in it:

```
CARD:       Run a shell command | grep -n "Discussion" -i main.tex | head -20
            | Find Discussion section in main.tex
            | Remembers: Bash!grep -n "Discussion" -i main.tex | head -20
            | Allow A | For this conversation C | Allow always ⇧A | Deny D
TURN TOOK:  19.5 s
EDIT CHIPS: 1, and still 1 after a reload
LENGTHS:    569 live vs 560 replayed
```

Everything the panel is for worked. The card named the command, said what it
was for in a sentence, showed the rule it would remember and offered four
answers. The edit landed, the chip carried `+1 −1` with Show and Undo, the
page rebuilt in 0.92 seconds and the new sentence is on it, and the section
list picked up the change. The replayed panel matched the live one to within
the composer's own hint text.

The first response arrived 87 milliseconds after the question in an earlier
run, which is the streaming path doing its job.

So the agent's core loop is in good order, and the findings above are about
its edges: what happens when a card is not answered, when the tab reloads
mid-turn, and what the record says afterwards.

**The numbers a writer actually feels are good.** The benchmark measures the
server. These were measured in a real browser, and none of them is a finding:

| | |
|---|---|
| The editor's input path, in a 71 kB chapter | median 3.9 ms, p90 4.7 ms, worst 13.1 ms |
| A file's text on screen, from opening a project | 321 ms, editor mounted at 189 ms |
| The same on a forty-file thesis | 288 ms, editor mounted at 156 ms |
| Touch tier, tablet at 1180 by 820 | 3 passed |

The keystroke number is the one worth keeping, and it is worth saying exactly
what it measures. It is `keydown` to the first mutation of the editor's own
DOM, measured inside the page, in a chapter long enough that CodeMirror is
virtualising it and with the project's default settings. That is the editor's
synchronous input path. It does not include paint, and it does not include the
spelling and colouring passes, which run after the input transaction and so
land outside the observer's window. Four milliseconds for the path a keystroke
takes before anything else happens is a quarter of a frame, and there is room
above it.

The other number, that a forty-file thesis opens faster than a four-file
project does, is what the symbol cache exists for.

The driver is `e2e/review/a12-typing.spec.ts`. The fix plan should watch that
number rather than trust it, because several of the comfort items add a
decoration to the editor and every one of those is a charge against this path.
Anything that wants to measure what a writer feels, rather than what the input
path costs, has to measure paint as well, and that is a different driver.

### The server

### ~~R-030 · Server · security · medium · confirmed~~

**Fixed.** `Sec-Fetch-Site` is read for every method, before the safe-method
exemption. A request with no such header is still allowed, because that is curl, the
installer and the printed link, and a page cannot forge an absence. The test whose
docstring claimed a GET cannot be made unsafe is rewritten with what is actually
true.

Found by: reading, then probed against a running server. Where:
`server/main.py:508`.

What happens: `_same_origin_request` returns `True` for every GET, HEAD and
OPTIONS before it looks at anything. The session cookie is `samesite="lax"`
and the comment twenty lines above it already records why that is not enough:
"`SameSite=Lax` does not separate ports: a page on `http://127.0.0.1:5173` is
same-site with NextTex and its cookie travels."

Probed:

```
GET  with Origin: http://127.0.0.1:5173, Sec-Fetch-Site: same-site  ->  200
POST with the same two headers                                      ->  403
```

So a page served on any other port of this machine can make authenticated GET
requests. It cannot read the answers, since no CORS middleware is installed
and the browser will not expose a cross-origin body to script. What it can do
is cause the work:

- `GET /api/projects/{id}/download` runs a full build, up to the 120 second
  timeout, and works whether or not the project is open.
- `GET /api/browse?path=/&count=true` walks an arbitrary directory tree.
- every route calls `session_for`, which opens a project, starts its agent
  pump and **reconnects its peer network**, so a shared project that was
  closed goes back on the network.

The reasoning the code gives for the exemption is that a browser "always sends
`Origin` on a request that changes something", which is true and beside the
point: these GETs change something.

Expected: the same `Sec-Fetch-Site` test on safe methods as on unsafe ones.
`same-origin` and `none` would still pass, so the app's own fetches, curl, the
installer and the test client are all unaffected, and only the neighbouring
port is refused.

### ~~R-031 · Server · performance · high · confirmed~~

**Fixed.** The write path has the same ceiling the read has, and the atomic write,
the version and the edit note are off the loop. `_ingest` stays, because it folds
into a pycrdt document. Held by `tests/api/test_off_the_loop.py`.

Found by: reading, then measured against a running server on the
thesis-shaped bench project.

What happens: `write_file` at `server/main.py:1621` takes `text: str` with no
size cap and then, **on the event loop**, writes it atomically with two
`fsync` calls, sha256s and zlib-compresses the whole of it to record a
version, folds it into the CRDT document, and regex-scans it three times in
`note_edit`. The request body limit is 512 MB and the upload limit is 256 MB
per file, so a large text file is an ordinary thing to hand it.

Measured. An unrelated trivial route, `GET /api/instance`, against an idle
server and then against one handling a single 40 MB write:

| | time |
|---|---|
| trivial route, idle | 9 ms |
| the 40 MB write itself | 1.91 s |
| trivial route, during that write | **1.61 s** |

`docs/architecture.md` opens by saying that in one process and one event loop
"anything synchronous in a request handler stops every other browser, every
autosave and every collaborator". This is that, measured: for a second and a
half nobody else's keystroke reaches disk, no collaborator's edit is applied,
and no build result is published.

The same shape, unmeasured but read, sits in four more places:
`duplicate` at `:1773` flushes every dirty document and then `shutil.copy2`s a
file that may be 256 MB; `upload` at `:2166` reads, hashes and compresses a
replaced figure inline; the file watcher at `:248` reads and diffs every
externally changed file inside its own callback, so a `git pull` touching
forty chapters is forty synchronous reads; and `_bib_for` at `:3036` runs
`rglob("*.bib")` over the whole project including `.git` and the build tree,
where `walk_project` at `:2729` already has the pruning fix and says why.

### ~~R-032 · Server · bug · medium · confirmed~~

**Fixed.** The single-page catch-all refuses anything under `/api/` rather than
answering 200 with the interface.

Found by: probing a running server. Where: `server/main.py:4001`, the SPA
catch-all, with `frontend/src/api.ts:309`.

What happens: the catch-all `@app.get("/{path:path}")` is registered last, and
Starlette stops at the first full match, so **any GET the API did not claim is
answered with the application's HTML and a 200**.

```
GET /api/projects/nosuch/open   ->  200, content-type: text/html
                                    <!doctype html><html lang="en">...
```

`request()` in the browser sees `response.ok`, reaches `response.json()`, and
throws a `SyntaxError`. That is not an `ApiError`, carries no status, and so
`redirectFor` cannot classify it as `signin` or `offline`. The writer gets an
unparseable failure with no sensible message.

This is precisely the skew `server/run.py:128` warns about: a bundle built from
one commit calling a route that has since moved gets a success it cannot read.

Expected: a request whose path starts `/api/` is a 404 in the shape the single
error path reads, never the index page.

### ~~R-033 · Server · bug · medium · confirmed~~

**Fixed.** A validation failure answers in the shape `api.ts` reads, naming the
field and what is wrong with it.

Found by: probing a running server, then checking the client. Where: no
`RequestValidationError` handler exists anywhere in `server/`, with
`frontend/src/api.ts:313`.

What happens: FastAPI's default validation failure is
`{"detail": [{"type": "missing", "loc": ["body", "path"], ...}]}`, an array.
The client does `message = body.detail || body.error || message`, so `message`
becomes that array, and `new ApiError(status, message)` coerces it through
`Error`'s constructor.

```
POST /api/projects  with body {}
  ->  422 {"detail":[{"type":"missing","loc":["body","path"],...}]}
  ->  the writer is shown:  [object Object]
```

Reachable from every route that takes a `Body(...)`, which is most of the
writing routes. The app's whole error story is one path with one shape, and
this is the one answer that does not fit it.

### ~~R-034 · Server · bug · medium · confirmed~~

**Fixed.** The archive renames first and clears the in-memory record only once that
worked, raising `TranscriptError` when it did not, so the route can tell "nothing to
file away" from "it would not go" and refuses the reset for the second.

Found by: reading. Where: `server/transcript.py:107` with
`server/main.py:3395`.

What happens: `Transcript.archive` clears the in-memory buffer and the
counters **before** it renames the file, and returns `None` if the rename
raises. `agent_reset` does not look at the answer: it publishes
`conversation_reset` to every tab and returns `{"ok": True, "archived": None}`
whatever happened.

So on a read-only or full `.nexttex`, the writer is told the conversation was
filed away and a new one started. It was not. The next append lands in the
same file, and a reload shows the old conversation and the new one as a single
thread. `docs/architecture.md` calls this file an audit trail, which is the
reason it matters more than an ordinary swallowed error.

`Transcript._append` at `:58` swallows `OSError` for the same file, so the
audit trail can also simply stop recording, in silence, while the panel goes
on showing the live conversation.

### ~~R-035 · Server · bug · medium · confirmed~~

**Fixed.** The watcher says once that it has stopped and is retrying, rather than
retrying in silence for the life of the process.

Found by: reading. Where: `server/main.py:266`.

What happens: the file watcher's loop ends `except Exception: await
asyncio.sleep(1.0)`, with no log line, inside `while True`. A failure that
recurs, a permission error on a watched root, a watched directory that has
gone, spins once a second for the life of the process and says nothing.

What the writer loses is exactly what the watcher's own docstring says it
exists to prevent: an external edit, a `git pull` or a checkout no longer
reaches the open tab, so the tab saves over a change it never saw. The reaper
twenty lines below logs its exceptions, so the house answer was available.

### ~~R-036 · Server · bug · medium · confirmed~~

**Fixed with R-031**: the ceiling is checked on the write as well as on the read, so
a file the editor cannot open cannot be put into the project.

Found by: reading, then probed. Where: `server/main.py:1582`, `:1601`.

What happens: the 10 MB ceiling on a file the editor will open is checked in
`read_file` and nowhere else. `write_file` takes an unbounded `text`.

```
PUT  big.tex, 12 MB   ->  200, written to disk
GET  big.tex          ->  413 "That file is 12 MB, and the editor opens
                                files up to 10 MB."
```

So the app will write, through its own route, a file it will then refuse to
open, for ever. The refusal is at least honest about why. The same missing cap
is what makes R-031 reachable at 40 MB.

### ~~R-037 · Server · bug · medium · confirmed~~

**Fixed.** `_close_session` holds the id in `CLOSING` while it awaits, and
`session_for` asks about that before it looks anything up, so a request arriving
mid-close is told 503 rather than being given a second session over the same files.

Found by: reading. Where: `server/main.py:326` and `:334`, with `:1460`,
`:1509`.

What happens: the reaper pops a session out of `SESSIONS` and then awaits
`session.close()`, which can take seconds: it awaits the peer network closing,
the agent disconnecting, and per document a `compiler.cancel()` that kills a
process group and waits up to three seconds for it. Any request landing in
that window calls `session_for`, misses the table, and builds a **second**
`ProjectSession` on the same directory, which is the one thing that
function's docstring promises cannot happen.

At the reaper's own call site the damage is small, because eviction only
happens when nothing is dirty. The sharp version is `forget_project` at
`:1460` and `relocate_project` at `:1509`, which do the same pop-then-await on
a session that may be actively dirty, because a person clicked the button
while their own tab or a collaborator was typing. There `close()` does flush,
and the flush ends in `_compact()`, which rewrites a document's log, so an
update the second store appended in the window is rewritten away.

`forget_project` has a third ending as well: the registry entry is removed
after the close, so a request in the window leaves a live session for a
project that is no longer registered. `GET /api/projects` then reports it as
open, and the watcher keeps watching the folder, until the thirty-minute
eviction.

### ~~R-038 · Server · performance · low · confirmed~~ deferred

**Moved to the backlog.** The fix that removes the 17 ms is building the session in
a thread, and a session builds its pycrdt documents: the constraint in
`docs/architecture.md` is that those belong to the thread that built them, and trying
it fails the whole suite. Threading a pre-walked listing through `session_for`
instead is a change to a function fifty routes call, which 17 ms does not justify.

Found by: reading, then measured. Where: `server/main.py:1300` with
`server/session.py:302`.

What happens: `session_for` is synchronous, and building a session walks the
whole project tree on the loop through `collab.adopt()`. `open_project` at
`:1529` carries a comment saying the filesystem work was moved off the loop,
and the block that was moved walks the tree a **second** time.

Measured, on the 2602-file thesis: opening a cold session takes 326 ms, and a
trivial route fired alongside it takes 27 ms against an idle baseline of 9 ms.
So about 17 milliseconds of the open is held on the loop rather than the 125
the comment is about, which says most of the fix landed. The second walk is
still real work done twice, and `_rejoin_shared_projects` at `:157` pays the
first walk once per shared project, in sequence, at boot.

### ~~R-039 · Server · security · low · confirmed~~

**Fixed.** Hashing a new password is off the loop, a supplied credential that
matches nothing is counted against the same limiter the password path uses, and an
attachment's declared size is checked before it is read. A stale session cookie is
deliberately not counted: every password set clears the session list.

Found by: reading. Where: `server/main.py:1223`, `:399`, `:3325`.

Three narrower ones, each against a claim in `docs/architecture.md`'s
"Security posture" list.

**scrypt is off the loop on one path of two.** Verification at `:1216` is in
`asyncio.to_thread`; setting a password at `:1223` calls `hash_password`
directly. About 15 ms of held loop, so the cost is small and the claim is
half true.

**The rate limiter covers one credential of two.** `POST /api/login` and the
change-password path count failures and delay. `_authorise` at `:399` compares
the instance token on every request with no counting at all. The token is
`token_urlsafe(32)`, so this is not practically guessable; the finding is that
the list says "a rate limiter keyed on the socket address" without saying which
credential it is keyed for.

**An attachment is refused after it is in memory.** `:3325` reads the whole
upload and then compares it against the 8 MB limit at `:3327`, inside a
request the body gate allows to be 512 MB. `file.size` is populated by the
multipart parser before the read and would refuse it for nothing.

### Collaboration, context and papers

### ~~R-057 · Collaboration · security · blocker · confirmed~~

**Fixed.** `settle_paths` puts a path through `resolve_for_write` before it becomes a
baseline, and `_rename_locally` fences its source as well as its target. Held by
`tests/collab/test_hostile_peers.py`, two tests that move a key and a `.git/config`
without the fix.

Found by: reading, then reproduced against the real `CollabStore`. Where:
`server/collab/store.py:845` with `:836`.

**What happens: anyone you share a project with can move any file your user
can read into the project, and delete it from where it was.**

The fence is on the wrong end of the rename. `_rename_locally` puts the target
through `resolve_for_write`, and takes the **source** straight from the
manifest with no fence at all:

```python
def _rename_locally(self, file_id, was, now_called):
    source = self.project.root / was              # no fence
    target = self.project.resolve_for_write(now_called)   # fenced
    ...
    source.rename(target)
```

`was` is `self._named[file_id]`, which `settle_paths` filled from
`record["path"]` on an earlier pass. That earlier pass writes nothing, so
nothing checks it: the first sight of a file is recorded as "the baseline the
next change is measured against" and the path is trusted because it has not
been used yet.

So the attack is two manifest edits and no writes:

1. Add a record whose `path` is `../../../home/you/.ssh/id_rsa`. Nothing
   happens; the path is remembered.
2. Change that record's `path` to `notes.tex`. `settle_paths` sees a rename,
   and renames the key into the project.

Reproduced against the real class, in a throwaway tree:

```
baseline the manifest left behind: ../outside/id_rsa

still outside the project: False
now inside the project:    True
project/notes.tex holds:   'PRIVATE KEY, not in any project\n'
```

The file is then adopted by the watcher like any other, becomes a shared
document, and syncs back to the peer who asked for it. So this is a read of
anything the server's user can read, **and** a destructive move of it, from a
collaborator, with no code execution and nothing on screen but a new file
appearing in the tree.

The manifest is peer-writable by design: `server/collab/peers.py:361` applies
a peer's sync message to it and then asks the store to settle, which is what
makes a rename travel at all.

`docs/architecture.md` states the guarantee this breaks: "What a peer may
write is fenced. A peer-supplied path goes through `resolve_for_write`, which
refuses control files. Staying inside the project was never the whole
question." That is true of every write and of the rename's destination. It is
not true of the rename's source, which is the one peer-supplied path that
never meets it.

`tests/collab/test_hostile_peers.py` covers the write path thoroughly, at
`:108` through `:190`. Nothing tests a rename's source.

The same mechanism moves directories, because `Path.rename` does, so
`.nexttex/history` and `.git` are reachable the same way.

Expected: `was` goes through `resolve_for_write` too, or better,
`self._named` is only ever filled with a path that has already passed it, so
that an escaping path can never become a baseline.

### ~~R-058 · Collaboration · bug · high · confirmed~~

**Fixed.** A local file a peer's rename displaces goes to the trash, which is
restorable, on a screen, and announced by the watcher, rather than to
`chapter (was here).tex` inside a suppressed OSError.

Found by: reading, then reproduced against the real `CollabStore`. Where:
`server/collab/store.py:862`.

What happens: when a peer renames one of their files onto a name this machine
is already using, the writer's own file is moved aside and nobody is told.

```
after a peer renames one of their files onto a name this machine was using:
     b (was here).tex      'MY OWN WORK, written on this machine\n'
     b.tex                 "the peer's file\n"
```

Nothing goes to the trash, nothing reaches the event stream, and no notice is
drawn. The writer finds a file called `chapter was here.tex` beside their
chapter and has to work out what happened.

The comment above it is honest about the mechanism and says nothing about the
person: "The manifest is the authority on what this file is called, so
whatever is in the way steps aside." Stepping aside is defensible. Doing it in
silence is the finding, and the app already has a trash and an event stream
for exactly this.

### ~~R-059 · Collaboration · bug · high · confirmed~~

**Fixed.** The join no longer flushes, and the store stays open until the answer.
Held by `tests/api/test_join_offer.py`, which asserts that accepting projects every
document and flushes, and that discarding does neither.

Found by: reading. Where: `server/main.py:946` with `:963`.

What happens: joining writes the whole project to disk before the writer is
asked, and closes the connection before the hold begins. `store.flush()` at
`:946` is the call that writes every document, and the `finally` at `:947`
closes the network and the store. Only then, at `:963`, is the pending join
created and the offer card returned.

Four statements say otherwise.

- `frontend/src/panes/Projects.tsx:618`: "Nothing has been written yet. This
  is what would arrive in..."
- `frontend/src/api.ts:380`: "Accept an invite as far as *looking* at it.
  Nothing is written to disk."
- The comment at `server/main.py:958`, directly above the pending join: "Held
  open rather than written and registered... the answer is offered before
  anything is written."
- `docs/architecture.md`: "The join syncs the project into memory, holds the
  connection open, and answers with the manifest."

Discarding does `rmtree` the folder, so the end state is still "nothing left
behind", which is why this has never been noticed. The Windows laptop later
staged this across two real machines and the timestamps make it worse than a
window. With the offer card still on screen, its folder held `main.tex`
complete and readable from preamble to `\end{document}`, and `nexttex.toml`
and `references.bib` carried an mtime a full minute earlier than the card. So
pressing Discard would have had to delete real files rather than decline to
create them, which is the opposite of what the text on the card promises.

What is real beyond that is the window: a server killed between join and
accept leaves a folder full of somebody else's project, unregistered and
untracked, and the writer's next attempt to join into it is refused with
"That folder already has something in it".

### ~~R-060 · Context · performance · high · confirmed~~

**Fixed.** `context.add`, which runs pdftotext and pdfinfo as subprocesses, is
threaded like everything comparable in that file.

Found by: reading, then measured against a running server. Where:
`server/main.py:2505` with `nexttex/context.py:242`.

What happens: uploading a style document or a writing sample runs `pdftotext`
and then `pdfinfo` **on the event loop**, with timeouts of 120 and 30 seconds.
`session.context.add` is called directly in the route with no `to_thread`,
which makes it the outlier: `texcount`, `chktex`, the download archive, the
library walk, the paper scan, the DOI fetch and every git call in the same
file are all threaded.

Measured, uploading a 100 page, 500 kB PDF to the review server:

| | time |
|---|---|
| trivial route, idle | 11 ms |
| the upload itself | 1.24 s |
| trivial route, during the upload | **1.00 s** |

A journal's author instructions run to a few hundred pages, and the timeout
permits a hundred and fifty seconds. For the whole of that, every tab, every
editing socket, every event stream and every peer is stopped.

### ~~R-061 · Collaboration · performance · high · likely~~ deferred

**Moved to the backlog, with the measurement.** The whole path this is about,
`collab.edit_to_disk_ms`, benches at 3.39 ms against a 120 ms budget, so it is
thirty-five times inside its own limit. The ordered off-loop queue that would fix it
properly is more machinery than that number justifies.

Found by: reading. Where: `server/collab/store.py:975` and `:997`, reached
from the 120 millisecond flush timer.

What happens: every settled edit records a version from inside the flush
callback, which is a `loop.call_later`. That path does a sha256 over the whole
file, a `zlib.compress` at level 6, and a full rewrite of the file's JSONL
log. The branch for an edit this machine did not author pays the hash and the
compression too.

Since the CRDT became the only save path, this is the cost of every keystroke
burst in every file rather than of an occasional save. `bench/thresholds.json`
measures `collab.edit_to_disk_ms` at about five milliseconds on a
thesis-shaped file and calls that settled, which it is; the finding is that
the work is on the loop rather than that it is slow, and it grows with file
size while the loop's other callers do not.

`server/collab/persist.py:110` is the same shape: `should_compact` calls
`doc.get_update()`, serialising the whole document, for every grown document
on that same timer once its log passes 64 kB.

### ~~R-062 · Collaboration · bug · medium · likely~~

**Fixed.** `_refused` maps a file id to the path its write was refused for, so a
record pointed somewhere ordinary afterwards is written like any other. Refusing to
retry the same path is unchanged, which was the part that was right.

Found by: reading. Where: `server/collab/store.py:923`.

What happens: `_refused` is a set of file ids a write was refused for, added
to once and removed from never. The comment argues correctly that a path which
named `.git/config` will name it again next time and should not be retried.
What is latched is the **file id**, not the path. A peer that names a file
badly for one flush and corrects it has poisoned that document for the life of
the session: the editor accepts keystrokes, everything looks normal, and
nothing is ever written to disk again. Only a `log.warning` says anything.

### ~~R-063 · Collaboration · bug · medium · likely~~

**Fixed.** The wait is for the bodies rather than for the manifest that lists them,
and it says so when only part of a project arrives instead of writing the half that
came.

Found by: reading. Where: `server/main.py:1071` with
`server/collab/peers.py:289`.

What happens: a join is considered complete when the manifest names any text
file, not when any body has arrived. `send_documents` pipelines every offer
without awaiting a reply, so on a relayed link or a large project the manifest
lands long before the contents. The wait then sleeps half a second and
returns, the store is flushed, the link is closed, and the offer card lists
every file in the manifest as arriving.

The writer accepts forty files and finds some of them empty, with nothing
anywhere saying so.

### ~~R-064 · Collaboration · security · medium · likely~~

**Fixed, all three parts.** The blob half landed with pass 1. The frame header has
its own ceiling now, 256 kB against the payload's 64 MB, because it is parsed on the
loop before anything has looked at the frame; and the transport's read has a sixty
second timeout, so a peer that declares a length and never sends the bytes no longer
holds its buffer open for ever.

Found by: reading. Where: `server/collab/wire.py:67`,
`server/collab/iroh_transport.py:78`, `server/collab/peers.py:1029`.

Three things a member can do to the process, each from the wire and each on
the event loop.

**A 64 MB frame header is parsed with `json.loads` on the loop.** `MAX_FRAME`
is checked after the bytes are assembled, and the real ceiling is
`MAX_MESSAGE` at 64 MB. One oversized header stops everything for seconds.

**A frame that declares a length it never sends holds its buffer open for
ever.** The read loop has no timeout, the first frame is awaited with no
timeout, nothing caps concurrent connections, and membership is checked only
after that first frame arrives.

**~~Unsolicited blobs are stored.~~ Fixed in `49b6b98`'s successor.** Any
`BLOB_HAVE` whose payload hashes to its claimed sha was written, whether or
not anything asked, and each cost a sha256 and a `zlib.compress` on the loop.
`take_blob` now asks the question its own docstring already claimed to ask,
whether some link is still waiting for that sha, before it asks whether the
bytes match the name. Held by
`tests/collab/test_hostile_peers.py::test_a_blob_nobody_asked_for_is_not_stored`.

**The other two are carried to the pass that does the loop and the bounds**,
because they are the same work as R-031 and R-038: a ceiling and a timeout on
something a person never sees. Neither is a rename and neither belongs with
the fence fix, which is what the rest of this record was grouped with.

### ~~R-065 · Collaboration and context · bug · medium · likely~~

**Fixed.** The share panel clears its error on a good poll and shows the one the
server sends; the Join button says Joining and refuses a second press while a whole
project syncs; the papers chooser lowers its busy flag in a `finally`; the context
panel's memory is keyed on the project; and opening a project clears the last one's
import progress. The blob re-ask is the one part not done: `wanted` is a set with no
time in it, and giving it one is a change to the wire's asking rules rather than a
latch, so it is in the `TRACKER.md` backlog.

A group, each read in the code and none reproduced here, recorded together
because they are one shape: a flag or an error set on one path and cleared on
fewer.

- `SharePanel`'s `error` is set on four paths and cleared on two, never by a
  success, so one blip in the four-second poll leaves "Could not read this
  project's sharing" on screen for the life of the card
  (`frontend/src/panes/SharePanel.tsx:43`).
- `CollabState.error` is set by a `DENIED` frame, serialised to the browser,
  and read by nobody (`server/collab/peers.py:421`, with the two consumers at
  `SharePanel.tsx:43` and `Editor.tsx:181`). Somebody removed from a share
  sees their collaborators listed as away for ever and is never told why.
- `PeerLink.wanted` is cleared only when a blob actually arrives, and
  `_send_blob` answers nothing when it does not hold the content, so a peer
  that has thinned a blob away leaves that sha in `wanted` for ever and the
  version fails to open every time (`peers.py:528`, `:521`).
- The Join button has no busy state during a wait that can run thirty
  seconds, and a second press starts a second join into the same folder
  (`frontend/src/panes/Projects.tsx:505`).
- `PapersChooser`'s `busy` is cleared only on the failure path; the success
  path relies on a parent in another file unmounting it
  (`frontend/src/panes/PapersChooser.tsx:89`). This is the Claude install
  panel's shape from `d11da03`, standing today on an invariant somewhere
  else.
- `ContextPanel`'s memory is refetched on an effect keyed on the documents
  rather than on the project, so switching projects shows the previous
  project's notes (`frontend/src/panes/ContextPanel.tsx:64`).
- `store.library` is never reset, so the papers panel goes on saying
  "Reading papers: stopped" for the life of the tab, across project switches
  (`frontend/src/store.ts:769`).

### ~~R-066 · Context and papers · bug · medium · likely~~

**Mostly fixed, and the crash first.** `write_bib` runs inside
`to_thread(scan.run)` and called `collab.ingest`, which applies a transaction to a
pycrdt document built on the loop: every reference the importer added was folded in
from the wrong thread. It hops back now, the way `announce` ten lines above it
already did. Memory over the cap is refused rather than silently truncated, and a
publisher that could not be reached is no longer reported as a paper that does not
exist. The remaining items are in the backlog.

A second group, about the papers pipeline, each read and none reproduced.

- **A scan interrupted by the file changing marks papers added that were
  never written.** `nexttex/library.py:491` returns early and discards the
  accumulated text, but those entries already carry `state="added"` and a
  citation key, and are persisted, so every later run skips them as settled.
  The writer has `\cite` keys the bibliography does not contain, permanently.
- **The bibliography writer touches loop-owned CRDT state from a worker
  thread.** `server/main.py:2350` calls `session.collab.ingest` from inside
  `asyncio.to_thread(scan.run, folder)`. The progress callback ten lines above
  correctly hops back with `run_coroutine_threadsafe`, which is what makes
  this look like an oversight. `docs/architecture.md` records that pycrdt
  panics rather than raising when a document is used from another thread.
- **A transport failure reads as a DOI that does not exist.**
  `nexttex/library.py:517` catches everything per candidate and writes "No
  record found for {doi}", so a rate limit and a bad DOI are the same
  sentence.
- **The DOI-against-PDF check does not run on the agent's path.**
  `nexttex/agent.py:2000`'s `add_reference` has no containment check, so a
  model reading a cited DOI off page one can add the wrong paper. README's
  "It cannot invent a citation" is about composition rather than
  misattribution, so this is a gap beside the claim rather than against it.
- **A PDF with no extractable text leaves the panel offering a button that
  does nothing.** The kind stays stale, "Read these now" reaches a
  distillation that skips empty excerpts and returns a 400, and the click has
  no `catch` (`frontend/src/panes/ContextPanel.tsx:232`).
- **Nothing clears the stale marker after a successful distillation**, because
  the agent writes under `.nexttex/`, which the watcher ignores by design.
- **Hand-editing memory past the cap truncates it mid-line with no message**,
  where the agent's own path refuses loudly (`nexttex/context.py:123` against
  `:149`).

### Install and update

### ~~R-041 · Update · bug · high · confirmed~~

**Fixed.** The running commit is read once at boot, and the commit on disk is reported beside it.
Held by `tests/api/test_update_routes.py`, `frontend/src/panes/update-standing.test.ts` and `e2e/specs/update.spec.ts`.

Found by: a real Windows machine, then confirmed against the code. Where:
`server/main.py:3599`.

What happens: `/api/instance` answers `head` by running `git rev-parse HEAD`
**at request time**, which reads the working tree. That is the commit on
disk, not the commit the running process loaded. Nothing anywhere compares the
two, and the update check on the projects screen compares the same disk HEAD
against the remote.

So an install whose files have moved forward without a restart reports a
commit it is not running, and the update footer says it is up to date.

This is not hypothetical. The writer's Windows laptop, read this afternoon:

```
working tree HEAD          b16bf6d
the process actually serving   664f237   (started 12:29:25, HEAD was
                                          664f237 at 12:29:03, and the
                                          tree fast-forwarded at 23:05:01)
origin/master              b832d28
```

Three different commits, and the interface reports the middle one as though
it were the answer. The laptop has been serving day-old code while being told
otherwise.

Expected: `head` is read once, at import, and reported as what is running.
The disk commit is a different fact and can be reported beside it, which is
what would make the case above visible instead of invisible.

The `boot` nonce in the same answer already exists to tell a browser that the
process changed. Nothing ties it to `head`.

The cleanest evidence came later, from the laptop, in one response taken
immediately after an update and before any restart:

```
{"instance":"","head":"f2296b4","boot":"eab23450b4ca4d07","supervised":false}
```

`head` is the commit `update.ps1` had just pulled onto the disk. `boot` is the
same nonce the process had carried since 15:56, hours earlier. One answer, two
fields, contradicting each other, and the only reason anybody can tell is that
`boot` happens to be beside it. After a manual restart `boot` changed and
`head` stayed, which is what agreement looks like.

### ~~R-042 · Update · bug · high · confirmed~~

**Fixed.** With R-122 and R-125: the update stops the server, restarts either install shape, and exits one if it could not.
Held by `tests/test_cross_platform.py`.

Found by: a real Windows machine, then confirmed against the code. Where:
`scripts/update.ps1:61` with `scripts/register-task.ps1:52`.

What happens: `update.ps1` restarts the server only if a scheduled task named
NextTex exists. Registering that task needs administrator, and
`register-task.ps1` falls back to a Startup-folder shortcut when it cannot,
which is what an ordinary Windows account gets and what the writer's laptop
has. On that install the update prints

```
not running as a scheduled task; restart it yourself
```

and exits, leaving the old process serving. The README says plainly:
"`./scripts/update.sh` pulls, reinstalls, rebuilds and restarts, or
`scripts\update.ps1` on Windows."

The installer's own start attempt has the same ending from the other
direction. The laptop's `server.err.log` holds exactly one line, written by
last night's install:

```
Port 8450 is already in use on 127.0.0.1. Stop the other NextTex, or set a
different port.
```

That is the installer losing the port to the process already running, which is
correct behaviour and is reported into a file nobody reads, while the console
said the install was ready.

Taken with R-041, the two make a writer who has done everything right believe
they are running code they are not.

### ~~R-043 · Documents · docs · medium · confirmed~~

**Fixed.** The README says `python.exe -u` and names the process to end, and says why it is not `pythonw`.
Held by `tests/test_documents_match_the_code.py`.

Found by: a real Windows machine. Where: `README.md:221`.

What happens: the README tells a Windows writer whose install fell back to a
Startup shortcut: "run `.venv\Scripts\pythonw.exe server\run.py` to start it,
and end the `pythonw` process to stop it."

Both halves are wrong, and `scripts/register-task.ps1:56` says why at length
in a comment written after it was found the hard way. The shortcut runs
`python.exe -u`, deliberately, because `pythonw` "discards stdout and stderr
entirely, so a server that dies on startup dies in complete silence: no
window, no message, no log. That is exactly what happened."

So the README's start command reproduces the failure that comment removed,
and its stop instruction finds nothing: on the laptop, with the server up and
listening, `Get-Process pythonw` returns nothing, because the process is
`python.exe`.

`tests/test_documents_match_the_code.py` cannot see this. It checks that every
path, route and `NEXTTEX_*` name a document mentions is real, and both of
these are real names used for the wrong thing.

### ~~R-118 · Install · bug · medium · confirmed~~

**Fixed.** A `--dir` that disagrees with the checkout the script is standing in is refused with both paths named.
Held by `tests/test_install_bootstrap_sh.py`.

Found by: running the documented installer on this machine, into a sandbox.
Where: `scripts/install.sh:134`, against its own `--help` at `:111`.

What happens: `--dir` is accepted, documented, and silently ignored whenever
the script is run from inside a checkout. So is `NEXTTEX_DIR`. The install
goes to the checkout the script is standing in, and says so only in a line of
its own banner that reads as a statement rather than as a correction:

```
  NextTex
    installing the checkout at /data/dakshitha/NextTex
```

`--help` says "--dir where to install. The default is ~/apps/NextTex", with
no caveat.

Reproduce:

1. From inside a checkout, run
   `sh scripts/install.sh --yes --plain --dir=/somewhere/else --no-service --no-shortcut`
2. Nothing is created at `/somewhere/else`. The checkout you are standing in
   is reinstalled: its `.venv` is brought up to date and `frontend/dist` is
   replaced with the downloaded build for its commit.

Mechanism: the script has two modes and only one of them reads the answer.

```sh
if [ -f "$(dirname "$0")/../requirements.txt" ] 2>/dev/null; then
  cd "$(dirname "$0")/.."
else
  ...
  TARGET="$DIR_CHOICE"
```

`DIR_CHOICE` is set from `--dir` before the branch and is read only inside the
`else`. The comment above the branch is exactly right about the design, "Run
from inside a checkout it installs that checkout", and the flag parsing does
not know about it.

Expected: either the flag moves the install, or the script says that it cannot
here and why. The comment beside `TARGET` already knows the stakes: "the
directory is the one decision here that cannot be changed afterwards without
moving the install by hand."

Severity is medium rather than low because of who meets it. A person who has
already cloned, which is the state the README's own "Installing from a
checkout" section describes, is the one likely to pass `--dir`, and the
outcome is that their existing checkout is rebuilt instead. Nothing is lost,
since the venv is updated rather than replaced and `frontend/dist` is
gitignored and rebuildable, but it is not what was asked for.

Anything reviewing or testing an install has the same problem, which is how
this was found: the sandboxing the review protocol specified could not work,
and the install landed in the working repository.

### ~~R-119 · Install · docs · low · confirmed~~

**Amended and fixed.** No sentence about Linux existed; the stale claim was the Windows paragraph, which said nothing had reported a running server serving a project. One has. The paragraph now names the two things still unproven.
Held by `tests/test_cross_platform.py`.

Found by: the same run. Where: `README.md`, "Installing".

What happens: the README describes the install as partly verified on Linux.
It is not, any more. The documented path ran end to end on this machine, in
one command, with exit 0, against a real TeX, a real `claude` and a real
`tailscale`. It priced the job, printed a seven-step plan, did the seven
steps, and ended with a working URL and a token:

```
    [6/7] At login
  · not set up -- .venv/bin/python server/run.py
    [7/7] Desktop
  · not made -- open NextTex from the address below
  Ready
      http://127.0.0.1:8459/?token=...
```

`--instance` did its whole job: the state directory, the `config.json` and
the `install.log` all went to `nexttex-review` under the redirected
`XDG_DATA_HOME`, the port came out as 8459 rather than 8450, and nothing in
the writer's own `~/.local/share/nexttex/` was written. The build it
downloaded carries a `BUILD_SHA` equal to `HEAD`.

The one thing wrong with it is R-118.

### The documents

### ~~R-007 · Documents · docs · low · confirmed~~

**Fixed.** Both files quote what the tiers measure now, and a test asserts the two agree with each other, which is the failure that let them drift in different directions.
Held by `tests/test_documents_match_the_code.py`.


Found by: the baseline run. Where: `scripts/check.sh:4` and
`docs/testing.md:7`.

What happens: both files quote a time for the test tiers and both are out of
date by an order of magnitude. `scripts/check.sh`'s header says "the browser
tier takes a minute and the Python tier takes seven seconds". `docs/testing.md`
says the fast tier is "about twenty seconds" and `--all` "about two minutes".

Measured on this machine at `5942653`:

| tier | quoted | measured |
|---|---|---|
| Python | 7 s | 136 s |
| fast tier, all three | 20 s | 167 s |
| `--all` | 2 min | see the baseline table |

The Python suite has grown to 1279 tests. The number in the header is the
reason the ordering argument in that comment is given at all, so it is worth
correcting rather than deleting: the argument still holds, and the ratio it
rests on has changed.

### ~~R-075 · Documents · docs · medium · confirmed~~

**Fixed.** The paragraph keeps its reasoning in the past tense and says what was built and where, which is the correction this repository already uses elsewhere.
Held by `tests/test_documents_match_the_code.py`, which reads that sentence and the tab strip's route together.


Found by: reading the design document against the code. Where:
`docs/design.md:296`.

What happens: a paragraph whose entire purpose is to warn about drift has
drifted. It reads:

> (This paragraph described a menu of *rename / duplicate / download / delete
> / new file here* for some time after the built menu had stopped matching it,
> which is the sort of drift this document exists to avoid. Duplicate was
> specified and never built; it is dropped rather than left described.)

Duplicate is built. `frontend/src/panes/Tabs.tsx:249` puts it in the tab
strip's menu, `server/main.py:1754` is the route, and
`docs/architecture.md` describes it at length under "Copying a file is a
fourth path, and it has to start by closing the second one", with its own
argument about flushing dirty documents first.

`TRACKER.md` has the accurate version, as a backlog item: "Duplicate is on the
tab strip and not in the file tree." So the repository knows; this one
document does not.

The correction is the one this repository already uses elsewhere: keep the
original reasoning in the past tense, and say what was built and where.

### ~~R-076 · Documents · docs · medium · confirmed~~

**Fixed.** The measured cell is the current figure and a test holds it there. The tolerance is half a percent rather than one, because the drift this record reports is 0.47 percent and a one percent tolerance would have passed it.
Held by `tests/test_documents_match_the_code.py`, skipped when there is no build.


Found by: the benchmark run. Where: `README.md`, the measured column of the
table under "The measured numbers".

What happens: the interface bundle row reads **788.0 kB** and measures
**791.7 kB**. That number is machine-independent, since it is the size of
`frontend/dist`, so this is drift rather than a difference between two
computers.

`tests/test_documents_match_the_code.py` has a test for this table, and it
checks the **budget** column against `bench/thresholds.json`, deliberately and
for a good reason recorded in `docs/testing.md`. Nothing checks the measured
column, which is the other transcription in the same row, and the commit
`1143527` that added the budget test is titled "The measurements in the README
were from a run several changes ago".

A second benchmark run was made on an idle machine to give the timing rows a
fair comparison, because the first ran straight after a twelve-minute browser
tier. On the quiet run every timing row in the table is within a few percent
of what the README says:

| row | README | quiet run |
|---|---|---|
| Chapter build | 330 ms | 334 ms |
| Full build with `biber` | 17.7 s | 17.4 s |
| Full symbol scan | 17.6 ms | 17.3 ms |
| Symbol lookup, cached | 0.85 ms | 0.86 ms |
| Opening a project | 94 ms | 94 ms |
| Recording a version | 2.3 ms | 2.5 ms |
| Rebuilding a transcript | 11.5 ms | 11.8 ms |
| Project file tree | 2.9 ms | 3.1 ms |
| A collaborator's edit, applied | 3.1 ms | 3.2 ms |
| Whole project as a zip | 61 ms | 62 ms |
| Interface bundle | 788.0 kB | 791.7 kB |

So the timings are not drift, and the table is honest about the machine it was
taken on. The bundle is the one row that has moved, and it is the one row that
would read the same on any machine.

### ~~R-077 · Documents · docs · low · confirmed~~

**Fixed in pass 10, with R-070.** `f907b63`. The item now says three, names them, and records that the count went from five to four by the grep and from four to three by the spelling menu being fixed as it was written. It also names the two files that decline the role deliberately, since that is the honest half of the inconsistency rather than a resolution.


Found by: reading `TRACKER.md` against the code. Where: `TRACKER.md:54`.

What happens: the backlog item says "Five menus claim `role="menu"` without
implementing it" and names them. A literal grep finds four: two of the named
files carry one each rather than the two the entry attributes to
`frontend/src/panes/Chat.tsx`. The entry also says "the answer is roving focus
in all seven", counting the two that deliberately decline the role.

The item is right about the problem and wrong about its size, which matters
because the number is the argument for it being "a piece of work of its own".

### The live suites, and the papers path against the real services

### ~~R-078 · Testing · bug · high · confirmed~~

**Fixed.** An autouse fixture in `tests/test_live_agent.py` puts the real binary
back per test, after the conftest has imported, for those two tests only. The
suite-wide guard is unchanged. `tests/api/test_claude_auth.py` fails if that
fixture stops being autouse, which is the half nothing was checking.

Found by: running the two live suites the plan asked for. Where:
`tests/conftest.py:20` against `tests/test_live_agent.py`.

What happens: the one test written to drive the real Claude SDK cannot reach
it. Its own docstring says so plainly:

> The one test a stand-in cannot replace. [...] So this drives the real
> `ProjectAgent` against a real account and asserts the vocabulary, not the
> answer.

`tests/conftest.py` sets `NEXTTEX_CLAUDE_BINARY` to `tests/fake_claude.py` at
import time, unconditionally, for every test in the suite. `nexttex/agent.py`
asks `claude_binary()` for the executable, `claude_binary()` returns the
stand-in before it ever looks at PATH, and the live test therefore runs
against the stand-in it exists to bypass.

What makes this worth a record rather than a shrug is what the failure looks
like. The stand-in does not refuse; it prints `unknown command:` to stderr and
exits 2, the SDK turns that into a `ProcessError`, and the test reports:

```
AssertionError: the SDK no longer emits ['text', 'text_end']; saw ['done', 'error', 'turn_start']
```

That is the message written for the one thing this test is for, an upstream
rename in the Agent SDK. Anybody running it before a release, which is what
the docstring tells them to do, is told the SDK has changed under them when
nothing has. The check that would catch a real upstream break has been
converted into a check that always reports a break that is not there.

Reproduce:

1. `NEXTTEX_LIVE=1 .venv/bin/python -m pytest tests/test_live_agent.py -q`
2. Both tests fail, with the message above.
3. Run it again with the real CLI restored per test, after the conftest has
   imported, and the first test passes against the real account.

The whole of step 3 is this, saved as `pin_sonnet.py` on `PYTHONPATH` and
passed as `-p pin_sonnet`. It is kept here rather than in a scratch directory
because it is the entire proof:

```python
import os
import shutil

import pytest

import server.session as session_module

_original = session_module.ProjectSession.__init__


def _with_sonnet(self, project, model=None, provider="claude", api_key=""):
    _original(self, project, model or "claude-sonnet-5", provider, api_key)


session_module.ProjectSession.__init__ = _with_sonnet


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_setup(item):
    if "test_live_agent" in str(item.fspath):
        real = shutil.which("claude")
        assert real, "no claude on PATH"
        os.environ["NEXTTEX_CLAUDE_BINARY"] = real
```

The hook is what matters: `tests/conftest.py` writes the environment variable
at import time, so anything that wants the real binary back has to do it per
test, after that import, and only for this file.

Mechanism: the guard was not there when the test was written.
`tests/test_live_agent.py` arrived on 6 September in `5f3364c`. The conftest
guard arrived on 8 September in `699ba8f`, "The test suite was signing the
developer out of Claude Code", which is a real and serious fix: a same-origin
case posted to `/api/claude/logout`, which ran `claude auth logout` against
the developer's own installation, and every full run of the suite deleted
their credentials. Pointing the whole suite at the stand-in shut that off for
every test at once, deliberately, "including the ones nobody has written yet".
It also shut off the one test that had been written to do the opposite, and
nothing noticed, because that test is opt-in and nobody had run it since.

The fix is not to weaken the guard. `tests/api/test_claude_auth.py:168` pins
it and should keep pinning it. The narrow thing this file needs is the real
binary back for its own two tests, taken from PATH in a fixture rather than
from the environment the conftest wrote, which leaves the guard in force for
all 1279 of the others.

Evidence: with the real CLI restored and the session pinned to
`claude-sonnet-5`, both tests pass, so the SDK vocabulary the interface reads
is intact on Sonnet today. That is the answer the test was asked for and could
not give.

### ~~R-079 · Testing · docs · low · confirmed~~

**Fixed.** `live_session` takes a model, defaulting to `claude-sonnet-5`, and the
vocabulary test asserts the turn was charged to it rather than to whatever the
account defaults to.

Found by: the same run. Where: `tests/test_live_agent.py:39`, `live_session`.

What happens: `live_session` builds `ProjectSession(Project.open(root))` with
no model, so a real turn runs on whatever the signed-in account happens to
default to. The test's purpose is to check the message shapes the interface
reads, and those can differ by model, so the model the assertion ran against
is worth knowing and is not recorded anywhere. Nothing in the test, its
docstring or `docs/testing.md` says which model a live run charges.

A parameter with a default would say it, cost nothing, and let a release check
run the same assertion against whichever model the writer is actually using.

### ~~R-080 · Testing · bug · medium · confirmed~~

**Fixed.** `collect` answers a permission card with no and records it, so a turn
that reaches for a fenced tool ends instead of waiting out its timeout. The
prompt also asks for the editing tools rather than the shell. Both tests pass
against a real account in thirteen seconds.

Found by: restoring the real CLI and watching the events arrive one at a time.
Where: `tests/test_live_agent.py:95`, `test_a_real_edit_arrives_as_an_edit_event`.

What happens: with the real CLI back in place, the first live test passes and
the second one hangs until its 180 second timeout, every time. It is not the
SDK. The turn stops on a permission card that nothing in the test will ever
answer:

```
  turn_start
  thinking
  thinking_end
  tool_use
  permission {'tool': 'Bash', 'rule': 'Bash:grep',
              'detail': 'grep -n "A Working Title" .../main.tex'}
  TIMED OUT with no done
```

The model reaches for `grep` to find the line before it edits it, which is
reasonable and is what it does in the browser too. In the browser a card
appears and the writer answers it. In the test there is no writer, `collect`
waits for `done`, and `done` never comes.

The first test passes only because its prompt says "Do not read or write any
file", which is the one phrasing that keeps the model away from every fenced
tool. The second asks for an edit, so a tool call is the whole point of it.

Expected: the two tests that exist to be run before a release both reach an
answer. `docs/testing.md` tells a reader to run this file after any Agent SDK
upgrade; what they get is one pass, one three-minute hang, and a stack ending
in `TimeoutError` with nothing saying a card is waiting.

Mechanism: the session is built by `ProjectSession(Project.open(root))` with
the default permission position, and the harness has no answer for a card. A
test that drives a real model cannot also assume which tools the model will
reach for. Either the session is built with the fence at the position that
allows work inside the project, which is what a writer who has pressed the
control once is actually running, or `collect` answers any card it sees and
records that it did.

Evidence: the probe above, run against `claude-sonnet-5` on a fresh copy of
`nexttex/templates/basic`. The title was still "A Working Title" when it gave
up, so nothing was edited.

Note for the fix plan: R-078, R-079 and R-080 are one job. The file needs the
real binary back for its own two tests, a model it names rather than inherits,
and an answer for the card. It is thirty lines and it turns the only check of
the real SDK back on.

### ~~R-102 · References · bug · low · confirmed~~

**Fixed.** A 404 now says the lookup could not find that DOI rather than that the
paper is unknown. Held by `tests/test_references_message.py`.

Found by: driving the reference paths against the real Crossref and the real
Semantic Scholar, which no test has done. Where: `nexttex/references.py:71`,
`cited_by`.

What happens: a 404 from Semantic Scholar is turned into a confident statement
about the paper:

> Semantic Scholar has no record of 10.1038/nature14539, so it cannot say what
> cites it.

That DOI is LeCun, Bengio and Hinton, "Deep learning", Nature 2015. Semantic
Scholar does hold the paper; what it does not hold is that DOI as a lookup
key, and it answers `{"error": "Paper with id DOI:... not found"}` with a 404.
The same is true of `10.1126/science.1127647`. Two other well-known DOIs,
`10.1145/3292500.3330701` and `10.1109/CVPR.2016.90`, resolve and return their
citations in full, so this is patchy coverage by DOI rather than an outage.

Expected: a writer building a literature review is told that this route could
not find the paper, not that the paper is unknown. The two readings lead to
different next actions, and the second one is wrong often enough to matter:
Nature and Science DOIs are exactly the ones a thesis cites.

Evidence:

```
cited_by 10.1038/nature14539      -> 404, "Paper with id DOI:... not found"
cited_by 10.1145/3292500.3330701  -> 200, citations returned
```

Mechanism: the message was written for the case where the DOI is wrong, and
the API returns the same status for a DOI it simply cannot resolve. A 404 here
means "not found by this key", which is not the same claim.

Recorded also because it is the first time this path has run against the real
service. Everything else in that module came back correct in the same run: a
real DOI resolved to a tidied entry in 86 ms, a DOI that does not exist raised
rather than inventing an entry, and a Crossref search returned records with
their own DOIs in about a second.

### What a writer reaches for and does not find

Found the fifth way the protocol names: by asking what a writer does twice,
waits for, or reaches for and does not find, with the README's own standard in
hand, that somebody who has used a Jupyter notebook already knows how this
works. Each record says what a writer does now, what they would do instead,
what it would cost, and which pieces are already built, because several of
these are a control in front of a route that is already written.

Found by: a subagent reading the whole interface at once, which is the only
way a list like this can be assembled, since it is about what is absent rather
than about what is wrong. Seven of its structural claims were re-verified here
by grep before anything was recorded: that there is no search route of any
kind in `server/main.py`, that the app has no tab shortcuts, that
`/history/timeline` has no client caller, that `loadTemplate`'s callers all
pass no name, that `api.forgetWord` is called from nowhere, that `explain` is
not imported by `server/main.py`, and that Duplicate appears in `Tabs.tsx` and
not in `FileTree.tsx`. The rest is read rather than reproduced, which for a
missing feature is the only evidence there is.

Two of the five leads this pass started with turned out to be wrong and are
recorded as leads closed rather than as findings. **Find and replace exists**:
`frontend/src/panes/editor-setup.ts:33` installs CodeMirror's `search` panel
with `top: true` and the whole `searchKeymap`, so replace, replace all, regex,
match case and select-all-matches are all there, and
`e2e/specs/writing.spec.ts:96` asserts the panel opens on the first press. A
comment at `editor-setup.ts:399` records the older bug, the keymap bound
without the extension, as already fixed. **A full build exists** and the
status strip does distinguish scope; what is missing about it is narrower and
is R-086.

### ~~R-081 · Editor · comfort · high · confirmed~~

**Built.** `Cmd-Shift-F` opens a panel in the rail under Files: every match in every text file, grouped by file, click to go there, and a replace across all of them behind a confirmation that says each file keeps a version in its history. The search reads the open documents live and the rest off disk, so it finds the sentence typed a moment ago.
Held by `tests/test_search.py`, `tests/api/test_search_routes.py` and `e2e/specs/project-search.spec.ts`.


Where: `frontend/src/panes/editor-setup.ts:33`, and the absence of any search
route in `server/main.py`.

What a writer does now: renaming a label like `eq:flux` across a twelve
chapter thesis means opening twelve tabs and pressing the keys twelve times,
with no way to know which file was missed. Search is per document because
CodeMirror's panel is per document, and the server offers nothing else: there
is no search route of any kind, for any scope.

What they would do instead: one box that searches the project, results grouped
by file, and replace across all of them.

Cost: a route and a panel. `nexttex/symbols.py:47`'s `walk_project` already
walks the project with its exclusion rules, so the server half starts from
something that knows which files count. The tree's filter row is the visual
idiom to copy.

### ~~R-082 · Files rail · comfort · high · confirmed~~

**Built.** `Cmd-Alt-O` puts the caret in the filter row, unfolding the rail if it is folded. The input claims focus itself rather than being focused on a timer, because the tree is unmounted while the rail is folded.
Held by `e2e/specs/navigation.spec.ts`.


Where: `frontend/src/panes/FileTree.tsx:927` and the global keymap at
`frontend/src/App.tsx:1147`.

What a writer does now: to open a file by name, they take a hand off the
keyboard, find the rail, unfold Files if it is folded, press the magnifier,
and type. The pieces of a quick-open are all there and none of them has a key:
the filter row, `searchTree` at `FileTree.tsx:430`, and Enter opening the
first match at `:927`.

What they would do instead: one shortcut from anywhere in the app that puts
the caret in that box.

Cost: a line, if it focuses the filter row that exists. The app's global keys
today are `Cmd-B`, `Cmd-S`, `Cmd-Enter`, `Cmd-Alt-A`, `Cmd-Alt-P` and Escape,
so there is room.

### ~~R-083 · Editor · comfort · high · confirmed~~

**Built.** Next, previous, close and reopen, on `Cmd-Alt` with the brackets, W and Shift-T. The arrows went first and reached the browser on neither desktop: GNOME and a Mac browser both claim them. The closed list is capped at twenty and comes from what `afterClosing` has always returned.
Held by `frontend/src/tabs.test.ts` and `e2e/specs/navigation.spec.ts`.


Where: `frontend/src/tabs.ts:16` and `frontend/src/App.tsx:534`.

What a writer does now: every tab change is a trip to the strip with the
mouse. There is no next or previous tab, no numbered tab, no close, and a tab
closed by mistake cannot be brought back. `afterClosing` computes the new
strip and hands back the path that was closed, and `App.tsx:534` throws that
path away.

What they would do instead: next, previous, close, and reopen the last closed
tab, from the keyboard.

Cost: a line each in the App keymap and one array for the closed stack. The
arithmetic is already in `tabs.ts`, including the returned path.

### ~~R-084 · References · comfort · high · confirmed~~

**Built.** `POST /library/add` is the resolve route with the paper taken out, and `POST /library/verify` puts the agent's checker in front of a writer. Both are in the Papers section, which now appears for any project with a bibliography rather than only for one that has imported a folder.
Held by `tests/api/test_library_routes.py` and `e2e/specs/papers.spec.ts`.


Where: `nexttex/references.py`, reachable from the interface only through
`server/main.py:2402`.

What a writer does now: the README calls working without an agent "a real
option, not a degraded one", and then describes two things that are agent
tools and nothing else. Adding an entry by DOI goes through `/library/resolve`,
which needs an unidentified PDF from a folder scan to hang the DOI on, so a
writer who simply has a DOI cannot use it. Re-checking a bibliography against
the publisher's record is called from `nexttex/agent.py:1683` and from nowhere
in the interface at all.

What they would do instead: paste a DOI on the `.bib` row and get the entry.
A "Check these against their records" control beside "Add papers from a
folder".

Cost: a route and a control each, where the route is the resolve route with
its paper lookup removed. `entry_for`, `appended` and `verify` are written and
tested, and `server/main.py:2402` already writes the entry, records a version
and tells the collaboration layer.

Confirmed against the network: `entry_for("10.1038/nature14539", "")` returned
a tidied entry keyed `LeCun2015deep` in 86 ms, and a DOI that does not exist
came back as a `LookupError` naming it rather than as an invented entry. The
path works; nothing in the interface reaches it.

### R-085 · Editor · comfort · high · confirmed

Where: `frontend/src/api.ts:63` and `:64`, with
`frontend/src/panes/math-hover.ts:215`.

What a writer does now: to see what `fig:flux` is, they search for
`\label{fig:flux}` by hand. Hovering a citation key says nothing. `\input` and
`\include` are not a way to open the file they name.

What they would do instead: Ctrl-click a `\ref` to jump to its label,
Ctrl-click an `\input` to open that file, hover a `\cite` key to see title,
author and year.

Cost: a control for the jump, a branch in a tooltip that is already installed.
Labels already arrive as `{name, file, line}` and citations as
`{key, type, title, author, year}`, `openFile(path, line)` already exists, and
`math-hover.ts:215` already registers a `hoverTooltip` over the same symbols
object and returns null at `:222` for everything that is not maths.

### ~~R-086 · Preview · comfort · high · confirmed~~

**Fixed.** The strip says "references pending" beside the scope when a fast pass
left an unresolved reference, and a Rebuild everything press appears beside the
modifier that was the only way to ask for one. Held by
`frontend/src/panes/status-dot.test.ts`.

Where: `nexttex/project.py:170`, `frontend/src/panes/Status.tsx:129` and
`:152`.

What a writer does now: a fast build leaves `??` where a reference should be.
`mark_warnings` is false by default, the diagnostics drawer never opens
itself, so the only thing on screen is a warning count in the editor's strip,
a pane away from the page showing `??`. The build that fixes it is a
Shift-click on a button labelled "Rebuild", and the only place that is written
down is a `title` attribute, in a segment that is dropped below a 420 pixel
pane. `Status.tsx:129` reads `result.scope` on its own, so a fast pass over
the whole document says "Whole document" with nothing saying that biber did
not run.

What they would do instead: the preview says that references have not settled
yet, where the page is, with the rebuild-everything press beside it, and a
real menu item rather than a modifier nobody can discover.

Cost: a line for the label and a control for the menu item. `CompileResult`
already carries `enginePass` and nothing renders it; `nexttex/explain.py:128`
already holds the English for the per-reference warning and `:136` for the
summary; `nexttex/compile.py:604`'s `pdf_is_complete()` already knows, and its
only consumer is the download route.

### R-087 · Diagnostics · comfort · high · confirmed

Where: `server/main.py:3229` and `frontend/src/panes/Diagnostics.tsx:208`.

What a writer does now: reads chktex in chktex's own words. "Delete this space
to maintain correct pagereferences" is shown verbatim, and expanding the row
shows nothing at all, because the drawer renders `explain` and `context` and a
chktex row carries neither. This is every one of the roughly thirty-five
enabled warnings, not some of them: `explain.py`'s twenty-four rules all match
LaTeX log wording. The README promises "Errors explained in English" two
sentences above.

What they would do instead: the treatment the LaTeX log already gets, a title,
what it means, what to do.

Cost: a table of about thirty-five entries and one call. `explain.py:33` is
the shape to copy, and the warning's own number is already parsed out of
chktex's `-f` format at `server/main.py:3229` and then discarded, so the
lookup can key on a number rather than on English prose that upstream may
reword. Worth knowing while there: the rc file is read from the install
directory at `main.py:3193`, so a project cannot carry its own and there is no
way to silence one warning.

### R-088 · Preview · comfort · medium · confirmed

Where: `frontend/src/panes/Pdf.tsx:254` and `:237`.

What a writer does now: a hundred typeset pages with selectable text on them,
and no way to find a word. Ctrl-F reaches CodeMirror only.

What they would do instead: a find box in the preview footer that steps
through hits and scrolls to them.

Cost: a control, and a pass that collects the text. pdf.js's own find
controller ships with its viewer and is not worth pulling in for this.
`Pdf.tsx:254` already builds a `pdfjs.TextLayer` per page and `:158` holds the
document proxy. The catch is that layers are built only for visible pages, so
a search has to walk the document once rather than read the DOM.

### R-089 · History and git · comfort · medium · confirmed

Where: `frontend/src/panes/GitPanel.tsx:200` and
`frontend/src/panes/Editor.tsx:853`.

What a writer does now: "See what changed" is one of the four git buttons the
README names, and what it shows is a status letter and a path. Clicking a row
opens the file. In the history, "Show what's gone" shades the lines the old
version had and this one does not, never shows what arrived, and two versions
cannot be compared with each other at all.

What they would do instead: a real patch in both places.

Cost: a control each. `diff` is already a dependency, `diffLines` is already
used, and the agent's edit chip at `Chat.tsx:1598` already renders a unified
diff with per-line colour. This is not a git client creeping in: branching and
merging stay in the terminal, and seeing what changed is a promise the README
has already made.

### R-090 · Agent · comfort · medium · confirmed

Where: `frontend/src/panes/prose.tsx:167`, `server/main.py:3399` and
`frontend/src/panes/Chat.tsx:756`.

What a writer does now: nothing in the agent's answer can be copied. A code
block is a bare `<pre>`. There is no copy on a message, no search over the
conversation and no export. "New conversation" files the old one away under a
timestamp, the server returns the filename it used, and the browser discards
it. No route lists the archives, so a past conversation is reachable only by
opening `.nexttex/transcript-*.jsonl` by hand.

What they would do instead: copy on a code block, and a list of past
conversations that can be reopened and read.

Cost: a line for the copy control; a route and a small panel for the archives.
`server/transcript.py:95` already names and prunes them, the reset response
already carries the filename, and `store.ts:375` already knows how to render a
replayed transcript.

This one is also a `docs` finding. `docs/design.md:508` specifies "copy
affordance on hover only" for code blocks in messages. Section 8, which
records what the audit changed, records no decision to drop it. It was
specified and never built.

### ~~R-091 · Editor · comfort · medium · confirmed~~

**Built, except the locale.** Up to four suggestions above the dictionary item, by edit distance against the list already loaded, and the accepted words listed in Settings with a way to forget one. The second locale is in the `TRACKER.md` backlog with its reason: it is a design question about two lists, a setting, and what a shared project does when its two writers disagree, rather than a control in front of something that exists.
Held by `frontend/src/panes/spell-suggest.test.ts` and `e2e/specs/spelling.spec.ts`.


Where: `server/main.py:2563` and `frontend/src/api.ts:530`.

What a writer does now: an underlined word offers exactly one thing, "Add to
the dictionary". No suggestion, no ignore-once, and no way back. `DELETE
/dictionary` exists, `api.forgetWord` exists, and nothing anywhere calls it,
so a word added by mistake is added for good. The word list is `wamerican`
only, so a thesis written in British English is underlined from end to end.

What they would do instead: three or four suggestions in the same menu, the
accepted list in Settings with a way to remove one, and a second locale.

Cost: a control for the list, edit distance over the word list for the
suggestions, a second `words.txt` for the locale. The route and its client
wrapper are both already written.

### ~~R-092 · Editor · comfort · medium · confirmed~~

**Built.** `$` is in the language's own closing-bracket set, and Enter after a `\begin{x}` writes the block when the document is short an `\end{x}`.
Held by `frontend/src/panes/close-environment.test.ts` and `e2e/specs/writing.spec.ts`. The existing test for a half-written equation now makes that state deliberately, since typing one no longer produces it.


Where: `frontend/src/panes/editor-setup.ts:398` and
`frontend/src/panes/latex-complete.ts:299`.

What a writer does now: types the two things a LaTeX writer types most, and
neither closes itself. `closeBrackets()` is installed with its default set,
which is `( [ { ' "`, so `$` does not pair and `$$` does not either. A
`\begin{figure}` typed by hand never produces its `\end{figure}`; that happens
only if the completion is accepted.

What they would do instead: `$` pairs like a bracket, and Enter after a
`\begin{x}` writes the `\end{x}`.

Cost: a line for the bracket configuration, since `closeBrackets` takes a
`brackets` option, and a small input handler for the environment. The
completion already knows how to build the pair.

### ~~R-093 · Files rail · comfort · medium · confirmed~~

**Built.** The History header carries a This file / Whole project toggle, and the project list is the same rows with the file each belongs to. Choosing one opens that file and puts the panel back on This file, so everything else the panel does still applies to it.
Held by `e2e/specs/history-trash.spec.ts`.


Where: `server/main.py:1988`, `GET /history/timeline`.

What a writer does now: to answer "what did I change this afternoon" they open
every file in turn, because History is per file.

What they would do instead: a project-wide stream of versions, newest first.

Cost: a control. The route is written, takes a limit from 1 to 500 and returns
every file's versions, and has no client wrapper and no caller. The History
panel's row rendering is reusable as it stands.

### ~~R-094 · Diagnostics · comfort · medium · confirmed~~

**Built,** all four parts. F8 and Shift-F8 step, a filter appears when more than one document is previewed, every row has a Copy, and the raw log opens inside the expanded row over a new route. Nothing became a console, which is what §7 rules out.
Held by `tests/api/test_diagnostics_and_switches.py` and `e2e/specs/navigation.spec.ts`.


Where: `frontend/src/panes/Diagnostics.tsx`, `frontend/src/store.ts:577` and
`nexttex/project.py:387`.

What a writer does now: the drawer answers nothing but a click. There is no
key that steps to the next error, a click expands the row and jumps at once
with no way to do one without the other, and there is no filter, though
`store.ts:577` merges every previewed document's diagnostics into one flat
list. A message cannot be copied. The full latexmk log is unreachable: there
is no route for it, and `build/` is excluded from the tree even though `.log`
is a text kind the editor would open.

What they would do instead: next and previous error from the keyboard, a
one-document filter when more than one thing is previewed, copy on a row, and
"Show the raw log" inside the expanded row.

Cost: a line for the keys, a control for the filter, a route for the log. The
drawer already renders `item.context`, a few lines of the log, in exactly the
place a longer one would go. `docs/design.md` section 7 rejects a bottom
console with Problems, Output and Terminal tabs, and keeping all of this
inside the drawer is the version of it that respects that.

### ~~R-095 · Git · comfort · medium · confirmed~~

**Built.** The first-run card asks the question the project is actually in: with no repository it leads with "Keep versions here" over the `init` action the route has always taken, and offers GitHub second.
Held by `e2e/specs/git.spec.ts`.


Where: `server/main.py:2801` and `nexttex/gitrepo.py:143`.

What a writer does now: a project with no git repository is shown the GitHub
wizard, because the panel only ever sends commit, push and pull. So the local
half of version control, which needs no account and no network, is reachable
only by going to a terminal.

What they would do instead: one button that makes the repository.

Cost: one control. The route already takes four actions and
`gitrepo.initialise` already writes the first commit and the `.gitignore` the
README describes.

### ~~R-096 · Projects · comfort · medium · confirmed~~

**Built.** Four templates, chosen on the create row and written before the project opens. The chooser hides itself when an install has only one, and names each template by what it is rather than by its directory.
Held by `tests/api/test_templates.py` and `e2e/specs/projects-form.spec.ts`.


Where: `server/main.py:2877` and `frontend/src/api.ts:489`.

What a writer does now: every new project is an article. `GET /api/templates`
lists the directories under `nexttex/templates` and there is one of them, and
both callers of `loadTemplate` pass no name, so the list is never fetched at
all.

What they would do instead: choose from article, report, beamer and letter
when the project is made.

Cost: a control, and four directories. The route, the list and the parameter
are already there and already unused.

### ~~R-097 · History · comfort · low · confirmed~~

**Built.** The purge says what it freed as well as what it deleted, and the panel's header says what the history is holding before anybody decides. One formatter, in `frontend/src/size.ts`, rather than the two that would have rounded the same number two ways.
Held by `frontend/src/size.test.ts` and `e2e/specs/history-trash.spec.ts`.


Where: `frontend/src/api.ts:468`, with `/history/size`.

What a writer does now: empties the version history and is told "Deleted N
versions". The response also carries how many bytes that freed and the
interface drops it, and `/history/size` has a client wrapper and no caller, so
the one number a person emptying something wants is the one number withheld.

What they would do instead: see what it freed, and see what it is holding
before deciding.

Cost: two lines.

### ~~R-098 · Preview · comfort · low · confirmed~~

**Built.** A Save in the preview footer, pointed at the PDF that is already rendered, with no rebuild.
Held by `e2e/specs/pdf-zoom.spec.ts`.


Where: the app header's download menu, against `frontend/src/panes/Pdf.tsx`.

What a writer does now: to save the page they are looking at, they go to the
header menu, whose PDF item forces a full server rebuild first. There is no
download in the preview footer, beside the PDF that is already rendered and
already on disk.

What they would do instead: save this, from here, without rebuilding it.

Cost: a control.

### ~~R-099 · Preview · comfort · low · confirmed~~

**Built.** The steppers and a page box are in both modes, and the zoom is remembered beside the mode. Naming a page in scroll mode scrolls to it and lets the scroll handler say which page that is, so the two answers cannot disagree.
Held by `e2e/specs/pdf-zoom.spec.ts`.


Where: `frontend/src/panes/Pdf.tsx:939` and `:1008`.

What a writer does now: in the scrolling mode there is no way to reach page
74. Next page, previous page and the arrow keys are all gated on
`mode === "page"`, and the page readout is never an input. Zoom is not
remembered between sessions either, though the view mode is.

What they would do instead: type a page number in either mode, and find the
zoom where it was left.

Cost: a line for the gate, a control for the readout, a line for the
persistence beside the one that already saves the mode.

### ~~R-100 · Editor · comfort · low · confirmed~~

**Built.** Four scopes, remembered, and the strip says which. Counted by texcount over a range of lines rather than by a second counter in the browser, because two counters disagreeing on the same prose is worse than two scopes.
Held by `frontend/src/words.test.ts`, `tests/api/test_diagnostics_and_switches.py` and `e2e/specs/toolbar.spec.ts`.


Where: `frontend/src/App.tsx:199`.

What a writer does now: reads a word count that is two numbers, forgets which
of the two they chose the moment the app reloads, because the scope is plain
`useState`, cannot count a selection, cannot count a section, and loses the
segment entirely below a 640 pixel pane.

What they would do instead: count what is selected, count the section, and
find the choice where it was left.

Cost: a line for the persistence, a control for the scope.

### ~~R-101 · Agent · bug · low · confirmed~~

**Fixed with R-108.** An answered card is folded into its tool row, so the command
appears once. An open card keeps its own row, because it has four buttons on it.

Found by: the live sessions on Sonnet, then read back in the code. Where:
`frontend/src/panes/Chat.tsx:1742`, `:1308` and `:1800`.

What happens: every shell command the agent runs is printed twice in the
panel, and three times while its card is still open. Once in the tool row,
where the verb is "Ran" and `frontend/src/store.ts:1114` makes the summary the
command itself; once in the resolved row underneath, where `item.detail` is
the command, set at `nexttex/agent.py:789`; and once in the open card while it
waits for an answer.

From a real turn here, verbatim:

```
Ran
grep -n "Discussion" -i main.tex | head -20
Allowed
grep -n "Discussion" -i main.tex | head -20
```

Expected: the command once, with what happened to it. `docs/design.md` section
28 puts the resolved permission under the tool row precisely so the pair reads
as one event.

Mechanism: `tidy()` at `Chat.tsx:41` already collapses a tool row into a tool
row and a permission into a permission. It has no case for a permission
against the tool row it belongs to, which is the one pair that always arrives
together.

### Proposed and rejected, on the record

Four things a Jupyter user might expect were considered and are not proposed,
because this repository has already decided them and the reasons still hold.
Selection verbs on a Sections row are refused in `docs/design.md` section 28
and in `TRACKER.md`. A bottom console with Problems, Output and Terminal tabs
is refused in section 7, and so is a spinner or a tick on a build. Comments,
suggestions and tracked changes are refused in the README's "What it is not".
Branching and merging in the git panel are refused in the README, and the
terminal is better at both.

### Collaboration across two real machines

Everything in this section was found by the user's Windows laptop, driving the
real interface in Chrome over the DevTools protocol against a share from this
machine. It is the only part of the review that had a second computer, a second
operating system and a real network in it, and it produced four findings that
nothing on one machine could have reached. The join itself worked: 2.30 seconds
from pressing Join to the file list, on the first attempt, with no retry.

### ~~R-103 · Collaboration · bug · high · confirmed~~

**Fixed, and the record was right about the mechanism after all: this is the binary
gap.** An extensionless name is text now, in one `kind_of`, matching the rule the
interface always had. And accepting projects every record, because a document that
arrived empty produces no change for the observer to see and so was never written.

Found by: the Windows laptop, joining a share over the real network. Where:
whichever side builds the offer, `server/main.py:946` and the manifest walk
behind it.

What happens: the offer card counted four files and three of them arrived. The
one that did not is `figures/.gitkeep`, and the `figures` directory does not
exist on the joiner's disk either. A file was named on the card, the writer
accepted it, and it is not there.

```
card:            4 files, 3 kB
                 figures/.gitkeep   0 B
                 main.tex           3 kB
                 nexttex.toml       211 B
                 references.bib     210 B
on disk after accept:
                 main.tex           1076 bytes
                 nexttex.toml        217 bytes
                 references.bib      218 bytes
                 figures/.gitkeep    MISSING, and figures/ does not exist
```

Expected: what the card lists is what arrives, or the card says which of them
will not.

Mechanism, as the laptop read it and as the evidence supports: an empty
directory is carried only by the file inside it, so a zero-length file whose
only job is to exist is exactly the case that goes missing if directories are
implied by file paths somewhere in the transfer. A path with nothing behind it
has nothing to imply the directory from.

This is adjacent to the known binary gap and is not the same thing. The binary
gap is a name with nothing behind it. This is no name at all, and the count on
the card is the number offered rather than the number that will exist. That
project had no real binaries in it, so the binary gap itself is still
untested across two machines.

### ~~R-104 · Collaboration · bug · medium · confirmed~~

**Fixed, with the record's mechanism corrected.** It is not the CRDT document's
size: `size` is written once when the sharer first adopts a file and never
refreshed, so the card quoted a number from whenever the project was first shared.
It is measured from the body that arrived. The line endings are the sender's and the
card says so.

Found by: the Windows laptop, comparing the offer card against the disk.
Where: the offer the join builds, against `frontend/src/panes/Projects.tsx`.

What happens: none of the three sizes on the offer card is the size of the
file that lands.

| file | card | on disk |
|---|---|---|
| `nexttex.toml` | 211 B | 217 B |
| `references.bib` | 210 B | 218 B |
| `main.tex` | 3 kB | 957 B |

The first two are line endings. Every line on the laptop's disk ends CRLF, the
deltas are exactly plus six and plus eight, and the card is showing the Linux
side's LF byte count. So the number a Windows writer is shown before they
accept is a number they can never have.

`main.tex` is a different mistake and a larger one. 3679 bytes is the size of
the CRDT document `f67098301b6788c1.y` in the joiner's own `.nexttex/collab`
directory, and 957 is the file. The card is measuring the document rather than
the text, on the one file in the project big enough for the two to differ
visibly.

Expected: a size on an offer card is the size of the thing being offered.
"3 kB" for a one kilobyte file is wrong by a factor of three on the only row a
person is likely to read.

### ~~R-105 · Collaboration · bug · high · confirmed~~

**Fixed with R-121 and R-126.** The store keeps the share the editor was already
fetching, and the tab strip has a third branch for a member who has joined and is
not connected.

Found by: the Windows laptop, typing in a shared file while somebody else was
in it. Where: `frontend/src/panes/Collaborators.tsx`.

What happens: the joiner was never shown that anybody else was there. No
cursor, no name, no avatar, and `[data-testid="collaborators"]` absent from
the DOM entirely, through a session in which both sides were editing the same
file and the edits were propagating in both directions.

`Collaborators` returns null when there are no people **and** the connection is
not offline. So the only positive evidence the laptop had that its socket was
up was the absence of the offline badge, which is the weakest possible signal:
"connected, and nobody is here" and "connected, a peer is here and is not
being drawn" are the same empty space on screen.

Expected: the share panel answers the one question a person joining a share
actually has, which is whether the other person is there. `docs/design.md` §22
describes presence as part of what the panel is for.

Evidence, in the laptop's words: "I could not tell you from this interface
whether you were there." The edits were arriving the whole time.

Mechanism: a component that renders nothing for the empty case, in a panel
whose entire subject is who else is present, makes absence and failure
identical. It is the same shape as the several latches this review found
elsewhere, one state standing in for two.

Sharpened by a second run on the laptop. After a page reload it did see a
remote caret, labelled `d-laptop`, belonging to its own previous client which
had not yet expired. So the caret and the label machinery work and render
correctly. What never appeared was the real remote peer. Presence is built; it
is a live peer across the network that does not produce one. R-121, which
found that the interface's idea of "connected" describes the browser's own
socket and not the peer link, is very likely the same fault seen from the
other side.

### ~~R-106 · Appearance · bug · medium · likely~~

**Fixed.** Both shot suites take the ratio from `NEXTTEX_SHOT_DPR` and name the files by it. The laptop reports the ratio is not constant on that machine either: Chrome came back at 2 on the same display the next day, so 1.25 is one of at least two values and the fractional one is the untuned one.

Found by: the Windows laptop, reporting its own display. Where: the text
clarity work in `docs/design.md` and `e2e/shots/text-clarity.spec.ts`.

What happens: the laptop renders at a device pixel ratio of 1.25, because the
Windows display is at 125 percent scaling, which is the ordinary default on a
laptop of that class. Every screen in this repository has been photographed
and tuned at a ratio of 1 or 2. `e2e/shots/text-clarity.spec.ts` carries
variants named `-1x` and nothing else.

Why it matters here rather than in general: the clarity work in this
repository is specifically about whole-pixel alignment, gutters and hairlines,
and a fractional ratio is where whole-pixel reasoning stops holding. A rule
that lands on a pixel boundary at 1 and at 2 lands between pixels at 1.25.

Recorded as `likely` rather than `confirmed` because nothing here has
photographed it. The finding is that the class of surface has never been
looked at, which is certain; what it looks like is not.

Cheap to settle: the sweep and clarity specs take a `deviceScaleFactor`, and
adding 1.25 to them is a line.

### ~~R-107 · Preview · bug · high · confirmed~~

**Fixed with R-044**, which is what this record corroborates from Windows.

Found by: the Windows laptop, on the first screen a joining writer sees. This
is R-044 on a second machine and a second platform, so it is recorded as
corroboration rather than as a new finding, and the number is kept here so the
fix plan sees both.

What happens: the preview said "Nothing has been typeset yet. An empty
document produces no pages." while `build/main.log` and the rest of the
latexmk output were already on disk and the document plainly was not empty.
The status strip beside it said "3 errors" at the same moment.

So the same screen carried two statements that cannot both be true, and the
one a person reads first is the wrong one. On this machine the same thing
happens for the whole of a project's first build. On the laptop it is the
first thing a joining writer sees, which is worse, because they have nothing
else to compare it with.

### ~~R-120 · Update · bug · high · confirmed~~

**Fixed.** The report carries `checked`, false until the fetch has actually
happened, and the footer asks that before it reads any number. The update route's
refusal carries git's own words after the reason. Held by
`tests/api/test_update_check.py`.

Found by: the Windows laptop, then verified in the source here. Where:
`nexttex/updates.py:219` with `frontend/src/panes/UpdateFooter.tsx:345`.

What happens: an update check that never reached the network is drawn as
**Up to date.**

On the laptop, `/api/update` answers:

```
"can_update": false,
"reason":     "Could not reach the repository.",
"error":      "fatal: unable to access 'https://github.com/...': Could not resolve host: github.com",
"behind":     0,
"restart":    "manual"
```

`check(root)` sets `error` and `reason` and returns early, before
`report.behind` is ever assigned, so `behind` keeps the dataclass default of
zero. The footer then does this and nothing else:

```tsx
if (!report.checkout) return null;
if (report.behind === 0) {
  return <Line><span>Up to date.</span> ... </Line>;
}
```

Nothing between those two lines reads `report.error` or `report.reason`. There
is a "Could not reach the repository." card at `UpdateFooter.tsx:265`, and it
belongs to `phase.kind === "error"`, which is the request itself failing. A
report that arrives successfully carrying an error is not that phase, so the
card never shows.

At 16:52:58 the laptop's forced check failed, reported `behind: 0`, and the
footer said "Up to date." while `git ls-remote` from a shell on the same
machine showed master at `5d366f6` and the install was on `94bf8c0`. Genuinely
behind, told it was current, by a check that never reached the network.

The second half is worse. `server/main.py:3633` refuses the update when
`can_update` is false, with 400 "There is nothing to update", so the update
cannot be started from the page at all on that machine. The documented
recovery, the page, is the one path closed.

Mechanism: one number carrying two meanings. Zero commits behind and no answer
about how many commits behind are the same value, and the field that would
distinguish them is in the same object and is not read. This is mechanism 2 in
the grouping below, with the largest consequence of any instance of it.

Why the server cannot resolve a host a shell on the same machine can is not
established and is not this finding. The laptop's reading, unproven, is that
the server re-execs into the Store Python, an MSIX package, and the git
subprocess inherits that sandbox. What is established is that when the check
fails for any reason, the footer says the install is current.

### ~~R-121 · Collaboration · bug · high · confirmed~~

**Fixed.** The peer link is drawn as its own badge, separately from the browser's
socket to its own server, because both can be true at once. Held by
`frontend/src/panes/peer-standing.test.ts`.

Found by: the Windows laptop, reasoning about what it could not test. Where:
`frontend/src/collab.ts:157` with `:318`.

What happens: the word the interface uses for whether collaboration is working
describes the wrong connection. `connection` is derived from
`new WebSocket(\`${scheme}://${location.host}${this.url}\`)`, which is this
browser to its own server. The peer link, the iroh leg that actually carries a
collaborator's edits, is not in it.

So a laptop that loses its internet while its browser keeps reaching localhost
shows nothing. No badge, no warning, an entirely live-looking interface, and
the other person's edits silently stop arriving. Both sides keep typing into
what each believes is a shared document.

Expected: a share panel says whether the share is working. `docs/design.md`
§22 describes the panel as reporting the connection, and the connection a
writer means is the one to the other writer.

This is the honest answer to the question this review set out to ask, which
was what "not connected" looks like on a real network. It looks like nothing.
The experiment would have shown an unchanged screen, which is why the laptop's
reasoning is better evidence than the test would have been.

### ~~R-122 · Update · bug · medium · confirmed~~

**Fixed.** With R-042. The task name is one default shared with `register-task.ps1`.
Held by `tests/test_cross_platform.py`.

Found by: the Windows laptop, running `scripts\update.ps1` for real. Where:
`scripts/update.ps1:62`, with `scripts/register-task.ps1`.

What happens: the update reports success when the last thing it promised did
not happen. R-042 said the restart branch is skipped on a Startup-folder
install. This is that run, and the part R-042 could not know is the exit code:

```
Restarting
  not running as a scheduled task; restart it yourself

exit code 0, 52 seconds
```

The pull and the interface fetch both worked, `94bf8c0..f2296b4`. The process
serving port 8450 afterwards was the same one from an hour before. The
script's own synopsis says it will "pull, reinstall dependencies, rebuild,
restart", and it exits zero having done three of the four.

There is a second, smaller mistake beside it. The check is
`Get-ScheduledTask -TaskName 'NextTex'`, and the installer registers its
Startup entry under `nexttex`, lowercase. On this machine there is no task
under either spelling so the else branch is the whole story, but an install
that did register one could miss on the name.

Expected: a step that did not happen does not exit zero, and the one word a
script uses for a thing it created is the word it uses to look for it.

### ~~R-123 · Interface · bug · high · confirmed~~

**Fixed.** The sentence is on the screen beside the word offline rather than in a
`title`, and the reload that used to take the page out from under it is gone with
R-040.

Found by: the Windows laptop, which is R-040 on a second platform, and adds
the part that makes it worse. Where:
`frontend/src/panes/Collaborators.tsx` with `frontend/src/Boundary.tsx:36`.

What happens: the app promises to keep what you type, and then throws away the
page that was keeping it.

With the server stopped at 17:05:35, the badge appeared. Its visible text is
one word:

```
visible text : offline
tooltip only : "Not connected. What you type is kept here until it is."
```

The sentence that says what happens to a writer's typing is a `title`
attribute. It is not on the screen, it is not reachable by touch, and a
screen reader reaches it only as the badge's own name.

By 17:09:25, about four minutes later, the tab had navigated itself away:

```
url   : chrome-error://chromewebdata/
title : 127.0.0.1
text  : This site can't be reached / ERR_CONNECTION_REFUSED / Reload
```

`.cm-content` was null. The editor and everything in it were gone. Whatever
had not reached the server went with them.

So the sequence a writer meets is: the app says your typing is kept here until
it reconnects, and then the error boundary reloads the tab onto the browser's
own error page, which is the one place it cannot be kept. R-040 is the reload.
This record is the promise it breaks.

The laptop could not finish its type-while-offline test because the reload
took the editor before the typing was done, which is itself the answer: typing
keeps working until the page stops existing.

Nothing was lost in this run, because nothing had been typed into the gap.
`main.tex` was intact at 1181 bytes afterwards and the other two files were
byte-identical to what had arrived.

### ~~R-124 · Update · docs · low · confirmed~~

**Fixed.** Both update scripts write `update.log` beside `install.log`.
Held by `tests/test_cross_platform.py`.

Found by: the Windows laptop, looking for a log that does not exist. Where:
`scripts/update.ps1`.

What happens: an update run from a shell records nothing to disk. The script
writes to the console only, and a grep across `server/`, `scripts/` and
`nexttex/` finds no update log anywhere. Run from the page the output goes to
the update job's in-memory log and out through the stream endpoint, so it
lives as long as the tab is watching.

The install has `install.log` and it is the thing that makes an install
diagnosable after the fact. The update, which is the operation most likely to
leave a machine in a state its owner cannot explain, has nothing.

### ~~R-125 · Update · bug · low · confirmed~~

**Fixed.** With R-042: nothing has the files open when pip runs, and what earlier updates left is swept up.
Held by `tests/test_cross_platform.py`.

Found by: the Windows laptop. Where: the dependencies step of
`scripts/update.ps1`.

What happens: updating dependencies underneath a running server leaves a
broken directory behind on Windows, every time, and nothing ever removes it.

```
WARNING: Failed to remove contents in a temporary directory
'C:\Users\daksh\apps\NextTex\.venv\Lib\site-packages\~ycrdt'.
```

`~ycrdt` is still there. pip could not clean up because the running server had
the old compiled extension loaded and Windows will not delete a mapped file.
Nothing is broken, `pycrdt` 0.14.5 imports, and the litter accumulates one
directory per update for as long as the install lives.

This is the same root cause as R-122 from the other end: the script updates
the dependencies of a server it has decided not to stop.

### ~~R-126 · Collaboration · bug · high · confirmed~~

**Fixed.** A link being adopted or dropped publishes `collab_peers`, so a peer
arriving or going away is a transition rather than whatever the next four-second
poll catches. Held by a two-peer test that closes one side and asserts the other is
told.

Found by: the Windows laptop, watching its own screen while the share it was
joined to was shut down from this end. Where: `frontend/src/panes/Collaborators.tsx`
with `frontend/src/collab.ts:318`.

What happens: a collaborator leaving for good produces no change on screen of
any kind.

The laptop sampled once a second from 17:15:24 to 17:17:04, across the window
in which the sharing server here was stopped. Every sample was the same
object:

```
{offline: null, collaborators: null, caretLabels: [], editor: true}
```

No badge appeared. No collaborator element came or went. No caret label went
stale, greyed or was removed. The before and the after are identical.

So the peer-gone state is not a state. A writer whose only collaborator has
permanently gone, the server shut down, the project no longer shared, their
own copy now an ordinary folder of files, sees exactly what they saw while the
collaboration was live, and would go on typing into what they believe is a
shared document indefinitely.

Expected: the end of a share is the one moment a writer must be told about,
because it is the moment their typing stops going anywhere.

### ~~R-127 · Update · bug · medium · confirmed~~

**Fixed.** The restart line offers a restart, not a reload, and where nothing
would bring NextTex back it offers no control and says so in words. Held by
`tests/api/test_update_routes.py` on the route and by two browser tests in
`e2e/specs/update.spec.ts` on the line.

Found by: the Windows laptop, during the run, checking R-041's fix. Where:
`frontend/src/panes/UpdateFooter.tsx`, the `standingOf(self) === "restart"`
branch added for R-041.

What happens: the line reads "Updated on disk to 1d10915. Restart to run it",
and the only control beside it is Reload, which is
`onClick={() => window.location.reload()}`. On that line it is a dead end. The
page comes back from the same process, `head` is read once when that process
starts and cannot move while it runs, so the sentence that returns is byte for
byte the one that was just read. The laptop pressed it rather than only reading
the source and photographed both states:

```
before: Updated on disk to 1d10915. Restart to run it. | This process is still running f3493a8. | Reload
after : Updated on disk to 1d10915. Restart to run it. | This process is still running f3493a8. | Reload
```

The sentence asks for a restart and the button next to it is the one a reader
will take as the way to do that. It is the right control for every other state
the footer draws, which is how it came to be on this one.

Expected: the control does what the sentence beside it asks for, or there is no
control.

### ~~R-128 · Update · bug · low · confirmed~~

**Fixed.** git's own words are the thing that gives way on that line: they
truncate with the full text on hover, and the control no longer leaves the
strip. Held by a browser test that asserts the warning and the control share a
row when the error is a paragraph.

Found by: the Windows laptop, during the run. Where:
`frontend/src/panes/UpdateFooter.tsx`, the `!report.checked` branch.

What happens: the unreachable-repository line puts git's message next to Try
again, and git's message can be a paragraph. It wrapped to three rows and
carried the control down and out of the footer strip.

Expected: one row, whatever git said.

### The three collaboration findings are one thing

R-105, R-121 and R-126 are the same fault seen at three points of one
lifecycle, and the fix plan should take them together rather than one at a
time.

The interface has no representation of the peer link at all. It cannot show a
peer arriving, which is R-105, where a live remote peer never produced a caret
although a stale local one did. It cannot show a peer present, which is the
same record from the other side: absence and unrendered presence are the same
empty space. It cannot show a peer leaving, which is R-126. And the one badge
that does exist watches the browser's socket to its own server rather than the
peer link, which is R-121, and is why it stays silent through all three.

One connection is modelled and the other is not. Everything above follows from
that, and no amount of work on the three screens fixes it until the thing they
are trying to draw exists in the state.

### The visual sweep, eighty-eight images against the design document

`e2e/shots/sweep.spec.ts` renders every pane at four widths in both themes, and
its own header anticipates "a reviewer with the design document open". That is
how this section was produced: all eighty-eight images read against
`docs/design.md` sections 3, 4, 5, 6, 10, 19, 23, 25 and 28, with `2cf7861`, a
sweep of the same kind that found five things, read first as the method.

Ten findings, and a list of surfaces that came back clean, which matters as
much: the status strip at all four widths, the four breakpoints behaving as §4
describes them, every row height measuring what §5 specifies, and all five of
the round-two fixes from `d11da03` present and correct in the pixels.

### ~~R-108 · Agent · bug · high · confirmed~~

**Fixed.** The card carries the id of the call it is about, and the row above says
Running while the card is open, Ran once it was allowed, and Did not run when it
was refused. Held by `frontend/src/panes/tool-verb.test.ts`,
`tests/test_permissions.py` and a browser test that denies a command and asserts
the panel does not say it ran.

Found by: reading the sweep images against the design document, then matched
against this review's own live transcripts. Where:
`frontend/src/panes/Chat.tsx:1177`, the `VERBS` table, with the tool row drawn
on `tool_use`.

What happens: the panel says a command has been run, in the past tense, above
the card that is still asking whether it may run. Every verb in the table is
past tense, `Bash` is "Ran", `Write` is "Wrote", `Edit` is "Edited", and the
row is drawn the moment the tool call arrives rather than when it is
permitted.

If the answer is Deny, the transcript keeps both. From a real turn in this
review, on Sonnet, verbatim:

```
Ran
find .../paper -maxdepth 2 -type f -name "*.tex"
Denied
find .../paper -maxdepth 2 -type f -name "*.tex"
```

Nothing ran. The panel says it did, and the panel is the audit trail.

Expected: a tool row drawn before an answer says what is being asked for, not
what has happened. `docs/design.md` §28 gives its worst-finding subsection to
the record inverting fact, which is exactly this.

Evidence: `13-card--light--1600.png` and its dark twin, `14-card-hover-allow`,
`15-card-hover-always`, `25-card-four-answers`, `26-card-conversation-scope`,
in both themes, all show `Ran <command>` above a card headed "Run a shell
command" carrying the same command.

Mechanism: one verb table serving two moments. For `Read` the tense is
harmless. For `Ran`, `Wrote` and `Edited` it is a false statement about
something the writer is at that second being asked to authorise, and it
survives into the record if they say no.

This is the sharper half of R-101, which is about the same rows being printed
twice. R-101 is tidiness; this one is the transcript saying a thing happened
that did not.

### ~~R-109 · Appearance · accessibility · high · confirmed~~

**Fixed.** The furniture block redeclares the three tokens derived from the inks it moves.
Held by `frontend/src/contrast.test.ts`, structurally: a block that moves an ingredient moves the mixture.

Found by: the sweep, measured off the pixels, then verified in the stylesheet
and recomputed here. Where: `frontend/src/styles.css:191`, `:192` and `:193`,
against the furniture block at `:243`.

What happens: every border, separator and drag handle in the light theme's
furniture is drawn at roughly half the contrast it is drawn at in the dark
theme, on the identical background.

| | light | dark |
|---|---|---|
| status strip's top border on `--surface-2` | 1.44:1 | 2.56:1 |
| composer separator on `--surface` | 1.32:1 | 2.34:1 |

`--line`, `--pen-wash` and `--hint-wash` are declared once, on bare `:root`,
as `color-mix` over `--ink-3`. The block at `:243` that gives the furniture
the dark palette in a light theme redeclares the surfaces, the inks, the
accents and the syntax hues, and does not redeclare those three. A custom
property is substituted where it is declared, so `--line` resolves against the
light `--ink-3` and the `.nx-furniture` subtree inherits the already-resolved
colour. `0.55 x 78 + 0.45 x 30 = 56`, which is the red channel the pixels
show.

Expected: `docs/design.md` §23 records this exact class of bug for `color` and
says "anything else handed a palette by a class needs the same line". `--line`
did not get it. §10 records the state after the second audit as "about 2.4:1
in light", and that is no longer true of the rail, the agent column, the
status strip, the diagnostics drawer, the folded spine, every floating card
and `.nx-handle`.

Why no test caught it: `frontend/src/contrast.test.ts` parses the tokens out
of the stylesheet and computes what they are meant to be, so it arrives at
2.58 and cannot see that the browser resolved something else.

Mechanism: a derived token declared in one place and a palette overridden in
another. §23's argument that reusing the dark palette creates no new pairs
holds for every token it redeclares and fails for the three it does not.

### ~~R-110 · Agent · bug · medium · confirmed~~

**Fixed.** The spacer is drawn only when there is no activity line to push Stop for it.
Held by `e2e/specs/chat-layout.spec.ts`.

Found by: the sweep. Where: `frontend/src/panes/Chat.tsx:445` and `:488`.

What happens: the one line that says what the agent is doing right now
truncates to `Read chapte…` with about a hundred pixels of empty space beside
it. The working span is `min-w-0 flex-1` and a bare `<span className="flex-1" />`
sits after it, so two flexible siblings split the free space and the line that
carries the text gets half the room that is there.

Evidence: `11-working-tool--light--1600.png` and its dark twin,
`23-turn-plan--*`.

Expected: the activity line is the only thing on screen during a turn that
says what is happening, and it has the room.

### ~~R-111 · Interface · bug · medium · likely~~

**Confirmed and fixed.** The hit zone overhangs into the editor, which paints in a later stacking context, so the press never reached the handle.
Held by `e2e/specs/layout.spec.ts`, which drags the handle and asserts the rail moved and nothing was selected.

Found by: the sweep, from two shots that should have differed and did not.
Where: `frontend/src/chrome.tsx:287`, with `frontend/src/App.tsx:880`.

What happens: dragging the rail's handle resizes nothing and selects text in
the editor instead. `31-rail-dragged-wide` shows the rail at the same 240
pixels as the shot before it, and the only difference between the two images
is a text selection inside the editor, bounding box (253,43) to (653,996),
identical in both themes.

The press did not reach the handle at all. `App.tsx:880` adds
`body.nx-dragging` on pointerdown precisely to stop this, and its comment
names the older bug, which "left the status strip and the gutter highlighted
afterwards". The chat handle in the shot before crossed six hundred pixels of
selectable PDF text layer, resized correctly and left no selection, so the
mechanism is not general.

Likely cause, inferred rather than proven: the handle is drawn as a `w-px` div
whose nine pixel hit zone is a child span at `-left-1`, so the right half of
that zone overhangs into the CodeMirror pane and is painted over by it.
`docs/design.md` §4 promises an eight pixel hit zone.

Recorded as `likely` because the observation is certain and the cause is read
rather than reproduced. It is a five minute check in a browser and the fix
plan should start by making it fail.

### ~~R-112 · Agent · bug · medium · confirmed~~

**Fixed.** The remembered rule is said in English, in `frontend/src/panes/short-rule.ts`.
Held by `frontend/src/panes/short-rule.test.ts`.

Found by: the sweep. Where: `frontend/src/panes/Chat.tsx:1100`, `shortRule`.

What happens: the line explaining what a permanent grant will cover is written
in protocol vocabulary. The card says `Remembers: Bash:echo`.

`docs/design.md` §5 specifies plain English for exactly this line, and gives
"shell commands starting with latexmk" as the example. `shortRule` rewrites
path rules into English and returns everything else raw, so the rule shown for
the most consequential answer on the card is the one nobody outside this
repository can read.

Evidence: `15-card-hover-always--light--1600.png` and its dark twin.

### ~~R-113 · Agent · bug · low · confirmed~~

**Fixed.** On a network card the reason wins and the consequence is blank, so the card says it once.
Held by `tests/test_permissions.py`.

Found by: the sweep. Where: the network permission card.

What happens: the card makes the same point twice, in two sentences, one under
the other:

> This is the first thing in a turn that leaves this machine, and what it
> sends is chosen from what the project's files say.
>
> Asked at this setting, because what is sent and where it goes are chosen
> from files that may not be yours.

`docs/design.md` §5 allows one consequence line and only when the consequence
is not obvious. Evidence: `25-card-four-answers--*`, `26-card-conversation-scope--*`.

### ~~R-114 · Interface · bug · medium · confirmed~~

**Fixed.** The safe answer carries the weight and takes focus.
Held by `e2e/specs/agent.spec.ts`.

Found by: the sweep, across all eight widths and themes of one shot. Where:
the two in-place confirmations.

What happens: the emphasis is on the destructive answer. In the new
conversation confirmation, `Start new` is a `ghost-button` at `--ink` and
`Keep this one` is `quiet` at `--ink-3`, which is the ink `docs/design.md` §19
uses for disabled `\include` rows. So the safe answer is drawn in the colour
the app uses for things that cannot be chosen.

§19 says focus goes to "Keep this one" because the default answer is no. No
focus ring is visible in any of the eight images, so this is recorded as being
about emphasis rather than about focus.

Evidence: `06-clear-confirm` at 800, 1000, 1300 and 1600, both themes.

The second confirmation, `22-all-confirm`, puts a `--warn` border on "Stop
asking" and leaves "Keep asking about those two" plain. That one is defensible
as a danger mark and is not part of this finding.

### ~~R-115 · Agent · bug · low · confirmed~~

**Fixed.** Both remembering answers draw a scope line, and they say different things because they mean different things.
Held by `e2e/specs/agent.spec.ts`.

Found by: the sweep, by diffing two shots that differ by thirty-six pixels.
Where: `frontend/src/panes/Chat.tsx:1884`.

What happens: of the card's four answers, only "Allow always" sets a scope and
only it explains itself on hover. "For this conversation" is keyed by exact
command text, per `docs/design.md` §28, and nothing on screen says so. A
writer choosing it cannot know whether a command that differs by one argument
will ask again.

### ~~R-116 · Interface · bug · low · confirmed~~

**Fixed.** The permission popover has the same dot the model popover has, and the Files header has a count as the Sections header always did.

Found by: the sweep. Two small inconsistencies between neighbours.

The permission popover marks the current position with a fill alone. The model
popover, one icon along the same strip, marks its selection with a `--pen` dot
as well as a fill. Evidence: `21-mode-menu--*` against `05-model-menu--*`.

A folded Sections panel keeps its count of 3 on the spine. A folded Files
panel shows nothing. Evidence: `07-sections-alone--*` against
`08-sections-folded--*`.

### ~~R-117 · Documents · docs · low · confirmed~~

**Fixed.** All three passages, and the row menu list gained the four conditional items as well as the one it was missing. The composer quote was the specification rather than the build, and the build is the better of the two, so the document follows it and says why.
Held by `tests/test_documents_match_the_code.py`, on the menu and on the welcome message's button count.


Found by: the sweep, reading three design document passages against the
pixels.

`docs/design.md` §5's file row menu paragraph has drifted again, in the same
place R-075 found it drifting about Duplicate. The built menu is Rename, Move
to, History, Delete version history, Download, Upload here, New file here, New
folder here, Move to trash. §5 lists "set as main document", which is
correctly absent because `FileTree.tsx:713` shows it only on a non-main `.tex`
file, and does not list "Delete version history", which is at
`FileTree.tsx:730`.

§10 says the welcome carries two instruction buttons and the build shows
three. §28 quotes a composer line, "Waiting on your approval, or ask something
else", which the build has since split between the placeholder and the state
line.

**What the sweep could not look at, because the spec does not photograph it.**
The diagnostics drawer and its rows, the upload chooser, the edit chip and its
diff, the tab right-click menu, the tab overflow chevron, the git section in
any state after first run, and the reading and writing modes. Several of those
carry findings elsewhere in this report, found by driving rather than by
looking. Adding them to the sweep is the cheapest way to stop the next review
from having to drive them. That is a finding about the tooling rather than
about the app, so it is recorded here rather than as a numbered record.

**Corroborated, not re-found.** Shot 21, 22 and 23 all show the preview
telling a writer that their forty-five line document is empty, which is R-044,
and the sweep reached it from a third direction after this review reached it by
driving and the Windows laptop reached it by joining. Shots 16, 18 and 12 show
every gated call costing two rows that say the same thing, which is R-101; the
sweep adds the arithmetic, that at the quietest permission position a forty
call turn is eighty rows.

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
- **The binary gap across two machines.** The laptop joined a project with no
  real binaries in it, so whether a figure added by one side arrives at the
  other is still untested between two computers. It is known to be a gap in
  one process.
- **The compiling latch, staged rather than reproduced.** R-001 stays
  `likely`. Killing the server makes the tab reload itself onto the browser's
  error page, which is R-040 and is a different bug; and `setOffline` does not
  cut an `EventSource` that is already open, so the offline driver could not
  reach it either. Aborting `/api/projects/*/events` with `page.route` after
  `compile_start` would stage it, and was not worth the time against a reading
  this clear.
- **A real network cut, rather than a stopped server.** The laptop declined,
  correctly: disabling its adapter would have cut the channel carrying the
  instruction to put it back, and the surgical version, a firewall rule scoped
  to the server process, needs administrator, which that account does not
  have. Chrome's own offline emulation is a dead end and is worth writing
  down: `Network.emulateNetworkConditions` with offline true does not sever an
  already-established WebSocket, the badge never appeared, and an edit typed
  under it still reached disk. Stopping the server was the honest substitute
  and cuts only the browser-to-its-own-server leg. R-121 is the reason the
  experiment would have shown nothing anyway.
- **A fractional device pixel ratio.** R-106. The Windows laptop reports 1.25,
  which is the ordinary default, and nothing in this repository has been
  photographed at anything but 1 and 2.
- **Seven surfaces the sweep does not photograph.** The diagnostics drawer and
  its rows, the upload chooser, the edit chip and its diff, the tab
  right-click menu, the tab overflow chevron, the git section after first run,
  and the reading and writing modes. Some of them carry findings here, found
  by driving instead. None of them has been read against the design document
  the way the other eighty-eight were.

## What the findings have in common

A hundred and twenty-six records is a list, not a picture. Grouped by what is
actually wrong rather than by which screen it appeared on, they are about nine
things, and several of the nine are one thing wearing different clothes. This
section is written the way `d11da03` wrote its own: the point of it is that
the fix plan should buy seven fixes with one piece of work wherever it can.

**1. Something is written down once, at the moment it is first true, and there
is no path back.** This is the repository's own taxonomy, from `2cf7861` and
`d11da03`, and it is still the largest family here. A flag goes up and the way
down is missing or is only on one of the paths out.

R-001, the status strip stuck on Compiling because the flag is raised by an
event and lowered by another that may never arrive. R-011, the git panel
reading `if (get().error) return;` before push, so one failure stops every
later one. R-017, "Not now" on the GitHub card written down and never read
back. R-018, three refresh flags with more endings than lowerings. R-023 and
R-024, inputs whose problem text and whose whole state survive the thing they
described. R-050, one deferred model change with two writers and one clearer.
R-062, a set of file ids a write was refused for that is added to and never
emptied. R-068, spell checking that reaches one tab and never comes back.

The shape to look for is always the same: count the ways the job can end, and
check each one lowers what it raised. Success, failure, timeout, cancel, the
server restarting underneath it, the tab reloading in the middle.

**2. One state stands in for two, so absence and failure look identical.**
This is the family that produces false statements on screen, and it is the one
a writer actually meets.

R-044 and R-107, the preview saying "Nothing has been typeset yet. An empty
document produces no pages" for the whole of a project's first build, because
a 404 for a PDF that does not exist yet and a PDF with no pages in it are
mapped to the same word. R-045, the strip saying Ready through that same
build, because the event that would have said Compiling was published before
the browser was subscribed and there is no backlog. R-105, the share panel
drawing nothing when nobody is there and nothing when somebody is there and is
not being rendered, so a person joining cannot tell the two apart. R-040, an
error boundary that treats every failed fetch as a stale chunk and reloads the
tab, so a stopped server becomes a reload loop. R-102, a 404 from Semantic
Scholar rendered as the claim that the paper is unknown. R-086, `??` on the
page with nothing on screen saying that references have not settled. R-108,
the panel saying "Ran" above the card that is still asking whether it may run,
and keeping that word if the answer is no. R-120, the largest instance of it
in the report: zero commits behind and no answer about how many commits behind
are the same number, so an update check that never reached the network is
drawn as "Up to date." R-121, a badge that reports the browser's socket to its
own server and is read by everybody as reporting the share, with R-105 and
R-126 beside it: one connection is modelled and the other is not, so a peer
arriving, a peer present and a peer gone for good are all drawn as the same
nothing.

The question that finds these is: what else produces this signal, and does it
mean the same thing.

**3. Identity by position, in a list that is rebuilt underneath it.**

R-008, the diagnostics drawer keeping `expanded` and `selected` as indices
into a list recomputed on every build, so the row drawn as open is whichever
one has landed in that slot. R-004 and R-009, the error to start from chosen
by `localeCompare` on the filename, twice, on both sides of the same screen,
and called document order in a docstring and in the README. R-006, a file
attributed to whichever `\include` target shares its directory, which on a flat
chapters folder is always the first one.

Each of these has the right key available a few lines away. File, line and
message together already identify a diagnostic; `\include` order already exists
in the document.

**4. The screen and the disk disagree, and the screen is confident.**

R-029, the blocker: six presses of Ctrl+Z empty a file on disk for everyone,
because the buffer is built before the socket has synced and the whole file
then arrives as an undoable transaction. R-059, the join writing the entire
project to disk a full minute before the card that says nothing has been
written yet, confirmed across two machines by the laptop's timestamps. R-058,
a peer's rename stepping over a local file with no event and no trash. R-104,
an offer card whose three sizes are all wrong, two by the number of newlines
and one by a factor of three. R-107 again, a preview calling a document empty
while its build log sits beside it. R-108 belongs here as much as it belongs
above: the transcript is the record of what the machine did, and for a denied
command it says the opposite.

**5. Everything the writer never sees is unbounded, and the loop pays for it.**

R-031, `write_file` taking a string with no ceiling, measured here at 1.61
seconds of blocked loop for a 40 MB write against a 9 to 11 millisecond
baseline. R-060, `pdftotext` run inline on a context upload, 1.00 second
blocked. R-061, a version recorded from inside the flush on every settled
collaborative edit. R-038, a synchronous `session_for` that walks the project.
R-015, a trash purge that reads the whole ledger.

Every one of these is on the path of something a person did not ask for and
cannot see, which is why none of them has ever been reported.

**6. A route exists and nothing in the interface reaches it.** The cheapest
group in the report, and almost all of the comfort list's top half.

R-093, `GET /history/timeline` written, limited, and with no client wrapper at
all. R-096, `GET /api/templates` listing the templates while both callers pass
no name. R-091, `DELETE /dictionary` and `api.forgetWord` both written and
never called, so a word added by mistake is added for good. R-095, the git
route already taking an initialise action while the panel only ever sends
three. R-097, `/history/size` with a wrapper and no caller, and a purge
response whose freed bytes are discarded. R-084, `entry_for` and `verify`,
both tested, reachable only through the agent, in an app whose README calls
working without an agent a real option.

These are a control each. Several are a line.

**7. A promise in prose that the code does not keep.** Seven `docs` records
and several bugs.

R-055, the parity test naming a promise in its own docstring that it does not
assert. R-075, a paragraph written to warn about documentation drift that has
itself drifted. R-076, a measured column nothing checks beside a budget column
something does. R-007 and R-077, quoted numbers out by an order of magnitude
and by one. R-027 and R-043, the sign-in page's own em dash and a README line
that sends a Windows writer to the wrong recovery. R-087, "Errors explained in
English" two sentences above a screen that shows chktex verbatim. R-090, a
copy affordance specified in the design document, never built, and never
recorded as dropped.

**8. A fix that broke its neighbour, quietly.**

R-078 is the clearest case in the report and is worth reading as a story. The
suite was signing the developer out of Claude Code, which is as serious as it
sounds. The fix pointed the whole suite at a stand-in, deliberately, "including
the ones nobody has written yet". It also disabled the one test written to do
the opposite, and the way it fails makes the test report the exact upstream
change it exists to detect. Nothing caught it because the test is opt-in and
nobody had run it for three days. R-002 is the same shape in miniature: a
cancellation check hardened on the success path and left off the two failure
paths beside it.

**9. The keyboard reaches about half of this app.**

R-028, `nested-interactive` at serious impact on five surfaces, one mechanism.
R-070 and R-016, menus claiming `role="menu"` without roving focus, and a tree
that is one tab stop. R-003 and R-010, a dot and a diagnostic row that answer
a click and not a key. R-025 and R-026, the sign-in page's contrast and its
recovery line. R-082, R-083 and R-094, three places a writer's hand has to
leave the keyboard for something the code already computes: opening a file by
name, changing tab, stepping to the next error. R-109 belongs here too, and is
the largest of them: every separator, border and drag handle in the light
theme is drawn at half the contrast the dark theme gives it, on the identical
ground, and the test that exists to catch that computes the intended value
from the stylesheet and never sees the resolved one.

### What this means for the order of the fix plan

The two blockers are unrelated to each other and to everything above. R-029
loses work and R-057 lets a collaborator move any file the server's user can
read into the project. Both go first, on their own.

After that, mechanism 2 buys the most: six records, all of them things a
writer reads and believes, and the fix in each case is to keep the two states
apart rather than to add a message. Mechanism 1 is the largest but the records
in it are individually small, and it is the one where a single careful pass
with the counting question in hand will close most of them together. Mechanism
6 is the cheapest thing in the report and the most visible to the person using
it, which makes it the right thing to do while the harder work is in review.

## Cost and time

The review ran on 11 September 2026, from about a quarter to three in the
afternoon, in one Opus session with Fable as the advisor at the checkpoints
the protocol names. The baseline came first and the report was committed after
every area, which is why the times below can be read off the log rather than
remembered.

| | |
|---|---|
| Baseline, `scripts/check.sh --all` | 12 m 12 s |
| Benchmarks, first run | after the browser tier, on a busy machine |
| Benchmarks, second run | on an idle machine, for the README comparison |
| First finding committed | 15:26 |
| Areas, first commit to last | about two hours |
| Live agent spend, in the app | $0.068, 2 turns, `claude-sonnet-5` |
| Live agent spend, in the suites | not separately recorded, of the order of a few tens of cents |
| Live iroh test | 2 passed in 5.3 s |

The spend is small because the live areas were driven with deliberate
questions rather than with a conversation. Two turns in the app produced R-073
and R-074 between them, and the panel-after-reload comparison that the plan
asked for. The agent findings that cost nothing at all, R-046 through R-056,
came from reading `nexttex/agent.py` and `nexttex/tools.py` against the
permission fence.

What the time actually went on is worth saying, because the next review can
skip most of it. Roughly a third went on the browser drivers, and most of that
third went on two mistakes: a compile driver that typed its broken LaTeX after
`\end{document}`, where the engine ignores everything, so the error never
appeared; and two specs that waited five minutes each for a server that was
already gone. Both are fixed in `e2e/review/` and neither can cost that again.
Another third went on reading, which is where most of the findings came from
and is the cheapest thing here per finding. The last third went on the report
itself, which is the deliverable, and on the two live servers.

The subagents earned their keep twice: once reading all eighty-eight sweep
images against the design document, which is a task that is expensive in a
main context and cheap in a fresh one, and once assembling the comfort list,
which needed the whole interface read at once. Both were checked before
anything they said was recorded. The sweep's three load-bearing claims were
verified here, including recomputing its contrast ratios from the pixel values
it reported, and all ten of its findings stood. The comfort agent's most
useful work was the opposite: two of the five leads it was given were wrong,
and it closed them rather than writing them up.
