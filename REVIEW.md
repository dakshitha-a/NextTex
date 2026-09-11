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

Numbered across the whole run, in the order they were found. Grouped by
mechanism at the end rather than here, because a list grouped as it is written
is a list that decides too early what a thing has in common.

### Compile, diagnostics and the preview

### R-001 · Compile · bug · medium · likely

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

### R-002 · Preview · bug · medium · likely

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

### R-003 · Compile · accessibility · low · confirmed

Found by: reading. Where: `frontend/src/panes/Status.tsx:80`.

What happens: the status dot and its label are a `<button>` whose handler is
`clickable && onToggleDrawer()`. In four of the seven states `clickable` is
false, and the control is then a focusable button that does nothing when
pressed or activated from the keyboard, with no `disabled` and no
`aria-disabled`. Somebody tabbing through the editor stops on it and gets no
answer.

Expected: a control that cannot be used says so, or is not a tab stop.

### R-004 · Compile · bug · high · confirmed

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

### R-005 · Compile · bug · medium · confirmed

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

### R-006 · Compile · bug · medium · confirmed

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

### R-008 · Compile · bug · medium · confirmed

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

### R-009 · Compile · bug · medium · confirmed

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

### R-010 · Compile · accessibility · medium · likely

Found by: reading. Where: `frontend/src/panes/Diagnostics.tsx:151` and `:197`.

What happens: each diagnostic row is a `div` with `role="button"` and
`tabIndex={0}`, and the `Fix` control is a real `<button>` **inside** it. A
button inside a button is a nested interactive control: assistive technology
is told the outer element is a single button, and the inner one is either
unreachable or reported as part of its name. This is the axe rule
`nested-interactive`, whose impact is serious, and `e2e/specs/a11y.spec.ts`
never opens this drawer, so its sweep has never looked at it.

### R-028 · Accessibility · accessibility · medium · confirmed

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

### R-040 · Interface · bug · high · confirmed

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

### R-044 · Preview · bug · high · confirmed

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

### R-045 · Compile · bug · medium · confirmed

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

### R-011 · Files rail · bug · high · confirmed

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

### R-012 · Files rail · bug · high · confirmed

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

### R-013 · Files rail · bug · high · confirmed

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

### R-014 · Files rail · bug · medium · confirmed

Found by: reading. Where: `nexttex/trash.py:422`.

What happens: `empty()` reads the ledger, destroys every payload, and then
rewrites the ledger empty. `purge`'s own comment eight lines above says
compaction was taken out of it for exactly this reason: "it read the ledger
and wrote the whole thing back, so a delete landing between the read and the
rename was erased, its payload left on disk under an id nothing knew about."
`empty` still does it, and holds the window open far longer, because it
`rmtree`s a whole folder of figures between the read and the write.

Expected: the fix already applied to `purge`, applied here.

### R-015 · Files rail · performance · medium · confirmed

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

### R-016 · Files rail · accessibility · medium · confirmed

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

### R-017 · Files rail · bug · medium · confirmed

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

### R-018 · Files rail · bug · medium · confirmed

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

### R-019 · Files rail · bug · medium · confirmed

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

### R-020 · Files rail · bug · medium · confirmed

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

### R-021 · Files rail · bug · medium · confirmed

Found by: reading. Where: `nexttex/gitrepo.py:145`.

What happens: `initialise` returns early when `.git` already exists, before
writing the `.gitignore`, and `commit` runs `git add -A`. A writer who points
NextTex at a repository they already had therefore commits `build/` on every
commit: every `.pdf`, `.aux`, `.log` and `.synctex.gz`. `.nexttex/` is safe,
because `nexttex/project.py` drops a `*` ignore file inside it, and `build/`
has no such protection.

### R-022 · Files rail · bug · low · confirmed

Found by: reading. Where: `nexttex/gitrepo.py:105`.

What happens: the changed-files list is parsed from `git status --porcelain=v1`
as `line[3:]`, with no `-z` and no `-c core.quotePath=false`. A rename arrives
as `old -> new` and any non-ASCII filename arrives C-quoted with escapes. Each
becomes a clickable row in `GitPanel.tsx:207` that calls `onOpen(change.path)`,
so clicking a renamed file, or any file with an accent in its name, opens
nothing.

### R-023 · Files rail · bug · low · confirmed

Found by: reading. Where: `frontend/src/panes/FolderChooser.tsx:125`.

What happens: the new-folder input sets `problem` in its catch and clears it
only on Escape or on success. There is no `onChange`, so the red underline and
*There is already a figures folder here* stay on screen while the writer types
a different name, and reopening the chooser shows the input still carrying the
old failure. `NewName` in `FileTree.tsx:1274` clears on every keystroke, which
is the behaviour this one should have.

### R-024 · Files rail · bug · low · confirmed

Found by: reading. Where: `frontend/src/panes/GitPanel.tsx:18`.

What happens: `message`, `url`, `token`, `wizard` and `open` are reset by
nothing when the project changes; only `dismissed` re-reads. A half-written
commit message follows the writer into the next project, and so does a pasted
personal access token, which sits in a password field belonging to a project
it was not issued for.

### The editor

### R-029 · Editor · bug · blocker · confirmed

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

### R-067 · Editor · bug · high · likely

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

### R-068 · Editor · bug · high · likely

Found by: reading. Where: `frontend/src/panes/editor-setup.ts:419` with
`frontend/src/panes/Editor.tsx:724`.

What happens: spell checking reaches one tab and never comes back once turned
off. Every fresh state gets `spellCompartment.of([])`, and the effect that
would reconfigure it takes an early branch when the module is already loaded,
dispatching an effect into a state that has no field to receive it. So a
second tab is never checked, and turning the setting off and on again does not
restore the underlines on any tab for the rest of the session.

### R-069 · Editor · bug · medium · likely

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

### R-070 · Editor · accessibility · medium · confirmed

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

### R-071 · Editor · bug · medium · likely

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

### R-072 · Editor · bug · medium · likely

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

### R-025 · Sign-in · accessibility · medium · confirmed

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

### R-026 · Sign-in · accessibility · medium · confirmed

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

### R-027 · Sign-in · docs · medium · confirmed

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

### R-046 · Agent · security · high · confirmed

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

### R-047 · Agent · security · medium · confirmed

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

### R-048 · Agent · bug · high · confirmed

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

### R-049 · Agent · bug · high · confirmed

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

### R-050 · Agent · bug · medium · confirmed

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

### R-051 · Agent · bug · medium · confirmed

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

### R-052 · Agent · bug · medium · confirmed

Found by: reading. Where: `nexttex/agent.py:1364`.

What happens: the call that folds an agent edit into the shared document is
wrapped in `except Exception: pass`. The fold's own failure is logged, with a
comment at `server/session.py:812` saying why silence there is unacceptable,
but anything raised *before* the fold, recording the version on a full disk
for instance, is caught by this outer handler and written nowhere.

The writer then sees the agent report an edit their editor does not show,
which that same comment calls indistinguishable from a turn that did nothing.

### R-053 · Agent · bug · medium · confirmed

Found by: reading. Where: `frontend/src/store.ts:917` and
`frontend/src/panes/Chat.tsx:386`.

What happens: the writer's own question is pushed into the panel by the tab
that sent it, and `turn_start` draws nothing. The transcript does record it, so
a reload is right. A **second tab** open on the same project never sees the
question at all, and its panel reads as the agent answering nobody.

The same line has a second ending. A question that failed to send leaves its
bubble on screen while the draft is restored to the box, so the writer sees it
twice, and a reload makes it vanish, because the server never had it.

### R-054 · Agent · bug · medium · confirmed

Found by: reading. Where: `server/transcript.py:164` with
`frontend/src/store.ts:445`.

What happens: nothing records that a turn ended, so the replay has to guess
from the last item's kind, and only `user`, `tool` and `edit` count as
interrupted. A turn that died after its prose, which is the ordinary shape of
a turn killed by a restart, replays as a completed answer with no notice at
all. Live, it was a turn still in flight.

### R-055 · Agent · bug · medium · confirmed

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

### R-056 · Agent · bug · low · likely

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

### R-073 · Agent · bug · medium · confirmed

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

### R-074 · Agent · bug · low · confirmed

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

### The server

### R-030 · Server · security · medium · confirmed

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

### R-031 · Server · performance · high · confirmed

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

### R-032 · Server · bug · medium · confirmed

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

### R-033 · Server · bug · medium · confirmed

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

### R-034 · Server · bug · medium · confirmed

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

### R-035 · Server · bug · medium · confirmed

Found by: reading. Where: `server/main.py:266`.

What happens: the file watcher's loop ends `except Exception: await
asyncio.sleep(1.0)`, with no log line, inside `while True`. A failure that
recurs, a permission error on a watched root, a watched directory that has
gone, spins once a second for the life of the process and says nothing.

What the writer loses is exactly what the watcher's own docstring says it
exists to prevent: an external edit, a `git pull` or a checkout no longer
reaches the open tab, so the tab saves over a change it never saw. The reaper
twenty lines below logs its exceptions, so the house answer was available.

### R-036 · Server · bug · medium · confirmed

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

### R-037 · Server · bug · medium · confirmed

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

### R-038 · Server · performance · low · confirmed

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

### R-039 · Server · security · low · confirmed

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

### R-057 · Collaboration · security · blocker · confirmed

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

### R-058 · Collaboration · bug · high · confirmed

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

### R-059 · Collaboration · bug · high · confirmed

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
behind", which is why this has never been noticed. What is real is the window:
a server killed between join and accept leaves a folder full of somebody
else's project, unregistered and untracked, and the writer's next attempt to
join into it is refused with "That folder already has something in it".

### R-060 · Context · performance · high · confirmed

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

### R-061 · Collaboration · performance · high · likely

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

### R-062 · Collaboration · bug · medium · likely

Found by: reading. Where: `server/collab/store.py:923`.

What happens: `_refused` is a set of file ids a write was refused for, added
to once and removed from never. The comment argues correctly that a path which
named `.git/config` will name it again next time and should not be retried.
What is latched is the **file id**, not the path. A peer that names a file
badly for one flush and corrects it has poisoned that document for the life of
the session: the editor accepts keystrokes, everything looks normal, and
nothing is ever written to disk again. Only a `log.warning` says anything.

### R-063 · Collaboration · bug · medium · likely

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

### R-064 · Collaboration · security · medium · likely

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

**Unsolicited blobs are stored.** Any `BLOB_HAVE` whose payload hashes to its
claimed sha is written, whether or not anything asked, and each costs a
sha256 and a `zlib.compress` on the loop.

### R-065 · Collaboration and context · bug · medium · likely

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

### R-066 · Context and papers · bug · medium · likely

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

### R-041 · Update · bug · high · confirmed

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

### R-042 · Update · bug · high · confirmed

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

### R-043 · Documents · docs · medium · confirmed

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

### The documents

### R-007 · Documents · docs · low · confirmed

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

### R-075 · Documents · docs · medium · confirmed

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

### R-076 · Documents · docs · medium · confirmed

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

### R-077 · Documents · docs · low · confirmed

Found by: reading `TRACKER.md` against the code. Where: `TRACKER.md:54`.

What happens: the backlog item says "Five menus claim `role="menu"` without
implementing it" and names them. A literal grep finds four: two of the named
files carry one each rather than the two the entry attributes to
`frontend/src/panes/Chat.tsx`. The entry also says "the answer is roving focus
in all seven", counting the two that deliberately decline the role.

The item is right about the problem and wrong about its size, which matters
because the number is the argument for it being "a piece of work of its own".

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
