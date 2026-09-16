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

A shared project surviving one machine losing its folder, worked from
`.claude/plans/binary-strolling-hinton.md`: a removed peer told once, edits
made while the server was stopped folded in, a share card outside the
project, leave, rejoin without an invite, and a join that may point at a
folder that already has files.

## Backlog

### Known gaps, with a cost somebody will eventually pay

- [ ] **An outside edit made while the server is running is not a
      version.** The watcher folds a `git pull` or another editor's save
      into the document through `ingest`, and nothing records what the
      file held before or after; only the projection's own writes and,
      since the projection record, edits made while the server was stopped
      are. Left because a pull touching forty files would write forty
      versions in one second and the timeline has no way yet to fold a
      burst like that into one entry.

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

- [ ] **The bug report has no Windows event log section.** `server.err.log`
      covers a server that started; a launcher that never got that far
      leaves its trace in the task's history, which `Get-WinEvent` can read.
      Waits for a Windows reporter whose report comes back empty.
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

- [ ] **A request during a session's close is told to wait, not made to.**
      `_close_session` holds the project id in `CLOSING` while the close
      awaits, and `session_for` answers 503 for it, so the window in which
      a second session could be built over a project still flushing is
      shut on every path since the backlog run put the provider change
      through the same guard. What remains is that the browser is told to
      try again in a moment rather than waited for, since `session_for` is
      synchronous and called from most of the routes; a moment is all the
      wait ever is.

- [ ] **One small latch left standing on purpose, from the projects screen
      sweep.** `PasswordNudge`'s persisted dismissal has no interface to undo
      it, which is deliberate and argued in that file's own header, with the
      action still reachable behind the cog. The two beside it, `error`
      keeping a dismissed notice's text and the sign-in screen carrying its
      chooser error into a provider's panel, are fixed: `error` now names
      the last notice still standing, which is what it means once a list
      exists.

### Never run against the real thing

- [ ] **The OpenAI provider has never spoken to OpenAI.** Everything above the
      transport runs for real against a stub: the streaming parser, the tool
      loop, the path fence, the edits, the usage accounting. Whether OpenAI
      still returns these shapes is unproven, and there is no account here to
      find out with.
- [ ] **The papers importer has not been run over a real Zotero library.**
      Fifty-four tests cover the pipeline with the network and `pdftotext`
      stubbed. Crossref and doi.org were asked by hand during the backlog
      run and answered in the shapes the code reads, and
      `tests/test_papers_live.py` asks them again under `NEXTTEX_LIVE`;
      what no test here can say is how a real library of PDFs behaves.
- [ ] **Windows: no clean install on current master is on the record.** Four
      failures were found on a real Windows machine and fixed, the last in
      `db8c332`, but the verification run afterwards was never written down.
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

- [ ] **A folder cannot be duplicated.** Copying a tree has its own failure
      modes and deserves its own decision; the route refuses it and neither
      menu offers it. Duplicate for a file is on the tab strip and in the
      tree since the backlog run.

### Deliberately not done, and worth revisiting only if something changes

- [ ] **Split the composer's four controls out of the entry chunk.**
      `bench/thresholds.json` names this as the honest way back under the
      bundle budget, and it is a refactor rather than an import change. The
      permission card is the wrong candidate for the same treatment: a session
      with an agent in it always sees cards.
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
- [ ] **The README's screenshots show the headers as they were.** The
      preview header had a serif "Preview" label for a single document and
      the `+` was a glyph; both are tabs and an icon now. `e2e/shots/`
      regenerates them and is never run by a check. The tutorial's figures,
      which were on this item too, were regenerated on 15 September 2026;
      the README's are `e2e/shots/hero.spec.ts` and still wait.
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

