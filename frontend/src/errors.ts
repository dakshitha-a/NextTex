/** What the interface saw go wrong, kept for the bug report.
 *
 *  Nothing on the client side recorded anything before this: an uncaught
 *  error outside React's tree, a promise nobody awaited, a chunk that failed
 *  to load, all went to a console the writer never opens and were gone when
 *  the tab was. The footer's Report a problem sends this list with the
 *  report, so the last thing that broke is beside the server's own log of
 *  the same moment.
 *
 *  A ring of twenty. Enough to hold the failure and what led to it, small
 *  enough that a page in an error loop cannot grow it, and bounded again on
 *  the server, which is the one that decides what is quoted. Nothing here
 *  calls `preventDefault`: the console still shows everything it did.
 */

export type Kind = "error" | "rejection" | "boundary" | "api";

export type Recorded = { at: string; kind: Kind; message: string; stack: string };

const LIMIT = 20;
const MESSAGE = 2000;
const STACK = 4000;

let recorded: Recorded[] = [];

function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

export function record(kind: Kind, message: unknown, stack = ""): void {
  recorded.push({
    at: clock(),
    kind,
    message: String(message ?? "").slice(0, MESSAGE),
    stack: String(stack ?? "").slice(0, STACK),
  });
  if (recorded.length > LIMIT) recorded = recorded.slice(recorded.length - LIMIT);
}

/** A copy, so nobody holding one sees the next error land in it. */
export function snapshot(): Recorded[] {
  return recorded.map((entry) => ({ ...entry }));
}

export function reset(): void {
  recorded = [];
}

/** Listen on a window for the two things a browser reports about a page,
 *  and return the way to stop. */
export function install(target: EventTarget = window): () => void {
  const onError = (event: Event) => {
    const { message, error } = event as ErrorEvent;
    record("error", message || String(error), (error as Error | undefined)?.stack ?? "");
  };
  const onRejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    record(
      "rejection",
      (reason as Error | undefined)?.message ?? String(reason),
      (reason as Error | undefined)?.stack ?? "",
    );
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
