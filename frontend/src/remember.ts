/** What the interface remembers about a project between visits.
 *
 *  Six copies of the same six lines had grown across `App.tsx`: read a key,
 *  parse it, merge it over a default, and swallow whatever went wrong. They
 *  did not all swallow the same things. Some wrapped the write as well,
 *  which matters because a private window throws on `setItem` rather than
 *  ignoring it, and losing a remembered pane width is not a reason to take
 *  the app down.
 *
 *  What a corrupt entry means is decided here, once: it means the default.
 *  Nothing stored in here is worth an error message, because everything in
 *  here is an arrangement the writer can simply make again.
 */

/** The stored value merged over `fallback`, or `fallback` if anything is
 *  wrong with it. */
export function recall<T extends object>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback;
    }
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

/** A stored string, or "" when there is not one. */
export function recallText(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function keep(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  } catch {
    /* a private window, or a full quota: it just will not be remembered */
  }
}

export function forget(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* as above */
  }
}
