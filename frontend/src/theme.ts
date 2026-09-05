/** Two themes, chosen by the user rather than by their operating system.
 *
 *  The choice is stamped on the root element before React renders, so the
 *  app never shows one theme's chrome for a frame before switching to the
 *  other. */

export type Theme = "light" | "dark";

const KEY = "nexttex.theme";

export function storedTheme(): Theme {
  const saved = window.localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  // Dark by default: this is an instrument you sit in front of for hours,
  // beside a white page that supplies all the brightness the eye needs.
  return "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(KEY, theme);
}
