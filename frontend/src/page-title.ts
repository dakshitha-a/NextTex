/** What the browser tab says.
 *
 *  The project's name first, then the app's, because a tab truncates from
 *  the end and a row of tabs that all begin "NextTex" tells you nothing
 *  about which paper is in which.  The name is shown only while a project
 *  is open: the list, the sign-in screen and the offline screen are the app
 *  and nothing else, and the store keeps the last project's name while the
 *  list is showing, so the caller says which screen it is on rather than
 *  this reading the store.  A named install (`--instance`) keeps its name
 *  at the end, where it was. */
export function pageTitle(
  view: "loading" | "offline" | "projects" | "editor",
  projectName: string,
  instance: string,
): string {
  const parts = [];
  if (view === "editor" && projectName.trim()) parts.push(projectName.trim());
  parts.push("NextTex");
  if (instance) parts.push(instance);
  return parts.join(" · ");
}
