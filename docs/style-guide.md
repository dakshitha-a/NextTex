# The interface's style guide

Read this before adding or changing anything a writer sees. It is the
look the visual overhaul of September 2026 gave NextTex, written down so
that what comes after keeps it. The direction page that overhaul was
built against is a record; this file is the rule. Everything it names
exists in the code, and `tests/test_documents_match_the_code.py` checks
that it keeps naming things that exist. When a change needs something
this guide does not have, add it here in the same commit, never by
improvising in the component.

## The principle

The interface shows what the current act needs and reveals the rest on
intent. Cognitive load is a design principle beside contrast and
consistency: every decision is weighed for how much it asks the writer
to hold in mind at once. In practice, row actions appear under the
pointer or on focus, composer tools on focus, consecutive tool calls
fold into one line, nothing carries a badge, a count or a coloured dot
for attention's sake, one accent has one meaning, menus are short with
the destructive item last, and a proposal that adds something visible
says what it removes.

Planes, not boxes. Panes are separated by tone and air, never by a
hairline. A border appears only where an edge is information: the
typeset page's edge, a text field, a focused control, a diff hunk, a
rule over a foot note. Menus and sheets float on shadow and a tonal
step. `--line` is a token for the places that earn it.

## Where every value comes from

A literal colour, size, radius or font in a component is a defect. The
tokens are declared in `frontend/src/styles.css` and bridged to Tailwind
through `@theme inline`, so a component reaches them as `bg-surface-2`,
`text-ink-3`, `rounded-control` or `var(--nx-row)`.

Colour, one palette per theme. The dark palette's floor is
`--surround` at L* 11 and `--surface` at 16 since 22 September (section
62 of `docs/design.md`): dark enough that the page is still the lit
object, light enough that body text sits at 12:1 rather than 15:1 and
the frame does not vanish into the bezel in a lit room. A change to any
surface moves the inks with it, so that `--ink-3` keeps 4.5:1 on
`--surface-3`, and `contrast.test.ts` is the gate.

| Token | Meaning |
| --- | --- |
| `--surround` | the frame: the band across the top of the workspace, the activity bar, the foot under each column, the field the typeset page lies on, and the ground of a screen with no document |
| `--surface` | the editor, a project card, a floating card in the dark theme |
| `--surface-2` | the chrome inside the frame: the drawer, the Claude column, the app bar, a field |
| `--surface-3` | the deepest step, a segmented control's track |
| `--ink`, `--ink-2`, `--ink-3` | text and glyphs, in three weights of attention; on `--surround` only the first two, since the third does not clear 4.5:1 on the light theme's frame |
| `--pen`, `--on-pen`, `--pen-wash` | the agent, and only the agent: its turns, its diff chips, the tab it is editing, the one filled button that sends or confirms |
| `--hint`, `--hint-wash` | focus rings, the chosen radio, a completion's match, "safe and interactive" |
| `--warn`, `--error`, `--ok` | states: a missing folder, a failed build, a connected peer |
| `--line` | the one hairline, where an edge is information |
| `--wash` | what a row, a menu item or a bar button takes under the pointer or when chosen |
| `--float`, `--lift`, `--page-shadow` | the three shadows: what floats, what is lifted a step, the page |
| `--paper` | the white of the typeset page, and the editor's white ground |

There is no second accent and no blue.

The window is a frame holding the panes. The four first rows (the
project's name over the bar and the drawer, the source tabs, the preview
tabs, the Claude header) are one 36 px band on `--surround`, class
`nx-band`; the activity bar is on the surround; the 28 px foot under each
column is on the surround, class `nx-foot`, set in `t-meta` in the second
ink with its controls as bare words that take the first ink on hover, as
the source's strip has always drawn Rebuild; and the panes between them
are on their own planes with no line between them. Every column has a
foot, so the frame closes: the drawer's holds Report a problem, the
source's the build, the preview's the page, the Claude column's what the
conversations have cost. A divider is invisible at
rest and shows in `--hint` while the pointer rests on it or drags it. A
surface that overlays another (the drawer below 1100 px, the Claude column
below 1400) is lifted by `--float`, never edged by a border.

A drawer's body may carry a label (`.nx-drawer-label`, 12 px in the
third ink), rows of people (`.nx-person`), blocks of documents
(`.nx-doc`, a name over its facts over a row of chips) and a foot of its
own (`.nx-drawer-foot`, above the drawer's 28 px foot) holding the
body's one or two actions. A chip that acts is the kit's `ChipButton`:
the chip's shape in the code face, `tone` naming the surface under it,
outlined in the third ink while disabled, which means the thing it
would give does not exist yet.

Size, one scale:

| Token | Value | For |
| --- | --- | --- |
| `--nx-radius-control` | 4 px | buttons, fields, chips, segmented controls |
| `--nx-radius-card` | 8 px | menus, hover cards, project cards, the confirm block |
| `--nx-radius-sheet` | 12 px | sheets |
| `--nx-control` | 28 px | a button |
| `--nx-row` | 32 px | a row, a field, a member line |

Spacing is a 4 px grid: 12 px gutters inside a drawer, 16 px inside a
pane, 8 px between a row's parts, 6 px between a foot's buttons.

Type, one family:

| Role | Size | For |
| --- | --- | --- |
| `t-display` | 22 on 28, 600 | a screen's or a sheet's title |
| `t-ui-lg` | 15 on 20, 600 | a drawer's or a column's heading |
| `t-ui` | 14 on 20 | controls, rows, running interface text |
| `t-meta` | 12 on 16 | the second line under a name, a note, a count |
| `t-micro` | 11 on 14, 500 | the smallest label, the stamp on a turn |
| `t-prose` | 15 on 24, 66 ch | Claude's replies and the tutorial |
| `t-code`, `t-code-sm` | the mono at 13.5 or 12 | a literal string the machine produced: a path, a key, an invite, a command |

Source Sans 3 is the one family across the chrome and the prose; no
serif appears anywhere, and Source Serif 4 is not loaded. Hierarchy is
carried by size and weight, never by a change of face. Source Code Pro
is for literal strings only, never for labels. Sentence case
everywhere; no tracked capitals, no eyebrow labels.

Icons are one hand-drawn set in `frontend/src/ui/icons.tsx`, at one
stroke weight (1.5) on a 16 px grid, 20 px on the activity bar. They are
uncoloured and never decorate a menu row.

## The kit is the only source of controls

Every control comes from `frontend/src/ui/`. A raw `<button>`,
`<input>`, hand-rolled menu or `rounded-[3px] border border-line`
container is what the overhaul removed, and the old `quiet`,
`ghost-button` and `pen-button` classes are gone from the stylesheet: the
kit's `Button` carries those looks as its variants.

| Primitive | File | Use it for | Never instead |
| --- | --- | --- | --- |
| `Button` | `Button.tsx` | any labelled action; `quiet` for the ordinary, `ghost` for the secondary with an edge, `pen` for the one filled button, `danger` for the irreversible; `sm` 28 px, `md` 32 px, `inline` 24 px for an action inside a row or a strip | a `<button>` with classes |
| `IconButton` | `Button.tsx` | an action with a glyph and an `aria-label`; `on` marks the active one by ink weight and a wash | a coloured or badged button |
| `Row` | `controls.tsx` | a line in a list or a drawer, with `leading`, `trailing` (shown under the pointer, on focus and on touch) and `selected` | a flex div with hover classes |
| `Field` | `controls.tsx` | a text input at 32 px on `--surface-2`, with `leading` and `trailing` slots | a bordered `<input>` |
| `Chip` | `controls.tsx` | a small labelled thing that can be removed: a file, an added word, a format; `mono` for a literal | a pill with a colour |
| `ChipToggle` | `controls.tsx` | one of several yes-or-no choices that are not exclusive, in one line: which cards the editor shows; on is the chip's shape in the ink, off is hollow in the third ink, `aria-pressed` carries the state | a switch row per item where the items are many and small |
| `Switch` | `controls.tsx` | on or off, and nothing between | a checkbox styled by hand |
| `Segmented` | `controls.tsx` | two to five exclusive choices, `md` in a sheet and `sm` in a strip; `className="nx-segmented-wrap"` when five may not fit the width, as the templates do not on a phone | a row of toggle buttons |
| `Heading` | `controls.tsx` | a real `h1`/`h2`/`h3`; `display` for a sheet's or a screen's title | a styled span |
| `Empty` | `controls.tsx` | what a drawer or a list says when it holds nothing: one sentence and at most one action | an illustration, a heading of its own |
| `Kbd` | `controls.tsx` | a key or a chord, shown always where a key is the way in | text in a box |
| `Menu`, `MenuItem`, `MenuDivider`, `MenuHeader` | `Menu.tsx` | anything that opens under a button: `role="menu"` on the fixed element, shortcut hints at the right, the destructive item last after a divider, a `note` under an item that needs a line | a positioned div of buttons |
| `FloatingCard` | `FloatingCard.tsx` | a hover card, a completion list, the selection bar: 8 px radius, `--float`, the shell's palette | a card with a border |
| `Sheet` | `Sheet.tsx` | anything that covers the screen: `role="dialog"`, a display heading, labels over fields, the foot | a modal built by hand |

A sheet's shape is fixed: `Heading level={2} display` first, one
paragraph of `t-meta` copy if the sheet needs explaining, `nx-sheet-label`
over each field, and `nx-sheet-foot` holding, left to right, the quiet or
destructive action pushed to the left with `mr-auto`, Cancel, and the one
`pen` button naming its verb ("Create project", "Make an invite", "Keep
Claude"). A question before an irreversible act is the `nx-confirm` block
in place, never a modal: one sentence, a `danger` button, Keep or Cancel.

A class means one thing. A component rule's class is never borrowed by
another element for one of its declarations, a colour say, because the
rule's whole box comes with the name, and an unlayered rule beats any
utility the element sets for itself: the four 28 px strips took the
drawers' `.nx-foot` for its surround colour and got its 6 px over 10 px
padding, which put every control on them 2 px high. That rule is
`.nx-panel-foot` now and `.nx-foot` is the strips' colour and nothing
else.

## How things behave

- Hover-revealed actions stay in the DOM, show on `:focus-within`, and
  are always visible under `pointer: coarse` and `hover: none`, so a
  keyboard and a finger reach them.
- The tree's file card arms after 400 ms and the editor's hover cards
  after 250, never on touch; a key press, a scroll or a menu opening
  dismisses the card. The editor's card stays while the pointer is over
  the thing or over the card and goes 300 ms after it has left both, so
  the pointer can travel to the card's buttons; a press on a button is a
  click, and the card goes after it.
- Anything that floats over the editor about a piece of its text, the
  hover card and the selection's verb row, is placed by `placeClear` in
  `frontend/src/panes/place-clear.ts`: above the block's first line when
  there is room, below its last line when there is not, else at the pane
  edge nearest the pointer; its left edge at the text, clamped inside the
  pane; measured in shell pixels end to end, since the interface size
  scales the shell with `zoom` and a viewport number written as CSS
  pixels lands off by the factor. It lives inside the pane it belongs to,
  never over a neighbour. A card below the text puts its button row on
  its top edge, nearest the text.
- A second press on the active bar icon folds the drawer; the drawer
  swap is a cut.
- The pen marks what the agent touched and nothing else. A 2 px pen rule
  along the top of a tab's block means Claude is editing that file now.
- A tab strip is on the band, and the open tab is the pane's block: the
  pane's surface, the card radius on its top corners, the first ink at
  500, no underline. The other tabs are on the band in the second ink,
  parted by a 16 px rule in `--line` that never touches the open tab;
  the strip starts at the pane's edge. Rules in `styles.css` under
  `.nx-tab`.
- The keyboard's ring is `--hint`, 2 px, on every control, and it is the
  control's own box that wears it: a tab's ring sits inside the tab's
  block and follows its corners, painted by the block when its name
  button has visible focus, never by the button. The page-wide ring in
  `--pen` is for what has no rule of its own; a control on the band or
  in the kit never shows it, since the pen means Claude.
- A menu is short. Conditional items are present only when they apply,
  never disabled in place; the destructive item is last, after a rule.
- Motion answers the writer: `.nx-arrive` (120 ms, opacity and a 0.98
  scale) on menus, cards and sheets only; a 90 ms colour transition on
  rows and buttons; nothing moves on its own; an animation that changes
  a control's box (a pulse that scales the button) is a defect, since it
  moves under the pointer reaching for it. Reduced motion is respected.
- A control that a strip cannot hold is dropped at the width it
  measures, through a container query, never wrapped or clipped.
- The project's name in the name row, when it does not fit, fades out
  over the well's last 32 px and glides under the pointer until its end
  is in view, at 40 px a second after a quarter-second pause, back when
  the pointer goes; it never wraps, and never moves under reduced motion,
  where the tooltip carries the whole name. `NameWell` in `chrome.tsx`
  and the `.nx-name-well` rules are the one copy, and the treatment is
  the name row's: a tab's name, a drawer heading and a path in a strip
  keep their ellipsis, as the tab primitive, `Heading` and the History
  header draw it. A heading's count yields before its word.
- Copy: every empty state is one sentence saying what to do next; every
  button names its verb; a control keeps the same name through the flow;
  errors say what went wrong and what to do, without apology; no em dash
  anywhere.

## The contract every change ships with

- A Playwright spec under `e2e/specs/`, not only a vitest, and every
  `data-testid` a spec selects by is kept through the change.
- A new floating surface is registered in `e2e/specs/menus-contrast.spec.ts`'s
  `SURFACES` and, where a click opens it, `e2e/specs/clipping.spec.ts`'s
  `OPENED`, so it is measured for contrast and swept for clipping.
- The surface is rendered from the running app in both themes and
  looked at before its commit (`e2e/shots/fidelity.spec.ts` is the
  harness), and where a direction page exists for the work, the render
  is put beside the page's drawing and the difference is fixed or put to
  the writer, never waved through.
- `scripts/check.sh --all` before the commit; `docs/design.md` and
  `docs/architecture.md` in the same commit.

## Adding a control, end to end

1. Find the primitive above that already does it. If none does, the kit
   gains one, with a vitest in `frontend/src/ui/kit.test.tsx`, before any
   pane uses it.
2. Build the surface from primitives and tokens only. Read the
   `data-testid`s the specs will need off the primitives' `rest` props.
3. Write the spec, register the surface in the sweeps, render it in both
   themes, and look.
4. Say what it is in `docs/design.md`, what it does in
   `docs/architecture.md`, and, if this guide had no rule for it, the rule
   here.
