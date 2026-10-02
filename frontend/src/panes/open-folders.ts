import { useCallback, useSyncExternalStore } from "react";

/** The folders open in the file tree, one set for every tree on screen.
 *
 *  The docked Files drawer and a peek at it are two trees, and each kept
 *  its own: a folder opened in one was shut in the other, so the peek
 *  showed a different tree from the one the writer had just been using.
 *  Kept per project and only for this visit, as the tree's own set was:
 *  a project still opens with its folders collapsed. */
let project: string | null = null;
let folders: Set<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOpenFolders(projectId: string | null): [
  Set<string>,
  (next: (current: Set<string>) => Set<string>) => void,
] {
  if (projectId !== project) {
    project = projectId;
    folders = new Set();
  }
  const current = useSyncExternalStore(subscribe, () => folders, () => folders);
  const update = useCallback((next: (current: Set<string>) => Set<string>) => {
    const changed = next(folders);
    if (changed === folders) return;
    folders = changed;
    for (const listener of Array.from(listeners)) listener();
  }, []);
  return [current, update];
}
