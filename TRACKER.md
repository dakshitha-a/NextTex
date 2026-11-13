# What is in hand, and what is waiting

This is working state, not documentation. It lives here rather than in `docs/`
because it describes what has not been done yet, which is the opposite of what
the documents are for.

**How it is used.** Finishing a piece of work means striking its line from *In
hand* in the same commit as the code, and writing anything the work turned up
but did not do into *Backlog* with one sentence saying why. That happens
alongside the other documents a change owes: `docs/architecture.md` when the
mechanics move, `docs/design.md` when the interface does, `README.md` when
something a reader would act on changes. Updating this file is part of the
change, not a tidying commit afterwards.

**There is no Done section.** The commit messages in this repository are long
enough to serve as one, so `git log` is the record of what was finished and
why. A Done section here would duplicate it and grow without bound, and the
only thing this file has going for it is that it is short enough to read every
time.

Every backlog item carries its reason. An item with no reason attached is one
nobody can ever decide about later, which is how a backlog becomes a place
things go to be forgotten rather than a list anybody reads.

## In hand

**Watching the live install, from 18 October 2026.** The writer asked for
a continuous record of errors, failures, crashes and slow spots on the
install they use every day, to be left running for a couple of days and
then reviewed. The record is `diagnostics.log` (`nexttex/diag.py`), read
with `scripts/diag-review.py`. Deployed 18 October and reviewed 21
October: no crash and no server or browser error. The stalls came from
the host's own load, and two 4 s page freezes could not be attributed,
so long frames now name their script. The logger stays on.
The thesis's chat logs showed the agent's memory full three times, with
the overflow put in `CLAUDE.md`; the cap is now 8,000 and the agent can
revise notes. Books are added and checked by ISBN, and a source with nothing to look up
is marked checked by hand by the writer. The agent now sees each figure it draws,
loads NextTex's tools up front and keeps .tex edits out of the shell. The
journal had already shown one fault, fixed in this run: a symlink to a
file outside a project made lint, headings and search answer 500.
Two requests joined the run on 19 October, passed on from the thesis
session: a scanned book opened as blank pages, fixed at once, since
pdf.js 6 was never told where its image decoders were; and books added
and checked by ISBN the way papers are by DOI, for the fix phase.
On 21 October, with the logger on, the writer saw a file the agent had
just created open as an empty page until they reloaded. The editor opens a
new file twice, once when the agent says where it will write and once when
it has, and over Tailscale both opens woke on one manifest update and built
a document each; the first, overtaken, destroyed the second's. Fixed in
`collab.ts`, held by a unit test and a browser spec with slowed sockets.
Reviewed again on 25 October: no crash and no server error. The thesis
preview stopped updating under "This build stopped" with no place named:
a build the session cancelled before queueing came back "ok" with the old
PDF put back, and its torn `.aux` made each build after it start clean.
Fixed in `compile.py`. The review also found 232 `biber` processes stopped
since the browser runs of 25 to 27 September, about 2 GB, left for the
owner to end.
Reviewed again on 28 October, for 26 to 28 October: no crash, no server
error, no stall, and the `biber` processes gone. Every project open ran a
full build of a current PDF, 9 s and 37 s after a restart, and one open
waited 78 s behind builds that replaced each other; opens now reuse the
PDF and join a running build (4.47.0, live since 29 October and seen
answering in 15 ms). Builds are logged with their cause, cancelled and
download builds too; a tab left open across an update now notices; the
ResizeObserver line is counted. Memory then rose 6 to 9 MB an hour
under real use, and a probe found edits, builds and reads flat. By 8
November it had settled: since 29 October the longest life, 108 hours,
grew 1.6 MB an hour, one of 43 hours grew nothing, and one of 55 hours
3.6, so the item was closed.
On 29 October the writer sent a message from claude.ai into the thesis
session with remote control on. The label read "Sent over remote
control", as expected, but the line was empty: the CLI writes a bridged
message to NextTex only with `--replay-user-messages`, which it now
gets, and the message's text is shown. The writer then continued a
past conversation with remote control on and prompted it from
claude.ai: both turns showed their text, but claude.ai named the
session only by its project, since that archive predated named
conversations. It is now named from its first question.
Reviewed again on 1 November, for 18 October to 1 November: no crash,
no server error, memory flat. From 30 October every thesis edit was a
9 s full pass, 757 s of them cancelled: a file holding an `\input` took
a full pass on every edit, which also kept chapter builds from starting.
On 29 October a calculation writing scratch files in the interface
paper's folder rebuilt all five documents on each write for two hours
and piled up tree requests of up to 21 s. All three are fixed in 4.50.2.
A 55 s stall that day had nothing in flight and no stack, so a long stall
now records the loop's stack. One React "maximum update depth" error came
from a tab receiving that storm, with no component in its stack; with the
storm gone there is nothing further to act on.
Reviewed again on 8 November, for 1 to 8 November: no server error,
no build error, no failed agent turn, 8 s of cancelled builds against
757 s the week before. Memory rose from 134 to 315 MB as projects were
opened and then held flat; the lag spikes, at most 952 ms, came with
host load averages of 50 to 317. The journal printed the `LaTeX` line
twice under one pid: with a tailnet address the lifespan ran once per
listener, so two file watchers reported every outside edit twice and the
reaper and rejoin ran twice. It now runs once (4.50.3); the watcher-driven
counts in the reviews before it may be doubled. The server was gone from
18:42 to 22:40 on 3 November: the host crashed and booted again at
20:31, and the unit was not enabled for boot until 22:41 that night,
though every installer since September enables it, so this host was a
one-off. The next start said only "stopped without saying why"; a start
on Linux or macOS now looks for a boot after the last heartbeat and
names the machine instead.

Before it, on 12 October 2026, at 4.33.0, the run on the page
losing the writing in a reflowing thesis closed, at the writer's request.
Done: the settling build follows what the fast pass followed unless the
reader has moved the page since; a rebuild keeps the reader's place by the
text at their eye rather than by the page number, across a chapter build
and a build of the whole; forward and inverse search answer from the kept
pages while a build runs, so the fast pass's own reveal finds its line.

Before it, on 8 October 2026, at 4.31.0, the backlog close-out
closed, from 4.30.1, at the writer's request: the known gaps and the
flaky specs. Done and pushed as 4.31.0: publishing a build with thousands of undefined citations no longer takes
23 seconds, which was the build loop's flake on CI; a hover card stays
while someone types elsewhere, which was the reference hover's; the menus
sweep finds its line wherever the editor scrolled, and the other flaky
specs passed 304 runs under load without failing for their own reasons;
Markdown has its own editor mode and the checkers read it as prose; a
display is found row by row by the flash and by the double-click, and an
agent's edit to a file no tab holds is flashed by its own text; non-UTF-8
text stays a download, at the owner's word. After the push, the build
flash and the double-click were tested across several documents and included files, at
the writer's request in a comment on the run's tracker: fourteen paths
held, so nothing changed, and three of them are kept as
`e2e/specs/multidoc.spec.ts`. The four tour animations left at one pixel
per point, Errors, History and git, Download and Write together, were
filmed again at two.

Before it, on 8 October 2026, at 4.30.1, the run on the flash
after a build closed, from 4.30.0. Done: a census of the flash in
`bench/forward-search/`; the server's forward search returning every box
SyncTeX gives rather than the first; the caret's line and column carried
into the text the build read; the line of type holding the caret chosen
by lining its text up with the page's; a caret on a line that sets
nothing moved to its neighbour, and none in the preamble; the flash drawn
on the build's own PDF once it is laid out. It turned up and fixed a fatal
build's kept PDF coming back without its SyncTeX map, and closed the gap
of one source snapshot for the whole project.

Before it, on 8 October 2026, at 4.30.0, the double-click
run closed, from 4.29.0, at the writer's request. Done: a census of every
way the jump from the page to the source went wrong, in
`bench/inverse-search/`; the matcher rebuilt to line the page's text up
with the source, so a repeated word, maths, a colour's name, a heading,
an accent and a hyphenated word land where they were clicked, and text
TeX made up selects its command; the line carried through writing done
since the build; the word selected and flashed in the page's own mark.
The writer's mid-run request for the page's text overlay gave a drag
that keeps its selection over the gaps, a copy that reads as the page
does, and a zoom that rescales the text instead of rebuilding it.

Before it, on 8 October 2026, at 4.29.0, English spelling came
to know the words of science papers, about 25,000 of them chosen from
arXiv and PubMed abstracts, on by default with a Science terms switch
under Variety. It turned up and fixed a licence notice that carried only
the first part of SCOWL's, which the everyday list already owed in full.

Before it, on 7 October 2026, at 4.28.0, a file's history came
to download as an audit trail, from its menu or the History drawer, and
a project gained a switch that keeps every version instead of thinning,
off by default.

Before it, on 7 October 2026, at 4.27.0, any file whose bytes
are text came to open in the editor, where only eighteen suffixes had:
a program's input or output, a molecule, a source file in any language,
drawn in its language when one is known. It turned up and fixed a text
file over 2 MB opening as an empty editable page that kept nothing.

The reopened-tab fix closed on 2 October 2026 at 4.25.1: a file closed
and opened again in one page was bound to its destroyed shared document.
It turned up a server socket that stops being fed without being closed,
fixed in its own commit.

Before it, the venue templates run closed on 2 October 2026 at
4.25.0, from 4.24.1. Done: each template's
shape in a `template.toml` of its own; twelve venue templates on their
publishers' TeX Live classes and eleven guides to the venues no licence
lets NextTex ship; the template browser, with the class installed on
Create; and a soft check of the classes against CTAN once per y bump.
It turned up and fixed a refused folder leaving Create disabled, and the
accessibility spec's light-theme tests auditing the dark theme.

Before it, the motion, rail and tour run closed on 2 October
2026 at 4.22.0, from 4.21.1, at the writer's request. Done: a fold that
moves once and stops, its strip's place widening with the slide and the
page drawn sharp once the panes rest; a bar that shows a drawer over the
panes when the pointer rests on its button and docks it on a click; a
README hero filmed at three times the pixels, its camera on the page as
the rebuild lands; a citations animation that ends on the page, with the
number and the entry; and a tour row for a figure script edited and run
in the app, before Write together at the writer's word. It turned up and
fixed a peek at History taking the caret out of the source, the
References drawer's publisher chooser squeezing the query, a citation
key taken before a full stop eating the stop, and the tour having been
filmed at one pixel per point whatever its setting said.

The roadmap run closed on 1 October 2026 at
4.21.1, from 4.13.5 in nine pushes: the first eight items of
`ROADMAP.md`'s list, one *y* bump each, and the writer's Copy path on a
file tree row. Done: word limits on a section or the abstract counted in
the outline and pages against the page limit in the strip; the `.bib`
rows' repairs; consistency checks marking only the less common of two
forms; a figures and tables list beside Sections; Changes as PDF from
any version in History; the publishers' records asked about retracted
and since-published citations; a document's source as a journal's
upload wants it; and the reply to the reviewers written from the open
comments. The tie before `\cite` on the roadmap was chktex's warning 2
already. It turned up and fixed a `.bib`'s rows left stale by a change
from outside the editor, an over-limit count drawn grey by a utility
class its own rule outranked, a reply-letter path with an underscore
breaking the build, the guide's measured bundle and the style guide's
segmented limit behind the code, and a History version folded away
while asked about answering "no such version". Venue templates stay on
the roadmap for a run of their own.

The performance run closed on 1 October 2026 at
4.13.5, at the writer's request, from 4.13.0 in five pushes: every item
was measured before it was changed, and those whose cost turned out not
to be real were left, with the measurement as the reason. Done: the
grammar checker and the PDF worker sent compressed, hashed assets kept
for good, the GitHub CLI's sign-in remembered, a download that stores
its figures, less loaded at start, word counts remembered, symbols
rescanned per file off the loop, the list of what can be previewed made
without re-parsing, one pdf.js worker for every rebuild, typing in a
long file no longer rescanning it for folds, the text after
`\end{document}` or spelling, a build log read without asking the disk
about each file again, the compaction check without an encoding per
flush, a file tree of one `scandir` per folder off the loop, a build cap
across projects, and the bibliography checked four entries at a time.
Left, as measured: a rebuild's PDF is never byte-identical, so it is
always fetched; ten agent writes walked the tree twice; caret moves cost
the same either way; the outline is under one percent of typing; a whole
thesis held open is 6 MB; the history timeline across 200 files is 16
ms; and the middleware is a fraction of a millisecond and the security
gate. It turned up and fixed a closing pane hidden part way through its
slide, and, from the writer's report during the run, figure tabs that
left `main.tex` empty and the pane offline. The feature survey of the
same day went to `ROADMAP.md`.

The README run closed on 1 October 2026 at 4.12.1,
at the writer's request: the README is a front door of about 450 lines,
with animations filmed in the real app by `e2e/shots/tour.spec.ts`, and the long
text it held lives in `docs/install.md`, `docs/guide.md` and
`docs/keyboard.md`. It turned up and fixed a restore from History that
changed the file on disk and left an open editor showing what had been
undone, with the next write ready to put the deletion back, and a host's
start-at-boot refusal that pointed at a README passage that had moved.

The right-click menus run closed on 30 September
2026 at 4.11.0, at the writer's request: a file tree row, the tree's empty
space, every tab, a projects row, the typeset page, and the rows of the
Comments, Deleted and History drawers open their own actions on a
right-click, by one rule in the style guide, and Shift with a right-click
is always the browser's. It turned up and fixed History's Escape closing
the panel under a menu that had already claimed the key.

The collaboration merge and host run closed on 29
September 2026 at 4.10.2: two versions of a paragraph written apart are
kept and chosen in place, an outside edit or pull that clashes with typing
keeps both, and an install can be an always-on host that keeps its
writers' shared projects. It turned up and fixed two shared projects on
one install answering for each other, fields for invites, keys and paths
drawn in the sans, and, in a check between two real installs, peers that
forgot each other's address and never reconnected, and a merge that
doubled a whole document rather than its paragraph.

Torn build files closed on 28 September 2026 at
4.6.0, from a writing agent's report of a cut-short `.aux`, an empty
`.bbl` and an `.aux` full of NUL bytes: a cancelled build puts back what
it touched, a cancelled task no longer leaves an engine running beside
the next one, the agent's build and compile as you type no longer
supersede each other, a damaged file is cleared once without being
asked, and Rebuild everything starts clean. It turned up and fixed the
e2e harness leaving its builds running.

Citations and Word figures closed on 27 September
2026 at 4.2.0: citation completion that reopens after each comma,
matches author, year and title words and offers the document's own
bibliography, and figures that reach a Word download whatever they are
drawn in. It turned up and fixed the completion popup's underline and
italics, which CodeMirror's theme had been adding since the overhaul,
and a race in the Markdown history spec.

The backlog close-out closed on 26 September 2026 at
4.1.0, one push per step from 3.19.1: a script's escaped grandchild ended
by Stop, the Windows task asking for administrator itself, the browser
flakes fixed at their causes, diff, Vite and pdf.js a major version up
with the build's Node floor at 22.13 as 4.0.0, every control and size
from the kit, and the agent answering comments. It turned up and fixed a
reload that lost the answer being streamed, a name save that took the
caret from a password, and a pdf.js text layer sized by the old rules.
One item stays open below, OpenAI against OpenAI, by the owner's choice;
the laptop's task was checked there the same day.

The fix run closed on 25 September 2026 at 3.19.0,
having fixed the probe's findings in the order its report proposed, one
push per step, 3.18.2 to 3.19.0. The findings were
`REVIEW.md`, 73 records with the four the Windows laptop sent after the
probe closed, and the file was deleted at the close once every record was
fixed or set down below: the cgroup half of Q-007, the kit's remaining
raw controls (Q-038), the laptop's task that only an administrator can
change (Q-070), and the major upgrades Q-036 weighed.

The probe itself closed on 25 September 2026 at 3.18.1.

Before the probe: the pass after Opus 5.5 closed at 3.18.0 on 24 September 2026.
It left nothing new in the backlog. The run before it, the roadmap, the
rest of the backlog and comments, closed at 3.17.4. What that one left is
below: six rare browser flakes, named with the traces read, and the
OpenAI provider against OpenAI itself.

## Backlog

### Known gaps, with a cost somebody will eventually pay

- [ ] **A link out of the project is shared as an empty file.** The
      tree lists a symlink whose target is outside the project, `adopt`
      records it as text, and `Project.resolve` then refuses to read it,
      so a joiner gets an empty file of that name. Found on 12 November
      2026 when the NexusQC paper's fifteen `refs/` links into another
      repository stalled every join of it; the join no longer stalls, and
      an edit from the joiner is refused at the sharer rather than written
      through the link. Left because leaving such a link out of the
      manifest, or sending what it points at, is a decision about what a
      link in a shared project means, and records already shared would
      need a migration either way.
- [ ] **A join of a large paper from the Windows laptop never finishes:
      the link to the sharer breaks every few seconds.** With both
      installs on 4.50.10, every link of the NexusQC paper's share
      between dak-n4 and the laptop ended after 0.5 to 6 s with
      `read failed: IrohError:` and an empty message, on both ends, and
      each new link sent the whole project again. Meanwhile the laptop
      dialled dak-n4 for each of its five idle shares every 3 to 5 s and
      was turned away at once, so dak-n4 held links for those shares that
      the laptop's networks did not see as theirs. Two installs on dak-n4
      never showed it: not with 2,500 files, a joiner already a member,
      or one sharing five projects, and closing a second iroh connection
      to a peer does not break the first on iroh 1.1 or 1.2 on Linux.
      Untested suspects: `IrohTransport._accept_loop` accepts one
      connection at a time, so a hung `accept_bi` or a stalled event loop,
      up to 20 s a frame on the laptop, holds every later dial; and the
      laptop's iroh build on Windows. NX-TeraChem waits on the same fix.
- [ ] **A join that gave up leaves a stall behind it.** After joins
      of three projects from the Windows laptop were abandoned on 12
      November 2026, a join of the dissertation failed with nothing
      answered, the resume's figures paused for four minutes, and the
      dissertation's figures stopped arriving after two restarts of the
      laptop. A restart of the laptop and a join on its own then
      worked. The sharer still listed the laptop as connected to a share
      whose join had been discarded. Not reproduced here; the next step
      is two installs on this host, one join abandoned mid-stream, then a
      second join of another share between the same two.
- [ ] **Joining again into the folder of a join never accepted opens a
      part of the project.** A second invite into a folder whose
      `.nexttex/collab/share.json` an unaccepted join had left answered
      `opened` in under a second, not an offer, and the folder held ten
      of the fifty files with the link not connected. Found between two
      installs on this host on 12 November 2026.
- [ ] **A join sends a sync step and a history ask for every record,
      deleted files included.** The NexusQC paper's manifest holds 2764
      records for 51 files, so a joiner works through about 4600 frames
      before the first answer for a live file. The wait now runs while
      frames arrive, but sending live documents first, or not asking a
      fresh joiner for history it cannot hold, would make the join itself
      quicker.
- [ ] **A text file that is not UTF-8 is shared as an empty file.** Same
      cause and same symptom as the link above: `read_text` returns
      nothing for it. One Latin-1 build log in the resume project showed
      it. Left for the same decision, since adopting such a file as a blob
      would carry its bytes but take its editor away.
- [ ] **A stale `previews` in `nexttex.toml` is ignored without a
      word.** Once `.nexttex/previews.json` exists the toml's list is never
      read, by design, so an entry naming a folder since renamed says
      nothing. Reported by the resume project's agent on 8 November 2026
      with the agent fix; left because the key is legacy and seeds a new
      install only, so a warning would speak to almost nobody.
- [ ] **`goto` on a root off the strip shows the file but not its
      document.** The resume project's agent reported on 8 November 2026
      that `goto` opened such a file in the editor and the document did
      not join the strip. Traced the same day without finding the cause.
      A browser was on the project and the writer was typing at the
      call, 11:46:16, yet no browser asked for the strip to change; two
      browser reproductions, a plain root and the writer's sequence of
      following a root in a subfolder, closing its tab and reloading,
      both put the root on the strip. The hypothesis left is a browser
      strip that still listed the root while the server's did not: the
      server answered "documents are: main.tex" at 11:45:54 and the
      browser sent nine removals in the same five minutes, and with the
      root on its own strip `followDecision` shows it without asking. A
      spec that makes the two strips differ before `goto` would decide
      it. `goto` now says when no editor window has the project open,
      a gap found on the way, and `compile` adopting the root, in
      4.50.4, removed the symptom the report needed.
- [ ] **The agent cannot see what a reader did on a page.** A page's
      `localStorage` is kept with the page since 1 November 2026, but
      `read_page` gives back the page as written, not its storage, so an
      agent asked what is left on a tracker cannot read the ticks. Left
      because the first ask was for the ticks to survive; a `state` in
      `read_page`'s answer is a small addition once a writer asks for it.
- [ ] **Delete leaves Claude Code's copy of the session.** Past
      conversations' Delete removes NextTex's record only, and says so.
      Removing the CLI's own file under the home folder too would need
      the CLI's folder naming, which is its business, not ours.
- [ ] **An update repairs nothing an install step fixed.** `scripts/update.sh`
      does not run the TeX extras step again, so a missing synctex stays
      missing after an update that fixed the step, and it does not rewrite
      the service, so a launch agent keeps the PATH it was written with.
      Running `scripts/install.sh` again does both. Left on the owner's word
      on 26 October 2026: there was one Mac install, and new ones start
      from scratch.
- [ ] **Remote control and the session's name use the SDK's private
      control channel.** The SDK has no call for `remote_control` or
      `rename_session`, so `_control` in `nexttex/agent.py` sends them
      through `_query._send_control_request`. An SDK that renames it turns
      both features off quietly; a public method should replace it when
      one exists.
- [ ] **A JPEG 2000 image of grey with an alpha channel is not
      drawn.** pdf.js 6.3.289 fails it with "Cannot read properties of
      undefined (reading 'length')" where poppler draws it; a
      one-component grey or an RGB codestream is drawn. Found making the
      fixture for `e2e/specs/pdf-decoders.spec.ts`; upstream's to fix,
      and worth a look when pdfjs-dist moves.

### Measured and left, worth revisiting with a measurement

- [ ] **The log parser stays Python.** Asked on 24 October 2026 what a
      Rust rewrite would buy: the build is TeX's time, and the parser,
      the one hot Python loop, now reads a real 0.14 MB thesis log in
      3.7 ms and the benchmark's 13.7 MB log in 0.61 s
      (`latexlog.parse_ms`). A native module would need a wheel for
      every platform the installer serves; revisit if a real log takes
      more than a few hundred milliseconds.

- [ ] **A revtex column's box is tested below the browser.** In the
      writer's methylamine paper SyncTeX answers a line in the middle of
      a paragraph with the whole column's box beside the line's, and the
      innermost box now wins; no document small enough to commit made
      revtex or article do the same, where the column's box goes to a
      blank line, which Mod-Enter never asks about. The unit test in
      `locate-on-page.test.ts` holds it, and the census over the writer's
      copy measured it; a document that reproduces it would let
      `jump-to-page.spec.ts` press the key there.

- [ ] **The science vocabulary's arXiv half stops in 2021.** The only CC0
      copy of arXiv's abstracts found was the 2021 one, so words that
      papers took up since are thin: "tokenizer" is used by 41 abstracts
      in it and stays out. A newer snapshot run through
      `scripts/count-corpus.py` would bring them in. The typo guard also
      keeps out "squark", one letter from the far commoner "square"; a
      writer adds it with one click, and a rule loose enough to let it in
      let "occuring" in too.

- [ ] **A save syncs to disk eight times.** Each flush of a typed edit
      writes the file, a history blob, the history log and the
      projection record, each with an fsync of the file and of its
      folder. On this machine's NVMe that is 4 ms; with a simulated 5 ms
      fsync it is 49 ms on the event loop. The projection record must
      stay durable, since a stale one would make the next start fold our
      own write back in as an outside edit and revert the document, and
      history is the safety net, so the performance run left it. Worth
      revisiting once a flush is timed on the Windows laptop, where
      FlushFileBuffers is the cost; moving the history half to one
      writer thread is the likely shape.
- [ ] **The file watcher restarts for every project when one opens.**
      `_restart_watch` restarts `awatch` for every open project and
      `_adopt_what_appeared` walks each again: tens of milliseconds a
      project, so left. The watch is also recursive over `.git` and any
      virtual environment inside a project, which on a project with a
      large one can reach the inotify limit; a watch per project with
      those folders left out is the shape, if that limit is ever met.
- [ ] **A long PDF's layout asks for every page.** A rebuild of a
      600-page document takes about 120 ms more to redraw than a short
      one, because the layout asks pdf.js for every page's size. Sizing
      pages from the first and correcting lazily would cost a wrong
      layout for documents that mix page sizes, so it was left; the
      chat's length was never measured.

### Never run against the real thing

- [ ] **Most venue templates are untried on a bare MiKTeX.** On the
      owner's laptop on 29 October 2026, MiKTeX 25.12, 4.48.2 built fresh
      acm, elsevier, ieee-conference and lncs projects on their first
      build, after 4.48.1 and 4.48.2 fixed the check, the install and
      both manifests. The others were not built there. The templates
      list named plausible missing packages for each, and MiKTeX's own
      list now filters out any id it does not know. A manifest that
      lacks a dependency still fails its first build, and the drawer
      offers that one package at a time.
- [ ] **The OpenAI provider has never spoken to OpenAI itself.**
      Everything above the transport runs for real against a stub, and
      since the backlog close-out against a real local server too:
      `tests/test_openai_ollama.py` edits a file and draws a figure
      through the card against the Ollama on this machine, and the same
      was driven by hand in a real browser, which is where the first real
      turn showed that a stream with no declared charset was being read
      as ISO-8859-1. Whether OpenAI's own endpoint still returns these
      shapes is the half that stays unproven, since there is no account
      here to find out with; the local run says the parser, the tool
      loop, the card and the usage chunk all hold against a server that
      speaks the same protocol. The backlog close-out of 26 September
      left it open by the owner's choice: a key would cost money, and
      the local run is the evidence there is.

### Deliberately not done, and worth revisiting only if something changes

- [ ] **A file linked in from outside is read by completion and refused by
      the editor.** Decided on 29 October 2026: TeX reads the link when it
      builds, so its labels resolve on the page and completion offers them;
      opening, search and replace stay off it, since writing through the
      link would write outside the project. Revisit if a writer wants to
      edit such a file in place.
- [ ] **A paper's PDF is never matched by its title.** A citation finds
      its PDF by a link, a name or a DOI (`nexttex/paperpdfs.py`), so a
      download named "Smith - 2020 - A title.pdf" with no DOI on its
      first page is not found. A wrong paper opening is worse than none;
      revisit if writers keep such files and ask for them.
- [ ] **BibDesk's `bdsk-file-1` links are not read.** They are base64
      macOS aliases rather than paths; the PDF is still found by its
      name or DOI if it is in the project.
- [ ] **An inline bibliography without hyperref has no Open this
      reference.** SyncTeX names the writer's own `.tex` line there, so
      the page menu shows Show this in the source; with BibTeX, biblatex
      or hyperref the entry opens its paper.
- [ ] **ChatGPT and a local model have no page tools.** `publish_page`,
      `read_page` and `edit_page` are the Claude provider's, and the
      OpenAI provider's function list was never given them. Adding them
      is three specs and the same methods; left until a writer on that
      provider asks for a page, since its tool results are words and
      the picture the check returns would not reach the model.
- [ ] **A figure's labels are not checked for overlap by the script
      tools.** The thesis's session asked for `run_plot_script` to
      report text that collides; the agent already gets the figure as
      a picture and is told to look for exactly that. Revisit if the
      writer still finds overlaps the agent missed.
- [ ] **No chart library for pages.** A plot goes on a page as the
      project's own figure, `{{figure:...}}`, drawn by matplotlib as
      the writer's figures are; a chart library would be a second way
      to draw the same thing, in a style the paper does not use.

- [ ] **A text file that is not UTF-8 cannot be opened.** The tree reads
      the first 8 kB of a file it has no name for, so an old program's
      output in Latin-1 is a download, and one that turns to Latin-1 past
      the first 8 kB is called text and then refused by the file route,
      which says it is not UTF-8. Opening it would mean choosing an
      encoding to write it back in. The owner said on 8 October 2026
      that this is not an issue and they like it as it is.

- [ ] **A Word download's figures are pictures, not vectors.** Word 365
      can carry an SVG with a PNG behind it, which would keep a PDF or SVG
      figure sharp at any zoom. It needs the `.docx` taken apart and put
      back after pandoc, Word draws some converted SVG wrongly, and no
      test here can check it against Word, so 300 dpi pictures were
      chosen. Worth revisiting if a writer finds print quality lacking.
- [ ] **A multi-page PDF figure shows its first page.** pandoc does not
      keep `\includegraphics`'s `page=`, so the export cannot know which
      page was meant. Rare in a paper; worth doing if one turns up.
