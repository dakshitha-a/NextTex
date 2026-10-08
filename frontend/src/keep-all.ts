import api from "./api";
import { get, set } from "./store";

/** The two sentences under Keep every version, in the History drawer's
 *  foot and on the settings sheet's This project group.  Off says what
 *  thinning does; on says what keeping everything still does not keep,
 *  since a writer turning it on for an audit may expect every keystroke. */
export const KEEP_ALL_OFF =
  "Older versions thin to one an hour after a day, one a day after a week, and one a week after 90 days.";
export const KEEP_ALL_ON =
  "Every saved version is kept. Typing within 90 seconds is still one version, so history grows faster.";

/** Turn the project's Keep every version on or off.  Applied at once and
 *  put back if the server refuses, as the settings sheet's switches are. */
export function setKeepAllVersions(projectId: string, keepAllVersions: boolean): void {
  const was = get().settings;
  set({ settings: { ...was, keepAllVersions } });
  api.setProjectSettings(projectId, { keepAllVersions }).catch(() => {
    set({ settings: { ...get().settings, keepAllVersions: was.keepAllVersions }, error: "Could not save that setting." });
  });
}
