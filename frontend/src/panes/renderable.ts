/** Which files the browser will simply draw.
 *
 *  Its own module, and not part of `FileView`, because that is the whole
 *  reason `FileView` could not be split out of the entry chunk: the history
 *  panel imports this one function, and a static import of anything in a
 *  module keeps the module. Vite says so plainly in the build log, and the
 *  lazy import that was supposed to move it was doing nothing at all.
 */
const RENDERABLE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

export function isRenderable(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot > 0 && RENDERABLE.has(path.slice(dot).toLowerCase());
}
