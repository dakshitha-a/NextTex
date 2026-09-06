import type { TreeNode } from "./api";

/** Reading the file tree the store already holds.
 *
 *  The upload chooser needs three things the server could answer and
 *  should not have to: which folders exist, what is already in one of
 *  them, and what a file would be called if the writer keeps both copies.
 *  All three are in the tree the rail is drawing, so asking costs nothing
 *  and the popover can open in the same frame the file picker closes in.
 */

export type Folder = { path: string; name: string; depth: number };

/** Every folder in the project, depth-first, with the root first.
 *
 *  The root is synthesised: it has no node of its own, which is also why
 *  nothing could be created at the project root until now. */
export function foldersIn(tree: TreeNode | null): Folder[] {
  const found: Folder[] = [{ path: "", name: "Project root", depth: 0 }];
  const walk = (node: TreeNode, depth: number) => {
    if (node.type !== "dir") return;
    found.push({ path: node.path, name: node.name, depth });
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  for (const child of tree?.children ?? []) walk(child, 1);
  return found;
}

/** The names directly inside one folder -- files and folders alike, since
 *  a file cannot be written where a folder of that name sits. */
export function namesIn(tree: TreeNode | null, directory: string): Set<string> {
  const find = (node: TreeNode, path: string): TreeNode | null => {
    if (node.path === path) return node;
    for (const child of node.children ?? []) {
      if (child.type !== "dir") continue;
      if (path === child.path || path.startsWith(`${child.path}/`)) {
        const hit = find(child, path);
        if (hit) return hit;
      }
    }
    return null;
  };
  const folder = directory === "" ? tree : tree ? find(tree, directory) : null;
  return new Set((folder?.children ?? []).map((child) => child.name));
}

/** What "keep both" will call the new file.
 *
 *  This has to agree with `unique_name` on the server exactly: the chooser
 *  quotes the name back to the writer before anything is written, and a
 *  sentence that turns out to be wrong is worse than no sentence. */
export function keptBothName(existing: Set<string>, name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  let candidate = `${stem} (${index})${suffix}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${stem} (${index})${suffix}`;
  }
  return candidate;
}

/** Files that already exist under the names being uploaded. */
export function collisions(
  tree: TreeNode | null,
  directory: string,
  names: string[],
): string[] {
  const taken = namesIn(tree, directory);
  return names.filter((name) => taken.has(name));
}

/** Every folder between the root and this path, so a file that lands in a
 *  collapsed folder can be shown rather than merely written. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}
