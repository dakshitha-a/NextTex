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

The backlog close-out went up as 3.6.1 to 3.6.9 on 22 and 23 September,
over two legs: the browser-tier flakes and the download report on this
host, and everything Windows on the writer's laptop, driven by a session
of its own. It took the backlog's unverified half, the items open only
because nobody could reproduce them or nobody had the machine.

Three of the five flakes were not flakes. The People drawer's timeout was
a browser that had never been told its project was shared, because that
flag is published on a transition and nothing could ask for it. The caret
readout was a keystroke landing in the file the writer had just left,
through the three round trips it takes to open a document. And the
restart helper's Startup-shortcut branch, which this file said had run
nowhere, had run three times on that laptop before anybody looked.

Doing the documented thing on a real machine found seven more: two
download controls still on the link pattern `43e9c2c` swept away six days
earlier and named one of them while missing it; an uninstall line that
killed the shell running it and left a half-uninstall looking like
success; a git error reduced to its last line, which for an unreachable
remote is the fragment "and the repository exists."; an explicit
`--tex=miktex` discarded in silence on any machine that already had a
TeX; a TeX search that inverted its own priority so the poorest directory
won; a trash entry that said the writer deleted a file nobody had; and a
hover card fetching a whole 192 MiB image to draw a picture a few hundred
pixels wide.

And one that was none of those. A file moved out of a watched project and
back was moved into NextTex's own trash, and the path then swallowed
whatever was written there afterwards. A sync client, a `git` checkout
and any editor that saves by writing a temporary file and renaming it
over the target all make exactly that move. Four causes, six tests, and
two corrections along the way: an existing history test caught a first
fix handing a new file the identity of a deleted one, and CI caught a
second walking every record on every file creation.

The Windows leg ran the uninstall, a clean install with MiKTeX fetched by
the installer, the update button twice, the logon task with a reboot into
it, and the desktop shortcut. The logon task branch had run nowhere but a
runner since this project began. What it could not do is in the backlog
with its reason. The run's tracker is
https://claude.ai/artifact/NJ2VxtkGiPiwe3Sh3TFHxu.

The placement run goes up as 3.5.0 on 22 September, raised by the writer
after 3.4.2 as a tune up of the hover cards and the selection menu: the
cards blocked the thing hovered and vanished on the way to their buttons,
and the menu had no order to where it appeared. Renders at 100 % and
125 % interface size found one cause under both, the shell's `zoom`
against measurements written as CSS pixels, and two more under the
cards: CodeMirror's layer pinning a card over a multi-line range, and a
button press leaving the card open. One placement rule, `placeClear`,
now serves the verb row and the card; the card is a plugin of its own
that stays for the pointer. Section 61 of `docs/design.md` and the
direction page's Clear of the text section (version 54) carry the
record; the tracker is https://claude.ai/artifact/JQviUT4Tsyy5xAX21SYW6e.
The same run then raises the dark theme's floor, at the writer's word,
as its own push.

The hover cards run went up as 3.4.0 on 21 September, planned after the
writer asked for a toggle for the editor's hover previews and control
over which kinds get one: a switch called Hover cards on the settings
sheet's While you write group and, under it while the switch is on, six
toggle chips, Equations, Tables, Figures, Cross-references, Citations,
Files, a new kit control, `ChipToggle`. The drawing went on the direction
page (version 51) and was approved before any code; the sheet was
rendered in both themes and with the switch off beside it, and matched.
The gate is a live read of `data-hover-cards` off the root at the moment
of the hover, so nothing is reconfigured; a reference's card draws the
thing it points at only while that thing's own kind is on. Two reports
arrived after the push and were folded in as 3.4.1: a bibliography
garbled on screen after two outside writes (pycrdt indexes a shared text
in UTF-8 bytes and the store's diff was in code points; `splice` converts
now and a guard puts the file in whole if a fold ever leaves the document
differing from it), and figures on the wrong page until a whole rebuild
(compile as you type is one engine pass, and the engine's own "rerun"
hints went unread; a settling full build now follows a fast pass that
left the layout unconverged, superseded by the next keystroke). The
run's tracker is https://claude.ai/artifact/AQ3u3A5natmoaGvokAse2Z.

The fit run went up as 3.3.0 on 21 September, planned against version
47 of the direction page from what the writer found on opening 3.2.0:
the project's name running past a narrowed drawer into the editor (the
left column had no width of its own; it now states the bar, the drawer
and the handle, and a name that does not fit fades at the column's edge
and glides under the pointer, the writer's choice from three drawings,
with the Files count yielding before its word at the drawer's
narrowest), the four feet's controls 2 px above their strips' centre
line (one class, `nx-foot`, carrying the drawers' foot padding onto the
strips; the drawers' rule is `nx-panel-foot` now), a tab's keyboard ring
in the pen colour outside its block where the guide gives rings the hint
colour, three drawers (the bibliography's, Deleted and History) drawing
an empty state for the round trip before their first answer, and the
bibliography drawer's name, which is References. Every surface was
compared with the page in both themes before its commit, and none
deviated; the run's tracker is
https://claude.ai/artifact/CBDEP9n8hMH2MhUahVY6e2.

The frame run went up as 3.2.0 on 21 September, planned against version
44 of the direction page after the writer opened 3.1.0 on a real
manuscript: no title bar, the project's name heading the left column,
the four first rows one band on the surround with the activity bar and
a foot under each column on the surround too, no line between panes at
rest, the open tab as the pane's own block with a short rule parting the
rest, New conversation in the composer; People, Build and Download as
drawers on the bar in place of the title bar's Share and Download and
the tray under the source; the formula and table cards without their
source; and a reference to a figure, a table or an equation drawing the
thing on hover, from an environment index the scan now keeps. Every
surface was compared with the page in both themes before its commit.
Two things it changed on the page, recorded there: the light theme's
error and warn inks stepped one shade darker to clear the surround, and
an invite's note says a week, which is what the server keeps. Two
tangents on the way: a collaborator's caret position is reported on
every move rather than only while typing, and `AppControls`, the folded
rail's bar from before the overhaul that nothing mounted, went with the
download menu. The writer then settled the five differences the run
put to them, all as built, the plan block in the Claude column among
them: it sits before the agent's words, in transcript order, and the
page now draws it there.

The visual overhaul, after 2.18.0, rebuilds the interface on one kit and
goes up as two pushes. It was planned over seventeen versions of a
direction page the writer went through surface by surface, and that page
is the specification: every surface is compared with it before its
commit. The first push, 3.0.0, is the workspace: the tokens and the type
roles on one family, a kit under every control, every menu and card on
it, the light theme lit throughout, an activity bar and one drawer in
place of the accordion rail, the Claude column, the strips, the editor's
own chrome, and the settings sheet as master-detail; it is an x because
the editor page goes from six grounds to two, the theme's own and the
page's white. The second, 3.1.0, is the front door: the projects screen
as a list under an app bar, with the writing agent chosen and set up
there, a job application among the presets and Share on a row; the
screenshots, README and design sections follow. What it leaves is
written here as it is found.

The workspace push went up as 3.0.0 on 20 September with every item of
Phases 1 and 2 landed and compared with the page in both themes: the
tokens, the type on one family, the kit and every overlay on it, the
light theme lit throughout, the activity bar and one drawer with the
eight instruments rebuilt, the strips and the tab strips, the master
detail settings sheet, the Claude column with its views and composer,
the editor's find strip and Vim bar, and the Git and Files drawers.
Three things it left for the writer, on the tracker: the table hover
card (item 2.10a) is drawn on the page as version 20 and waits on a
yes before its code; the floating Claude pill keeps its earlier look
because the page did not draw one; and the plan block in the column
sits before the agent's words, as the transcript orders it, where the
page drew it after. The CSS retirement of `.quiet` and `.ghost-button`
follows the front door's rebuild (item 3.5), since those files still
wear them.

The front door went up as 3.1.0 on 20 September, and the overhaul is
finished: the projects screen as a list under an app bar (3.1), Share
from a row (3.1a), the job application template (3.1b), the writing
agent chosen and set up in one sheet reached from the bar, the settings
sheet and the Claude column (3.1c), projects archived or put in the
trash with their views and restore (3.1d), the app bar's lock with its
hover card, the join offer inside its sheet and the access card's bodies
(3.2), the floating pill on the kit's card with its shortcut in the
tooltip (3.2a), the update sheet, the tutorial brought up to date on the
kit with its figures regenerated, the screen guide, the failure and
waiting screens, all closing with Esc (3.3), the README's thirteen
pictures and its prose read against the app (3.4, 3.4a), the record in
`docs/design.md` §56 and the style guide, `docs/style-guide.md`, with
its rule in `CLAUDE.md` (3.5, 3.5a), the figure hover as the tree's card
(3.6), and the three legacy button classes gone from the stylesheet.
Every surface was compared with the page in both themes; the three
deviations the writer settled on the page (the frame's grey, the
banner's verb, the pill) are recorded there. One difference is still
with the writer: the plan block in the Claude column sits before the
agent's words, in the order the transcript has them, where the page drew
it after; it was reported at 3.0.0 and has had no answer, and moving it
is a small change if the writer wants the page's order. Nothing else on
the interface was left; the tangents the run fixed on the way are in the
log, the last of them found by the front door's sweep,
`e2e/shots/front-sweep.spec.ts`, which now runs beside the workspace's
at every push.

## Backlog

### Known gaps, with a cost somebody will eventually pay

The backlog close-out worked every line here that this host could work.
What stays needs a Windows machine, GitHub, or a report that names what
this host could not reproduce; each says which.

- [ ] **An editor pane drew a document's collaboration log where the file
      on disk said something else.** Seen once on the Windows install on
      23 September and not dug into, because the run it turned up in was
      holding that machine as evidence for the trash bug. After a fresh
      page load the editor showed a 449-byte version of `main.tex` that
      had been written into the project at 16:36 the day before; the file
      on disk was the 69-byte original, and
      `GET /api/projects/{id}/file` served those 69 bytes correctly. The
      document's log, `.nexttex/collab/docs/f67098301b6788c1.y`, was last
      written at 16:36:37, which is exactly when the 449-byte version was
      made. So the file, the route and the log disagreed, and the editor
      drew the log. Nothing was lost, but a writer who opened that project
      and typed would have written the stale text over their own file,
      which is the same shape as the trash bug and lives next door to it
      in `server/collab/store.py`. What would settle it: whether the fold
      that reconciles a document with its file runs when the file was
      changed while the document was open but no tick was seen, and
      whether the log or the disk is meant to win when they differ at
      open. `tests/collab/test_outside_edits.py` is the file that already
      asks half of this question.
- [ ] **A file deleted outside NextTex does not schedule a build.** The
      watcher's tick now tells the compiler about every outside write it
      sees, so a pull, another editor's save or a regenerated figure
      reaches the page, but a file the tick saw go is not yet known to be
      deleted, for the reason `ingest` gives, and is settled at the
      flush, where nothing schedules a build. A chapter removed in another
      terminal therefore stays on the page until the next edit, when the
      build fails on the missing input. Left because the honest build is
      a failing one and the flush's `_settle_gone` would need to tell the
      session; small, once somebody wants it.
- [ ] **A trash entry's `source` and `why` are not shown anywhere yet.**
      Since 3.6.6 an entry records when the writer did not ask for the
      deletion: a collaborator's deletion followed onto this disk, or a
      file replaced while rejoining a share. No panel reads the fields,
      so the trash still looks as if the writer did it. What a row should
      say in that case is a drawing for the direction page before it is
      any code.
- [ ] **A failed update check hides the useful half of its reason and
      says nothing is pending.** Seen at 125 percent on the Windows laptop
      on 23 September, with the remote pointed at an unresolvable host.
      The reason is clipped with an ellipsis, which keeps Try again on the
      row, but the clipped half was the useful one ("Could not resolve
      host"). And the header control relabels itself from "An update is
      waiting" to "Check for updates" when a check fails, which tells a
      writer nothing is pending when something is, and takes two clicks
      to open the sheet. Both are for the next interface run, drawn on the
      direction page before they are built.
- [ ] **`navigation.spec.ts` "the caret readout belongs to the file on
      screen" still fails now and then.** The backlog close-out traced it
      to a keystroke landing in the file the writer had just left, and
      fixed that. On 23 September it failed again, once in three full runs
      of the browser tier with retries off: the readout said "Ln 1, Col 2"
      where "Ln 1, Col 4" was expected, so two keystrokes were missing or
      went elsewhere. Its trace is in `e2e/test-results/` on the owner's
      Linux host until the next run clears it. Those three runs also had
      two other failures that were not captured by name, so the tier has
      at least one more intermittent test. `--retries 0` with
      `--reporter list` is the way to name them.
- [ ] **The printed token link is refused when a browser extension drives
      the navigation.** `_same_origin_request` (`server/main.py:720`)
      accepts `Sec-Fetch-Site` of `none` or `same-origin`, and an
      extension-initiated navigation is neither, so the link prints, works
      when a person types or bookmarks it, and answers 403 with "This
      request came from another page, so it was refused" when something
      automated opens it. That is the gate doing its job and no writer
      meets it. Recorded because the next session that tries to drive a
      browser at that link from outside the origin will otherwise lose an
      hour to it, as one did on 22 September; the way in is to set
      `location.href` from a page already on the origin.
- [ ] **The issue form's `where` field is an input rather than a dropdown**
      because GitHub does not prefill dropdowns from a URL. If that changes,
      a dropdown for the platform would make the field sortable.
- [ ] **The installer does not record which TeX it was told to use, so
      the server still has to guess.** `--tex=miktex` installs MiKTeX now,
      and then `nexttex/tools.py` searches a fixed list of locations in
      which TinyTeX comes four lines earlier on Windows, so a machine that
      had a TinyTeX before compiles with it anyway. Asking for MiKTeX gets
      you MiKTeX on disk and TeX Live in every build. Seen on 23 September
      on a fresh install that had explicitly asked for MiKTeX.
      `NEXTTEX_TEX` names a directory and wins the search, which is the
      seam and not the cure: nobody should have to set an environment
      variable to get the TeX they asked the installer for. The cure is
      for the install to write its choice into `config.json` and for the
      server to read it, which is a config-format addition and wants its
      own run. The list itself cannot be reordered to fix this: its order
      is what makes a logon-started server find TeX at all, which the
      comment at `tools.py:40-43` records.

      **What that machine actually had is worse than "the wrong TeX", and
      is the reason this matters.** A compile driven through the running
      server reported `MiKTeX-pdfTeX 4.23` as its engine and read
      `TinyTeX/texmf-dist` for its fonts in the same run: one
      distribution's engine against another's package tree, because the
      directory comes from the hint list and the binary from PATH and
      nothing reconciles them. It built, correctly, and a document whose
      body is one sentence took **95.6 seconds**. The survey's TeX line
      now says when the pdflatex on PATH is a different TeX from the one
      it reports, instead of printing one distribution's version beside
      the other's directory and leaving somebody to notice.
- [ ] **A logon-started server took five minutes to begin serving, where
      the same build started from the desktop shortcut took under
      twenty-five seconds.** Measured on the laptop on 23 September, eight
      minutes apart: the task's process was created 62 seconds after boot,
      wrote its banner three and a quarter minutes later, and was
      answering on the port at about five minutes; the shortcut's was
      serving in 25. A cold disk after boot, an antivirus reading a 400 MB
      virtual environment and a freshly installed MiKTeX are all plausible
      and none is measured. It matters twice over: a writer who reboots
      and looks will think NextTex did not come up, and anybody watching
      that machine for the overnight disappearance can mistake a slow
      start for a failure to start, which one session nearly did.

### Never run against the real thing

- [ ] **The restart helper's scheduled-task branch has not run on a real
      machine.** The Startup-shortcut branch has, three times on the
      owner's laptop, and the logon task itself was registered and started
      a server there after a reboot on 23 September. What has not run is
      `windows_restart_argv` taking `Start-ScheduledTask` rather than the
      shortcut, which needs an update pressed while the task is the armed
      launcher. That laptop is on the task now, so the next update pressed
      there runs it.

- [ ] **The drawer's Install button has still not been pressed on a
      MiKTeX, and now for a better reason.**
      `nexttex/texpkg.py` runs `mpm --install=<stem>` when `tlmgr` is
      absent and `mpm` is present, with the missing file's stem as the
      package name, because MiKTeX names nearly every package after its
      main file and installs on the fly by default anyway; nothing here
      has a MiKTeX to check either claim against. The tlmgr path is run
      for real on this machine's TinyTeX and against the stand-in in the
      browser tier. A real MiKTeX finally existed on 23 September 2026, on
      the laptop, installed by NextTex's own installer. The button was
      still not pressed, deliberately: that machine had MiKTeX's engine
      running against TinyTeX's package tree, so a package `mpm` installed
      might land somewhere the running engine never looks, and neither a
      pass nor a failure would have meant anything. What this needs is a
      machine with one TeX on it, or the item above about the installer
      recording its choice.
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
      speaks the same protocol.
- [ ] **Stop has not been pressed against the real CLI since the buffer
      fix.** The one-behind reply after Stop was diagnosed in a writing
      session's transcript and is reproduced by a stub with the SDK's
      buffer in `tests/test_agent_robustness.py`; the real `interrupt`
      control request and the `result` the CLI sends for a stopped turn
      are exercised only by `tests/test_live_agent.py` under
      `NEXTTEX_LIVE`. `tests/fake_claude.py` speaks the sign-in commands
      and not the stream protocol, and teaching it the protocol is a
      day's work that would still be a stand-in.
- [x] **Windows: a clean install of current master is on the record.**
      Done on 23 September 2026 on the owner's laptop, by the documented
      `irm ... | iex` route, from an uninstall of the previous install
      through to a working one with MiKTeX fetched by the installer. The
      same sitting took the update button twice, the logon task and a
      reboot, and the desktop shortcut. The README's Windows section is
      rewritten around what actually ran, and `docs/testing.md` records
      which of the lane's blind spots have now been taken by hand and
      which have not.

### Deliberately not done, and worth revisiting only if something changes

- [ ] **The project tree is walked twice per open.** `Project.tree` and
      `DependencyGraph._source_files` each descend the project with the
      same exclusions. Re-measured by the backlog close-out on the bench's
      thesis: the tree walk is 4.6 ms and the whole open 31 ms, so the
      plumbing to pass one walk into the other costs more than it buys.
      Revisit if the walk gets more expensive.
- [ ] **The Sections panel has no selection verbs.** Selecting the section in
      the editor already produces them, so a second entry point buys a shorter
      route to something reachable, at the cost of a hover control on every row
      of a panel that can hold forty.
- [ ] **Two documents whose stems match cannot both be on the strip.** The
      jobname is the stem, so `variants/acme/resume.tex` beside `resume.tex`
      would build to one `resume.pdf`, and `server/session.py` refuses the
      second with a 409 that the preview now shows as a notice when a
      chapter of the colliding document is opened. A jobname made from the
      relative path would end it and was not done: the writer keeps names
      unique across their folders, and `main.pdf` is what every Makefile
      pointed at a project expects to find. Revisit if somebody reports the
      notice rather than renaming.
- [ ] **Another window's removal of a preview closes no tabs here.**
      `previews_changed` from elsewhere moves the strip and nothing else,
      by design: the strip is shared and the tabs are each window's own.
      Wiring `handlers.onPreviewsChanged` would make the two windows'
      tabs move together and would also fire for this window's own
      removal; revisit if two-window writers report the asymmetry.
- [ ] **An unnumbered heading set at body size is not read as a heading by
      the inverse search.** A double-click on the page carries a hint that
      the span is a heading when it is set at least 15% larger than the
      page's running size or opens with a section number; a `\paragraph{}`
      heading in a class that sets it at body size and unnumbered gets the
      ordinary word search, which is no worse than before this run. Reading
      the font's weight off the text layer would catch it, and pdf.js does
      not put the weight on the span; left until somebody reports one.
- [ ] **A press of Escape within 100 ms of a keystroke closes the pending
      completion query rather than the extra carets.** CodeMirror's own
      rule, met while testing column selection. Nobody presses that fast;
      recorded so the next person to see the test's wait knows why it is
      there.
- [ ] **Building a session walks the project on the event loop.**
      `session_for` is synchronous, and constructing a `ProjectSession`
      calls `collab.adopt()`, which walks the whole tree. Measured at about
      17 ms of held loop on a 2602-file thesis, once per cold open. The
      obvious fix, building the session in a thread, was tried and reverted:
      a session builds its pycrdt documents, and the constraint recorded in
      `docs/architecture.md` is that those belong to the thread that built
      them, so the whole suite fails. Moving the walk alone means threading
      a pre-walked listing through `session_for` into `CollabStore.adopt`,
      which is a change to a function called from ninety-nine places in
      `server/main.py`, and it is not worth 17 ms once per cold open
      without somebody deciding it is. Re-affirmed by the backlog
      close-out, which had the widest brief and still left it.
- [ ] **A settled edit records its version from inside the flush.**
      `CollabStore._write` calls `session.record_version`, a sha256 and a
      zlib pass over the whole file, on the event loop, once per settled
      edit rather than once per burst. Measured by the backlog close-out,
      which found the row that was supposed to say (`collab.edit_to_disk_ms`)
      had been timing a no-op: on a 900-line chapter the write is 1.4 ms
      and the write with the record is 3.0 ms
      (`collab.edit_to_disk_with_history_ms`), so the record is about
      1.5 ms held on the loop once per settled edit, which is once per
      pause in typing. The ordered per-session queue it would take to
      move that off the loop is more machinery than 1.5 ms justifies.
      Worth doing if the number crosses about 5 ms on a chapter.

- [ ] **A script never runs on its own.** Not on save and not after the
      agent edits it; the pane says the agent changed it and offers Run
      again. The agent's runs pass the permission fence with the script as
      the card's text, and a rerun from the pane of code the agent just
      wrote would not, so an automatic rerun would be the fence's one
      hole. Left deliberately.
- [ ] **Captured figures are PNG only.** `plt.show()` is kept at 150 dpi;
      a figure saved through the seeded helper is a PDF in `figures/` and
      opens in the viewer, so the vector copy exists where it matters. An
      SVG capture would be a format choice in `script_runner.py`'s
      snapshot and a second file per shown figure; nobody has asked for
      the shown copy in vector form.
- [ ] **A file that appears outside NextTex begins its history with the
      state it arrived in, never with what was there before.** True of a
      document that was not open when the change landed, and of one the
      browser's socket opened in the moment between the write and the
      watcher's tick: the document is seeded from the file as it now is,
      so the earlier state was never anywhere NextTex could see. The
      earlier state could only come from a copy NextTex never took, and a
      file that already has a history keeps its earlier states there,
      where the version before this one is exactly that.
- [ ] **A document dropped by an outside move comes back as a followed
      one.** The watcher's re-scan drops a document whose file moved; the
      open tab's follow effect asks for it under the new name and marks it
      followed, so it can now leave with its last file where before the
      move it stayed. Telling "asked for" from "followed" for a document
      the strip lost and regained needs the origin the strip itself does
      not keep, and the `previews.json` format change section 34 declined
      is still the only place it could live; the followed set surviving a
      reload does not change that.
- [ ] **`PasswordNudge`'s persisted dismissal has no interface to undo
      it.** Deliberate and argued in that file's own header, with the
      action still reachable behind the cog.
- [ ] **The Emacs keymap is a vendored copy of `@replit/codemirror-emacs`
      6.1.0,** under `frontend/src/vendor/`, because the package's ESM
      build marks its own key and command registration as pure and a
      bundler drops it, so the keymap arrived with no keys; the CJS build
      brought a second copy of CodeMirror. Two annotations are removed in
      the copy and a licence header says so. Checked against the registry
      on 19 September 2026: 6.1.0 is still the newest release, so there is
      nothing to move back to. An upgrade means vendoring again by hand,
      and `keymaps.spec.ts`'s `C-k` against the real build is what says
      the keys arrived.
- [ ] **`password.spec.ts` "setting a password says so and closes itself"
      timed out once in four full runs**, and is understood well enough to
      be left alone. The close-out run worked the arithmetic rather than
      the timeout. The chain is a sequence of causes, not a race: the POST
      returns, `access-done` renders, `AccessCard.tsx:61-69`'s deliberate
      1800 ms timer fires `onClose`, `PasswordNudge.tsx:74-77` runs one
      `api.auth()`, and the lock goes. Every wait in the spec is on an
      observable and there is no window in which an event can be missed.
      The budget against that is generous: `playwright.config.ts` gives
      `expect` ten seconds, not the five this entry used to claim, the
      spec's own `toHaveCount(0)` gets six for 1800 ms plus a round trip,
      and the test has sixty against a worst case near twenty-six. Only a
      whole-machine stall fails it, which the one retry is there for.
      Widening a timeout here is the move `docs/testing.md` calls not
      worth it. If it recurs, open the trace before touching the numbers.
