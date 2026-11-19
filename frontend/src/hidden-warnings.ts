import api from "./api";
import { get, set } from "./store";
import { warningShape } from "./warning-shape";

export { hiddenBy, hiddenOf, warningShape } from "./warning-shape";

/** The project's whole table, replaced, applied at once and put back if
 *  the server refuses, as `setNotShared` does. */
export function setHiddenWarnings(
  projectId: string,
  table: Record<string, string[]>,
): Promise<boolean> {
  const was = get().settings;
  set({ settings: { ...was, hiddenWarnings: table } });
  return api.setProjectSettings(projectId, { hiddenWarnings: table }).then(
    () => true,
    (error: any) => {
      set({
        settings: { ...get().settings, hiddenWarnings: was.hiddenWarnings },
        error: error?.message || "Could not hide that warning.",
      });
      return false;
    },
  );
}

/** Hide warnings like this one in this document. */
export function hideWarning(projectId: string, document: string, message: string): Promise<boolean> {
  const table = get().settings.hiddenWarnings;
  const shape = warningShape(message);
  const listed = table[document] ?? [];
  if (listed.includes(shape)) return Promise.resolve(true);
  return setHiddenWarnings(projectId, { ...table, [document]: [...listed, shape] });
}

/** Stop hiding one shape, or with none every shape, in a document. */
export function showWarnings(projectId: string, document: string, shape?: string): Promise<boolean> {
  const table = { ...get().settings.hiddenWarnings };
  const kept = shape === undefined ? [] : (table[document] ?? []).filter((item) => item !== shape);
  if (kept.length) table[document] = kept;
  else delete table[document];
  return setHiddenWarnings(projectId, table);
}
