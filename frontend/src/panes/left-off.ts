/** Where the writer left each file and each typeset document, so that
 *  opening the project again puts both panes back there.
 *
 *  One entry per project, ending in its id, so `forgetProject` takes it
 *  with the rest; the file or document is a field inside it, because a
 *  path after the id would hide the id from that sweep.
 *
 *  The editor's place is a line and a column, never an offset or a pixel:
 *  a file changed outside the app since keeps its lines near where they
 *  were, and the pane may be another width next time. Anything that no
 *  longer fits the file is clamped when it is put back, not here.
 */
import { keep, recall } from "../remember";

export type EditorPlace = { line: number; column: number; top: number };
export type PagePlace = { index: number; fraction: number };

/** Enough for every file a writer moves between, and a bound on a
 *  project that has had thousands of figures opened once. */
const MOST = 200;

const editorKey = (project: string) => `nexttex.editor.place.${project}`;
const pageKey = (project: string) => `nexttex.pdf.place.${project}`;

const whole = (value: unknown, least: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= least;

function editorPlace(value: unknown): EditorPlace | null {
  const place = value as Partial<EditorPlace> | null;
  if (!place || typeof place !== "object") return null;
  if (!whole(place.line, 1) || !whole(place.column, 1) || !whole(place.top, 1)) return null;
  return { line: place.line, column: place.column, top: place.top };
}

function pagePlace(value: unknown): PagePlace | null {
  const place = value as Partial<PagePlace> | null;
  if (!place || typeof place !== "object") return null;
  const { index, fraction } = place;
  if (!whole(index, 0) || typeof fraction !== "number" || !(fraction >= 0 && fraction <= 1)) {
    return null;
  }
  return { index, fraction };
}

/** Write one entry, the newest last, so the oldest go first past `MOST`. */
function put(key: string, name: string, place: object) {
  const all: Record<string, unknown> = { ...recall<Record<string, unknown>>(key, {}) };
  delete all[name];
  all[name] = place;
  const names = Object.keys(all);
  for (const old of names.slice(0, Math.max(0, names.length - MOST))) delete all[old];
  keep(key, all);
}

export function recallEditorPlace(project: string, path: string): EditorPlace | null {
  if (!project || !path) return null;
  return editorPlace(recall<Record<string, unknown>>(editorKey(project), {})[path]);
}

export function keepEditorPlace(project: string, path: string, place: EditorPlace) {
  if (!project || !path || !editorPlace(place)) return;
  put(editorKey(project), path, place);
}

/** `document` is the name the preview tabs use; "" is the one in front. */
export function recallPagePlace(project: string, document: string): PagePlace | null {
  if (!project) return null;
  return pagePlace(recall<Record<string, unknown>>(pageKey(project), {})[document]);
}

export function keepPagePlace(project: string, document: string, place: PagePlace) {
  if (!project) return;
  const fraction = Math.min(Math.max(place.fraction, 0), 1);
  const clean = pagePlace({ index: place.index, fraction });
  if (clean) put(pageKey(project), document, clean);
}
