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

- [ ] Delete the superseded Artifact trackers from the gallery at
      claude.ai/code/artifacts. Ten NextTex pages, from Reworking the Agent
      Panel back to the Release Tracker. Nothing here can do it: publishing an
      Artifact is a tool call and deleting one is not, so it has to be done by
      hand. The working files they left outside the repository are gone, and
      what was worth keeping from them is in this file.

## Backlog

### Known gaps, with a cost somebody will eventually pay

- [ ] **`server/run.py --version` cannot answer on a broken virtual
      environment.** The file imports uvicorn before it reads its
      arguments. `--report` has `python -m nexttex.report` as its bare
      interpreter spelling; `--version` has none, and the answer is in the
      report anyway, so this waits for somebody to want it on its own.
- [ ] **The server prints its token URL to stdout at every start**, so
      `server.log` on macOS and Windows, and the journal on Linux, hold the
      token in clear for the life of the log. The bug report redacts it,
      and `update.sh` prints it too. Printing it once, to a terminal, and
      telling a service to ask `--print-url` would close it; left because
      the log is 0600 and the fix touches every launcher.
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
- [ ] **`fetch-interface.ps1` on Windows 7 or 8.1.** `Invoke-WebRequest`
      there does not offer TLS 1.2 by default and GitHub requires it. Modern
      Windows is fine and the lane runs on it; the fix is one line setting
      `[Net.ServicePointManager]::SecurityProtocol`, left until somebody on
      such a machine appears.

- [ ] **A joiner gets a manifest entry for a binary file and no file.**
      `figures/plot.png` arrives as a name with nothing behind it. Syncing a
      figure's *past* is done; delivering its bytes is not. A file-sync gap
      rather than a history one, which is why it was left when the history
      work closed. The September review's Windows laptop joined a project
      with no real binaries in it, so whether a figure added on one machine
      arrives on another is still untested between two computers; the gap
      is known in one process.
- [ ] **A peer link that dies silently is not noticed until something is
      sent.** `PeerLink.alive` in `server/collab/peers.py` flips on a send
      failure, a closed stream, a denial or a removal, and on nothing else,
      so a QUIC path that stops carrying packets without closing leaves both
      ends drawn as connected until one of them types. The fix is a
      heartbeat frame, and `server/collab/wire.py` has ten frame kinds and
      no version number: adding a kind means both sides have to tolerate one
      they do not know, which is a wire-version decision rather than a line,
      and it was found by reading rather than by anybody meeting it. The
      `collab_peers` event that pass 3 of the fix run added covers every
      departure the link does notice.
- [ ] **Rekey history on the collaboration file id rather than the path
      slug.** Three keyspaces meet here, the path slug, the file id and the
      trash entry id, and that is the root cause behind two findings already
      fixed by narrower means. Following the manifest's path on the receiving
      side was the minimal correct fix; rekeying is a migration and deserves
      its own run.
- [ ] **The session reaper's window.** It takes a session out of the table and
      then awaits its close, so a request landing in that window builds a
      second history on the same directory while the first is still writing to
      it. Closing it properly needs `session_for` to be able to wait, and it is
      called synchronously from most of the routes in `server/main.py`.

- [ ] **Three small latches left standing on purpose, from the projects screen
      sweep.** `dismissNotice` in `frontend/src/store.ts` leaves `state.error`
      holding the text of the notice just dismissed, which is harmless because
      nothing in the app reads `s.error` directly and the notice list is the
      thing that gets rendered; fixing it means deciding what `error` means
      once the list exists, which is a larger question than the symptom.
      `frontend/src/panes/SignIn.tsx` keeps its top-level error across a move
      from the provider chooser into a provider's own panel, which is cosmetic
      and overwritten by the next attempt. And `PasswordNudge`'s persisted
      dismissal has no interface to undo it, which is deliberate and argued in
      that file's own header, with the action still reachable behind the cog.

### Never run against the real thing

- [ ] **The OpenAI provider has never spoken to OpenAI.** Everything above the
      transport runs for real against a stub: the streaming parser, the tool
      loop, the path fence, the edits, the usage accounting. Whether OpenAI
      still returns these shapes is unproven, and there is no account here to
      find out with.
- [ ] **The papers importer has never spoken to Crossref.** Fifty-four tests
      cover the pipeline with the network and `pdftotext` stubbed. What no test
      here can say is how a real Zotero library behaves.
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

- [ ] **Duplicate is on the tab strip and not in the file tree.** The route and
      the naming rule are shared, so adding it to
      `frontend/src/panes/FileTree.tsx`'s row menu is a line in the item list
      and a branch in `act`. It was left because the menu asked for was the tab
      strip's and a row menu that already holds twelve items is not somewhere
      to add a thirteenth without being asked. A folder cannot be duplicated
      either way: copying a tree has its own failure modes and deserves its own
      decision.

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
- [ ] **A folder with no `.tex` in it opens with an empty preview strip, and
      only the API says so.** `tests/api/test_previews.py` covers the 404 and
      the template load that gives the folder its first document; the pane
      shows its "nothing typeset yet" offer through `pdf-absence.ts`, which
      keys on the status and not the message, but no browser test opens such
      a folder. It is a state a project is in for the first minute and never
      again.
- [ ] **The README's screenshots and the tutorial's tab-strip figure show
      the headers as they were.** The preview header had a serif "Preview"
      label for a single document and the `+` was a glyph; both are tabs and
      an icon now. `e2e/shots/` regenerates them and is never run by a check,
      and the photographs are the one part of the documents this run did not
      remake, because the headers were photographed at one and two on a
      machine this session does not have.
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
      edit rather than once per burst. The bench measures the whole path,
      `collab.edit_to_disk_ms`, at 3.39 ms against a 120 ms budget, so this
      is thirty-five times inside its own limit and the queue it would take
      to fix it properly, an ordered per-session queue consumed off the
      loop, is more machinery than the measurement justifies. Worth doing
      if that number ever moves.

- [ ] **A blob asked for once is never asked for again.** `PeerLink.wanted`
      in `server/collab/peers.py` is a set of content addresses with no time
      in it, and `_send_blob` says nothing when it holds none, so a peer that
      was asked while it happened not to have the blob is never asked again
      and the version stays unopenable. Giving `wanted` an age and answering
      a miss are both changes to what the wire says, which wants a frame kind
      and a version thought rather than a line, and it was found by reading
      rather than by anybody meeting it.

- [ ] **What a distillation writes does not mark the context stale.** A
      distilled `voice.md` or `style.md` is written under `.nexttex/`, which
      the file watcher ignores by design, so nothing publishes
      `context_changed` and the panel's "these have not been read since you
      changed them" marker is computed from what it last saw. Noticed while
      fixing the rest of R-066; the fix is one publish in the agent's
      `on_edit`, and it wants a test that can drive a real distillation.

- [ ] **The spell checker knows one variety of English.** The word list is
      `wamerican`, so a thesis written in British English is underlined from
      end to end: colour, analyse, centre, and every derived form. Left out of
      R-091 deliberately rather than by oversight. The suggestions and the way
      back from an accepted word are both about a word at a time and cost
      nothing but code; a second locale is a second ninety-eight kilobyte list,
      a setting to choose between them, a decision about what a project shared
      between two writers with different settings does, and a rule for which
      one a new project starts with. That is a piece of work with a design in
      it rather than a control in front of something that exists, which is what
      the rest of that record was.
