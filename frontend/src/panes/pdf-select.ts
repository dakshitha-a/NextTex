/** Selecting and copying the typeset page's text.
 *
 *  The text layer is transparent spans over the picture, and a drag that
 *  left the spans for the gap under a paragraph found nothing under the
 *  pointer: Chromium put the selection's end wherever the gap's nearest
 *  node was, and an audit dragging down a paragraph saw the selection grow
 *  to 561 characters and drop to 15 the moment the pointer reached the
 *  gap. pdf.js's own viewer guards this with an element at the end of each
 *  layer, `.endOfContent`, which while a drag is under way covers the
 *  layer under the spans and is moved beside the selection's moving end,
 *  so a pointer over empty page extends the selection from there. This is
 *  that guard; the rules are under `.nx-text-layer` in styles.css.
 *
 *  A copy from the page carried what the PDF holds rather than what the
 *  page says: an accent set as a glyph of its own, "Schr¨odinger", and a
 *  word broken at a line end, "misrep-" and "resentations" on two lines.
 *  `cleanCopy` puts them back together.
 */

const ends = new WeakMap<Element, HTMLElement>();

/** Give a freshly built layer its end-of-content element. */
export function addEndOfContent(layer: HTMLElement): void {
  const end = document.createElement("div");
  end.className = "endOfContent";
  layer.append(end);
  ends.set(layer, end);
}

let installed = false;

/** Listen, once for the whole page, for drags and copies in a text layer. */
export function guardSelection(): void {
  if (installed) return;
  installed = true;
  let previous: Range | null = null;

  const reset = () => {
    for (const layer of document.querySelectorAll<HTMLElement>(".nx-text-layer.selecting")) {
      layer.classList.remove("selecting");
      const end = ends.get(layer);
      if (end) {
        layer.append(end);
        end.style.width = "";
        end.style.height = "";
      }
    }
    previous = null;
  };

  document.addEventListener("pointerdown", (event) => {
    const layer = (event.target as Element | null)?.closest?.(".nx-text-layer");
    if (layer) layer.classList.add("selecting");
  });
  document.addEventListener("pointerup", reset);
  window.addEventListener("blur", reset);

  document.addEventListener("selectionchange", () => {
    if (!document.querySelector(".nx-text-layer.selecting")) return;
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      reset();
      return;
    }
    const range = selection.getRangeAt(0);
    // Which end of the selection is moving: the start when the end has
    // not moved since the last change.
    const moveStart = previous !== null && (
      range.compareBoundaryPoints(Range.END_TO_END, previous) === 0
      || range.compareBoundaryPoints(Range.START_TO_END, previous) === 0
    );
    let anchor: Node | null = moveStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    // An end at offset 0 of a node belongs to the node before it.
    if (!moveStart && range.endOffset === 0 && anchor) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor?.previousSibling ?? null;
      } while (anchor && !anchor.childNodes.length);
    }
    const element = anchor as Element | null;
    const layer = element?.parentElement?.closest(".nx-text-layer") as HTMLElement | null;
    const end = layer ? ends.get(layer) : undefined;
    if (element && layer && end && element.parentElement) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      element.parentElement.insertBefore(end, moveStart ? element : element.nextSibling);
    }
    previous = range.cloneRange();
  });

  document.addEventListener("copy", (event) => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || !event.clipboardData) return;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.parentElement?.closest(".nx-text-layer");
    if (!start) return;
    event.clipboardData.setData("text/plain", cleanCopy(String(selection)));
    event.preventDefault();
  });
}

/** Spacing accents a font without accented letters sets before the
 *  letter, and the combining mark each stands for. */
const ACCENTS: Record<string, string> = {
  "¨": "̈", "´": "́", "`": "̀", "ˆ": "̂", "˜": "̃",
  "¸": "̧", "˘": "̆", "ˇ": "̌", "˙": "̇", "˚": "̊",
  "˝": "̋", "˛": "̨", "¯": "̄",
};
const ACCENT = new RegExp(`([${Object.keys(ACCENTS).join("")}])([\\p{L}])`, "gu");

/** Text copied from the page, as the page reads.
 *
 *  An accent glyph before a letter is that letter accented, and the dotless
 *  i it sits on is an i; a word broken across a line with a hyphen is one
 *  word, when the next line goes on in lower case, which is how TeX's
 *  hyphenation looks. Every other line break is kept. */
export function cleanCopy(text: string): string {
  return text
    .replace(ACCENT, (_, accent: string, letter: string) =>
      `${letter === "ı" ? "i" : letter === "ȷ" ? "j" : letter}${ACCENTS[accent]}`)
    .replace(/(\p{L})-\r?\n(\p{Ll})/gu, "$1$2")
    .normalize("NFC");
}
