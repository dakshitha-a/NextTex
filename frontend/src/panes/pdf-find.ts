/** Find on the typeset page.
 *
 *  The preview is where a writer reads their own document, and reading
 *  a two-hundred-page thesis for one sentence means scrolling. The text
 *  layer that makes the page selectable has always carried every word on
 *  it; this is a second reader of that layer, in a pure form the pane can
 *  test without a PDF.
 */

/** One text item as pdf.js hands it over: the string, and whether a line
 *  ends after it. */
export type TextItem = { str: string; hasEOL?: boolean };

/** One page's text as one string.
 *
 *  A newline after an item that ends a line and nothing after the rest,
 *  because pdf.js splits a line into items at every change of font and
 *  every kerned gap, and a space between them would put a space inside
 *  "re" and "sults" where a ligature or a kern split the word. */
export function textOf(items: TextItem[]): string {
  let out = "";
  for (const item of items) {
    out += item.str;
    if (item.hasEOL) out += "\n";
  }
  return out;
}

export type PageHit = {
  /** 1-based, like the footer's readout. */
  page: number;
  /** Where in the page's text the match starts. */
  offset: number;
  /** Which match on its page this is, 0-based, so the text layer's spans
   *  can be walked to the right one. */
  occurrence: number;
};

/** Every place the query appears, page by page, case-insensitive.
 *
 *  Case-insensitive because the project search and the editor's own find
 *  both are by default, and three finds in one app that disagree about
 *  what a query means read as three features. */
export function findIn(texts: string[], query: string): PageHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: PageHit[] = [];
  texts.forEach((text, index) => {
    const hay = text.toLowerCase();
    let at = hay.indexOf(needle);
    let occurrence = 0;
    while (at !== -1) {
      hits.push({ page: index + 1, offset: at, occurrence });
      occurrence += 1;
      at = hay.indexOf(needle, at + needle.length);
    }
  });
  return hits;
}

/** The nth span on a page whose text contains the query.
 *
 *  Approximate on purpose: pdf.js draws one span per text item, and a
 *  match that straddles two items, where a line breaks mid-word or a font
 *  changes, is found in the joined text and has no single span to mark.
 *  The page still scrolls to it and the count is still right. */
export function spanFor(
  spans: Iterable<{ textContent: string | null }>,
  query: string,
  occurrence: number,
): { textContent: string | null } | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  let seen = 0;
  for (const span of spans) {
    const text = (span.textContent ?? "").toLowerCase();
    let at = text.indexOf(needle);
    while (at !== -1) {
      if (seen === occurrence) return span;
      seen += 1;
      at = text.indexOf(needle, at + needle.length);
    }
  }
  return null;
}
