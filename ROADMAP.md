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

1. **Install a missing package from the error drawer.** The commonest
   build failure on a TinyTeX install is a `.sty` file that is not there.
   `nexttex/explain.py` already recognises the error and tells the writer
   to run `tlmgr install` themselves, which is the one instruction in the
   drawer that sends somebody to a terminal. Map the file to its package
   with tlmgr's file search, put an *Install* on the diagnostic row behind
   the same two-press card the script pane uses for pip, which lives in
   `nexttex/plots.py`, run it off the loop, and build again when it lands.
   MiKTeX on Windows has an install command of its own and the survey
   already knows which of the two is here. *Small to medium; y.*

2. **Choose the engine per document: xelatex and lualatex.** NextTex runs
   pdflatex and nothing else, in `nexttex/compile.py`. A paper in a
   non-Latin script, or one whose venue hands out a font, needs fontspec,
   and fontspec needs one of the other two. Honour the `% !TeX program =`
   line that every other editor honours, and an `engine` key in
   `nexttex.toml` for a project that would rather say it once; a preamble
   that loads fontspec or polyglossia under pdflatex gets a diagnostic
   naming the fix rather than fontspec's own error. The fast pass becomes
   one run of the chosen engine, and synctex and the log parser are
   engine-neutral already. *Medium; y.*

3. **Before you submit.** One panel that reads the last build and says
   what a venue would send back. Nearly every input is already parsed:
   undefined references and citations, the overfull count, the page
   count and missing files come out of `nexttex/latexlog.py`; duplicate
   and unused labels and uncited bibliography entries come out of the
   symbol scan. What is new is the checks a log cannot make. Fonts not
   embedded, which poppler's `pdffonts` answers and which arrives with
   the `pdftotext` the installer already names. Raster figures below the
   resolution print needs. A `\today`, a `\todo`, a TODO in a comment, a
   commented-out paragraph. The author, affiliation and acknowledgement
   fields when the writer says the review is blind. A page limit they
   type in. Every row names the file and line, and none of it involves a
   model. *Medium to large; y.*

4. **Bibliography checks while you type.** A `.bib` file gets rows in the
   drawer the way a `.tex` file gets chktex rows: a duplicate key, a
   required field missing for the entry type, a year that is not one, a
   DOI that appears twice, an entry no document cites. Typing `@` at the
   start of a line offers the entry types with their fields as tab stops,
   and `\bibliographystyle{}` completes the styles this TeX has. The
   field rules are the ones `nexttex/vendor/verify_bib.py` already applies
   when it checks an entry against its record; this moves them from an
   action to a standing check. *Small to medium; y.*

5. **Grammar and style, locally.** Spelling is checked in the browser
   without a model and without the network, and grammar can be too:
   Harper compiles to WebAssembly and runs on a sentence in a few
   milliseconds. It is fetched on first use, the way the word list and
   the PDF pane are, so the bundle budget is untouched. It runs over the
   prose mask that `frontend/src/panes/spell-scan.ts` already computes,
   which is what keeps a `\cite` from being read as a sentence with no
   verb, under a rule set trimmed for academic prose, and a finding gets
   the actions a misspelling has: replace it, ignore it in this project,
   ignore it for now. *Medium; y.*

6. **Hover says the number.** Hovering `\ref{fig:a}` says the file and
   line; it should say "Figure 3, on page 7". Every build writes
   `\newlabel` lines into `.aux` files that the build directory already
   mirrors per chapter, so the numbers are on disk after every pause in
   typing and only need reading. The same numbers go beside each label in
   the completion list, and hovering an `\includegraphics` shows the
   image, which the file route already serves. The hover and tooltip
   machinery is `frontend/src/panes/math-hover.ts`. *Small; y.*

7. **Rename a label or citation key everywhere.** Renaming `fig:overview`
   today is a project-wide replace that the writer has to scope by hand.
   *Find references* for a label, a key or a macro, and *Rename* across
   every file, on the search and replace routes that exist in
   `server/main.py`, which already record a version per changed file. The
   rename knows the syntax, so `fig:a` leaves `fig:ab` alone and a rename
   inside a comment is offered rather than assumed. *Small; y.*

8. **Search the literature yourself.** The agent can search Crossref,
   OpenAlex and Semantic Scholar; the writer without an agent cannot. A
   search box in the Papers section at the foot of the file list, running
   the same `nexttex/vendor/lit_search.py`, with an *Add* on each result
   that goes through the add-by-DOI path the section already has. The
   principle is the one the README states: everything the agent does
   with references is yours without an agent as well. *Small; y.*

9. **Arrive with a project.** Upload a zip and have it unpacked into a
   new project rather than into one that exists; give an arXiv id and
   have its source fetched and unpacked; give a git URL and have it
   cloned, which `nexttex/gitrepo.py` cannot yet do, though it can attach
   a remote to a repository that exists. Templates stay out: the decision
   in `server/main.py` that a new project is empty on purpose still
   stands, because a template is a guess about the venue. A starting point
   that is somebody's real project, including your own from last year, is
   not a guess. *Medium; y.*

10. **Local models through the OpenAI provider.** The OpenAI provider
    speaks a protocol that Ollama, LM Studio, vLLM and most local servers
    speak too, so a base URL in the settings sheet is nearly the whole
    feature, and with it the sentence "nothing leaves this machine" holds
    with an agent running. It is also the first real endpoint that
    provider could be exercised against, which bears on the tracker's note
    that it has never spoken to OpenAI. *Small; y.*

11. **Word, HTML and Markdown export with pandoc.** A co-author who does
    not write LaTeX, a journal that wants a `.docx`, a web page for the
    group's site. Pandoc is named in the installer's survey as an optional
    tool, the way `pdftotext` is, and when it is present the download menu
    gains the three formats. *Small to medium; y.*

12. **Fold sections and environments.** A fold gutter in the source pane,
    with a LaTeX fold service built on the parser in
    `frontend/src/outline.ts`, so a chapter can be read as its headings and
    a forty-line table can be closed while the prose around it is
    written. *Small; y.*

13. **A command palette.** One box that finds every action, setting and
    file by typing. The chords in `frontend/src/keys.ts` and the settings
    sheet's controls are the list; the palette is the way to reach them
    without remembering which. *Medium; y.*

14. **Vim and Emacs keymaps**, loaded only when chosen, so a session that
    does not want one pays nothing. Undo stays the shared document's, which
    is the constraint recorded in `docs/architecture.md`, and a keymap that
    brings its own history has to be told not to. *Small; y.*

15. **Read the page in the dark, two pages at once, rotate.** The editor
    has six grounds and the page is always white, which at night is the
    brightest thing in the room. An inverted page first, keeping figures
    the right way round; a two-page spread and rotation are cheap beside
    it. *Small; y.*

16. **Paste data as a table, paste an image as a figure.** Comma- or
    tab-separated text on the clipboard becomes an escaped booktabs table
    at the caret. An image pasted into the source is saved into `figures/`
    on the upload path that exists and an `\includegraphics` written for
    it, which is what pasting one into the agent panel does today for a
    different purpose. *Small; y.*

17. **Slash commands in the agent panel, and a review in two voices.**
    A `/` at the start of the box lists reusable prompts kept as files in
    the context directory beside the distilled style guide, so a group can
    share them through git. The first two are `/review friendly`, which
    reads as a mentor, and `/review critical`, which reads as a second
    reviewer. *Small to medium; y.*

18. **Spelling in other languages.** The bundled word lists are English.
    A German, French, Spanish or Portuguese list is downloaded when a
    project asks for it, the language is set once per project in
    `nexttex.toml`, and a `babel` or `polyglossia` line in the preamble is
    the hint that a project should. *Medium; y.*

19. **Shell escape, per project, on purpose.** `minted` and `pythontex`
    need `-shell-escape`, and a build the editor starts on its own must
    never pass it silently. It is switched on in `nexttex.toml`, which is
    validated rather than trusted because a project may have come from
    somebody else, and confirmed once per machine and project before the
    first build that uses it. *Small; y.*

20. **A git log, and blame.** The panel shows the commits, each opening
    to its diff, and the version panel can say who committed a line and
    when. *This reverses part of "four git buttons": the fifth button is
    still a terminal, but reading history is not a command.* Staging,
    branching and merging stay where they are. *Medium; y.*

21. **The page in its own window.** A view with nothing but the typeset
    page, for a second monitor, on the two-window machinery a project
    already supports. *Small; y.*

22. **An equation as an image.** A selected equation typeset on its own
    and handed back as SVG or PNG, for a slide or a message. *Small; y.*

23. **A sticky section header** above the source, so a long chapter says
    where you are without scrolling up to find out. *Small; y.*

24. **Where a citation is missing.** An agent action that reads the
    paragraphs of a section and names the claims with nothing cited,
    using the literature search it already has for the suggestions. It
    proposes; the writer adds. *Small; y.*

25. **The TeX version on every build.** The engine's version beside the
    build's log and in the bug report, so a build that differs between two
    machines can be explained without asking. *Small; z.*

26. **Alt text and PDF metadata in the submission check.** After item 3:
    hyperref's title and author metadata, a figure with no alternative
    text, and whether `pdfx` is in play for a venue that wants PDF/A.
    *Small; y.*

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
  way out is item 11.
- **Snapshots after each successful compile.** The history already
  records every pause, per file, whether or not the build succeeded.
- **Skill packs, a downloadable shelf of them and a catalogue of CLI
  agents.** The agent is one, and the handbook and the sample of your own
  writing are the reusable-instruction mechanism; item 17 covers the
  reusable prompt.
- **An MCP server for outside clients.** The agent is the Claude CLI
  already, and somebody who wants it in a terminal runs it in the folder.
  Revisit if somebody asks.
- **Interface localisation.** One maintainer and an English interface.
- **Git staging, amend and merge-conflict resolution.** Not a git client.
- **The full PDF/UA accessibility rulebook, and resume ATS checks.** Item
  26 takes the part a paper needs; the rest is a conformance tool.
- **Conference deadlines, lab search and statistics calculators.** Not
  writing.
- **Assistant personas.** The distilled handbook and sample are the
  persona, and a menu of characters beside them would be a second one.
