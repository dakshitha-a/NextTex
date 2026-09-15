/** The documents this window put on the preview strip by following a
 *  file, remembered across a reload.
 *
 *  Per window on purpose: the strip is shared between windows and this is
 *  a memory of what *this* one did, so it lives in `sessionStorage`, which
 *  is exactly a window's own memory that survives its reload and reaches
 *  no other tab.  It used to be a bare `Set` in a ref, empty after every
 *  reload, so every document on the strip then read as asked for and a
 *  document the strip had followed onto it stayed when its last file
 *  closed.  Persisting it in `.nexttex/previews.json` would have been a
 *  stored format change, and so a major version, for a per-window
 *  question; this costs nothing and reaches exactly as far as it should.
 *
 *  Every read and write of storage is guarded: a private window, cleared
 *  site data or a preview can make the accessor throw, and the set has to
 *  work as a set regardless.
 */

const PREFIX = "nexttex.followed.";

export class Followed {
  private paths = new Set<string>();
  private key: string | null = null;

  /** Forget one project's memory and take up another's. */
  load(projectId: string | null): void {
    this.key = projectId ? PREFIX + projectId : null;
    this.paths = new Set(this.key ? read(this.key) : []);
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  add(path: string): void {
    this.paths.add(path);
    this.save();
  }

  delete(path: string): void {
    if (this.paths.delete(path)) this.save();
  }

  /** Keep only the documents still on the strip. */
  retain(onStrip: readonly string[]): void {
    let changed = false;
    for (const path of [...this.paths]) {
      if (!onStrip.includes(path)) {
        this.paths.delete(path);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** A document has a new name. */
  rename(from: string, to: string): void {
    if (!this.paths.delete(from)) return;
    this.paths.add(to);
    this.save();
  }

  /** The set as it stands, for the pure helpers that read it. */
  get all(): ReadonlySet<string> {
    return this.paths;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.paths[Symbol.iterator]();
  }

  private save(): void {
    if (!this.key) return;
    try {
      window.sessionStorage.setItem(this.key, JSON.stringify([...this.paths]));
    } catch {
      /* nowhere to keep it: the set still works for this page's life */
    }
  }
}

function read(key: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}
