import api from "./api";
import { get, set } from "./store";

/** The project's list of what a share leaves out, kept in `nexttex.toml`
 *  so every member agrees on it.  Changed from the settings sheet's This
 *  project group and from a row's Stop sharing this.  Applied at once and
 *  put back if the server refuses, as the sheet's switches are. */
export function setNotShared(
  projectId: string,
  patch: { notShared?: string[]; notSharedDefaults?: boolean },
): Promise<boolean> {
  const was = get().settings;
  set({ settings: { ...was, ...patch } });
  return api.setProjectSettings(projectId, patch).then(
    () => true,
    (error: any) => {
      set({
        settings: {
          ...get().settings,
          notShared: was.notShared,
          notSharedDefaults: was.notSharedDefaults,
        },
        error: error?.message || "Could not save that setting.",
      });
      return false;
    },
  );
}

/** The entry a row's Stop sharing this adds: the path from the project's
 *  root, with a slash after a folder, so it means that one and nothing of
 *  the same name elsewhere. */
export function entryFor(path: string, isFolder: boolean): string {
  return isFolder ? `${path}/` : path;
}

/** Whether a row's path is on the list as itself, which is when its menu
 *  offers Share this again; a path left out by a broader entry or by the
 *  defaults is shared again from the settings sheet. */
export function listedAsItself(list: string[], path: string, isFolder: boolean): boolean {
  return list.includes(entryFor(path, isFolder));
}

/** The list with a row's own entry added or taken away. */
export function toggledFor(list: string[], path: string, isFolder: boolean): string[] {
  const entry = entryFor(path, isFolder);
  return list.includes(entry) ? list.filter((item) => item !== entry) : [...list, entry];
}
