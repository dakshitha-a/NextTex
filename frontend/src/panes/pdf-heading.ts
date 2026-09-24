import type { WordHint } from "./locate-word";

/** What the double-click can tell the editor beyond the word.
 *
 *  Whether the span is a heading is read off the page rather than asked
 *  of synctex, which does not know: a heading's span is set larger than
 *  the page's running text, or begins with its number.  The running size
 *  is the most common span size on the page, which on a page of prose is
 *  the body face.  A `\paragraph{}` heading set at body size and unnumbered
 *  is missed by both readings and gets the ordinary search, which is no
 *  worse than before.
 */
export function headingHint(
  page: HTMLElement,
  span: HTMLElement | null,
  word: string,
  bold = false,
): WordHint {
  if (!span) return { word };
  const context = span.textContent ?? "";
  // pdf.js writes the size as `calc(var(--scale-factor) * 9.96px)`, so the
  // number is fished out rather than parsed off the front.
  const size = (el: HTMLElement) =>
    Number(/([\d.]+)px/.exec(el.style.fontSize)?.[1] ?? 0);
  const counts = new Map<number, number>();
  for (const other of page.querySelectorAll<HTMLElement>(".nx-text-layer span")) {
    const px = Math.round(size(other) * 10) / 10;
    if (px > 0) counts.set(px, (counts.get(px) ?? 0) + 1);
  }
  let body = 0;
  let most = 0;
  for (const [px, count] of counts) {
    if (count > most) { body = px; most = count; }
  }
  const larger = body > 0 && size(span) >= body * 1.15;
  const numbered = /^\s*(?:\d+|[A-Z])(?:\.\d+)*\.?\s+\S/.test(context);
  // Bold, at the start of its line and short: a `\paragraph{}` heading in a
  // class that sets it at body size and unnumbered, which the two readings
  // above miss. A bold word inside a sentence does not begin the line, and
  // a bold paragraph is not short.
  const runIn = bold && span.dataset.bol === "1" && context.trim().length <= 80;
  return { word, context, heading: larger || numbered || runIn };
}

/** A font name that says bold: `CMBX10`, `LMRoman10-Bold`, Times's
 *  `NimbusRomNo9L-Medi`, a `Semibold` or a `Black`, after any subset
 *  prefix. */
export function isBoldFont(name: string | undefined): boolean {
  if (!name) return false;
  const bare = name.replace(/^[A-Z]{6}\+/, "");
  return /bold|black|heavy|semibold|demi|medi(?!um)|^cmbx|^lmbx|bx\d/i.test(bare);
}

/** Each span of a text layer, told which font set it and whether it begins
 *  its line. pdf.js makes one span per text item, in order, and keeps
 *  neither fact on the span; the double-click reads both to tell an
 *  unnumbered heading set at body size, a `\paragraph{}`, from bold words
 *  inside a sentence. */
export function tagSpans(
  spans: HTMLElement[],
  items: ReadonlyArray<object>,
): void {
  type Item = { fontName?: string; hasEOL?: boolean; str?: string };
  // Marked-content entries carry no `str` and make no span.
  const text = (items as Item[]).filter((item) => item.str !== undefined);
  for (let index = 0; index < spans.length && index < text.length; index += 1) {
    const span = spans[index];
    span.dataset.font = text[index].fontName ?? "";
    if (index === 0 || text[index - 1].hasEOL) span.dataset.bol = "1";
  }
}

