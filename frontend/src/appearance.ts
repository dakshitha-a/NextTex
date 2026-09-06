/** Theme, interface size and editor text size: everything about how the app
 *  looks that the person using it gets to choose.
 *
 *  All three are stamped on the document before React renders, so no frame
 *  is ever painted at the wrong size or in the wrong theme.  All three are
 *  global rather than per project, because a person's eyes do not change
 *  between documents.
 */

export type Theme = "light" | "dark";

export type Appearance = {
  theme: Theme;
  /** Interface size as a percentage.  100 is the size everything was drawn at. */
  scale: number;
  /** Editor text size in CSS pixels. */
  editor: number;
};

/** The steps the two size controls offer.  Discrete stops rather than a
 *  continuous range: there is no useful difference between 112% and 114%,
 *  and a stepper is a control you can hit without aiming. */
export const SCALES = [90, 100, 110, 125, 150];
export const EDITOR_SIZES = [12, 13.5, 15, 17, 19, 21];

export const DEFAULTS: Appearance = { theme: "dark", scale: 100, editor: 13.5 };

const KEYS = {
  theme: "nexttex.theme",
  scale: "nexttex.ui.scale",
  editor: "nexttex.editor.size",
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

export function step(value: number, steps: number[], by: 1 | -1): number {
  const index = steps.indexOf(nearest(value, steps));
  return steps[Math.min(Math.max(index + by, 0), steps.length - 1)];
}

export function storedAppearance(): Appearance {
  const theme = read(KEYS.theme);
  const scale = Number(read(KEYS.scale));
  const editor = Number(read(KEYS.editor));
  return {
    // Dark by default: this is an instrument you sit in front of for hours,
    // beside a white page that supplies all the brightness the eye needs.
    theme: theme === "light" || theme === "dark" ? theme : DEFAULTS.theme,
    scale: scale ? nearest(scale, SCALES) : DEFAULTS.scale,
    editor: editor ? nearest(editor, EDITOR_SIZES) : DEFAULTS.editor,
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

  write(KEYS.theme, appearance.theme);
  write(KEYS.scale, String(appearance.scale));
  write(KEYS.editor, String(appearance.editor));

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
    appearance.editor === DEFAULTS.editor
  );
}
