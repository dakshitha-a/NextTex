/** Which heading a scrolled pane is inside, for the bar above the source.
 *
 *  A long chapter says where you are without scrolling up to find out:
 *  the bar names the section the top of the viewport is in.  Driven by
 *  the viewport and not by the caret, which is what the Sections panel
 *  already answers and is a different question: the caret can be forty
 *  lines below the top of the screen, in the next section.
 */

import { headingAt, type Heading } from "./outline";

/** The heading to show for a pane whose first visible line is `topLine`
 *  (1-based), or null when the bar should hide: before the first
 *  heading, on the heading's own line, where the source says it already,
 *  or in a file with none.  A `file` entry, an `\include` in a skeleton,
 *  is not a place the reader is inside. */
export function sectionAtTop(headings: Heading[], topLine: number): Heading | null {
  if (!headings.length) return null;
  let index = headingAt(headings, topLine);
  while (index >= 0 && headings[index].path) index -= 1;
  if (index < 0) return null;
  const heading = headings[index];
  // The heading's own line is at the top: the source already says it,
  // and a bar repeating it would cover the line beneath.
  if (heading.line === topLine) return null;
  return heading;
}

/** The trail from the outermost enclosing heading down to the current
 *  one, for a bar that reads "Chapter 2 › Method › Sampling". */
export function trailTo(headings: Heading[], target: Heading): Heading[] {
  const at = headings.indexOf(target);
  if (at < 0) return [target];
  const trail: Heading[] = [target];
  let level = target.level;
  for (let i = at - 1; i >= 0; i--) {
    const heading = headings[i];
    if (heading.path) continue;
    if (heading.level < level) {
      trail.unshift(heading);
      level = heading.level;
    }
  }
  return trail;
}
