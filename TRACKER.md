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

Nothing is in hand. The collaboration merge and host run closed on 29
September 2026 at 4.10.0: two versions of a paragraph written apart are
kept and chosen in place, an outside edit or pull that clashes with typing
keeps both, and an install can be an always-on host that keeps its
writers' shared projects. It turned up and fixed two shared projects on
one install answering for each other, and fields for invites, keys and
paths drawn in the sans. Its tracker page is
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

- [ ] **A citation list that spans lines is not completed.** The
      completion source reads the current line, so a `\cite{` whose keys
      run onto the next line offers nothing there. Rare, since a list is
      usually typed on one line; the fix is reading back to the brace.

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
