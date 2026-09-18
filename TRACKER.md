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

The first roadmap run, after 2.7.0: eleven items from `ROADMAP.md`, taken
in its order and grouped into three pushes. Each leaves this list in the
commit that finishes it.

The build went up as 2.8.0, with three interface fixes the writer's
mid-run report turned up: a deleted file's tab closes, closing the tab
in front shows the next, and a tab not in front follows its file.

The editor went up as 2.9.0.


Papers, provider and window, for 2.10.0, is done and is this push.

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

- [ ] **A PNG download the writer reported as broken was not reproduced.**
      The file route answers a PNG with its bytes, `image/png` and an
      attachment disposition, and the tree's *Download*, the image
      viewer's and the History panel's each raise a real download in
      Chromium, all under `e2e/specs/image-view.spec.ts` now. Whatever
      failed did so in a browser or on a network this checkout did not
      have; the report asks which control, which browser and how large
      the file was, and the item waits on the answer.

- [ ] **A full pytest run warns once that a pycrdt subscription was
      dropped on another thread.** `PytestUnraisableExceptionWarning`
      during `tests/api/test_download.py`, from a `Subscription` being
      garbage collected on a worker thread rather than the loop's; it
      does not appear when that file runs alone, so it is a store from an
      earlier test whose last reference died in a thread. A warning and
      not a panic, because it is a drop rather than a use, and the suite
      is green with it; left because finding which test's store it is
      means bisecting the order, and the cure is a `close()` that test is
      not calling.
- [ ] **A file that appears outside NextTex begins its history with the
      state it arrived in, never with what was there before.** True of a
      document that was not open when the change landed, and of one the
      browser's socket opened in the moment between the write and the
      watcher's tick: the document is seeded from the file as it now is,
      so the earlier state was never anywhere NextTex could see. Recorded
      rather than fixed: the earlier state could only come from a copy
      NextTex never took, and a file that already has a history keeps its
      earlier states there, where the version before this one is exactly
      that.
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
- [ ] **A script never runs on its own.** Not on save and not after the
      agent edits it; the pane says the agent changed it and offers Run
      again. The agent's runs pass the permission fence with the script as
      the card's text, and a rerun from the pane of code the agent just
      wrote would not, so an automatic rerun would be the fence's one
      hole. Left deliberately.
- [ ] **The OpenAI provider has no script tools.** It puts no permission
      card up at all: everything it can do is confined by construction, and
      a tool that runs Python needs the card before it can have the tool.
      Parity is the card machinery on that provider, not a tool entry, and
      it is a piece of work with a design in it. The Claude provider has
      `run_script` since the backlog run.
- [ ] **Captured figures are PNG only.** `plt.show()` is kept at 150 dpi;
      a figure saved through the seeded helper is a PDF in `figures/` and
      opens in the viewer, so the vector copy exists where it matters.
- [ ] **A document dropped by an outside move comes back as a followed
      one.** The watcher's re-scan drops a document whose file moved; the
      open tab's follow effect asks for it under the new name and marks it
      followed, so it can now leave with its last file where before the
      move it stayed. Recorded rather than fixed: telling "asked for" from
      "followed" for a document the strip lost and regained needs the
      origin the strip itself does not keep, and the `previews.json`
      format change section 34 declined is still the only place it could
      live; the followed set surviving a reload does not change that.
- [ ] **`password.spec.ts` "setting a password says so and closes itself"
      timed out once in four full runs**, waiting on the done card for the
      five second default, and passed on its retry in three seconds. The
      hash it waits on takes fifty milliseconds here, so the wait was
      somewhere else, on a machine running five browsers. Not reproduced
      in isolation, and not in five consecutive runs of the spec with
      retries off during the backlog run; if it recurs, trace it before
      widening the timeout.
- [ ] **The issue form's `where` field is an input rather than a dropdown**
      because GitHub does not prefill dropdowns from a URL. If that changes,
      a dropdown for the platform would make the field sortable.
- [ ] **The scheduled lane runs with `--tex=none`.** The TinyTeX shape has
      been dispatched by hand on all three runners and is green, with
      `verify_install.py --tex tinytex` checking pdflatex, the five extras
      and the service seeing them; the Monday schedule does not take it,
      to keep a CTAN mirror's bad day from painting the lane red for a
      reason that is not in the code. Dispatch `tex=tinytex` after any
      change to the TeX step in `nexttex/install/steps.py`.
- [ ] **The Windows restart helper on a machine where the task could not
      be registered.** `updates.windows_restart_argv` brings the server
      back after the update button on Windows. The lane drives it through
      the scheduled task and the per-push Windows job runs its command-line
      fallback for real under both PowerShells; the middle way back, the
      Startup shortcut on a non-admin account, has run nowhere.
- [ ] **One small latch left standing on purpose, from the projects screen
      sweep.** `PasswordNudge`'s persisted dismissal has no interface to undo
      it, which is deliberate and argued in that file's own header, with the
      action still reachable behind the cog. The two beside it, `error`
      keeping a dismissed notice's text and the sign-in screen carrying its
      chooser error into a provider's panel, are fixed: `error` now names
      the last notice still standing, which is what it means once a list
      exists.

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
      for an edit; none of that has been done here either.
- [ ] **Stop has not been pressed against the real CLI since the buffer
      fix.** The one-behind reply after Stop was diagnosed in a writing
      session's transcript and is reproduced by a stub with the SDK's
      buffer in `tests/test_agent_robustness.py`; the real `interrupt`
      control request and the `result` the CLI sends for a stopped turn
      are exercised only by `tests/test_live_agent.py` under
      `NEXTTEX_LIVE`. `tests/fake_claude.py` speaks the sign-in commands
      and not the stream protocol, and teaching it the protocol is a
      day's work that would still be a stand-in.
- [ ] **The papers importer has not been run over a real Zotero library.**
      Fifty-four tests cover the pipeline with the network and `pdftotext`
      stubbed. Crossref and doi.org were asked by hand during the backlog
      run and answered in the shapes the code reads, and
      `tests/test_papers_live.py` asks them again under `NEXTTEX_LIVE`;
      what no test here can say is how a real library of PDFs behaves.
- [ ] **Windows: no clean install on current master is on the record.** Four
      failures were found on a real Windows machine and fixed, the last in
      `e92a9d7`, but the verification run afterwards was never written down.
      The README says Windows is partly verified, which is honest; this is the
      check that would change that.
- [ ] **The update footer's long-reason line is held by a Linux browser
      test and was not re-taken on Windows.** The wrapping that pushed Try
      again off the footer strip was found on the Windows laptop, fixed in
      `frontend/src/panes/UpdateFooter.tsx`, and confirmed there off the DOM
      rather than off the screen: the laptop's session could not repoint its
      checkout at the fixed commit, and was told to leave that refusal alone
      rather than work around it. The browser test asserts the row's height;
      a screenshot from a Windows machine at 125 percent is what would close
      this.

### Deliberately not done, and worth revisiting only if something changes

- [ ] **The project tree is walked twice per open.** Three milliseconds of the
      ninety-five, so the plumbing to pass one walk into the other costs more
      than it buys. Revisit if the walk gets more expensive.
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
      which is a change to a function called from about fifty routes, and
      it is not worth 17 ms without somebody deciding it is.
- [ ] **A collaborator's settled edit records its version from inside the
      flush.** `CollabStore._write` calls `session.record_version`, which is
      a sha256 and a zlib compression, on the event loop, once per settled
      edit rather than once per burst. The bench does not measure it:
      `collab.edit_to_disk_ms` is taken on a store with no session, so the
      version record is outside that number, and `history.record_ms`, the
      nearest, is about two milliseconds on ten-byte strings. On a thesis
      chapter the sha256 and the zlib pass are a fraction of a millisecond
      each, and the queue it would take to move them off the loop, an
      ordered per-session queue consumed off it, is more machinery than
      that justifies. Worth doing if a measurement ever says otherwise.

