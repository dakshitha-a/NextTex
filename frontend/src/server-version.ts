/** Whether the server this tab talks to is still the one that served it.
 *
 *  A tab left open across an update keeps running the interface it loaded
 *  against a server on a newer commit. On 27 October 2026 a laptop tab ran
 *  the old interface for nine hours and broke only when it asked for a
 *  chunk the new build no longer had. Nothing told it to reload.
 *
 *  So the first `/api/instance` answer this page gets fixes the commit it
 *  belongs to, and the tab asks again whenever its event stream reconnects
 *  and whenever it comes back into view. A different commit means the
 *  server was updated under it: a tab nobody is looking at reloads itself,
 *  and one in view says so and offers Reload, since reloading under the
 *  writer's caret is not this module's call.
 */
import api from "./api";
import { set } from "./store";

let first = "";

export async function checkServerVersion(): Promise<void> {
  let head = "";
  try {
    head = (await api.instance()).head ?? "";
  } catch {
    return;
  }
  if (!head) return;
  if (!first) {
    first = head;
    return;
  }
  if (head === first) return;
  if (typeof document !== "undefined" && document.hidden) {
    window.location.reload();
    return;
  }
  set({ outdated: true });
}

/** Start asking; the return stops. */
export function watchServerVersion(): () => void {
  void checkServerVersion();
  // Both ways: coming into view is when the writer will look, and going
  // out of it is when a reload costs them nothing.
  const onVisible = () => void checkServerVersion();
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}

/** For tests. */
export function forgetServerVersion(): void {
  first = "";
}
