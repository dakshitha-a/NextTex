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

- [ ] Delete the superseded Artifact trackers from the gallery, and the two
      files outside the repository they leave behind.

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
