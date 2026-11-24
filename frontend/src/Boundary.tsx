import {
  Component,
  lazy,
  Suspense,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Button } from "./ui/Button";
import {
  freshAfterFailure, probeChunk, reloadAfterProbe, worthReloading,
} from "./boundary-cause";
import { record } from "./errors";
import api from "./api";
import { get, subscribe } from "./store";

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
 *  Only once per version of the server, recorded per tab, so that a fault
 *  which is *not* a stale chunk cannot put the tab in a reload loop -- the
 *  second failure against the same commit is shown and explained instead.
 */

export const RETRIED = "nexttex.reloadedAfterChunkError";

/** Whether this looks like a chunk that is no longer on the server.
 *
 *  Matched on the message rather than the type: browsers disagree about
 *  what they throw for a failed module import, and every one of them says
 *  so in the text. A false positive here costs one reload; a false negative
 *  costs the black window this exists to prevent.
 */

type Props = { children: ReactNode };
type State = { failed: boolean; message: string; serverGone: boolean };

export default class Boundary extends Component<Props, State> {
  state: State = { failed: false, message: "", serverGone: false };

  static getDerivedStateFromError(error: unknown): State {
    // Which of the two it is, decided here where the connection can still
    // be read. The screen below said "NextTex updated while this tab was
    // open" for both, so a writer whose server had simply stopped was told
    // a confident and false explanation and pointed at a Reload that could
    // not work.
    const message = String((error as Error)?.message ?? error);
    record("boundary", message, (error as Error)?.stack ?? "");
    return {
      failed: true,
      message,
      serverGone: get().connection === "offline",
    };
  }

  componentDidCatch(error: unknown): void {
    // Asked of the connection as well as of the message. A stopped server
    // makes every request fail with a bare "Failed to fetch", which used
    // to be in the pattern below, so a NextTex that was simply not running
    // was read as a deployment that had moved and the tab reloaded itself
    // onto the browser's error page, taking the editor with it.
    if (!worthReloading(error, get().connection)) return;
    // And asked of the chunk itself. The socket can say "live" for most of
    // a minute after the network has gone, and a failed import reads the
    // same whether the file is gone or the way to it is. A server that
    // answers, even with a 404, is one a reload reaches.
    const message = String((error as Error)?.message ?? error ?? "");
    void probeChunk(message).then((answer) => {
      if (!reloadAfterProbe(answer)) {
        this.setState({ serverGone: true });
        return;
      }
      this.reloadOnce();
    });
  }

  private reloadOnce(): void {
    // Once per version of the server, not once per tab.  The marker holds
    // the commit the tab reloaded onto, so a second update while the same
    // tab stays open reloads it again, as the first did; a chunk that
    // fails against the commit it already reloaded onto is a real fault,
    // and the screen says so instead of reloading in a loop.  Until 29
    // October 2026 the marker was "yes" for the life of the tab.
    void api.instance().then(
      (instance) => instance.head || "",
      () => "",
    ).then((head) => {
      let already = false;
      try {
        const marker = window.sessionStorage.getItem(RETRIED);
        already = marker !== null && (head === "" || marker === head);
        window.sessionStorage.setItem(RETRIED, head || "unknown");
      } catch {
        // A private window with storage switched off: show the message
        // rather than risking a reload we cannot remember having done.
        already = true;
      }
      if (!already) window.location.reload();
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="interface-failed"
        className="flex h-full w-full items-center justify-center bg-surround p-8"
      >
        <div className="max-w-105">
          <p className="t-ui-lg mb-1 text-ink">
            {this.state.serverGone
              ? "NextTex is not answering."
              : "Part of the interface could not be loaded."}
          </p>
          <p className="t-meta mb-4 text-ink-2">
            {this.state.serverGone ? (
              <>
                This tab cannot reach the server, so part of the interface
                could not be loaded. Your work is on disk as it was at the
                last keystroke that reached it. Start NextTex again and
                reload.
              </>
            ) : (
              <>
                This almost always means NextTex updated while this tab was
                open, so the page is asking for files the server has
                replaced. Nothing you have written is affected: your work is
                on disk, and the server is still running.
              </>
            )}
          </p>
          <Button
            variant="pen"
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
          </Button>
          <p className="t-micro mt-4 break-words text-ink-3">
            {this.state.message}
          </p>
        </div>
      </div>
    );
  }
}

/** A piece of the interface the window can do without, which on failure
 *  draws nothing instead of taking the window with it.
 *
 *  The collaborators chip at the end of the source strip is a chunk of its
 *  own, and when it would not load the root boundary above replaced the
 *  whole window, editor and all, for a chip. That happened ten times on
 *  the laptop from 8 to 17 November 2026, with its network down. A piece
 *  like that fails quietly: the error is recorded, nothing is drawn, and
 *  once the connection has been down and is live again it is tried again.
 *
 *  And on a clock, since the connection need not go down at all: three
 *  times from 20 to 24 November 2026 the laptop woke from standby for a
 *  few seconds, the chip's fetch failed in them with the Wi-Fi not yet up,
 *  and the stream never noticed, so the chip stayed missing until a
 *  reload. A failure is tried again after `QUIET_RETRY` ms, doubling to
 *  `QUIET_RETRY_MOST`, for as long as the piece is on screen.
 */
export const QUIET_RETRY = 5_000;
export const QUIET_RETRY_MOST = 300_000;

type QuietProps = { name: string; onRetry: () => void; children: ReactNode };

export class Quiet extends Component<QuietProps, { failed: boolean }> {
  state = { failed: false };
  private unsubscribe: (() => void) | null = null;
  private timer: number | null = null;
  private failures = 0;
  private down = false;

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    const message = String((error as Error)?.message ?? error);
    // Recorded the first time; the retries that follow fail the same way
    // while the network is away, and a line each would bury the log.
    if (this.failures === 0) {
      record("boundary", `optional ${this.props.name}: ${message}`,
        (error as Error)?.stack ?? "");
    }
    const wait = Math.min(QUIET_RETRY * 2 ** this.failures, QUIET_RETRY_MOST);
    this.failures += 1;
    this.down = get().connection !== "live";
    this.stopWaiting();
    this.timer = window.setTimeout(() => this.retry(), wait);
    this.unsubscribe = subscribe(() => {
      if (get().connection !== "live") {
        this.down = true;
        return;
      }
      if (!this.down) return;
      this.down = false;
      this.retry();
    });
  }

  private retry(): void {
    this.stopWaiting();
    this.props.onRetry();
    this.setState({ failed: false });
  }

  private stopWaiting(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  componentWillUnmount(): void {
    this.stopWaiting();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** `lazy`, for a piece the window can do without: wrapped in `Quiet`, and
 *  loaded afresh on a retry, since `lazy` keeps a failed import's rejection
 *  for good. One lazy component is shared by every place that draws the
 *  piece, so a second mount does not wait for it again. A retry asks the
 *  network again rather than the browser's memory of the failure, through
 *  `freshAfterFailure`. It brings its own `Suspense`, with nothing as its
 *  fallback, so loading it never hides what is around it. */
export function optional<C extends ComponentType<any>>(
  name: string,
  firstLoad: () => Promise<{ default: C }>,
): C {
  const load = freshAfterFailure(
    firstLoad,
    (url) => import(/* @vite-ignore */ url) as Promise<{ default: C }>,
  );
  let Loaded = lazy(load) as unknown as ComponentType<any>;
  function Optional(props: object) {
    const [, rerender] = useState(0);
    const drawn = Loaded;
    return (
      <Quiet
        name={name}
        onRetry={() => {
          if (Loaded === drawn) Loaded = lazy(load) as unknown as ComponentType<any>;
          rerender((n) => n + 1);
        }}
      >
        {/* Its own, so that a retry, which suspends again while the
            chunk is fetched, hides this piece and nothing around it. */}
        <Suspense fallback={null}>
          <Loaded {...props} />
        </Suspense>
      </Quiet>
    );
  }
  Optional.displayName = `Optional(${name})`;
  return Optional as unknown as C;
}
