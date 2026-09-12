/** Why the interface threw, and whether reloading can help.
 *
 *  A pane is a dynamic import. When a deploy replaces the built assets under
 *  a tab that is still open, the next pane it opens asks for a chunk that is
 *  no longer there, and the only cure is to reload onto the new build. That
 *  is what the boundary's reload is for and it is right.
 *
 *  It was matched with a pattern that included a bare `Failed to fetch`,
 *  which is what a browser says for *any* request it could not make,
 *  including every request to a server that has stopped. So a stopped
 *  NextTex was read as a moved deployment and the tab reloaded itself onto
 *  the browser's own error page, taking the editor and anything in it that
 *  had not reached the server. The Windows laptop watched that happen four
 *  minutes after the app had promised, in a tooltip, that what you type is
 *  kept here until it reconnects.
 *
 *  The two are separable. A moved deployment names the module it could not
 *  import; a dead server does not, and is already known about, because the
 *  document socket has gone offline.
 */

export type Connection = "live" | "connecting" | "offline";

/** The messages a browser gives for a module that is no longer on the
 *  server. Deliberately not a bare "Failed to fetch": every browser names
 *  the module when that is what happened. */
const MOVED_DEPLOYMENT =
  /dynamically imported module|Importing a module script failed|Loading chunk/i;

/** The URL out of "Failed to fetch dynamically imported module: <url>",
 *  which Chrome and Firefox both include. Empty when there is none. */
export function chunkUrlIn(message: string): string {
  const found = message.match(/https?:\/\/\S+/);
  return found ? found[0].replace(/[)\].,]+$/, "") : "";
}

/**
 * Whether reloading is worth trying.
 *
 * `false` for anything the reload cannot fix, which is most things: the
 * reload costs the writer their editor, and getting it wrong once is worse
 * than never trying, because the page it reloads onto is the browser's
 * error screen.
 */
export function worthReloading(error: unknown, connection: Connection): boolean {
  const message = String((error as Error)?.message ?? error ?? "");
  if (!MOVED_DEPLOYMENT.test(message)) return false;
  // The server is already known to be unreachable, so this is not a
  // deployment that moved: it is a deployment that is not answering, and
  // the assets will be back when it is.
  if (connection === "offline") return false;
  return true;
}
