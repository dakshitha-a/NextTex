/* Pure helpers for hidden warnings, apart from the store so the store
   can use them without importing a module that imports it. */

/** A warning with its numbers as `#`, so hiding one hides its kind; the
 *  same rule as `warning_shape` in `nexttex/project.py`, which keeps the
 *  table and filters the builds. */
export function warningShape(message: string): string {
  return message.split(/\s+/).filter(Boolean).join(" ").replace(/\d+(?:\.\d+)?/g, "#");
}

/** Whether a warning is one of the shapes a document hides; a shape is
 *  found anywhere in it, as on the server. */
export function hiddenBy(message: string, shapes: readonly string[]): boolean {
  const shaped = warningShape(message);
  return shapes.some((shape) => shape !== "" && shaped.includes(shape));
}

/** The table as the server sent it, with anything malformed dropped. */
export function hiddenOf(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [document, shapes] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(shapes)) continue;
    const kept = shapes.filter((shape): shape is string => typeof shape === "string" && shape !== "");
    if (kept.length) out[document] = kept;
  }
  return out;
}
