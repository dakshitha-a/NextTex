import type { Locator } from "@playwright/test";

/** What one run of text measured: its colour, the colour behind it, and
 *  the WCAG ratio between the two. */
export type Reading = {
  text: string;
  color: string;
  background: string;
  ratio: number;
  /** Where it is, for the failure message: tag and the first classes. */
  where: string;
};

/** Measure every run of text and every field inside an element against
 *  the colour actually painted behind it.
 *
 *  axe's `color-contrast` rule is the usual answer and it is run over the
 *  page by `a11y.spec.ts`; this exists because it was not enough to find
 *  the field it was written for.  The editor's find box drew light ink on
 *  a white box in the dark theme, 1.24:1, and the rule had nothing to say
 *  about it, since the box only exists once Ctrl+F has been pressed and a
 *  page-at-rest sweep never sees it.  So the measurement is a function of
 *  an element rather than of a page, and the spec opens each menu, popup
 *  and floating panel in turn and asks about that.
 *
 *  The background is composited: the walk goes up from the text's element
 *  until it meets an opaque background, blending each translucent one on
 *  the way (the menus' washes and the selection row's ground are all
 *  `color-mix` with transparent).  The text colour is blended over that
 *  the same way.  What this cannot see is a background image or a canvas,
 *  which is why the typeset page's text layer, transparent text over a
 *  picture by design, is left out by name.
 *
 *  Runs in the page, so it is serialised by Playwright: no closures over
 *  anything outside the function. */
export async function measure(root: Locator): Promise<Reading[]> {
  return root.evaluate((element) => {
    const parse = (colour: string): number[] => {
      const parts = colour.match(/[\d.]+/g) ?? [];
      return parts.map(Number);
    };
    const channel = (value: number): number => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminance = ([r, g, b]: number[]): number =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const over = (top: number[], alpha: number, under: number[]): number[] =>
      [0, 1, 2].map((i) => Math.round(top[i] * alpha + under[i] * (1 - alpha)));
    const alphaOf = (parts: number[]): number =>
      parts.length === 4 ? parts[3] : parts.length === 3 ? 1 : 0;

    const behind = (start: Element): number[] => {
      const layers: [number[], number][] = [];
      let at: Element | null = start;
      while (at && at !== document.documentElement) {
        const parts = parse(getComputedStyle(at).backgroundColor);
        const alpha = alphaOf(parts);
        if (alpha > 0) layers.push([parts.slice(0, 3), alpha]);
        if (alpha >= 1) break;
        at = at.parentElement;
      }
      let ground = [255, 255, 255];
      const html = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (alphaOf(html) > 0) ground = over(html.slice(0, 3), alphaOf(html), ground);
      const body = parse(getComputedStyle(document.body).backgroundColor);
      if (alphaOf(body) > 0 && !layers.some(([, a]) => a >= 1)) {
        ground = over(body.slice(0, 3), alphaOf(body), ground);
      }
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        ground = over(layers[i][0], layers[i][1], ground);
      }
      return ground;
    };

    const disabled = (el: Element): boolean =>
      el.closest("[disabled], [aria-disabled='true']") !== null;
    const hidden = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return true;
      if (parseFloat(style.opacity) === 0) return true;
      const box = el.getBoundingClientRect();
      return box.width === 0 || box.height === 0;
    };
    const excluded = (el: Element): boolean =>
      // The typeset page's text layer is transparent text over a picture
      // by design: it is there to be selected and searched, not read.
      el.closest(".nx-text-layer") !== null;

    const reading = (el: Element, text: string): {
      text: string; color: string; background: string; ratio: number; where: string;
    } => {
      const style = getComputedStyle(el);
      const fore = parse(style.color);
      const ground = behind(el);
      const ink = over(fore.slice(0, 3), alphaOf(fore), ground);
      const l1 = luminance(ink);
      const l2 = luminance(ground);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const classes = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(" ");
      return {
        text: text.slice(0, 48),
        color: style.color,
        background: `rgb(${ground.join(", ")})`,
        ratio: Math.round(ratio * 100) / 100,
        where: `${el.tagName.toLowerCase()}${classes ? "." + classes.replace(/\s+/g, ".") : ""}`,
      };
    };

    const out: ReturnType<typeof reading>[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? "").trim();
      const parent = node.parentElement;
      if (!text || !parent) continue;
      if (hidden(parent) || disabled(parent) || excluded(parent)) continue;
      out.push(reading(parent, text));
    }
    for (const field of element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    )) {
      if (hidden(field) || disabled(field) || excluded(field)) continue;
      if (field instanceof HTMLInputElement && ["checkbox", "radio", "file", "range"].includes(field.type)) continue;
      const label = field.getAttribute("aria-label") || field.placeholder || field.name || "field";
      out.push(reading(field, `[${label}: ${field.value || "(empty)"}]`));
    }
    return out;
  });
}

/** Readings under the floor, spelt out for an assertion message. */
export function tooFaint(readings: Reading[], floor = 4.5): string {
  return readings
    .filter((r) => r.ratio < floor)
    .map((r) => `${r.ratio.toFixed(2)}:1  ${r.color} on ${r.background}  ${r.where}  "${r.text}"`)
    .join("\n");
}
