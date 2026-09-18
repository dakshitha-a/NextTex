/** A window with nothing but the typeset page, for a second monitor.
 *
 *  The app has no router: the only thing it ever read from the URL was
 *  the token.  This is the second thing.  `?page=<project id>` with an
 *  optional `&document=<name>` opens the project straight into a view
 *  that holds the PDF pane alone, on the same event stream as the main
 *  window, so a build there redraws the page here.  The project id
 *  rather than a name, because the id is what every route takes and a
 *  name can be renamed under the window.
 */

const ID = /^[A-Za-z0-9._-]{1,64}$/;

export type PageWindowRequest = { projectId: string; document: string };

/** What the URL asks for, or null for an ordinary visit. */
export function pageWindowRequest(search: string): PageWindowRequest | null {
  const params = new URLSearchParams(search);
  const projectId = params.get("page") ?? "";
  if (!ID.test(projectId)) return null;
  const document = params.get("document") ?? "";
  // A document is a project-relative path; anything trying to leave is
  // not one, and the server would refuse it anyway.
  if (document.includes("..") || document.startsWith("/")) return { projectId, document: "" };
  return { projectId, document };
}

/** The URL to open for a project's page, relative to the app's origin. */
export function pageWindowUrl(projectId: string, document: string): string {
  const params = new URLSearchParams({ page: projectId });
  if (document) params.set("document", document);
  return `/?${params.toString()}`;
}
