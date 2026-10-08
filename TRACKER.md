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

Nothing is in hand. On 8 October 2026, at 4.30.1, the run on the flash
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

- [ ] **The flash after a build covers a whole display for a caret in
      it.** The page sets a display's symbols in an order the source does
      not write, as the double-click's own gap below says, so the letters
      around a caret inside `\begin{equation}` seldom agree with the page
      and every box of the display is flashed. The census counts these as
      held but not as one line of type. A caret in a file no editor tab
      holds, which an agent's edit can name, flashes every line its
      source line set, since there is no text to line up.

- [ ] **A click inside a displayed equation can select the wrong symbol.**
      The census has "N", the upper limit of a sum, selecting `\sum`: the
      page sets a display's pieces in an order the source does not write,
      so the text around a glyph agrees with the source less than it does
      in prose. Inline maths and every word of prose land; mapping a
      display's layout back to its source would take a TeX parser.

- [ ] **A text file that is not UTF-8 cannot be opened.** The tree reads
      the first 8 kB of a file it has no name for, so an old program's
      output in Latin-1 is a download, and one that turns to Latin-1 past
      the first 8 kB is called text and then refused by the file route,
      which says it is not UTF-8. Opening it would mean choosing an
      encoding to write it back in, which nothing asked for yet.

- [ ] **Four tour animations are still the soft 1x recordings.** The
      motion, rail and tour run found that every animation had been
      filmed at one pixel per point, since the screencast ignores the
      ratio a context emulates, and re-filmed the hero, citations and
      the new script row at two and three. Errors, History and git,
      Download and Write together were left as they were because the
      writer asked about the first two only; their close-ups are as soft
      as the hero's were. Re-filming each is one run of its scene in
      `e2e/shots/tour.spec.ts`.

### Measured and left, worth revisiting with a measurement

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

### Flaky, with the trace read

- [ ] **`e2e/specs/history-panel.spec.ts:117` failed once under the
      quick tier's full run for 4.24.2** and passed on its retry. It was
      on the earlier flaky list; not read further this time.

- [ ] **Four specs that failed once each under the full run's load
      in the roadmap run**: `bib-check.spec.ts:76` (the
      `\bibliographystyle` completion) and `writing.spec.ts:237` (Tab
      indenting) on the 4.18.0 check, `menus-contrast.spec.ts:650` and
      `share-panel.spec.ts:135` on the 4.19.0 check, each passing on its
      retry; the first two passed 10 of 10 alone. Not read further,
      since none recurred in the two runs after. `menus-contrast.spec.ts:668`
      failed once more on the 4.29.0 check, the light shell's card over a
      cross-reference not opening, and passed on its retry.

### Never run against the real thing

- [ ] **A venue template's install on MiKTeX.** Each template's
      `[needs]` names TeX Live packages, and `texpkg.install_argv` hands
      the name to MiKTeX unchanged; most names coincide, some may not.
      MiKTeX also installs on the fly during a build, so a name it does
      not know shows the "did not install" notice and the build may
      still succeed. Tried only on TinyTeX; worth one ACM project on the
      owner's Windows laptop.
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
