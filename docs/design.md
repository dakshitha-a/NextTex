# NextTex — Design Specification

> This document is the reference for all front-end work. It was produced before
> implementation and the built UI is reviewed against it. When the implementation
> and this document disagree, that is a bug in one of them — decide which, and
> fix that one. Do not let them drift silently.

## 1. Design direction

**The composing room.** The rendered PDF is the only white object on screen; everything
around it is the grey surround of a proofing table, and the only saturated colour in the
entire chrome is the pen the agent writes with. This comes from the practice of judging
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

Ten tokens per theme. `--paper` is a constant `#FFFFFF` in both themes — it is painted by
PDF.js and is never themed. `--line` and `--pen-wash` are derived, not authored:
`--line: color-mix(in oklab, var(--ink-3) 35%, transparent)`,
`--pen-wash: color-mix(in oklab, var(--pen) 12%, transparent)`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surround` | `#C7CCC7` | `#0D0F0E` | App background; the field the PDF sits on |
| `--surface` | `#E3E7E2` | `#161A18` | Panes: rail, editor body, chat column |
| `--surface-2` | `#D7DCD6` | `#1E2320` | Raised/inset: tab bar, status strip, hover fills, code blocks |
| `--surface-3` | `#CDD3CC` | `#272D29` | Pressed and selected states inside a raised surface |
| `--ink` | `#141715` | `#E3E8E2` | Primary text |
| `--ink-2` | `#4C534E` | `#9CA49E` | Secondary text, user messages, consequences |
| `--ink-3` | `#626963` | `#7F8781` | Metadata, file extensions, line numbers, idle dot |
| `--pen` | `#6B3A87` | `#C08CE8` | Agent identity, SyncTeX highlight, active-file bar, primary button |
| `--hint` | `#1B6B72` | `#56C7C0` | Live and interactive states that are *not* the agent: streaming stopped, a control the eye should find |
| `--error` | `#9C2521` | `#F0776D` | Compile errors, destructive hover |
| `--warn` | `#74590C` | `#D6B155` | chktex warnings, permission gate bar |
| `--ok` | `#2A6144` | `#6BC79A` | Git clean, added diff lines, resolved-allow dot |

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
- **< 900 px** — editor and PDF become a two-item segmented toggle in the status strip; only
  one is mounted.

**Rail collapse is to zero, not to an icon strip.** A 40 px activity bar is VS Code's shape
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
open; drag to 320 px. It auto-opens on the *first* build that produces errors; if the user
closes it, it does not reopen for that build. Warnings alone never auto-open it.

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
slot becomes a `⋯` opening rename / duplicate / download / delete / new file here. **Rename
is inline** — the label becomes an input in place, same font, same position, 1 px `--pen`
underline, Enter commits, Escape reverts. Never a modal.

Drag-drop upload highlights the target folder row only, never the whole panel.

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
02_theory.tex`, `--ink-3` — with a `Redo` link live for 10 s. The reverted chip then **stays
in the transcript permanently**. The chat is a record of what was done to the dissertation;
nothing in it ever disappears.

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

**Fonts are self-hosted, not loaded from Google Fonts.** §3 says "Google Fonts
only". NextTex is a self-hosted tool that people run on a private tailnet, and
often on a machine with no route to the public internet; a stylesheet from
`fonts.googleapis.com` would make the app's typography depend on Google being
reachable, and would tell Google every time someone opened their thesis. The
three families ship as `@fontsource` packages in the bundle. The typefaces and
their roles are unchanged.

**There is one transient message, at the bottom of the shell.** §6 says "no
toasts". It carries save and download failures only — the cases where an action
the user took did not happen and nothing else on screen would say so. It has no
timer: it stays until dismissed, because a failed save that fades out is worse
than no message at all.

**Editor syntax highlighting is near-monochrome.** The specification does not
cover token colours. Commands take `--ink` at 600, comments `--ink-3` italic,
arguments and literals `--ink-2`; no hue is introduced. The rendered page sits
two panes away and must stay the loudest object on screen, and `--pen` stays
reserved for the agent.

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
