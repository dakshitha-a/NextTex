import type { WordHint } from "./locate-word";

/** The word under a double-click on the page, and the text around it.
 *
 *  Not the browser's selection. The census in bench/inverse-search found
 *  Chromium selects nothing at all on a one-letter span, which is every
 *  letter of maths, `$S_0$` is set as an "S" span and a "0" span, and a
 *  single space for some one-letter words; and it stops a word where
 *  pdf.js split its spans, so "Schr¨odinger" came back as "Schr". The text
 *  layer's own text is read instead: every span in order, a line break for
 *  each `<br>` pdf.js puts after a line's last span.
 *
 *  `pieces` is that text, one entry per span or break; `piece` and
 *  `offset` say where the pointer is.
 */
/** The display symbols `locate-word.ts` compares as letters. */
const SYMBOL = /[∑∏∐∫∬∭∮⋃⋂⨁⨂≥≤≠≈×⋅·∞∂∇±]/;

export function wordAt(pieces: string[], piece: number, offset: number): WordHint {
  let text = "";
  let at = 0;
  pieces.forEach((part, index) => {
    if (index === piece) at = text.length + Math.min(Math.max(offset, 0), part.length);
    text += part;
  });
  // Part of a word: letters, digits, a combining mark, and the spacing
  // accents a font without accented letters sets as glyphs of their own.
  // A point or a comma between two digits is part of a number, "2.5".
  const inWord = (index: number) => /[\p{L}\p{N}\p{M}¨´`ˆ˜¸˘ˇ˙˚˝˛]/u.test(text[index] ?? "")
    || (/[.,]/.test(text[index] ?? "") && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? ""));
  // A word broken at the end of a line: "transfor-", a break, "mation".
  const brokenBack = (index: number) => text[index - 1] === "\n" && text[index - 2] === "-" && inWord(index - 3)
    && /\p{Ll}/u.test(text[index] ?? "");
  const brokenOn = (index: number) => text[index] === "-" && text[index + 1] === "\n" && /\p{Ll}/u.test(text[index + 2] ?? "");

  // A pointer just past the last letter is still on the word.
  if (!inWord(at) && inWord(at - 1) && !SYMBOL.test(text[at] ?? "")) at -= 1;
  let from = at;
  let to = at;
  if (SYMBOL.test(text[at] ?? "")) {
    // A display's sum, product or integral sign, or a relation, is a word
    // of one character: the matcher compares it as one, and a sign set
    // beside its limit is not part of the limit. A font's variation
    // selector after it goes with it.
    to = at + 1;
    while (/[\uFE00-\uFE0F]/.test(text[to] ?? "")) to += 1;
  } else if (inWord(at)) {
    for (;;) {
      if (inWord(from - 1)) from -= 1;
      else if (brokenBack(from)) from -= 3;
      else break;
    }
    for (;;) {
      if (inWord(to)) to += 1;
      else if (brokenOn(to)) to += 2;
      else break;
    }
  }
  // A line and a bit either way: enough to tell one "the" from another,
  // not so much that it reaches into another paragraph's words.
  const REACH = 120;
  return {
    word: text.slice(from, to),
    before: text.slice(Math.max(0, from - REACH), from),
    after: text.slice(to, to + REACH),
  };
}

/** The pieces of a page's text layer, and which one the pointer is in.
 *
 *  The offset is found by measuring the span's characters with a Range,
 *  since the spans are stretched to sit over their glyphs and the
 *  pointer's place in one is not proportional to anything else. */
export function textAtPoint(
  layer: HTMLElement,
  target: Element,
  clientX: number,
  clientY: number,
): WordHint | null {
  const pieces: string[] = [];
  let piece = -1;
  let offset = 0;
  const span = nearestAt(layer, clientX, clientY) ?? target.closest(".nx-text-layer span");
  for (const node of layer.querySelectorAll("span, br")) {
    if (node.tagName === "BR") {
      pieces.push("\n");
      continue;
    }
    // A tagged PDF wraps spans in a span of its own, which holds no text
    // of its own.
    if (node.querySelector("span")) continue;
    if (node === span) {
      piece = pieces.length;
      offset = offsetAt(node as HTMLElement, clientX, clientY);
    }
    pieces.push(node.textContent ?? "");
  }
  if (piece < 0) return null;
  return wordAt(pieces, piece, offset);
}

/** The span under the point whose middle is nearest it, when several are.
 *
 *  pdf.js sizes a span by its glyph's font, and a display's sum, product
 *  or integral is set in a large one, so its span stands over the small
 *  limits above and below it and over the row above's subscripts. The
 *  browser gives the double-click to whichever span is on top, and a click
 *  on the N of `\sum_{i=1}^{N}` went to the sign. A reader aims at the
 *  middle of the glyph they mean, so of the spans under the point the one
 *  whose middle is nearest is the one meant. */
function nearestAt(layer: HTMLElement, x: number, y: number): Element | null {
  let best: Element | null = null;
  let distance = Infinity;
  for (const node of layer.querySelectorAll("span")) {
    if (node.querySelector("span")) continue;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    const away = Math.hypot(x - (box.left + box.right) / 2, y - (box.top + box.bottom) / 2);
    if (away < distance) {
      distance = away;
      best = node;
    }
  }
  return best;
}

/** The character of a span nearest the point. */
function offsetAt(span: HTMLElement, x: number, y: number): number {
  const node = span.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return 0;
  const length = node.textContent?.length ?? 0;
  const range = document.createRange();
  // A document that lays nothing out, as under test, cannot be measured.
  if (typeof range.getBoundingClientRect !== "function") return 0;
  let best = 0;
  let nearest = Infinity;
  for (let index = 0; index < length; index += 1) {
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const box = range.getBoundingClientRect();
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return index;
    const dx = x - (box.left + box.right) / 2;
    const dy = y - (box.top + box.bottom) / 2;
    const distance = dx * dx + dy * dy;
    if (distance < nearest) { nearest = distance; best = index; }
  }
  return best;
}
