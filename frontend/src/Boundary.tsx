import { Component, type ReactNode } from "react";

/** What is on screen when part of the interface cannot be loaded.
 *
 *  The interface is split into chunks that arrive when they are first
 *  needed -- the PDF pane, the tutorial, the share card, the shared-document
 *  machinery. Their file names carry a content hash, so an update replaces
 *  every one of them, and a tab that was already open is holding an
 *  `index.html` that names files the server no longer has.
 *
 *  Nothing caught that. A `lazy` import whose chunk 404s throws, React
 *  unwinds to the nearest error boundary, and there was no error boundary
 *  anywhere in this application -- so it unmounted the whole tree and left
 *  a black window: no message, no way back, and nothing in it to say that a
 *  reload was all it needed. It is the worst possible failure for a thing
 *  that updates itself while you are looking at it.
 *
 *  So: reload once, automatically, because after an update that is the
 *  whole fix and asking the writer to do it by hand is asking them to guess.
 *  Only once, recorded per tab, so that a fault which is *not* a stale
 *  chunk cannot put the tab in a reload loop -- the second failure is shown
 *  and explained instead.
 */

const RETRIED = "nexttex.reloadedAfterChunkError";

/** Whether this looks like a chunk that is no longer on the server.
 *
 *  Matched on the message rather than the type: browsers disagree about
 *  what they throw for a failed module import, and every one of them says
 *  so in the text. A false positive here costs one reload; a false negative
 *  costs the black window this exists to prevent.
 */
function looksLikeAStaleChunk(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error ?? "");
  return (
    /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported module|Failed to fetch/i
      .test(message)
  );
}

type Props = { children: ReactNode };
type State = { failed: boolean; message: string };

export default class Boundary extends Component<Props, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, message: String((error as Error)?.message ?? error) };
  }

  componentDidCatch(error: unknown): void {
    if (!looksLikeAStaleChunk(error)) return;
    let already = false;
    try {
      already = window.sessionStorage.getItem(RETRIED) === "yes";
      window.sessionStorage.setItem(RETRIED, "yes");
    } catch {
      // A private window with storage switched off: show the message
      // rather than risking a reload we cannot remember having done.
      already = true;
    }
    if (!already) window.location.reload();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="interface-failed"
        className="nx-furniture flex h-full w-full items-center justify-center bg-surround p-8"
      >
        <div className="max-w-[420px]">
          <p className="t-ui-lg mb-2 font-serif text-ink">
            Part of the interface could not be loaded.
          </p>
          <p className="t-meta mb-4 text-ink-2">
            This almost always means NextTex updated while this tab was open,
            so the page is asking for files the server has replaced. Nothing
            you have written is affected — your work is on disk, and the
            server is still running.
          </p>
          <button
            className="pen-button t-ui h-[28px] px-3"
            onClick={() => {
              try {
                window.sessionStorage.removeItem(RETRIED);
              } catch {
                /* nothing to clear */
              }
              window.location.reload();
            }}
          >
            Reload
          </button>
          <p className="t-micro mt-4 break-words text-ink-3">
            {this.state.message}
          </p>
        </div>
      </div>
    );
  }
}
