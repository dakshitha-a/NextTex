# The probe: a review of NextTex, September 2026

This is a review in progress, not documentation. Like `TRACKER.md` it lives
here rather than in `docs/` because it describes what is wrong and what is
missing, which is the opposite of what the documents are for. It is the
input to a fix plan, and it is deleted when that plan's fixes have landed,
because the commit log is then the record.

The live tracker, which becomes the finished report when the probe ends, is
https://claude.ai/artifact/4mdUwu1mLwVYquc7Bm7vkS.

## Why this review, and why now

The last whole-app review ran on 11 and 12 September 2026 at `5942653` and
is readable with `git show 8746e16^:REVIEW.md`. Since then about five
hundred commits have landed and `docs/design.md` has grown from section 45
to section 75. Comments, the settings sheet, the visual overhaul, the frame
and its drawers, the hover cards, outside edits merged and named, git's
history, spelling in other languages, grammar, the page in the dark and the
projects archive have none of them been looked at as a whole. This review
looks at all of it, and at everything older again, starting from 3.18.0.

## How it is run

**Record, never fix.** Every finding, however small, is a record below, and
nothing is repaired while the review runs. A list fixed as it is found is a
list that stops at the first hard item. The standing rule that a tangent is
fixed on sight is paused for this run, on the writer's word. A confirmed
blocker or security finding is reported to the writer the moment it is
confirmed, and is still only recorded.

**Five ways a fault is found, and each finds a different kind.** A *test*
finds a broken contract, and the suites already do that. A *reading* finds a
correct line doing what it says in a case its author did not have in front
of them. A *screen* finds what is drawn wrong, missing, cut off or stale,
read against `docs/design.md` and against the direction page, the Artifact
at https://claude.ai/artifact/9dczkpMaP23Be5H5AEJVPp, which is the
interface's specification. A *measurement* finds the path that is fine on a
fixture and slow on a thesis. And *use*, a stretch of writing with the
question of what was done twice, waited for, or reached for and not found,
finds what is not a fault at all. The README compares NextTex to a Jupyter
notebook, so that is the standard.

**The questions asked of every area.** What sets this state back? How many
ways can this job end, and does each ending reach the screen: success,
failure, timeout, cancel, the server restarting underneath, a reload in the
middle? Does the replayed version equal the live one? Does every
implementation behind a seam keep the promise? What happens on a thesis
rather than a fixture, on a second tab, a second peer, a second instance?
What happens when the file is changed outside NextTex while it is open?
Can it be done from the keyboard, and does a screen reader hear what a
sighted person sees? What does the document say, and is it still true?

**A document's claim is a lead, not a finding.** `docs/design.md` narrates
the state when each section was written, so a sentence saying the app
cannot do something is checked against the code before it is recorded.

**Nothing touches the writer's own install or login.** It runs as a
`systemd --user` service on port 8450 with its state in the writer's own
data directory. Every server this review starts redirects `XDG_DATA_HOME`
and `XDG_CONFIG_HOME` into a sandbox and takes a port of its own, the way
`e2e/server.ts` does, and every one that is not a deliberate live session
runs the scripted agent, the fake sign-in and the loopback transport. No
process is ever killed by pattern or by name: the September review
probably stopped the writer's service that way. A server is stopped by the
number it started under, after its environment has been read to confirm it
is this review's. The Claude login was fingerprinted before the first live
turn and is compared after the last, and the sign-out control is never
pressed. Live turns use `claude-sonnet-5`, within two dollars for the run.

## The record format

One record per finding, numbered `Q-001` onward across the whole run, so
that the numbers never collide with the September review's `R-` records.
The heading is `Q-NNN · area · category · severity · confidence`.

- **Categories.** `bug`, `security`, `performance`, `accessibility`,
  `consistency` for a departure from `docs/style-guide.md` or the direction
  page, `docs`, `test` for a gap or a flake in the suites, `comfort` for
  something a writer reaches for and does not find, and `improvement` for a
  change that makes something better that is not broken.
- **Severity.** `blocker` loses work or exposes the machine. `high` means a
  feature fails in an ordinary case. `medium` means it works and is wrong in
  a case a writer will meet. `low` is cosmetic or rare.
- **Confidence.** `confirmed` means reproduced in the running app, or read
  line by line with the mechanism named; the *Found by* line says which.
  `likely` means read in the code and consistent with a screen, with one
  step not pinned down. `suspected` means a reading only.
- **The body.** *Found by*, *Where* as a file and line, *What happens*,
  *What should happen*, *How to reach it again* naming a driver under
  `e2e/review/` when one was written, the *Size* of the fix as small,
  medium or large, and the *Version* level the fix would earn.

This file is on the list `tests/test_documents_match_the_code.py` reads, so
every path, route and variable it quotes has to exist. A name a finding
proposes is written in prose, never in backticks.

## Baseline

Recorded at `06396c4`, NextTex 3.18.0, before anything was looked at.

**Everything is green.** `scripts/check.sh --all` passed in 22 minutes and 8
seconds on 25 September 2026, with nothing skipped that was not meant to be.

| tier | result | wall time |
|---|---|---|
| Types (`tsc --noEmit`) | pass | |
| Frontend (vitest) | 1137 passed, 89 files | |
| Python (pytest) | 2403 passed, 28 skipped | 3 m 33 s |
| Frontend build and precompression | pass | |
| Bundle budget | 861.0 kB against 864 | |
| Browser (playwright) | 575 passed, none retried | 18 m 0 s |

GitHub Actions was green on all four workflows for `06396c4`, from
`gh run list`. Against the September baseline: the frontend tests went from
700 to 1137, the Python tests from 1279 to 2403, the browser tests from 228
to 575, and the full run from about 12 minutes to 22.

Two warnings in the Python tier: a deprecation inside starlette's test
client, and one from `pty.forkpty` in a multi-threaded process during a
sign-in test. The build prints two: harper's bundle names `fs`, and the
spelling engine's loader is Q-036.

**Nothing was already broken, so every finding below belongs to this review.**

## Findings

Numbered across the whole run, in the order they were found, under the area
where they were found. They are grouped by mechanism at the end rather than
here.

### Compile, diagnostics, the preview and the page

### Q-017 · Compile · bug · high · confirmed
**A chapter's build hides the other chapters' errors.**

*Found by:* reading, from a lead a reading agent raised, then reproduced in
a browser by `e2e/review/q017-scoped-diagnostics.spec.ts`.

*Where:* `server/session.py:1114`, `nexttex/compile.py:632`,
`server/session.py:1142`.

*What happens:* once a document's full build takes longer than two seconds,
a fast build compiles only the chapter being edited, through
`\includeonly`. TeX never opens the other chapters, so the log names no
problem in them. The session then replaces the document's whole list of
diagnostics with that build's list. An error that is still in chapter one
disappears from the gutter and the drawer the moment the writer types in
chapter two. No settling build follows, because the settling build is only
started for a fast pass that asks for a rerun or for citations.

*What should happen:* a scoped build replaces only the diagnostics of the
files it opened, and keeps the rest until a build that opens them says
otherwise.

*Reproduced.* The driver copies the bench's thesis, slows every build past
the two second line with a counting loop in the preamble, puts an undefined
command at the end of chapter 00, and waits for the build that reports it:
a full build, outcome errors, one error in chapter 00. It then types a
sentence in chapter 01. The next build is scoped to `chapters/01`, its
outcome is ok, and it carries no diagnostics at all. The error in chapter
00 is still in the file and is gone from what the app says, and the build
strip reports a clean build. It stays that way until something forces a
full build.

*How to reach it again:* `e2e/review/q017-scoped-diagnostics.spec.ts`, with
`NEXTTEX_THESIS` pointing at a project `bench.build_project` made.

*Size:* small. *Version:* z.

*Fixed in 3.18.2.* A scoped build keeps the diagnostics of every file it
did not open, and `e2e/specs/scoped-diagnostics.spec.ts` drives the
driver's scenario on two short chapters.

### Q-043 · Compile · performance · high · confirmed
**A build with many warnings freezes the server.**

*Found by:* measurement, then a profile. Phase 3 pinged `/api/instance`
every ten milliseconds while the thesis built, and the longest wait was
17.6 seconds, at the end of every full build, three runs out of three.
`py-spy` sampled the server through a fourth.

*Where:* `server/session.py:1035` and `server/session.py:1046`, calling
`nexttex/project.py:468`; and `nexttex/compile.py:913`.

*What happens:* after a build, the result is turned into what the browser
receives on the event loop. Each diagnostic's file is made relative with
`Project.relative`, which resolves the diagnostic's path and resolves the
project root again, for every diagnostic, and the compile route does this
twice for the same build. Before that, `_remap_shadow` resolves every
diagnostic's path once more to find the stand-in main file. The thesis
build produced 72,000 warnings, because the bench's thesis cites and refers
to things it never defines, and turning them into the payload held the loop
for about 15 seconds: no tab, no autosave and no collaborator was answered
in that time. That count is extreme, but the cost is about a quarter of a
millisecond per warning with nothing capping the count, so a draft with a
few thousand undefined references stalls the install for a second or more
on every build. All 72,000 are then sent to every tab in the event.

*What should happen:* the root is resolved once per build, the paths are
made relative once and cached by file, the work runs off the loop, and the
diagnostics sent to the browser are capped, with the count of what was left
out.

*How to reach it again:* `e2e/review/q043_build_loop_block.py`, with
`NEXTTEX_THESIS` pointing at a project `bench.build_project` made.

*Size:* small. *Version:* z.

*Fixed in 3.18.5.* The payload is made off the loop with each file
related once, and at most 500 rows are sent with the rest counted.

### Q-018 · Compile · bug · medium · confirmed
**A deleted file's labels stay in completion.**

*Found by:* reading. *Where:* `nexttex/symbols.py:489`.

*What happens:* the cache of labels, citations, macros and images is
rescanned only when the newest modification time among the source files
changes. Deleting a file that is not the newest one leaves that time where
it was, so everything the deleted file defined stays in completion and in
the hover cards until some other file is touched. A `git pull` that removes
a chapter, or a collaborator deleting a figure, is the ordinary way to get
here.

*What should happen:* the stamp includes the set of files, for example the
count and the newest time together, so a deletion is a change.

*Size:* small. *Version:* z.

### Q-019 · Compile · bug · medium · confirmed
**Windows drive paths confuse the log parser.**

*Found by:* reading. *Where:* `nexttex/latexlog.py:56` against
`nexttex/latexlog.py:32`.

*What happens:* the pattern that tracks which file TeX has open accepts a
path starting with a slash or a dot, and not one starting with a drive
letter. The pattern for errors does accept a drive letter, so the two have
drifted apart. On Windows, where an engine opens `C:/...` paths, the stack
of open files is kept with an unnamed entry, and a warning TeX does not
attribute itself goes to whichever file is next on the stack.

*What should happen:* both patterns accept a drive letter. A captured
MiKTeX log goes into the parser's tests.

*How to reach it again:* a build on the Windows laptop with a warning in an
`\input` file.

*Confirmed on the laptop,* after the probe closed, on 3.18.1 with MiKTeX
25.12. A project whose chapter one holds an overfull box on its line 3
showed the warning against `main.tex`, in the drawer and in the parser
called directly. The log opens the main file as C:/Users/daksh/test/q019/main.tex
and the chapter as C:\Users\daksh\test\q019\chapters/one.tex, so the
separators are mixed within one path, and a long path is wrapped at the
log's line width. The fix's test uses these lines.

*Size:* small. *Version:* z.

### Q-020 · Compile · comfort · low · likely
**A queued TeX install says nothing about why.**

*Found by:* reading. *Where:* `nexttex/texpkg.py:60`, the route at
`server/main.py:3206`.

*What happens:* installing a TeX package takes one lock for the whole
machine, which is right, since the distribution is shared. A second
project's Install press waits on that lock for up to five minutes and says
nothing about why.

*What should happen:* the drawer says another project's install is running.

*Size:* small. *Version:* z.

### Files, history, trash and git

### Q-021 · Files · performance · low · confirmed
**The history timeline runs on the event loop.**

*Found by:* reading, from a lead a reading agent raised.
*Where:* `server/main.py:3545` calling `nexttex/history.py:644`.

*What happens:* the History drawer's timeline reads and parses every file's
version log in the project, and does it on the event loop. Its neighbours,
the size and purge routes, do the same class of walk in a worker thread and
say so in a comment. While the timeline is being built, every other
request on the install waits: autosave, the other tabs, collaborators.
Measured in Phase 3 on the thesis after four hundred saves across forty
chapters: 9 ms, and the loop was held no longer than that. So the reading
overstated it. It is recorded as low because the cost grows with the number
of logs and the rule it breaks is the codebase's own.

*What should happen:* the timeline runs in a worker thread, as its
neighbours do.

*Size:* small. *Version:* z.

*Fixed in 3.18.5.* The timeline runs in a worker thread.

### Q-022 · Files · performance · medium · confirmed
**Trashing a folder holds the event loop.**

*Found by:* reading, from a lead a reading agent raised.
*Where:* `server/main.py:3097` and `server/main.py:3259`, calling
`nexttex/trash.py:279` and `nexttex/trash.py:355`.

*What happens:* moving a folder to the trash, or restoring one, walks the
folder twice, reads every text file under two megabytes and rewrites its
version log, all on the event loop. Duplicating a folder, the nearest
comparable route, runs off the loop. A large figures folder stops the
whole install while it moves.

*What should happen:* both run in a worker thread.

*Size:* small. *Version:* z.

*Fixed in 3.18.5.* Trash and restore run in a worker thread.

### Q-023 · Files · bug · medium · confirmed
**The Git drawer commits conflict markers.**

*Found by:* reading. *Where:* `nexttex/gitrepo.py:262`.

*What happens:* the Git drawer's commit runs `git add -A` and then
`git commit`. A merge the writer started in a terminal and left with
conflicts is still in progress, and `git add` marks every conflicted file as
resolved whatever it holds. The conflict markers are committed into the
manuscript, and nothing in the drawer said a merge was under way.

*Reproduced* by `e2e/review/q023_git_and_projects.py`: a merge left with a
conflict in a terminal, then the drawer's commit through
`/api/projects/{project_id}/git/{action}`. The commit succeeded, and `HEAD`
held the markers. The status the drawer reads does list the file as `UU`,
so the server already knows; `frontend/src/panes/GitPanel.tsx` has no case
for that state.

*What should happen:* the drawer reads whether a merge is in progress and
whether any path is unmerged, says so, and refuses to commit until the
terminal has finished it.

*Size:* small. *Version:* z.

### Q-024 · Files · comfort · low · confirmed
**A detached head shows as a branch name.**

*Found by:* reading. *Where:* `nexttex/gitrepo.py:189`.

*What happens:* the branch name is read from the status header by
splitting at three dots. On a detached head the header is `HEAD (no
branch)`, and the drawer shows that text as the branch. Reproduced by the
same driver.

*What should happen:* a detached head is named as such, with its commit.

*Size:* small. *Version:* z.

### Q-025 · Files · bug · medium · confirmed
**Replace-all stops halfway without saying so.**

*Found by:* reading. *Where:* `server/main.py:2782` and
`server/main.py:2859`.

*What happens:* replace in every file, and renaming a label everywhere,
save one file at a time with no transaction. Each save is its own version,
so there is no single step that undoes the whole replace. If one save fails
partway, for example because the file was renamed a moment before, the
files already saved stay changed, the rest are skipped, and the writer sees
a bare error with no account of which files changed.

*What should happen:* the route reports which files it changed and which it
did not, and the versions it records share one source stamp, so the
History drawer folds them into one row that can be undone together.

*Size:* medium. *Version:* z.

### Q-026 · Projects · bug · low · confirmed
**Adding a folder revives an archived project.**

*Found by:* reading. *Where:* `nexttex/project.py:676`.

*What happens:* adding a folder writes a fresh entry in place of any entry
already at that path. A project that is archived or in the trash comes back
as active, with its dates reset, without the Restore that the projects
screen offers for exactly this. The move-a-project path, `relocate`, carries
the state across and so does not have the fault. Reproduced by
`e2e/review/q023_git_and_projects.py`: archived, then added again, then
listed as active.

*What should happen:* adding a folder that is already registered opens the
existing entry, and asks before bringing an archived or trashed project
back.

*Size:* small. *Version:* z.

### Q-027 · Files · bug · medium · likely
**An upload into a vanished folder loses its report.**

*Found by:* reading. *Where:* `server/main.py:3632`, the writes near
`server/main.py:3733`.

*What happens:* an upload makes the destination folder once, then reads and
writes each file in turn, awaiting each read. A folder moved to the trash in
another tab between two files makes the next write fail with an uncaught
error. The request ends in a 500, and the report of the files already
written is lost, so the writer does not know which arrived.

*What should happen:* a failed file is reported as failed, with the rest,
and the files already written are listed.

*Size:* small. *Version:* z.

### Q-028 · Files · security · high · confirmed
**One regex search stops the whole server.**

*Found by:* reading, from a lead a reading agent raised.
*Where:* `nexttex/search.py:21`.

*What happens:* project search caps a pattern at two hundred characters,
and the comment above the cap says that is short enough that a pattern
which backtracks exponentially cannot be built. It is not: `(a+)+$` is
seven characters. The reading assumed the damage stopped at a worker
thread, since the search runs in one. The measurement below found it does
not.

*What should happen:* a pattern search runs in a child process with a time
limit, or through a matcher that cannot backtrack, and the comment stops
claiming what the cap cannot do.

*Measured, and worse than the reading said.* Phase 3 put one line of 34
letters and an exclamation mark in a chapter and searched it for `(a+)+$`
with the regular-expression switch on. The whole server stopped answering,
not just one worker: a request for `/api/instance`, which touches nothing,
waited out its full two-minute timeout, and so did the Git drawer's log
after it. Python's `re` holds the interpreter lock while it matches, so a
thread does not protect the event loop at all. One search typed into the
Search drawer hangs the install for every tab and every collaborator. The
pattern needs about two to the thirty-fourth steps, so the hang lasts
minutes at least; the run did not wait to see it end. While the loop is
held nothing is flushed to disk, so a writer who sees the frozen tab and
reloads it loses what they typed since the hang. That is this review's
definition of a blocker, reached only by a pattern nobody types by
accident, which is why it is recorded as high. Reported to the writer when
it was confirmed.

*How to reach it again:* `.venv/bin/python e2e/review/q028_search_freeze.py`,
or by hand: a chapter holding that line, and that pattern in the Search
drawer with the regular-expression switch on.

*Size:* medium. *Version:* z.

*Fixed in 3.18.2.* A search or replace with the pattern switch on goes
through the `regex` package with a time limit, and lets go of the
interpreter lock while it matches.

### Q-029 · References · bug · medium · confirmed
**The library writes to the wrong .bib file.**

*Found by:* reading. *Where:* `server/main.py:3838`.

*What happens:* the reference library chooses the project's bibliography by
walking the whole project for `.bib` files and taking the first in
alphabetical order. A project with `refs.bib` for the paper and an exported
`library.bib` beside it has references added to `library.bib`, which the
document never reads. The walk also runs on the event loop, on every open
of the picker and on every add, scan and verify, and it descends into
`.git` and any other large folder.

*What should happen:* the library uses the file the document names in
`\bibliography` or `\addbibresource`, found through the dependency graph
that already knows it, and the walk, where one is still needed, runs off
the loop and skips `.git`.

*Size:* small. *Version:* z.

*Fixed in 3.18.5.* The library uses the `.bib` the document names, and
any fallback walk skips `.git` and runs off the loop.

### The editor and the preview in the browser

### Q-030 · Editor · bug · high · confirmed
**AltGr letters are taken for the app's shortcuts.**

*Found by:* reading, from a lead a reading agent raised.
*Where:* `frontend/src/actions.ts:90`, the chords at `frontend/src/actions.ts:43`.

*What happens:* the app's own chords, Ctrl and Alt with a letter or a
bracket, answer from anywhere and are matched on the physical key with
Ctrl and Alt both held. On Windows, the AltGr key that German, French,
Nordic and Polish layouts use to type `@`, `€`, `[`, `]` and more reaches
the browser as Ctrl and Alt together. So AltGr and E, the euro sign on a
German layout, is also the chord for Writing mode, and the brackets typed
through AltGr on several layouts are chords too. Nothing in the frontend
reads the AltGraph modifier state.

*What should happen:* a key press with AltGraph set is never a chord.

*Reproduced by simulation.* `e2e/review/q030-altgr.spec.ts` dispatches at
the editor exactly what a browser on Windows sends for AltGr: the
character in `key`, the physical key in `code`, and Ctrl and Alt both set.
Polish is worse than German. The app swallowed ą as the chord that shows
the Claude column, ę, which is also the euro sign on German and French
layouts, as Writing mode, and ó as quick open. A Polish writer on Windows
cannot type three of their letters in NextTex. ś, which has no chord, was
left alone. The Windows laptop has been asked to try a real layout if one
is already installed.

*How to reach it again:* `e2e/review/q030-altgr.spec.ts`.

*Size:* small. *Version:* z.

*Fixed in 3.18.6.* A press with AltGraph held, or with Ctrl and Alt
making a character other than the chord's letter, is never a chord.

### Q-031 · Preview · performance · high · confirmed
**The preview never frees a page it drew.**

*Found by:* reading. *Where:* `frontend/src/panes/Pdf.tsx:546`, drawing at
`frontend/src/panes/Pdf.tsx:484`.

*What happens:* the preview draws the pages within 400 pixels of the view
and never frees a page it drew once the page scrolls away. Reading a long
thesis from start to finish leaves a full-resolution canvas for every page,
and in the dark page a second canvas of the same size for the figures. A
single page is capped at sixteen megapixels; the document is not capped at
all.

*Measured.* `e2e/review/q031-pdf-memory.spec.ts`, written for this record,
builds the bench's thesis, 600 pages, scrolls the preview from the first
page to the last at 1600 by 1000, and adds up the canvases that hold
pixels. At the top: 27.6 megapixels. A quarter of the way: 57.7. Half:
87.8. Three quarters: 118.1. At the end: 147.4 megapixels, about 590 MB of
canvas at four bytes a pixel, and it climbs in a straight line with what
has been read. On a laptop with a browser full of other tabs, reading a
thesis through once is enough to make the tab the largest thing running.

*What should happen:* pages far from the view give their backing store
back, and are drawn again when they return.

*Size:* medium. *Version:* z.

### Q-032 · Preview · performance · medium · confirmed
**The first find in a long PDF is slow.**

*Found by:* reading. *Where:* `frontend/src/panes/Pdf.tsx:1324`.

*What happens:* the first find after a build reads every page's text one
page after another. The same file's layout code does the equivalent work
in parallel, with a comment explaining why serial awaits over two hundred
pages are slow. The first search in a long document pays that cost.

*What should happen:* the find path reads the pages the way the layout
does.

*Size:* small. *Version:* z.

### Q-033 · Editor · performance · low · confirmed
**Spelling rescans the whole file on each key.**

*Found by:* reading. *Where:* `frontend/src/panes/spellcheck.ts:238`.

*What happens:* with spelling on, every keystroke rebuilds the list of all
the document's lines and runs the skipped-lines scan over all of them,
inside the editor's update. Grammar does the same scan after a 600
millisecond pause. Spelling is off by default, so this is the cost for
those who turn it on, and it grows with the file.

*Measured.* `e2e/review/q033-typing-spelling.spec.ts`, written for this
record, switches spelling on and confirms the checker is marking before it
measures. In the seventy kilobyte chapter, keystroke to screen went from a
median of 3.7 to 4.5 ms with spelling off to 5.0 to 5.2 with it on, and the
p90 from about 5 to about 7, over two runs each. So it costs about a
millisecond a key on this machine, which is small, and more on a longer file
or a slower one.

A second thing turned up. `e2e/review/a12-typing.spec.ts` says in its header
that it measures with spelling and syntax colouring both on. It never turns
spelling on, and spelling has been off by default since the setting moved,
so the September number and every comparison with it measured without the
checker.

*What should happen:* the scan is kept and adjusted for the changed lines
only, or waits for typing to pause, as grammar does.

*Size:* small. *Version:* z.

### Q-034 · Editor · bug · medium · likely
**A script's running state can stick.**

*Found by:* reading. *Where:* `frontend/src/App.tsx:1631`.

*What happens:* a figure script's running state is corrected from the
server only when a different script's tab comes to the front. Builds have
a state frame sent on every reconnection of the event stream, and the
Claude column has its own reconcile. Scripts have neither. If the stream
drops during a run and the writer stays on that script's tab, the tab says
it is running for ever.

*What should happen:* the reconnection's first frame carries the scripts'
state, as it carries the builds'.

*Size:* small. *Version:* z.

### Q-035 · Projects · performance · low · confirmed
**Forgotten projects leave their browser keys.**

*Found by:* reading. *Where:* `frontend/src/panes/Projects.tsx:314`,
the keys written in `frontend/src/App.tsx`.

*What happens:* the drawer, folds, widths and open tabs are remembered in
the browser under keys named by project. Forgetting a project leaves all
of them behind. A writer who keeps one project per job application makes
and forgets projects often, and the keys only accumulate.

*What should happen:* forgetting a project forgets its keys.

*Size:* small. *Version:* z.

### The agent

### Q-001 · Agent · bug · medium · likely
**An OpenAI turn can end without saying so.**

*Found by:* reading, from a lead a reading agent raised.
*Where:* `nexttex/openai_agent.py:660`.

*What happens:* the OpenAI provider announces the turn and builds its first
message before the `try` that turns every failure into an ending. Building
the message reads the editor's state and the diagnostics. If either raises,
the task ends with no `done` event. The Claude provider has a `finally`
that sends `done` on every exit, so the two differ. The panel would wait
for an ending that never comes.

*What should happen:* the whole of the turn sits inside the guard, and a
turn always ends with `done`.

*Size:* small. *Version:* z.

### Q-002 · Agent · bug · medium · confirmed
**The OpenAI provider's round limit reports success.**

*Found by:* reading. *Where:* `nexttex/openai_agent.py:733`.

*What happens:* the OpenAI provider's tool loop stops after twelve rounds.
The comment calls a turn that has not settled by then stuck, but the loop
simply ends, after running the twelfth round's tools, and the turn is
reported as a success. The model never sees those tools' results, and the
writer is not told the turn was cut short.

*What should happen:* the turn ends with a notice saying it reached the
limit, and a subtype that says so.

*Size:* small. *Version:* z.

### Q-003 · Agent · comfort · low · confirmed
**A dropped stream shows Python's own error text.**

*Found by:* reading. *Where:* `nexttex/openai_agent.py:758`.

*What happens:* a failure on the first response, such as a refused key or a
quota, is turned into a sentence. A connection that drops while the answer
is streaming is shown as Python's own exception text.

*What should happen:* both go through the same explanation.

*Size:* small. *Version:* z.

### Q-004 · Agent · docs · low · confirmed
**The last permission position means two things.**

*Found by:* reading. *Where:* `nexttex/agent.py:1273` against
`nexttex/openai_agent.py:883`.

*What happens:* at the last permission position, the Claude agent asks
about nothing, including a write outside the project. The OpenAI provider
refuses a path outside the project in every position. The OpenAI side is
the safer one. But one control means two things depending on the provider,
and the settings sheet and the documents do not say so.

*What should happen:* the difference is stated where the positions are
explained, or the two are made the same.

*Size:* small. *Version:* z.

### Q-005 · Agent · bug · medium · confirmed
**A renamed style sheet breaks every figure script.**

*Found by:* reading. *Where:* `nexttex/figure_helper.py:68`,
`nexttex/plots.py:65`.

*What happens:* the figure helper every agent-drawn script imports loads its
style sheet at import time. The style sheet is written into the project
once and handed to the writer as theirs to edit. If they rename or delete
it, every figure script fails at import with a raw traceback. The plot
tool's explanation of a failed run recognises only a missing module, so the
writer is not told what went wrong. The helper has no test at all.

*What should happen:* a missing style sheet falls back to the defaults with
a warning in the run's output, and the helper gets tests of its own.

*Size:* small. *Version:* z.

### Q-006 · Agent · security · low · confirmed
**Builds and scripts inherit the server's whole environment.**

*Found by:* reading, from leads two reading agents raised.
*Where:* `nexttex/compile.py:660`, `nexttex/plots.py:112`.

*What happens:* builds and figure scripts are started with the server's
whole environment. Git is started with an environment built from nothing,
and the security section of `docs/architecture.md` explains why. A figure
script or a build with shell escape on can print any variable the server
was started with. This is defence in depth rather than a hole: such a
script runs as the writer's own user and can already read what that user
can. The OpenAI key is kept in the settings file and never put in the
environment.

*What should happen:* builds and scripts get an allowed list of variables,
as git does.

*Size:* small. *Version:* z.

### Q-007 · Agent · security · low · likely
**A script that daemonises outlives its stop.**

*Found by:* reading. *Where:* `nexttex/proctree.py`, called from
`nexttex/scripts.py`.

*What happens:* a stopped or timed-out script is ended by killing its
process group. A script that forks and starts a new session of its own
leaves that group, and keeps running after NextTex reports the run
stopped. There is also no limit on how many different scripts run at once;
the limit is one run per script.

*What should happen:* on Linux the run is placed in its own cgroup or
tracked by descendant, and a small cap limits concurrent runs.

*Size:* medium. *Version:* z.

### Collaboration and comments

### Q-008 · Collaboration · bug · medium · confirmed
**A peer's comment of the wrong shape breaks the Comments drawer.**

*Found by:* a reading agent's lead, then `e2e/review/q008_comment_shape.py`,
which found a second way in. *Where:* `server/collab/comments.py:96` and
`server/collab/comments.py:119`, with the peer path at
`server/collab/peers.py:516`.

*What happens:* comments live on the shared manifest, and a peer's changes
to it are applied as they arrive, without the checks this install's own
routes make. The driver puts threads on the manifest the way a sync would,
and asks for the listing the Comments drawer reads.

- **Anchors that are not base64.** The thread is treated as detached and
  keeps the `line` the peer wrote. With one thread's line a number and
  another's text, the listing's sort raises `TypeError`.
- **An empty anchor.** That is valid base64 for no bytes, and pycrdt's
  `StickyIndex.decode` panics on it. A pyo3 panic is a `BaseException`, not
  an `Exception`, so the `except Exception` written around exactly this
  call does not catch it.
- **Length.** A peer's comment body of thirty thousand characters is
  accepted; the twenty thousand limit applies only to this install's
  routes.

In both of the first two cases the Comments drawer fails for everyone on
the project. The drawer is also the only way to delete the thread that
broke it. A collaborator is someone the writer let in, so the likely cause
is a buggy or older peer rather than a hostile one. The same class of
fault, a pycrdt panic escaping an `except Exception`, could in principle
reach other places pycrdt reads what a peer sent; this probe did not look
further.

*What should happen:* `where` catches the panic as well, and treats an
anchor shorter than a sticky index as detached. The listing coerces what it
sorts on to the types it expects. A peer's comment is trimmed to the same
limits as a local one when it is read.

*How to reach it again:* `.venv/bin/python e2e/review/q008_comment_shape.py`.

*Size:* small. *Version:* z.

*Fixed in 3.18.4.* The listing holds a peer's thread to the local shapes
and limits, treats an empty anchor as detached and catches the panic.

### Q-009 · Collaboration · bug · high · confirmed
**Two people's new files of one name merge into one.**

*Found by:* a reading agent's lead, which was wrong in its mechanism, then a
driver that found the real one. *Where:* `server/collab/store.py:975`, the
id rule at `server/collab/store.py:540`, and the test at
`tests/collab/test_hostile_peers.py:75`.

*What happens:* the September review found that two collaborators who each
created `chapters/03.tex` while apart derived the same id from the path,
and their two documents merged, each ending up with both chapters
interleaved. Its fix, in `b2ef5d1`, gave a file created here random bytes
for an id and kept the path-derived id for adopting a project's existing
files. The docstring of `_new_id` still describes that. But the only caller
of `_new_id` in the program is `adopt`, with `adopting=True`, and every new
file reaches the manifest through `adopt`: a file made in another editor,
by the agent, by a script, by a pull. So every new file gets the id derived
from its path again. The random branch is reached only by the test meant
to guard it, which calls `_new_id` directly, so the test passes while the
fault it was written for is back.

*Reproduced.* `e2e/review/q009_same_path.py` gives two peers the same
`main.tex`, has each write and ingest its own `chapters/03.tex`, then
exchanges manifests and documents as a sync does. Both got the id
`ad764fcd17c7e88e`. After the sync both documents, and both disks, read
"Bob's chapter three." followed by "Alice's chapter three.", and neither
person was told. On real prose typed at the same time the two would
interleave rather than sit one after the other.

*What should happen:* a file first seen on disk in a shared project gets a
random id, as the docstring says, and only a project's first adoption uses
the path. If two live records still meet on one path, one keeps the path
and the other is renamed to the kept-both name the upload chooser uses,
and both people are told. The test drives the real path, a file ingested
on two peers, rather than calling the private method.

*Size:* medium. *Version:* z.

*Fixed in 3.18.4.* A new file in a shared project gets an id of its own;
two live records on one path are parted, or merged only when they say
the same thing, and the notices say so. The driver now marks its two
projects shared, which it had not, and shows two files on each disk.

### Q-010 · Collaboration · test · low · confirmed
**The hostile-peer tests miss comments and races.**

*Found by:* reading. *Where:* `tests/collab/test_hostile_peers.py`.

*What happens:* the hostile-peer tests cover paths, control files, forged
share ids, the provenance of files and frame size. None sends comments or
file records through the sync path, none removes a peer while a file is in
flight, and none races a rename on one side with an edit on the other.

*What should happen:* those cases get tests, starting with the two above.

*Size:* medium. *Version:* none.

*Fixed in 3.18.4.* `tests/collab/test_hostile_peers_sync.py` sends a
malformed thread and a fenced file record through a real sync, races a
rename with an edit, and removes a peer while a figure is on its way;
`tests/collab/test_same_path_apart.py` holds the two new files.

### Q-054 · Collaboration · bug · medium · confirmed
**A comment stays on stray letters after an outside edit.**

*Found by:* `e2e/review/q054_comment_outside_edit.py`, written for the
outside-edits area. *Where:* `server/collab/comments.py:79`, with the fold
of an outside edit at `server/collab/store.py:1446`.

*What happens:* a thread on "converges quickly" survives outside edits
well when they are small. Text added above moves it down with the
paragraph, and a rewording to "converges slowly" keeps it on the new
words. But when another editor or a pull replaces the whole paragraph, the
fold into the shared text is a character diff, and it keeps the letters
the old and new paragraphs happen to share. The comment's two positions
land on those, and the thread stays attached to "ly", from "entirely",
with its old quote, instead of being shown as detached. Typing the same
change in the editor deletes the text under the comment and detaches it
properly, so only outside edits do this, and the writer calls those a
first-class case.

*What should happen:* a thread whose range now holds text sharing little
with its quote is shown as detached, with its quote, the way a deleted
range is.

*How to reach it again:*
`.venv/bin/python e2e/review/q054_comment_outside_edit.py`.

*Size:* small. *Version:* z.

*Fixed in 3.18.4.* A range that holds little like its quote is detached,
by one measure in the server and the editor, and an outside edit tells
the drawer to read its threads again.

### The server

### Q-011 · Server · test · low · confirmed
**The rename route has no path-escape test.**

*Found by:* reading, from a lead a reading agent raised.
*Where:* `tests/api/test_files.py`.

*What happens:* the rename route resolves both of its paths through the
same fence as every other route, and is safe. It has no path-escape test
for either path, and `CLAUDE.md` requires one for every route that takes a
path. The other routes the survey listed were read and are safe, and each
either has an escape test or takes no path at all.

*What should happen:* the rename route gets escape tests for both fields.

*Size:* small. *Version:* none.

### Install and update

### Q-012 · Install · bug · high · likely
**An update that fails to start cannot come back.**

*Found by:* reading, from a lead a reading agent raised.
*Where:* `server/main.py:6201`, `nexttex/install/service.py:77`.

*What happens:* the update page pulls, installs and fetches the interface,
then restarts. If the new code then fails to start, the service manager
restarts the same broken commit every three seconds for ever. No last good
commit is kept, and nothing goes back to one. The page may update as soon
as the interface for a commit is published, and the interface workflow
finishes in about half a minute, while the Python workflow takes nearly
five. So a commit that breaks start-up can reach an install before any
test has said so. The footer shows the server as down, then its manual
card.

*What should happen:* the update records the commit it left. If the new
server has not answered its health check within a minute, it goes back to
that commit and says so. The update is offered only once CI is green for
the commit, not only once its interface exists.

*Size:* medium. *Version:* z.

### Q-013 · Install · bug · low · confirmed
**The update script skips the interface check.**

*Found by:* reading. *Where:* `scripts/update.sh:150`.

*What happens:* the update script run by hand does not check that the
interface for the new commit exists. When it cannot fetch one and there is
no Node, it keeps the old interface in front of the new server. The footer
does show that the two commits differ, so the writer is told, but only
afterwards.

*What should happen:* the script refuses, or waits, when the interface for
the commit is not published yet, as the page does.

*Size:* small. *Version:* z.

### Q-014 · Settings · bug · low · likely
**Two tabs signing in to Claude cancel each other.**

*Found by:* reading. *Where:* `nexttex/claude_auth.py:70`.

*What happens:* there is one sign-in to Claude at a time for the whole
server, and starting one cancels any other. Two tabs on the sign-in screen
cancel each other, and the cancelled one is told the sign-in finished.

*What should happen:* the second tab joins the sign-in already running, or
is told another is in progress.

*Size:* small. *Version:* z.

### The suites, CI and dependencies

### Q-015 · Suites · test · medium · confirmed
**Two Python tests fail on CI by timing.**

*Found by:* reading the last fifty-three runs of each workflow with
`gh run list`.
*Where:* `tests/api/test_history_events.py:76`,
`tests/collab/test_files_between_peers.py:103`.

*What happens:* the `python` workflow failed three times in fifty-three
runs. One was a real README assertion, fixed the same day. The other two
are tests that depend on timing. One expects three saves made in a row to
fall into one history event, and on the runner of 23 September they fell
into two. The other sleeps 0.4 seconds and then asserts that a file was
not asked for again. The first failed once more during this probe, on 25
September, in run 36100772138, on a commit that changed only `REVIEW.md`
and a review driver. Neither is on the tracker's list of flaky tests,
which names only browser tests, and neither has been changed since.

*What should happen:* each waits on the event it means rather than on the
clock, and the tracker names them until it does.

*Size:* small. *Version:* none.

### Q-055 · Suites · test · low · confirmed
**The six browser flakes did not reproduce.**

*Found by:* the capped flake hunt the tracker's backlog asked for.

*What happens:* the backlog names six browser tests that fail about once
in a full run under load and asks for a full tier with retries off, run
until one fails. The probe ran three, one after another, on 25 September
2026, each while other work loaded the machine: 575 passed three times,
1725 runs with no failure, 17.7 to 17.9 minutes each. Nothing failed, so
there is no trace to read. What did fail in the same week is on CI, and it
is two Python tests, Q-015, which the backlog does not name.

*What should happen:* the backlog item says what these runs showed, and
the next step moves to CI, where the retries' own reports are kept: read
which of the six the retries rescued there, if any.

*Size:* small. *Version:* none.

### Q-056 · Suites · test · medium · confirmed
**The fidelity harness and the axe sweep pass while skipping.**

*Found by:* the screen pass. *Where:* `e2e/shots/fidelity.spec.ts`.

*What happens:* `docs/style-guide.md` asks every interface change to be
rendered with this harness in both themes and set beside the direction
page. Run in full on 25 September 2026 it took 10.9 minutes, reported
`1 passed`, and wrote failure notes instead of images for 13 of its 98
surfaces, most in both themes: the Sections, Search, References and
Deleted drawers, the submit drawer's second view, the Git drawer's history
in the dark, the narrow frame, the notices, the share sheet, the equation
card's Copied state in the light, the spelling language's suggestion and
the spelling menu in the dark. The one screenshot looked at shows why: all
the surfaces share one project, earlier surfaces edit it, and by the time
the Sections drawer was reached `main.tex` held no section to list. So the
harness is correct only for whoever renders a surface or two, and its
green result says nothing about the rest.

The review's own axe sweep, `e2e/review/a-axe-sweep.spec.ts`, has drifted
the same way: it skipped five of its eight surfaces, because the controls
it clicks were renamed in the visual overhaul, and passed. A tool that
passes while doing less than it says is how a gap stays hidden.

*What should happen:* each surface starts from a project of its own, or
the harness restores the fixture between surfaces, and a surface that
cannot be reached fails the run. The same for the review drivers that are
kept: a skip is a failure.

*Size:* medium. *Version:* none.

### Q-069 · Suites · test · low · confirmed
**The suites leave their temporary folders behind.**

*Found by:* the probe's close-out, counting what it had left in `/tmp`.
*Where:* `tests/collab/conftest.py:29`, `e2e/specs/papers.spec.ts:28`, and
the browser harness in `e2e/server.ts`.

*What happens:* `/tmp` on this machine holds 1927 folders named for
NextTex's tests, 154 MB, the oldest from 5 September: 591 from the browser
harness, 378 from the API tests, 371 and 274 from the papers spec's
folders, and 304 from the collaboration tests. The collaboration conftest
makes its state folder at import and never removes it, so every Python run
leaves one; the papers spec names its folders by the time and does not
remove them. The browser harness removes its sandbox in `stop()`, so its
leftovers are likely the runs that ended without reaching it, the review
drivers among them. The probe removed every folder made during its own
run, 41 of them, and left the older ones.

*What should happen:* each suite removes what it makes, through pytest's
`tmp_path` or a session finaliser, and the papers spec through its own
cleanup, so a developer's machine does not fill with them.

*Size:* small. *Version:* none.

### Q-016 · Suites · test · low · confirmed
**The local venv is newer than the Python floor.**

*Found by:* reading. *Where:* the checkout's own virtual environment.

*What happens:* `CLAUDE.md` says CI pins Python 3.10, so nothing newer may
be used. The checkout's `.venv` on this machine is Python 3.13, so the
checks run by hand cannot see a 3.11 feature until CI does.

*What should happen:* `scripts/check.sh` warns when the interpreter is
newer than the floor, or the venv is made with 3.10.

*Size:* small. *Version:* none.

### Q-036 · Suites · security · low · confirmed
**Audit advisories and a noisy build.**

*Found by:* `npm audit` and `pip-audit` on 25 September 2026.

*What happens:* the Python environment has no known vulnerabilities. The
frontend has four advisories. Three are `nanoid`, reached through the
spelling engine's loader, and are about generator sizes the loader never
passes. One is `diff`, in `parsePatch` and `applyPatch`, which the app
does not call. None is reachable. The build also prints a warning that the
loader's ES build calls a namespace. `frontend/src/panes/hunspell-speller.ts`
imports the CommonJS build to avoid exactly that, so the warning is noise,
but it is printed on every build and will hide the next real one. Several
dependencies are a major version behind: `pdfjs-dist` at 4.10 against 6.3,
`vite` at 6 against 8, and `diff` at 7 against 9.

*What should happen:* the build is quiet, and the major upgrades are
weighed, `pdfjs-dist` first, since the preview is built on it.

*Size:* medium. *Version:* z.

### Q-037 · Suites · security · low · confirmed
**Workflow actions are pinned by tag.**

*Found by:* reading. *Where:* every `uses:` line under `.github/workflows/`.

*What happens:* each action is named by a moving tag such as `@v4` rather
than by a commit. The release workflow runs with permission to write the
repository's contents.

*What should happen:* the release workflow's actions at least are pinned
to commits.

*Size:* small. *Version:* none.

### Q-041 · Suites · docs · low · confirmed
**The documented check times are half the real ones.**

*Found by:* the baseline. *Where:* `docs/testing.md`, the first code block,
and the comment at the top of `scripts/check.sh`.

*What happens:* both say the full run takes about twelve minutes. It took
22 minutes and 8 seconds, 18 of them in the browser tier, which has grown
from 228 tests to 575 since the numbers were written.

*What should happen:* the numbers are the ones measured, or the passages
say what the time depends on.

*Size:* small. *Version:* none.

### Q-042 · Suites · improvement · medium · confirmed
**The projects screen loads the whole workspace.**

*Found by:* the baseline. *Where:* `bench/thresholds.json`.

*What happens:* the initial bundle is 861.0 kB against a budget of 864, so
three kilobytes of room are left. The budget's own comment names the
settings card's trigger as the refactor that would win room back, and it
has not been done.

*Measured.* A build with source maps, written to the probe's scratch
directory, attributes the initial chunk's 861 kB by source. CodeMirror is
about 355 kB of it: the view 182, the state 46, completion 34, language 30,
commands 23, search 20, and lezer 27. React's DOM is 177. Then the app:
`frontend/src/App.tsx` 33, `frontend/src/panes/Chat.tsx` 24,
`frontend/src/panes/Projects.tsx` 23, `frontend/src/panes/Editor.tsx` 20,
`frontend/src/panes/FileTree.tsx` 20, and the `diff` package 12. Everything
a project's workspace needs is in the chunk the projects screen loads,
although the projects screen is what every visit shows first and draws none
of it. The Claude column ships to installs that have turned the agent off.

*What should happen:* the workspace, meaning the editor, the tree and the
Claude column, becomes a chunk fetched when a project opens. That takes
roughly 450 kB off the first paint of the projects screen and gives the
budget room for years. The fix plan does this before it adds any weight.

*Size:* medium. *Version:* z.

*Fixed in 3.18.7.* The editor, the Claude column and the file tree are
fetched when a project opens; the entry chunk is 349.7 kB and its
budget 400.

### The look

### Q-038 · Look · consistency · medium · confirmed
**Raw controls and literal sizes outside the kit.**

*Found by:* grep. *Where:* 32 files under `frontend/src/panes/` and
`frontend/src/App.tsx`.

*What happens:* `docs/style-guide.md` says every control comes from
`frontend/src/ui/` and that a literal colour, size or radius in a component
is a defect. Outside the kit there are 88 raw `button`, `input`, `select`
and `textarea` elements, in 32 files, led by `frontend/src/panes/Chat.tsx`
with twelve and `frontend/src/panes/Projects.tsx` with eight. There are 189
arbitrary pixel sizes or inline literal styles in components, such as
`text-[12.5px]` in `frontend/src/panes/AgentSheet.tsx:255`. Some predate the
overhaul and were missed by it. Others are newer: the comment cards'
textareas came with comments on 24 September. A few are fair, such as the
three hidden file inputs. Nothing enforces the rule, which is how the
drift the guide was written to stop has started again.

*What should happen:* the kit gains what these need, the components move
onto it, and a test fails on a raw control or a literal size outside
`frontend/src/ui/`, with a short list of allowed exceptions and their
reasons.

*Size:* large. *Version:* z.

### Accessibility

A reading agent went through the frontend for names, keyboard reach,
focus, live regions and motion. It found the kit doing its job: the icon
button cannot be built without a label, sheets trap and return focus, the
settings sheet is a proper set of tabs, the notices region is a live
region, and one reduced-motion rule in `frontend/src/styles.css` covers
every animation. A scan for icon-only controls with no name found none.
What it found is on the newest surfaces. Each lead was checked here.

### Q-050 · Accessibility · accessibility · high · confirmed
**The Comments drawer's rows nest buttons.**

*Found by:* reading. *Where:* `frontend/src/panes/CommentsPanel.tsx:55`.

*What happens:* each thread in the Comments drawer is a `div` with
`role="button"` that holds real buttons: Resolve or Reopen, Delete, and
Delete's own Delete and Keep. A screen reader is told the row is one
button, and the buttons inside are folded into its name or cannot be
reached, so a thread cannot reliably be resolved or deleted without
sight. `frontend/src/panes/Diagnostics.tsx:359` and
`frontend/src/panes/History.tsx:370` carry comments explaining exactly
why a row must not be done this way, from when the September review found
it there. The Comments drawer came later and does it again, and neither
`e2e/specs/a11y.spec.ts` nor the review's axe sweep opens it.

*Confirmed by axe.* `e2e/review/q050-axe-drawers.spec.ts`, written for
this record, opens all twelve drawers from the rail with a thread in the
Comments drawer, in both themes. Axe reports `nested-interactive`, of
serious impact, on `.nx-comment-row` in both, and nothing of serious or
critical impact on the other eleven drawers.

*What should happen:* the row follows the Diagnostics drawer's pattern, and
the a11y spec opens the Comments drawer.

*Size:* small. *Version:* z.

### Q-051 · Accessibility · accessibility · medium · confirmed
**A thread's card takes no focus.**

*Found by:* reading. *Where:* `frontend/src/panes/CommentCards.tsx`.

*What happens:* the card for a new comment puts the cursor in its text box
when it opens. The card for an existing thread, opened from the gutter, a
hover card or a row in the drawer, does not move focus at all, has no role,
and is not announced. A keyboard user is left where they were, with
nothing to say a card appeared or how to reach its Reply and Resolve.

*What should happen:* opening a thread moves focus into its card, Escape
returns it, and the card is a labelled dialog or region.

*Size:* small. *Version:* z.

### Q-052 · Accessibility · accessibility · medium · confirmed
**The build strip changes without being announced.**

*Found by:* reading. *Where:* `frontend/src/panes/Status.tsx`, and the
update control in `frontend/src/panes/Projects.tsx`.

*What happens:* the build strip changes between building, errors and built
with no live region, and the projects screen's update control changes only
its label. A screen reader user hears neither a build finishing nor
failing, nor an update wanting attention, unless they go and look. The
notices area in `frontend/src/App.tsx` is a live region, with a comment
saying why, so the pattern is already in the app.

*What should happen:* a build's ending and an update's change of state are
said through the notices region, or through a polite live region of their
own.

*Size:* small. *Version:* z.

### Q-053 · Accessibility · accessibility · low · confirmed
**The pane dividers move only by dragging.**

*Found by:* a reading agent's comfort list, checked here.
*Where:* the dividers in `frontend/src/chrome.tsx`.

*What happens:* the dividers between the panes resize only by dragging.
They have no keyboard handling and no separator role, so a writer who
works from the keyboard can fold the rail with Ctrl and B but cannot give
the preview a little more room.

*What should happen:* a divider takes focus, is a separator with its
value, and moves with the arrow keys.

*Size:* small. *Version:* z.

### The outside legs

**What was run, and what it showed.** On 25 September 2026.

- **Crossref and doi.org.** `tests/test_papers_live.py` with `NEXTTEX_LIVE`
  set: 3 passed in 3.3 seconds. The publishers still answer in the shape
  the importer, the tool and the checker read.
- **Ollama.** `tests/test_openai_ollama.py` against `qwen3-coder:30b`: 2
  passed in 19 seconds. Then four turns through the server's own routes on
  a sandbox set to the OpenAI provider: an edit, a figure, a Stop six
  seconds into a long answer, and the transcript a reload rebuilds. On the
  second run all four behaved: the edit landed through `edit_file`, the
  figure ran with its cards answered, and Stop ended `interrupted` with the
  notice "Stopped.". On the first run the model answered the edit and the
  figure in prose without calling a tool, which is the model's choice and
  not a fault in NextTex.
- **Claude.** `tests/test_live_agent.py`: 3 passed in 12 seconds. Then the
  same four turns on `claude-sonnet-5`, twice. The edit changed the one
  word and made one version. The figure turn drew `figures/square.pdf`,
  inserted a figure environment, added `graphicx` and built cleanly. Stop
  ended `interrupted`. The transcript a reload rebuilds held 31 items of
  the same kinds the live stream showed; it was not compared item by item.
  Three turns cost $0.24; the whole live leg cost about $0.55.
- **The login.** The Claude credentials' fingerprint was the same before
  the first live call and after the last. The sign-out control was never
  pressed.

### Q-044 · Agent · improvement · low · confirmed
**A figure script fails without a figures folder.**

*Found by:* the Ollama leg. *Where:* `nexttex/plots.py:41`, and the
helper's own `save` at `nexttex/figure_helper.py:110`.

*What happens:* the figure helper creates `figures/` when it saves. A
script the model writes with a plain `savefig('figures/square.pdf')`, which
`qwen3-coder` did, fails on a project with no `figures/` yet. The model
then spends a round listing files and a second card running the script
again.

*What should happen:* the runner creates `figures/` before it runs a
script, since that is where the tool tells the model figures go.

*Size:* small. *Version:* z.

### What a writer reaches for and does not find

A reading agent assembled the candidates against the README's standard, a
Jupyter notebook, and against `ROADMAP.md`'s list of what was considered
and refused. Each was checked here against the code before it was written
down. Phase 5's use of the app adds to this section.

### Q-045 · Files · comfort · medium · confirmed
**Renaming a file breaks every reference to it.**

*Found by:* a reading agent, checked here. *Where:* `nexttex/rename.py:31`,
the rename route at `server/main.py:2936`.

*What happens:* renaming or moving a chapter or a figure in the Files
drawer moves the file and nothing else. Every `\input`, `\include` and
`\includegraphics` that named it is now broken, and the next build says
so. F2 already renames a label, a citation key or a macro in every file,
but a file path is not one of the kinds it knows.

*What should happen:* renaming a file that other files name offers, once,
to change those names too, the way F2 does, through the same
rename-everywhere route. It adds no new control: one confirmation where a
rename already is.

*Size:* medium. *Version:* y.

### Q-046 · Collaboration · comfort · medium · confirmed
**A comment cannot suggest a replacement.**

*Found by:* a reading agent, checked here.
*Where:* `frontend/src/panes/CommentCards.tsx`, `server/collab/comments.py`.

*What happens:* co-authors have two ways to disagree about a sentence: edit
it, which overwrites the other's prose in place, or comment on it, which
changes nothing. The everyday middle, "here is how I would put it, your
call", has no form.

*What should happen:* a comment can carry a replacement for the text it is
on, and the thread's Resolve becomes Accept for such a thread, applying it
as an ordinary edit with its own version. One control changes its meaning
rather than a second being added.

*Size:* large. *Version:* y.

### Q-047 · Files · comfort · low · confirmed
**A project cannot be duplicated.**

*Found by:* a reading agent, checked here.
*Where:* `frontend/src/panes/Projects.tsx`, and `_copy_tree_skips` in
`server/main.py`.

*What happens:* a writer who keeps one project per job application, which
the application template is made for, and who has refined a resume and a
letter they want to start from, has no Duplicate for a project. They copy
the folder by hand and open it. The server already copies a folder safely
for the Files drawer's duplicate.

*What should happen:* a project row's More menu offers Duplicate, placed
before the destructive items.

*Size:* small. *Version:* y.

### Q-048 · Compile · improvement · low · confirmed
**No marked-up PDF of what changed.**

*Found by:* a reading agent, checked here.

*What happens:* a revised paper usually goes back to the journal with a
PDF that marks what changed since the submitted version. NextTex shows
patches in the History and Git drawers, never a typeset document with the
changes marked, and nothing in the program runs `latexdiff`.

*What should happen:* when `latexdiff` is installed, which the installer's
survey could note as it notes pandoc, the History or Git drawer offers a
marked-up PDF against a chosen version or commit.

*Size:* medium. *Version:* y.

### The screen pass

The fidelity harness rendered 85 of its 98 surfaces in both themes, and
four reading agents compared each render with its drawing on the direction
page and with `docs/style-guide.md`. Every lead they raised was opened here
and checked before it was written down. Where a render matched its drawing
the reading is not repeated.

### Q-057 · Look · consistency · low · confirmed
**An undrawn Back on the projects screen.**

*Found by:* the screen pass, checked in the light render of the projects screen and in the code.
*Where:* `frontend/src/panes/Projects.tsx:728`.

*What happens:* when the projects screen is reached from an open project, a
quiet Back sits at the end of the top row, after Other ways in, and returns
to that project. It is deliberate, but the direction page's projects
screen does not draw it, and the word alone does not say where it goes,
while the Archived and Trash views say "Back to projects" in full. A
reading agent took it for a control with no destination, which is what a
writer may take it for too.

*What should happen:* the control names the project it returns to, and the
direction page draws it, as the process in `CLAUDE.md` requires for a
visible change.

*Size:* small. *Version:* z.

### Q-058 · Look · consistency · low · confirmed
**Browse sits outside its field.**

*Found by:* the screen pass, checked in the dark render of the New project sheet.
*Where:* `frontend/src/panes/Projects.tsx:1243`.

*What happens:* the direction page draws the New project and Join sheets'
Where as one field with Browse as its trailing action inside it. The built
sheets have a text field and, beside it with a gap, a separate bordered
Browse button: two controls where the drawing has one.

*What should happen:* the field carries Browse as its own trailing action,
as drawn, or the page is redrawn to what was built and the difference
decided.

*Size:* small. *Version:* z.

### Q-059 · Look · consistency · low · confirmed
**The composer menu hides its unchosen options.**

*Found by:* the screen pass, checked in the light render of the composer's
menu. *Where:* the menu under the composer's chip,
`frontend/src/panes/ComposerMenus.tsx`.

*What happens:* the direction page draws the model and permission choices
as radio rows: every option has a ring, the chosen one is filled in the
hint colour, and "Never ask about anything" is set in the warning colour.
The built menu marks only the chosen options, with a dot, leaves the rest
with nothing, and draws "Never ask about anything" like its neighbours. So
the menu does not show that the rows are a choice between alternatives,
and the one dangerous choice does not look it.

*What should happen:* as drawn: a ring on every option and the warning
colour on the last.

*Size:* small. *Version:* z.

### Q-060 · Look · consistency · low · confirmed
**The file menu's order and length.**

*Found by:* the screen pass, checked in the light render of a file row's
menu. *Where:* the file menu in `frontend/src/panes/FileTree.tsx`.

*What happens:* the direction page orders the menu's last group New file
here, New folder here, Upload here. The built menu puts Upload here first.
The menu is also twelve items in five groups, with a second destructive
item, "Delete version history", in the middle, where the writer's rule is
a short menu with the destructive action last.

*What should happen:* the order drawn, and "Delete version history" moved
down beside Move to trash or into the History drawer, where the menu
already has a way to reach it.

*Size:* small. *Version:* z.

### Q-061 · Look · comfort · low · confirmed
**The upload sheet does not name its folder.**

*Found by:* the screen pass, checked in the light render of the upload
sheet and in `frontend/src/panes/UploadStaging.tsx:141`.

*What happens:* when files are dropped on a folder, the folder is taken as
the destination and the sheet shows no destination row, by design. When a
name collides, the sheet still opens to ask about it, and then nothing on
it says which folder "replaces" and "1 file is already there" are about.
The direction page's drawing names it: "Into figures".

*What should happen:* the sheet always names the destination, as a line of
text when it is not open to question.

*Size:* small. *Version:* z.

### Q-062 · Agent · performance · low · confirmed
**The composer's menu takes 870 ms to open first.**

*Found by:* the screen pass, whose 1.25 sweep never caught the menu open,
then `e2e/review/q-model-menu-125.spec.ts`. *Where:* the lazy
`ComposerMenu` in `frontend/src/panes/Chat.tsx:1028`.

*What happens:* the menu under the composer's chip, which picks the model
and what Claude asks about, is fetched the first time it is opened. On
this machine, against a server on the same host, it appeared 870 and 885
ms after the first click, at 1x and at 1.25 alike, with nothing on screen
in between; every later open was immediate. On a laptop over a tailnet the
first open is slower still. The sweep waited 200 ms and photographed a
closed menu, which is how this was found.

*What should happen:* the chunk is fetched when the column first draws, or
when the pointer reaches the chip, so the first open is as quick as the
rest.

*Size:* small. *Version:* z.

*Fixed in 3.18.7.* The menus come with the Claude column's own chunk.

### Q-063 · Agent · comfort · low · confirmed
**A waiting card is pushed behind the composer.**

*Found by:* the screen pass, checked in the dark render of the live Claude
column. *Where:* `frontend/src/panes/Chat.tsx:438`.

*What happens:* the conversation follows the stream while the reader is at
the bottom, and re-pins only when the conversation changes. Opening a
folded run of tool calls while a permission card waits makes the content
above the card taller without changing the conversation, so the card is
pushed down and its bottom row, Allow always and Deny, goes behind the
composer. The keys still answer, but the buttons are out of sight.

*What should happen:* while pinned, the column stays at the bottom when its
content grows for any reason, for example through a resize observer on
the stream.

*Size:* small. *Version:* z.

### Use as a writer

`e2e/review/q-journey.spec.ts` does a week of a paper in one sitting on a
new article, timing each act and photographing it: a project made from the
New project sheet in 2.2 seconds to the first page, completion offered at
`\ref{` in under a second, an error on the strip 5.5 seconds after it was
typed and gone 1.9 seconds after it was fixed, History and Download each
open in under a second. What it could not do, or did twice, is below.

### Q-064 · Editor · comfort · medium · confirmed
**No word count on a 1440 pixel laptop.**

*Found by:* the writer journey, then `frontend/src/panes/Status.tsx:178`.

*What happens:* the word count sits on the status strip under the source,
and is dropped, by design, when the source pane is narrower than 640
pixels. In the default layout at 1440 pixels wide, a common laptop, the
source pane is about 420 pixels, so the word count is never on screen. It
is not in the command palette or anywhere else, so a writer on that laptop
with a word limit has no count at all unless they drag the panes apart or
fold the Claude column.

*What should happen:* the count stays reachable at every width: the
palette offers it, and the strip keeps it ahead of segments that matter
less when it has to drop one.

*Size:* small. *Version:* z.

### Q-065 · Editor · comfort · low · confirmed
**Text after end-document is ignored unmarked.**

*Found by:* the writer journey, whose first run typed three lines after
`\end{document}`, the same mistake the September review recorded making.

*What happens:* TeX ignores everything after `\end{document}` and says
nothing, and so does the editor. Three lines typed there, a section and a
reference, built cleanly and appeared nowhere, and nothing on screen said
why.

*What should happen:* the editor shows text after `\end{document}` dimmed,
with a hover that says TeX ignores it.

*Size:* small. *Version:* y.

### Q-066 · Preview · bug · high · confirmed
**An unclosed brace wipes the preview, which then says the document is empty.**

*Found by:* the writer journey, three runs out of three, then the same
journey with the file on disk, the PDF route and the last build logged at
every step. *Where:* the build writing straight into `build/main.pdf` in
`nexttex/compile.py`, and the empty state at
`frontend/src/panes/pdf-absence.ts:48` and `frontend/src/panes/Pdf.tsx:1470`.

*What happens:* the journey left a `\ref{` without its closing brace, the
most ordinary of typing slips, which Q-068 makes easy. pdfTeX stopped with
"File ended while scanning use of \T@ref", "Emergency stop" and "Fatal
error occurred, no output PDF file produced!", and in doing so it removed
`main.pdf`. The logged state goes from `main.pdf 230839 bytes, the route
200` at one step to `main.pdf absent, the route 404` at the next. NextTex
builds into the one file the preview serves and keeps no copy of the last
good one, so the preview lost the article's two typeset pages. With the
PDF gone after a finished build, `absenceFrom` answers "empty", and the
pane told the writer "Nothing has been typeset yet. An empty document
produces no pages" and offered a basic document, beside a strip saying "3
errors" and a page counter still saying "of 2". The offer is safe, since
the server refuses to put a template over a document with anything in
it, but the statement is false, and the pages are gone until the brace is
found. A build with errors that are not fatal keeps its PDF, which is why
a cleaner reproduction first missed it.

*What should happen:* the last good PDF is kept, for example by building
to a scratch name and moving it over only when a PDF was written, and the
preview shows it, marked as out of date, with the errors beside it. The
pane never calls a document empty after a build that failed.

*How to reach it again:* `e2e/review/q-journey.spec.ts`, whose log prints
the file, the route and the build at each step, and on the first step that
finds the PDF gone, the end of `main.tex` and the log's fatal lines.

*Size:* medium. *Version:* z.

*Fixed in 3.18.3.* The PDF is moved aside while the engine runs and put
back when the engine wrote none; the pane shows it with one line saying
where the build stopped, and a failed build is never called empty.

### Q-068 · Editor · comfort · medium · confirmed
**A label accepted in a reference leaves its brace open.**

*Found by:* the writer journey, then `e2e/review/q068-ref-completion-brace.spec.ts`.
*Where:* the editor's completion, `frontend/src/panes/latex-complete.ts`.

*What happens:* typing `\ref{` leaves no closing brace, and accepting a
label from the completion list inserts the label and nothing after it, so
`See Section~\ref{sec:introduction` is what the writer has, and whatever
they type next goes inside the argument. An unclosed brace in a reference
is a fatal error, and by Q-066 it costs the preview its pages.

*What should happen:* accepting a label, a citation key or a file name
inside braces closes the brace when it is not already closed, and puts the
cursor after it.

*Size:* small. *Version:* z.

*Fixed in 3.18.3.* Accepting a label, a key or a file name inside braces
closes the brace when it is open and leaves the caret after it.

### Q-067 · Editor · bug · medium · confirmed
**The first search typed goes into the document.**

*Found by:* the writer journey, then `e2e/review/q067-search-focus.spec.ts`.
*Where:* the lazily fetched Search drawer, `frontend/src/panes/SearchPanel.tsx`.

*What happens:* the first time in a session a writer presses Ctrl, Shift
and F and types at once, what they type goes into the document they were
editing, not into the search box, because the drawer's code is still
being fetched and focus has not moved. The journey's search word landed as
a line of `main.tex`. Once the drawer has been opened, typing at once goes
to the box every time. The window is as long as the first fetch, which for
the composer's menu was nearly 900 ms on this machine, Q-062.

*What should happen:* the drawer's code is fetched before it is needed, or
keystrokes after the chord are held for the box until it is ready. Either
way, a chord that opens a text box never lets its first letters into the
paper.

*Size:* small. *Version:* z.

### The Windows leg, after the close

The Windows tester session sent its results on 25 September 2026, after
the probe had closed. The update from the page, from 3.17.4 to 3.18.1,
worked: 82 seconds from the press to the page reloading itself on the new
version. Q-019 above is confirmed by it. Three new records follow.

### Q-070 · Install · bug · medium · confirmed
**A Windows server that dies stays dead.**

*Found by:* the Windows tester. *Where:* the scheduled task the installer
registers, in `nexttex/install/`.

*What happens:* on Windows the server runs from a scheduled task with only
a logon trigger and no restart on failure. The tester ended the listening
process by its number. The launcher exited with it, the task went back to
Ready, and nothing started it again in the ninety seconds they watched, or
would have until the next sign-in. A crash would end the same way. On
Linux the service manager restarts the server.

*What should happen:* the task restarts the server when it exits with a
failure, as the Linux service does.

*Size:* small. *Version:* z.

### Q-071 · Files · bug · low · confirmed
**A tab shows a backslash in a path on Windows.**

*Found by:* the Windows tester. *Where:* the paths the server sends.

*What happens:* on the laptop the editor's tab for the chapter read
chapters\one.tex. A path reaches the interface with the platform's
separator, where everywhere else it uses a forward slash.

*What should happen:* every path the server sends uses forward slashes.

*Size:* small. *Version:* z.

### Q-072 · Install · comfort · low · confirmed
**The update dialog's heading lags behind git's output.**

*Found by:* the Windows tester. *Where:* the update dialog.

*What happens:* while git fast-forwards and prints its list of files and
commits, the dialog's heading still reads "Fetching the new version".

*What should happen:* the heading names the step the output belongs to.

*Size:* small. *Version:* z.

*Fixed in 3.18.7.* The drawer's chunk is prefetched, and until it has
arrived the chord holds what is typed for the box.

### The documents

### Q-039 · Documents · docs · medium · confirmed
**The README counts eleven buttons on the bar.**

*Found by:* a reading agent, checked here. *Where:* `README.md:109` and
`README.md:856`, against `frontend/src/App.tsx:164`.

*What happens:* both passages say the bar down the left edge has eleven
buttons and list them. It has twelve: Comments sits between People and
Build and is not named. The README describes the Comments drawer
correctly elsewhere, so only the bar's own account is stale.

*What should happen:* both passages name twelve buttons, Comments among
them.

*Size:* small. *Version:* none.

### Q-049 · Documents · docs · medium · confirmed
**The README says there are no comments.**

*Found by:* a reading agent, checked here. *Where:* `README.md:1250`.

*What happens:* the passage on collaboration says "What there is not:
comments, suggestions, tracked changes". Comments shipped on 24 September,
and the same README describes the Comments drawer earlier on. A reader of
this passage is told a feature the app has does not exist.

*What should happen:* the sentence names what is still absent, suggestions
and tracked changes, and points at comments.

*Size:* small. *Version:* none.

### Q-040 · Documents · docs · low · confirmed
**The architecture diagram's route count is stale.**

*Found by:* a reading agent, checked here. *Where:* `docs/architecture.md:17`.

*What happens:* the diagram of the server says it has 113 routes.
`server/main.py` defines about 140 now. The document test checks that a
named route exists, not a count.

*What should happen:* the diagram gives no number, or the test checks it.

*Size:* small. *Version:* none.

## What worked

A review that lists only faults is not a picture of the app. These were
looked at as hard as anything above and held.

- **The suites.** All green at the start, 1137 frontend, 2403 Python and
  575 browser tests, and the browser tier then ran three more times with
  retries off, 1725 runs, without one failure.
- **The server's discipline.** No path-taking route could be made to
  escape the project, including the ones with no escape test. Every one of
  the 43 broad `except` blocks logs, reports or has a documented reason.
  Authentication is uniform, scrypt runs off the loop, comparisons are
  constant-time, the rate limiter is bounded and keyed on the socket, and
  the report of a problem redacts before anything reaches the clipboard.
- **The kit.** An icon button cannot be built without a label, sheets trap
  and return focus, the settings sheet is a proper set of tabs, one
  reduced-motion rule covers every animation, and axe finds nothing of
  serious impact on eleven of the twelve drawers in either theme.
- **Every width and the fractional scale.** The projects screen and its
  sheets at five widths down to a phone, and the workspace at a device
  pixel ratio of 1.25, the first photographs ever taken at a fractional
  ratio, with no clipping, overlap or blurred hairline anywhere.
- **The agent, live.** Both providers, against Claude and against a local
  model, made an edit, drew a figure through its cards, stopped cleanly
  and replayed after a reload. The live leg cost about $0.55, and the
  login was untouched.
- **The speed a writer feels.** A keystroke reaches the screen in about 4
  ms in a seventy kilobyte chapter, the same as in September, and a
  second peer in 1.4 ms. A pinch on the page costs 3.8 ms of layout over
  sixty events. The server starts answering in 0.8 seconds. A new project
  is on screen, built, in 2.2 seconds.
- **Outside edits,** in the cases most writers meet: text added above a
  comment moves it, a rewording keeps it, and a keystroke's merge with a
  file changed on disk is sound.
- **The install workflow** passed against master when dispatched, on
  every platform it covers.
- **The benchmarks,** run at the close on an idle machine, are all within
  budget, and near the README's measured column: a chapter build 359 ms
  against 343, a full build 19.2 s against 17.9, the symbol scan 22.5 ms
  against 17.9, opening a project 32 ms against 20, the bundle 861.0 kB
  exactly.

## Unverifiable here

- **The Windows laptop.** It was sent six checks early in the probe: an
  update from the page, the logon launcher and a restart, a MiKTeX build
  log with drive-letter paths for Q-019, AltGr on a real layout for Q-030,
  and the display at 125 percent. Nothing came back while the probe ran.
  The results arrived after it closed and are under "The Windows leg,
  after the close": the update, the restart and Q-019 were checked there.
  Two remain open. AltGr, because the laptop has only a US layout; a
  synthesized key event of the shape Windows sends stood in. The display
  at 125 percent, because close-up captures failed in a background tab;
  Playwright at a device pixel ratio of 1.25 stood in. A figure sent
  between two machines, which September could not test either, remains
  unverified.
- **macOS.** Nothing here can run it.
- **The OpenAI provider against OpenAI itself.** There is no key; a local
  model stood in.
- **A real network cut.** Stopping a server is not the same thing, and
  Chrome's offline emulation does not sever an open socket.
- **Q-012's rollback.** Reasoned from the code and the service file; a
  broken commit was not pushed to watch an install loop on it.
- **Q-066's cause in isolation** was pinned by the journey's own log; the
  commit that removes the PDF is pdfTeX's, and whether other engines do the
  same was not tried.

## What the findings have in common

Sixty-nine records: 9 high, 27 medium, 33 low, no blocker. Of them 21 are
bugs, 11 comfort, 8 performance, 7 test, 5 security, 5 docs, 5
consistency, 4 accessibility and 3 improvements. Sixty-one are confirmed, most
by reproduction, and eight are likely. Grouped by the mechanism that
produced them, so that one change closes several:

1. **The server's one loop, held.** Q-028, a regular expression that holds
   the interpreter lock and so stops every thread; Q-043, 72,000
   diagnostics made relative one by one after a build; Q-029, a walk of
   the whole project on every open of the reference library; Q-022 and
   Q-021, the trash and the timeline. The codebase's own rule is that such
   work runs off the loop, and a thread is not enough when the work never
   releases the lock.
2. **A part replacing the whole.** Q-017, a chapter's build replacing the
   whole document's diagnostics; Q-066, a failed build replacing the last
   good PDF with nothing; Q-018, a cache keyed on the newest time, which a
   deletion does not change; Q-026, a fresh registry entry replacing an
   archived one; Q-025 and Q-027, bulk writes that stop halfway and say
   nothing about the half that happened.
3. **A peer's data taken on trust where a local route checks it.** Q-008,
   comments of any shape and size; Q-009, the path-derived id that merges
   two people's new chapters, which is September's fix undone; Q-054, an
   outside edit's character diff leaving a comment on two stray letters;
   Q-010, the tests that would have caught the first two.
4. **Two providers, one promise.** Q-001 to Q-004: the OpenAI provider's
   endings, its round cap, its raw errors, and what the last permission
   position means under each.
5. **Code fetched on first use, with nothing held meanwhile.** Q-062, an
   870 ms first open of the composer's menu; Q-067, the first search
   typed into the document. The other side of the same decision is Q-042,
   the whole workspace in the chunk the projects screen loads. Fetching
   the workspace when a project opens, and prefetching its lazy parts once
   it has drawn, addresses all three.
6. **Guards that pass while doing less than they say.** Q-056, the
   fidelity harness reaching 85 of 98 surfaces and reporting one test
   passed, and the axe sweep skipping five of eight; Q-009's test calling
   the private method its fix added, while the path users take went back;
   the typing driver's header claiming spelling was on; Q-015, timing
   tests red on CI and missing from the tracker's list of flakes. This is
   the most reusable lesson here: each of these let a regression through
   while every light stayed green.
7. **The newest surfaces relearning old lessons.** Q-050, the Comments rows
   built the way Diagnostics and History carry comments against; Q-038,
   raw controls returning after the overhaul; Q-039 and Q-049, the README
   left behind by comments; Q-057 to Q-061, built surfaces drifting from
   the page that specifies them.
8. **Keys.** Q-030, AltGr taken for chords, so three Polish letters cannot
   be typed on Windows; Q-053, dividers that move only by dragging;
   Q-051, a thread's card that takes no focus; Q-068, a brace not closed.

## What this means for the order of the fix plan

Each step is its own push, highest version level first within it.

1. **Q-028**, the search that stops the server, on its own, because it is
   the one security finding with a high severity and it is small.
2. **Q-066 and Q-068**, then **Q-017**: the preview and the diagnostics
   telling the truth after a failed or scoped build. These are the ones a
   writer meets in an ordinary afternoon and believes.
3. **Q-009**, with Q-008, Q-054 and Q-010: collaboration's trust in a
   peer, and the test that drives the real path.
4. **Q-043** with the rest of mechanism 1.
5. **Q-030**, then Q-067 and Q-062 with Q-042's split of the workspace
   chunk, which also answers the bundle budget.
6. **Q-012**, the update that cannot come back, and Q-013.
7. **Q-031**, the preview's memory.
8. Mechanism 2's remainder, mechanism 4, then accessibility, Q-050 to
   Q-053.
9. **Mechanism 6 as its own run**: make the harness and the review drivers
   fail when they do less than they claim, and fix Q-015. Doing it before
   the look work below means that work is checked by tools that are
   honest.
10. **The look and the comfort features**, Q-038 the large one, Q-057 to
    Q-061, Q-045 to Q-048, Q-064 and Q-065. These change what a writer
    sees, so under `CLAUDE.md` each is drawn on the direction page and
    approved before it is built.
11. The documents last, in the same commits as whatever makes them true.

Nearly all of it is patch-level, z. The comfort features that add
something a writer can newly do, Q-045 to Q-048 and Q-065, are y. Nothing
here changes what an install is.

## Cost and time

The probe ran on 25 September 2026 from about 23:55 on the 24th to about
03:05, in one Opus session with Fable as the advisor at the three
checkpoints the plan names. Commits to `REVIEW.md` went up after each
area, so the times can be read off the log.

| | |
|---|---|
| Baseline, `scripts/check.sh --all` | 22 m 8 s |
| Flake hunt, three browser tiers with retries off | 53 m, in the background |
| Fidelity harness, 98 surfaces in two themes | 10.9 m |
| Live Claude spend | about $0.55, `claude-sonnet-5` |
| Reading agents on Sonnet | 14, and 3 more while the plan was written |
| Leads from agents dropped or reframed after checking | about 10 |

What the time went on: reading was again the cheapest source of findings
per hour, and seven reading agents in parallel covered the code in about
eight minutes, but a third of their leads needed correcting or dropping,
and one of them, Q-009, was wrong in a way that hid a worse fault. The
drivers found what reading could not: Q-066, Q-067 and Q-028's real
reach all came from running the app. The largest waste was the driver's
own mistakes, the same one September made, typing after `\end{document}`,
and a menu measured at 200 ms. Both are fixed in the drivers kept under
`e2e/review/`.
