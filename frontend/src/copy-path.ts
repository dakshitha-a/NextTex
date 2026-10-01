/** A project file's absolute path, and putting text on the clipboard.
 *
 *  The path is the one on the machine running NextTex, which is where a
 *  terminal or an editor beside it would look: the project's folder, as
 *  the server reports it, joined with the tree's path. The tree speaks in
 *  forward slashes; a folder written with backslashes is a Windows one,
 *  and its paths are given back in its own separator.
 */
export function absolutePath(root: string, path: string): string {
  if (!root) return path;
  const windows = root.includes("\\") && !root.includes("/");
  const sep = windows ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  const rest = path.replace(/^[\\/]+/, "");
  if (!rest) return base || sep;
  return `${base}${sep}${windows ? rest.replace(/\//g, "\\") : rest}`;
}

/** Put `text` on the clipboard, true when it got there.
 *
 *  The Clipboard API exists only in a secure context, and an install
 *  reached over plain http on a tailnet address is not one, so the old
 *  way stays as the fallback: a hidden text box, selected and copied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused: try the old way below.
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.append(box);
  box.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
  }
}
