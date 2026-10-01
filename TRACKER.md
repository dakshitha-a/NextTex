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

The roadmap run, from 1 October 2026 at 4.13.5, builds the first eight
items of `ROADMAP.md`'s list in its order, one push and one *y* bump
each; venue templates stay on the roadmap for a run of their own. Each
item moves here from the roadmap when it starts. Its tracker page is
https://claude.ai/artifact/Lttcw8HSYKBGfhLUyVmy9x.

- [ ] **One-click fixes on the `.bib` rows.** `nexttex/bibcheck.py`
      reports and does not repair. Rows gain verbs that protect capitals
      in a title with braces, rename a key to author and year through
      `nexttex/rename.py`, drop bulky `abstract` and `url` fields, and
      merge two entries with one DOI.

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
same day went to `ROADMAP.md`. Its tracker page is
https://claude.ai/artifact/XJHE3kBwz6wkBWpYXcJxZ6.

The README run closed on 1 October 2026 at 4.12.1,
at the writer's request: the README is a front door of about 450 lines,
with animations filmed in the real app by `e2e/shots/tour.spec.ts`, and the long
text it held lives in `docs/install.md`, `docs/guide.md` and
`docs/keyboard.md`. It turned up and fixed a restore from History that
changed the file on disk and left an open editor showing what had been
undone, with the next write ready to put the deletion back, and a host's
start-at-boot refusal that pointed at a README passage that had moved. Its
design and tracker page is
https://claude.ai/artifact/T3da4GzKr4V5FHdafYxZAm.

The right-click menus run closed on 30 September
2026 at 4.11.0, at the writer's request: a file tree row, the tree's empty
space, every tab, a projects row, the typeset page, and the rows of the
Comments, Deleted and History drawers open their own actions on a
right-click, by one rule in the style guide, and Shift with a right-click
is always the browser's. It turned up and fixed History's Escape closing
the panel under a menu that had already claimed the key. Its tracker page
is https://claude.ai/artifact/XU4Kb38EP82iYRdXrBbvk6.

The collaboration merge and host run closed on 29
September 2026 at 4.10.2: two versions of a paragraph written apart are
kept and chosen in place, an outside edit or pull that clashes with typing
keeps both, and an install can be an always-on host that keeps its
writers' shared projects. It turned up and fixed two shared projects on
one install answering for each other, fields for invites, keys and paths
drawn in the sans, and, in a check between two real installs, peers that
forgot each other's address and never reconnected, and a merge that
doubled a whole document rather than its paragraph. Its tracker page is
https://claude.ai/artifact/SKmTRSrLXXe2BYXDT6Peyd.

Torn build files closed on 28 September 2026 at
4.6.0, from a writing agent's report of a cut-short `.aux`, an empty
`.bbl` and an `.aux` full of NUL bytes: a cancelled build puts back what
it touched, a cancelled task no longer leaves an engine running beside
the next one, the agent's build and compile as you type no longer
supersede each other, a damaged file is cleared once without being
asked, and Rebuild everything starts clean. It turned up and fixed the
e2e harness leaving its builds running. Its tracker page is
https://claude.ai/artifact/L17MEaxrgQgBMUNoewDJUJ.

Citations and Word figures closed on 27 September
2026 at 4.2.0: citation completion that reopens after each comma,
matches author, year and title words and offers the document's own
bibliography, and figures that reach a Word download whatever they are
drawn in. It turned up and fixed the completion popup's underline and
italics, which CodeMirror's theme had been adding since the overhaul,
and a race in the Markdown history spec. Its tracker page is
https://claude.ai/artifact/8GQZBbDqKPk47aNifYXj7q.

The backlog close-out closed on 26 September 2026 at
4.1.0, one push per step from 3.19.1: a script's escaped grandchild ended
by Stop, the Windows task asking for administrator itself, the browser
flakes fixed at their causes, diff, Vite and pdf.js a major version up
with the build's Node floor at 22.13 as 4.0.0, every control and size
from the kit, and the agent answering comments. It turned up and fixed a
reload that lost the answer being streamed, a name save that took the
caret from a password, and a pdf.js text layer sized by the old rules.
Its tracker page is https://claude.ai/artifact/BRABBddBZDD4j9iF1yHAkc.
One item stays open below, OpenAI against OpenAI, by the owner's choice;
the laptop's task was checked there the same day.

The fix run closed on 25 September 2026 at 3.19.0,
having fixed the probe's findings in the order its report proposed, one
push per step, 3.18.2 to 3.19.0. Its tracker page is
https://claude.ai/artifact/1PHFeRFMcKicS3PZFCqCzW. The findings were
`REVIEW.md`, 73 records with the four the Windows laptop sent after the
probe closed, and the file was deleted at the close once every record was
fixed or set down below: the cgroup half of Q-007, the kit's remaining
raw controls (Q-038), the laptop's task that only an administrator can
change (Q-070), and the major upgrades Q-036 weighed.

The probe itself closed on 25 September 2026 at 3.18.1. Its report page
is https://claude.ai/artifact/4mdUwu1mLwVYquc7Bm7vkS.

Before the probe: the pass after Opus 5.5 closed at 3.18.0 on 24 September 2026;
its tracker page is https://claude.ai/artifact/SqdkLWZHqSaMBS5nvKCRtF.
It left nothing new in the backlog. The run before it, the roadmap, the
rest of the backlog and comments, closed at 3.17.4; its tracker page is
https://claude.ai/artifact/7LzPbY8jvhfg3xSbAMqMwY. What that one left is
below: six rare browser flakes, named with the traces read, and the
OpenAI provider against OpenAI itself.

## Backlog

### Known gaps, with a cost somebody will eventually pay

None. The last three were closed on 1 October 2026 at 4.13.0.

### Measured and left, worth revisiting with a measurement

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

### Flaky, with the trace read

- [ ] **`e2e/specs/latex-links.spec.ts:112`, the reference hover, under
      load.** Run with `writing.spec.ts` at `--repeat-each=6` it failed
      2 of 156 on 4.13.1's interface and on 4.13.3's alike, the card
      never appearing; alone it passed 12 of 12. Not caused by the
      performance run; the likeliest cause is a document change arriving
      inside the card's rest and closing it.
- [ ] **`tests/api/test_build_loop.py` on CI.** It held the loop 0.60 s
      against a 0.25 s budget once, on the 4.13.1 push, and passed on the
      rerun and five times locally. A collection pause over its 72,000
      diagnostics is the suspect.

### Never run against the real thing

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

- [ ] **A Word download's figures are pictures, not vectors.** Word 365
      can carry an SVG with a PNG behind it, which would keep a PDF or SVG
      figure sharp at any zoom. It needs the `.docx` taken apart and put
      back after pandoc, Word draws some converted SVG wrongly, and no
      test here can check it against Word, so 300 dpi pictures were
      chosen. Worth revisiting if a writer finds print quality lacking.
- [ ] **A multi-page PDF figure shows its first page.** pandoc does not
      keep `\includegraphics`'s `page=`, so the export cannot know which
      page was meant. Rare in a paper; worth doing if one turns up.
