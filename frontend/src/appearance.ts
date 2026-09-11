/** Theme, interface size and editor text size: everything about how the app
 *  looks that the person using it gets to choose.
 *
 *  All three are stamped on the document before React renders, so no frame
 *  is ever painted at the wrong size or in the wrong theme.  All three are
 *  global rather than per project, because a person's eyes do not change
 *  between documents.
 */

export type Theme = "light" | "dark";

/** The ground the editor draws its page on.
 *
 *  Separate from the interface theme because the two are answering
 *  different questions.  The shell is chrome and some people want it out of
 *  the way in the dark; the editor is the page being written, and a writer
 *  who thinks in paper wants that white whatever the frame is doing.
 *  `match` is the default and means exactly that: follow the theme.
 *
 *  `light` is the proofing grey the light theme is built on, which is still
 *  the right answer for most people and is what `match` gives them.  The
 *  three after it are brighter pages for the writer who has only ever
 *  composed on white: `white` is exactly #FFFFFF, `warm` is the colour of
 *  book paper, `cool` is white with the yellow taken out.  They are not
 *  separate palettes -- see the note in styles.css -- they are the light
 *  palette with its four surfaces moved up, which is why the syntax
 *  highlighting comes with them rather than having to be redrawn. */
export type EditorTheme = "match" | "light" | "dark" | "white" | "warm" | "cool";

/** The grounds that are a page rather than a following of the theme.  One
 *  list rather than a condition repeated in three files. */
export const EDITOR_GROUNDS: EditorTheme[] = [
  "match", "light", "white", "warm", "cool", "dark",
];

/** Whether control sequences are told apart by colour.
 *
 *  `subtle` is the original look and stays the default: weight and italics
 *  alone, because the rendered page sits two panes away and a rainbow of
 *  token colours beside it makes the source the louder object.  `colour`
 *  gives each family of command -- sectioning, environments, mathematics,
 *  citations, preamble -- its own hue, which is what makes a long file
 *  skimmable for the shape of the document rather than its words. */
export type SyntaxMode = "subtle" | "colour";

/** How many device pixels the preview draws a page with.
 *
 *  The page is rasterised at the device ratio times the interface scale, so
 *  a retina screen or a scaled-up interface already costs several times the
 *  pixels of an ordinary one, and that is where the work is.  `balanced` is
 *  what this pane always did and stays the default.  `faster` caps it, which
 *  matters on a laptop battery and on a tablet; `sharper` oversamples, which
 *  keeps text crisp when a reader zooms in on a figure. */
export type { PreviewQuality } from "./panes/pdf-raster";

export type Appearance = {
  theme: Theme;
  /** Interface size as a percentage.  100 is the size everything was drawn at. */
  scale: number;
  /** Editor text size in CSS pixels. */
  editor: number;
  /** Editor text weight, as a CSS font weight.
   *
   *  What the writer asked for, not what is drawn: a light page adds a step
   *  to it, because dark type on a bright ground looks thinner than light
   *  type on a dark one at the same weight.  That compensation lives in the
   *  palette -- `--nx-editor-weight-lift` in styles.css -- so it follows the
   *  page the editor is actually lit on rather than the theme the app is in,
   *  and it is why this control is named for its steps rather than
   *  numbered: the number would be true on one ground and wrong on four. */
  weight: number;
  /** Whether the editor is lit on its own terms. */
  editorTheme: EditorTheme;
  /** Whether control sequences are coloured by family. */
  syntax: SyntaxMode;
  /** How many device pixels the preview draws a page with. */
  preview: import("./panes/pdf-raster").PreviewQuality;
  /** Whether the prose is spell checked.
   *
   *  Off by default, and deliberately: it downloads a word list, and until
   *  a writer has told it about the vocabulary of their own subject it has
   *  something to say about a great many correctly spelled words. */
  spelling: boolean;
};

/** The steps the two size controls offer.  Discrete stops rather than a
 *  continuous range: there is no useful difference between 112% and 114%,
 *  and a stepper is a control you can hit without aiming. */
export const SCALES = [90, 100, 110, 125, 150];
export const EDITOR_SIZES = [12, 13.5, 15, 17, 19, 21];
/** Three weights, and three is the whole range there is room for.
 *
 *  The monospace face is five static weights rather than a variable one, so
 *  the steps are 100 apart or they are nothing; a light page spends one of
 *  them before the writer sees it; and a control sequence is set 200 above
 *  the prose.  So the top stop here is already 600 prose and a command at
 *  the 700 ceiling on a white page, and a fourth at 600 would put 700 prose
 *  there -- a face with its counters filling in, under a command that can no
 *  longer outweigh it.  These three reach 300 to 600 for the prose and 500
 *  to 700 for a command, which is the whole of the usable range. */
export const EDITOR_WEIGHTS = [300, 400, 500];

/** What each weight is called in the settings sheet.  Relative names, like
 *  the preview quality's, rather than the absolute ones the two size rows
 *  use: "Regular" would be a lie on four of the six editor grounds, where
 *  the palette has already added a step to it.  Lighter and heavier than
 *  the default is all a writer needs to be told, and all that is true. */
export const WEIGHT_NAMES: Record<number, string> = {
  300: "Lighter",
  400: "Normal",
  500: "Bolder",
};

export const DEFAULTS: Appearance = {
  theme: "dark", scale: 100, editor: 13.5, editorTheme: "match",
  weight: 400, syntax: "subtle", preview: "balanced", spelling: false,
};

const KEYS = {
  theme: "nexttex.theme",
  scale: "nexttex.ui.scale",
  editor: "nexttex.editor.size",
  editorTheme: "nexttex.editor.theme",
  weight: "nexttex.editor.weight",
  syntax: "nexttex.editor.syntax",
  preview: "nexttex.preview.quality",
  spelling: "nexttex.editor.spelling",
};

/** localStorage throws rather than returning null in a private window, or
 *  with site data blocked.  A preference is never worth taking the boot
 *  down for. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* nothing to do: the choice applies to this session and no further */
  }
}

/** The nearest stop to a number, so a stored value from an older ladder --
 *  or a hand-edited one -- lands somewhere sensible instead of nowhere. */
export function nearest(value: number, steps: number[]): number {
  return steps.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best,
  );
}

/** The size the gutter numbers its lines at: 0.82 of the text, to the
 *  nearest whole pixel.  The ratio is the one the design has always
 *  specified; the rounding is what stops it landing between pixels. */
export function gutterSize(editor: number): number {
  return Math.round(editor * 0.82);
}

export function step(value: number, steps: number[], by: 1 | -1): number {
  const index = steps.indexOf(nearest(value, steps));
  return steps[Math.min(Math.max(index + by, 0), steps.length - 1)];
}

export function storedAppearance(): Appearance {
  const theme = read(KEYS.theme);
  const scale = Number(read(KEYS.scale));
  const editor = Number(read(KEYS.editor));
  const editorTheme = read(KEYS.editorTheme);
  const weight = Number(read(KEYS.weight));
  const syntax = read(KEYS.syntax);
  const preview = read(KEYS.preview);
  const spelling = read(KEYS.spelling);
  return {
    // Dark by default: this is an instrument you sit in front of for hours,
    // beside a white page that supplies all the brightness the eye needs.
    theme: theme === "light" || theme === "dark" ? theme : DEFAULTS.theme,
    scale: scale ? nearest(scale, SCALES) : DEFAULTS.scale,
    editor: editor ? nearest(editor, EDITOR_SIZES) : DEFAULTS.editor,
    editorTheme: EDITOR_GROUNDS.includes(editorTheme as EditorTheme)
      ? (editorTheme as EditorTheme)
      : DEFAULTS.editorTheme,
    weight: weight ? nearest(weight, EDITOR_WEIGHTS) : DEFAULTS.weight,
    syntax: syntax === "colour" || syntax === "subtle" ? syntax : DEFAULTS.syntax,
    preview:
      preview === "faster" || preview === "sharper" || preview === "balanced"
        ? preview
        : DEFAULTS.preview,
    spelling: spelling === "on",
  };
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;

  const factor = appearance.scale / 100;
  // `zoom` on #root rather than a wrapper inside App: #root is the parent of
  // every view, including the loading, sign-in and project-list screens that
  // return early and never reach the editor shell.  One line covers all of
  // them.
  const shell = document.getElementById("root");
  if (shell) (shell.style as unknown as { zoom: string }).zoom = String(factor);
  // Also published as a variable, because measuring code has to undo it --
  // see `viewport.ts`.
  root.style.setProperty("--nx-ui-scale", String(factor));
  root.style.setProperty("--nx-editor-size", `${appearance.editor}px`);
  // The gutter is a fixed ratio of the text it numbers, and the ratio used
  // to be applied in CSS, which put its line numbers at 11.07px at the
  // default size and at a fraction of a pixel at every other stop on the
  // ladder as well.  A glyph set at a fractional size has its stems laid
  // across pixel boundaries and comes out soft, which on a bright page is
  // exactly the complaint this was found chasing.  Rounded here rather than
  // with CSS `round()` so there is no feature to fall off, and because a
  // whole number is easier to assert than a calc.
  root.style.setProperty("--nx-editor-gutter", `${gutterSize(appearance.editor)}px`);
  // The weight the writer chose.  What the editor sets its text in is this
  // plus the page's own lift, added in CSS rather than here, because the
  // editor can be lit on a different palette from the app around it and
  // only the stylesheet knows which one is in force inside that pane.
  root.style.setProperty("--nx-editor-weight", String(appearance.weight));
  // Published on the root so the editor pane can read it without a prop
  // reaching four components deep, and so it is in place before the first
  // paint rather than one frame after it.
  root.dataset.editorTheme = appearance.editorTheme;
  root.dataset.syntax = appearance.syntax;
  // On the root so the preview can read it without a prop, the same way the
  // editor reads its theme.  Deliberately not in the pre-paint script in
  // index.html: that script exists because a theme applied one frame late is
  // a visible flash, and nothing rasterises a page before React mounts, so a
  // third blocking read on the boot path would buy nothing and can throw.
  root.dataset.previewQuality = appearance.preview;
  root.dataset.spelling = appearance.spelling ? "on" : "off";

  write(KEYS.theme, appearance.theme);
  write(KEYS.scale, String(appearance.scale));
  write(KEYS.editor, String(appearance.editor));
  write(KEYS.editorTheme, appearance.editorTheme);
  write(KEYS.weight, String(appearance.weight));
  write(KEYS.syntax, appearance.syntax);
  write(KEYS.preview, appearance.preview);
  write(KEYS.spelling, appearance.spelling ? "on" : "off");

  // The preview draws to a canvas whose backing store is sized for the
  // scale in force when it was drawn, so it has to be told rather than left
  // to notice.  An event rather than a callback: the change can come from
  // the popover or from ctrl-wheel over the editor, and neither knows the
  // preview exists.
  window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGED));
}

export const APPEARANCE_CHANGED = "nexttex:appearance";

export function isDefault(appearance: Appearance): boolean {
  return (
    appearance.theme === DEFAULTS.theme &&
    appearance.scale === DEFAULTS.scale &&
    appearance.editor === DEFAULTS.editor &&
    appearance.editorTheme === DEFAULTS.editorTheme &&
    appearance.weight === DEFAULTS.weight &&
    appearance.syntax === DEFAULTS.syntax &&
    appearance.preview === DEFAULTS.preview &&
    appearance.spelling === DEFAULTS.spelling
  );
}
