/** Which document the preview should show for the file in front.
 *
 *  There is no main document.  The page follows the file being written: a
 *  root document previews itself, a chapter previews the document that
 *  reads it, and a chain of parts previews whatever is at the top.  What
 *  the browser knows is enough for most of that; what it does not know it
 *  asks the server, which walks the graph and registers the root.
 */

export type FollowDecision =
  /** A document already on the strip: bring it in front. */
  | { kind: "show"; document: string }
  /** A script: its tab, with its last run, is what the pane shows. */
  | { kind: "script"; path: string }
  /** A Markdown file: its rendering, as it is typed, is what the pane shows. */
  | { kind: "markdown"; path: string }
  /** Not known here: ask the server which document this file belongs to. */
  | { kind: "ask" }
  /** Not a `.tex` file, or nothing to do. */
  | { kind: "none" };

const TEX = /\.(tex|ltx)$/i;
const SCRIPT = /\.py$/i;
const MARKDOWN = /\.(md|markdown)$/i;

export function followDecision(
  path: string | null | undefined,
  previews: readonly string[],
  activePreview: string,
  owners: Readonly<Record<string, readonly string[]>>,
): FollowDecision {
  if (path && SCRIPT.test(path)) return { kind: "script", path };
  if (path && MARKDOWN.test(path)) return { kind: "markdown", path };
  if (!path || !TEX.test(path)) return { kind: "none" };
  if (previews.includes(path)) {
    return path === activePreview ? { kind: "none" } : { kind: "show", document: path };
  }
  const readers = owners[path] ?? [];
  if (readers.length) {
    // A part two documents both read stays with the one on screen, so the
    // page never changes under the writer for a file both of them show.
    if (readers.includes(activePreview)) return { kind: "none" };
    const onStrip = previews.find((document) => readers.includes(document));
    if (onStrip) return { kind: "show", document: onStrip };
  }
  return { kind: "ask" };
}
