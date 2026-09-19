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

The backlog close-out, after 2.16.0, works through every line of the
backlog below in two pushes. The first carries two things the writer
asked for while the plan was being drawn, the Vim status bar painting
over the settings sheet and a download menu with one row per document
and a chip per format, and then every fix this host can make: the
pycrdt warning, the `localStorage` copies, the last-opened tie, the two
flaky specs at their real causes, a bench row that has been measuring a
no-op, the vendored Emacs keymap checked against upstream, and a real
attempt at the PNG download the writer reported from the tree menu in
Chrome. The second gives the OpenAI provider the script tools behind
the permission card, runs it against the Ollama on this host, and runs
the papers importer over a folder of real papers, which is what the
writer asked for in place of a Zotero library nobody here has. What
stays afterwards is only what needs a Windows machine, a MiKTeX, the
real Claude CLI or OpenAI's own endpoint, each with its reason.

The first push went up as 2.17.0. The papers run is done: twenty-five
files, nineteen real open-access papers and six decoys, through the real
`pdftotext` and Crossref from a throwaway install. The first pass added
ten and lost the rest to Crossref's `429`; three defects came out of it
(no pacing or retry on a refusal, a figure's component DOI offered as a
paper, zero-width spaces inside an eLife DOI), each fixed with a test
over a page of `pdftotext` text in `tests/fixtures/`. The second pass
added all seventeen papers with a printed DOI, refused the thesis
chapter on the title check, said "No DOI printed" of the two arXiv
preprints and the slides, "nothing could be read" of the scan, the
truncated file and the text file, and counted the duplicate once.

The second roadmap run, after 2.13.0, took eight items from `ROADMAP.md`
in its order and went up as three pushes: the checks (the submission
panel and the bibliography rows) as 2.14.0, in and out (arriving with a
zip, an arXiv id or a git URL, and pandoc export) as 2.15.0, editor and
agent (the command palette, Vim and Emacs, paste as table or figure,
slash commands) as 2.16.0. Three of the roadmap's premises were found
wrong on the way in and are corrected in the design sections: the
required-field rules the bibliography check needs did not exist in
`nexttex/vendor/verify_bib.py`, which checks an entry against a
publisher's record; the context directory is under `.nexttex/`, which is
never synced, so shared prompt files live at the project root; and the
rail gained one tile, not three. It left the roadmap's seven, the Emacs
keymap as a vendored file rather than a dependency, and nothing else.

The rail's first review, after 2.12.0, went up as 2.13.0. The three ways
in were a stacked list with the chosen one unfolded in place, so the two
closed ones sat under the Create button and read as its children, and
did not look like buttons. The writer chose tiles from five variants
drawn for them: one row of icon tiles with the form under all three.
Nothing was left.

The projects screen revamp, after 2.11.1, went up as 2.12.0. The writer
chose, from five layouts drawn as an artifact, a rail: a docked column on
the left holding the brand, the agent, the three ways in and, at its
foot, help, the cog and the update, beside a list with a pinned header
that always has the search box and a sort by last opened or by name, the
list being the only thing that scrolls. Mid-plan they added a Browse
button beside the folder field, so a project's folder is chosen on the
machine's disk rather than typed. The order is a pure function, the
offer card is fetched on demand for the bundle's sake, the sheet is gone,
a phone gets a strip and a drawer, the help card is placed by
`placeMenu`, `/api/browse` has its first tests and a flag that skips
counting PDFs, the walk is one component shared with the papers chooser,
and the picker fills the field by the way in. What it left is two lines
in the backlog below, and one flake sighting.

The run after 2.10.0 works two requests from the writer: a review of the
history panel, whose close arrow was drawn over the size and the toggle,
and a Markdown preview that behaves like the page, its tab bringing its
file to the source pane and a double-click on its rendering reaching the
line. The panel's half is done: the header is two rows, a row shows that
it is hovered and chosen, Name it and Compare exist for a finger and a
keyboard, Escape leaves one level at a time and no longer blocks the
chat's, the viewing banner wraps instead of tearing, and the list follows
versions as they are recorded rather than after a build. The Markdown
half is done too: the tab brings its file, the document tab brings its
own back, and a double-click on the rendering lands on the line and the
word. The writer's mid-run report, the whole-project ZIP failing from
inside a project over HTTPS, was reproduced against the running install
with a real browser and fixed by fetching it the way the PDF is; what
Chrome objects to in a link download from that state is recorded in
`docs/design.md` §43 as not established. The rendering follows the
caret while typing, on the page's own anti-jump terms. The run went up
as 2.11.0, and the writer's same-day report that the `.md` and its
rendering did not close each other went up as 2.11.1.

Before it, the first roadmap run, after 2.7.0, took eleven items from
`ROADMAP.md` in its order, in three pushes. The build went up as 2.8.0:
the engine is chosen per document or per project, shell escape is
allowed per project on this machine and never silently, a missing
package installs from the drawer, and every build says which TeX made
it; with three interface fixes the writer's mid-run report turned up,
a deleted file's tab closes, closing the tab in front shows the next,
and a tab not in front follows its file. The editor went up as 2.9.0:
hover on a reference says the number and the page, sections and
environments fold, a bar above the source names the section at the top
of the pane, and a label, a citation key or a macro is renamed
everywhere by the syntax. Papers, provider and window went up as
2.10.0: the literature is searched from the Papers section without an
agent, a local model runs through the OpenAI provider with a base URL
and no key, and the page opens in a window of its own. What it left is
two lines under *Never run against the real thing* below, the install
button on a MiKTeX and the provider against a real endpoint, since this
machine has neither; and one flake, also below. The fifteen items that
stay in `ROADMAP.md` are where they were.

Before it, the run after 2.6.3 worked the writer's September
interface list to 2.7.0, in one push: a figure of any size opens whole
and downloads from its viewer, the source tab menu closes to the right
and downloads, the find field's typed text can be read, every menu and
popup is measured for contrast by a spec that stays, a menu never opens
below the screen, a folder answers a drag over it, and a Markdown file is
previewed. What it left is one line in the backlog below. Before it, the
run that worked the backlog finished with
2.6.0: of the thirty items at 2.4.0, eight were real gaps that could be
started from this checkout with a test, and all eight are done, in three
pushes. The README's screenshots show the tab-strip headers; a request
during a session's close waits for it; the composer's popovers arrive on
first open; the project list has arrow keys; a row says its project is
open in another window, which took closing the event stream on Back to
mean anything; a folder can be duplicated; an edit made outside NextTex
while it runs is a version and a pull's worth of them is one row of the
project's history; and a Windows bug report carries the task's history and
the interpreter's crash events. What it turned up and left is in the
backlog below, and the twenty-two items that need a machine or an account
this checkout does not have, or are decisions, are where they were.

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
- [ ] **The issue form's `where` field is an input rather than a dropdown**
      because GitHub does not prefill dropdowns from a URL. If that changes,
      a dropdown for the platform would make the field sortable.
- [ ] **The OpenAI provider has no script tools.** It puts no permission
      card up at all: everything it can do is confined by construction, and
      a tool that runs Python needs the card before it can have the tool.
      Parity is the card machinery on that provider, not a tool entry, and
      it is a piece of work with a design in it. The Claude provider has
      `run_script` since the backlog run. In hand: the backlog close-out's
      second push.

### Never run against the real thing

- [ ] **The drawer's Install button has not been pressed on a MiKTeX.**
      `nexttex/texpkg.py` runs `mpm --install=<stem>` when `tlmgr` is
      absent and `mpm` is present, with the missing file's stem as the
      package name, because MiKTeX names nearly every package after its
      main file and installs on the fly by default anyway; nothing here
      has a MiKTeX to check either claim against. The tlmgr path is run
      for real on this machine's TinyTeX and against the stand-in in the
      browser tier.
- [ ] **The OpenAI provider has never spoken to OpenAI, nor to a local
      server.** Everything above the transport runs for real against a
      stub: the streaming parser, the tool loop, the path fence, the
      edits, the usage accounting. Whether OpenAI still returns these
      shapes is unproven, and there is no account here to find out
      with. The base URL for a local model, added by the roadmap run, is
      the first real endpoint that provider could be exercised against
      without an account: install Ollama, point the form at
      `http://localhost:11434/v1` with a model it has pulled, and ask
      for an edit; none of that has been done here either. In hand: the
      backlog close-out's second push takes the local half.
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
