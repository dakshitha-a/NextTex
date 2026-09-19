# What NextTex builds next, in order

This is working state, like `TRACKER.md`, and it sits beside it rather than
under `docs/` for the same reason: it describes what does not exist yet.
`TRACKER.md` is what is in hand and what finished work left behind. This
file is what to build next, in the order it should be built. An item leaves
this file when it enters the tracker's *In hand*, in the same commit, so the
two never describe the same work.

**How the order was chosen.** Three questions, asked of every candidate.
How often does somebody writing a paper meet this need: weekly, once per
paper, or once a career? How much of the mechanism is already here, so
that the feature is a surface on something that exists rather than a new
subsystem? And does it fit what NextTex has decided to be: a LaTeX editor,
not a general-purpose editor and not a git client; a typeset page that
stays the loudest thing on screen; an agent that is optional, with every
reference coming from a publisher's own record. Weekly needs on existing
mechanisms come first. A need met once a paper on a new subsystem comes
last. Anything that fails the third question is in the final section,
with its reason, so the decision can be revisited when something changes.

**What each item carries.** What the writer gets; why it sits where it
sits; what it builds on, named by the file that already does the nearby
work; a size, where *small* is an evening, *medium* a few days and *large*
a run of its own; and the version level it would earn under the rule in
`CLAUDE.md`, which is *y* for anything a writer can newly see or do. An
item that reverses a decision recorded in `docs/design.md` or in the code
says so, because the reason for the earlier decision is still there and
the reversal should have to answer it.

## The list

1. **Grammar and style, locally.** Spelling is checked in the browser
   without a model and without the network, and grammar can be too:
   Harper compiles to WebAssembly and runs on a sentence in a few
   milliseconds. It is fetched on first use, the way the word list and
   the PDF pane are, so the bundle budget is untouched. It runs over the
   prose mask that `frontend/src/panes/spell-scan.ts` already computes,
   which is what keeps a `\cite` from being read as a sentence with no
   verb, under a rule set trimmed for academic prose, and a finding gets
   the actions a misspelling has: replace it, ignore it in this project,
   ignore it for now. The second roadmap run left it for a run of its
   own: it is a new WebAssembly subsystem with its own loading, rule
   trimming and test story rather than a surface on something that
   exists. *Medium; y.*


2. **Read the page in the dark, two pages at once, rotate.** The editor
   has six grounds and the page is always white, which at night is the
   brightest thing in the room. An inverted page first, keeping figures
   the right way round; a two-page spread and rotation are cheap beside
   it. Two runs have left it for the same reason: a CSS invert on the
   canvas cannot keep figures the right way round, and pdf.js gives no
   per-object hook. *Small; y.*


3. **Spelling in other languages.** The bundled word lists are English.
   A German, French, Spanish or Portuguese list is downloaded when a
   project asks for it, the language is set once per project in
   `nexttex.toml`, and a `babel` or `polyglossia` line in the preamble is
   the hint that a project should. *Medium; y.*


4. **A git log, and blame.** The panel shows the commits, each opening
   to its diff, and the version panel can say who committed a line and
   when. *This reverses part of "four git buttons": the fifth button is
   still a terminal, but reading history is not a command.* Staging,
   branching and merging stay where they are. *Medium; y.*


5. **An equation as an image.** A selected equation typeset on its own
   and handed back as SVG or PNG, for a slide or a message. *Small; y.*


6. **Where a citation is missing.** An agent action that reads the
   paragraphs of a section and names the claims with nothing cited,
   using the literature search it already has for the suggestions. It
   proposes; the writer adds. *Small; y.*


7. **Alt text and PDF metadata in the submission check.** On the
   submission check that came with 2.14.0: hyperref's title and author
   metadata, a figure with no alternative text, and whether `pdfx` is in
   play for a venue that wants PDF/A. *Small; y.*

## Not adopting, and why

Each of these was considered and left out for the reason beside it. A
reason is what makes the decision revisitable.

- **A visual or WYSIWYG mode.** The source is what NextTex edits and the
  typeset page beside it is what it looks like; a third rendering between
  them is a second document model to keep in step with the first.
- **A formatting toolbar and a symbol palette.** Completion carries the
  snippets, and the typeset page has to stay the loudest thing on screen.
- **A terminal in the browser.** A shell behind a password on a tailnet is
  a different security posture from an editor behind one, and "the fifth
  command is a terminal" means your own.
- **Typst and Markdown as engines.** A second engine doubles the
  dependency graph, the log parser, synctex and every test that touches
  a build. NextTex is a LaTeX editor.
- **A gallery of converters, PDF-to-LaTeX and a diagram canvas.** A tools
  gallery is a different product. The one conversion a paper needs on the
  way out is the pandoc export, here since 2.15.0.
- **Snapshots after each successful compile.** The history already
  records every pause, per file, whether or not the build succeeded.
- **Skill packs, a downloadable shelf of them and a catalogue of CLI
  agents.** The agent is one, and the handbook and the sample of your own
  writing are the reusable-instruction mechanism, and the slash commands
  since 2.16.0 cover the reusable prompt.
- **An MCP server for outside clients.** The agent is the Claude CLI
  already, and somebody who wants it in a terminal runs it in the folder.
  Revisit if somebody asks.
- **Interface localisation.** One maintainer and an English interface.
- **Git staging, amend and merge-conflict resolution.** Not a git client.
- **The full PDF/UA accessibility rulebook, and resume ATS checks.** Item
  7 takes the part a paper needs; the rest is a conformance tool.
- **Conference deadlines, lab search and statistics calculators.** Not
  writing.
- **Assistant personas.** The distilled handbook and sample are the
  persona, and a menu of characters beside them would be a second one.
