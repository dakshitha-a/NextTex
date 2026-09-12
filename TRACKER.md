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

- [ ] **A joiner gets a manifest entry for a binary file and no file.**
      `figures/plot.png` arrives as a name with nothing behind it. Syncing a
      figure's *past* is done; delivering its bytes is not. A file-sync gap
      rather than a history one, which is why it was left when the history
      work closed.
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
- [ ] **Five menus claim `role="menu"` without implementing it.** The spelling
      menu in `frontend/src/panes/Editor.tsx`, the document chooser in
      `frontend/src/panes/PreviewTabs.tsx`, the downloads menu in
      `frontend/src/chrome.tsx` and two in `frontend/src/panes/Chat.tsx` carry
      the role, and none of them offers the arrow-key navigation it promises,
      so assistive technology is told each is a menu widget when it is a column
      of buttons. `frontend/src/panes/FileTree.tsx` and the tab strip's menu
      deliberately do not claim it, which is the honest half of an
      inconsistency rather than a resolution. The answer is roving focus in all
      seven, which is a piece of work of its own and is why it was not done
      alongside the tab menu.

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

- [ ] **The caret readout is not reset when the editor swaps to another
      file.** `setState` does not fire the update listener, so the line and
      column in the status strip belong to the state that was replaced.
      Writing the caret from the parked state inside `afterSwap` in
      `frontend/src/panes/Editor.tsx` stops later keystrokes reaching the
      readout at all, which is worse than the bug and which I could not
      account for; the other two things R-069 named, the selection verb row
      and the spelling menu, are fixed there. Left rather than shipped half
      understood.

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
