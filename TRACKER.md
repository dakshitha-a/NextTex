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

The hover cards run goes up as 3.4.0 on 21 September, planned after the
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

- [ ] **A PNG download the writer reported as broken was not reproduced,
      twice.** The report names the tree's row-menu *Download*, in Chrome.
      The route answers the bytes with `image/png` and an attachment
      disposition; the tree's, the viewer's and the History panel's
      *Download* each raise a real download in Chromium under
      `e2e/specs/image-view.spec.ts`; and the backlog close-out went
      after the two things that tier lacks, the origin and the size: a
      throwaway install behind a TLS front on this host, a 1 MB PNG and a
      201 MB one, Playwright's full Chromium through the row menu, both
      files landing with their full byte counts and a clean console,
      twice. Google Chrome itself is not on this host. What would close
      it: the words on Chrome's download bar when it fails ("Failed -
      Network error", "Blocked", "Insecure download"), whether it was the
      laptop or this machine, and whether the tab was on the tailnet's
      HTTPS address or the token URL.
- [ ] **A Windows install's server exited silently after an update's
      restart.** Seen on the laptop during the cross-machine check for
      2.3.0: the restart helper launched the Startup shortcut, the new
      server printed its banner four seconds later, and by morning nothing
      was listening, with `server.err.log` empty and no crash, reboot or
      logoff in Windows' own logs. Either the process died with nothing
      logged or the minimized console window the shortcut opens was closed
      by hand, which kills it without a word. Left because the two cannot
      be told apart from the evidence; the bug report now carries the
      evidence, since the backlog run gave it the task's history and the
      Application log's crash events on Windows, so the next step is to
      leave a freshly restarted server alone overnight on that machine
      with its window untouched and read the report's Windows events
      section in the morning, and if it is still up, to have the shortcut
      run the server without a console window at all.
- [ ] **The Windows restart helper on a machine where the task could not
      be registered.** `updates.windows_restart_argv` brings the server
      back after the update button on Windows. The lane drives it through
      the scheduled task and the per-push Windows job runs its command-line
      fallback for real under both PowerShells; the middle way back, the
      Startup shortcut on a non-admin account, has run nowhere.
- [ ] **The update footer's long-reason line is held by a Linux browser
      test and was not re-taken on Windows.** The wrapping that pushed Try
      again off the footer strip was found on the Windows laptop, fixed in
      `frontend/src/panes/UpdateFooter.tsx`, and confirmed there off the DOM
      rather than off the screen: the laptop's session could not repoint its
      checkout at the fixed commit, and was told to leave that refusal alone
      rather than work around it. The browser test asserts the row's height;
      a screenshot from a Windows machine at 125 percent is what would close
      this.
- [ ] **`navigation.spec.ts` "the caret readout belongs to the file on
      screen" failed once under the full tier and passed on retry.** Seen
      at the backlog close-out's push A check: the spec makes a new file,
      waits for its tab, types `abc` and expects `Ln 1, Col 4`; it read
      `Ln 1, Col 2`, so one or two keystrokes went missing. The likely
      shape is typing into a file whose shared document has not yet
      arrived from the server, with the local document then replaced
      under the caret; the tab being visible is not the document being
      live. One sighting; a second is the signal to find what the editor
      could expose as "this document is live" and have the spec wait on
      it, and to check whether a writer typing straight into a new file
      can lose a character the same way.
- [ ] **A spec's own server once took longer to start than the harness
      waits.** `tab-strips.spec.ts` failed at the backlog close-out's push
      B check with "the server never answered on 127.0.0.1:36551" and
      passed on retry; nothing in the spec ran. Two workers, each a real
      server, beside a LaTeX build. One sighting; a second is the signal
      to read what `startServer` in `e2e/server.ts` waits on and how
      long, and to widen it or to have it say which step was slow.
- [ ] **`openai-card.spec.ts` "Allow always survives a reload as a
      settled card" failed and passed on retry in four of the frame run's
      nine full checks.** The failing read was `toBeVisible` on "Done."
      after the card's Always is pressed, within 20 s, on a run with two
      workers beside a LaTeX build; the case passed alone every time it
      was run alone. The likely shape is the scripted OpenAI stand-in
      finishing its turn before the card's answer lands, or the 500 ms
      shield on the card's buttons letting the click through a moment
      early under load, so the press is lost and the turn waits out its
      timeout. Four sightings in one day is past the one-sighting bar the
      two entries above set; what closes it is reading the card's answer
      route under load (`tests/api/` has the permission gate's cases) and
      having the spec wait on the card's own "answered" state rather than
      on the turn's last word. `previews.spec.ts` "renaming a previewed
      document moves its tab and its page together", `history-trash.spec.ts`
      "naming a version makes it findable later" and `writing.spec.ts`
      "typing lands on disk without being asked to" each flaked once in
      the same runs.
- [ ] **The issue form's `where` field is an input rather than a dropdown**
      because GitHub does not prefill dropdowns from a URL. If that changes,
      a dropdown for the platform would make the field sortable.

### Never run against the real thing

- [ ] **The drawer's Install button has not been pressed on a MiKTeX.**
      `nexttex/texpkg.py` runs `mpm --install=<stem>` when `tlmgr` is
      absent and `mpm` is present, with the missing file's stem as the
      package name, because MiKTeX names nearly every package after its
      main file and installs on the fly by default anyway; nothing here
      has a MiKTeX to check either claim against. The tlmgr path is run
      for real on this machine's TinyTeX and against the stand-in in the
      browser tier.
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
- [ ] **Windows: no clean install on current master is on the record.** Four
      failures were found on a real Windows machine and fixed, the last in
      `e92a9d7`, but the verification run afterwards was never written down.
      The README says Windows is partly verified, which is honest; this is the
      check that would change that.

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
      timed out once in four full runs**, waiting on the done card for the
      five second default, and passed on its retry in three seconds. The
      hash it waits on is already off the loop and takes fifty
      milliseconds here, and the spec starts a server of its own, so the
      wait was a cold instance under five browsers. Not reproduced in
      isolation, nor in five consecutive runs with retries off. If it
      recurs, open the trace `playwright.config.ts` retains on failure
      before touching the timeout.
