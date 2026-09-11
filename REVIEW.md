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

**Reproduced on the real screen as well.** A document whose body carries an
undefined command on line 3 of `main.tex` and another on line 2 of
`chapters/one.tex`, both recoverable so that both reach the log, builds and
the strip says two errors. The drawer's headline reads:

```
Start here.  A command LaTeX does not know   one.tex:2
```

The error in `main.tex` comes first in the document and is not offered. The
first attempt at this used a missing package, which aborts the run before the
chapter is read, so only one file had errors and the sort could not be seen;
that is worth recording because it is why an ordinary test would not find this.

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
