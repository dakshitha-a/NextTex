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
 *
 *  Each entry is also sent, a couple of seconds after it lands, to the
 *  server's diagnostics log (`POST /api/client-log`, nexttex/diag.py),
 *  with the slow moments a writer feels and no error reports: an API call
 *  that took over two seconds and a long task that held the page for over
 *  two hundred milliseconds. Whatever is still unsent goes as a beacon
 *  when the page is hidden. Sending never goes through `api.ts`, so a
 *  failed send cannot record an error that schedules another send.
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
  const entry = {
    at: clock(),
    kind,
    message: String(message ?? "").slice(0, MESSAGE),
    stack: String(stack ?? "").slice(0, STACK),
  };
  recorded.push(entry);
  if (recorded.length > LIMIT) recorded = recorded.slice(recorded.length - LIMIT);
  if (unsent.length < LIMIT) unsent.push({ ...entry });
  schedule();
}

export type Slow = { path: string; ms: number; status: number };

/** An API call over this long is worth a line in the server's log. */
export const SLOW_CALL_MS = 2000;
/** A long task over this long is counted; the browser reports from 50. */
export const LONG_TASK_MS = 200;
/** How long after the first unsent entry the batch goes. */
export const SEND_AFTER_MS = 2000;
const ENDPOINT = "/api/client-log";

type Sender = (body: string, leaving: boolean) => void;

let unsent: Recorded[] = [];
let slow: Slow[] = [];
let longTasks = 0;
let longestTask = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let sender: Sender | null = null;

/** An API call finished; kept when it was slow. Its own sends are not. */
export function noteCall(path: string, ms: number, status: number): void {
  if (ms < SLOW_CALL_MS || path.startsWith("/client-log")) return;
  if (slow.length < LIMIT) slow.push({ path: path.split("?")[0].slice(0, 300), ms: Math.round(ms), status });
  schedule();
}

export function noteLongTask(ms: number): void {
  if (ms < LONG_TASK_MS) return;
  longTasks += 1;
  longestTask = Math.max(longestTask, Math.round(ms));
  schedule();
}

function schedule(): void {
  if (!sender || timer) return;
  timer = setTimeout(() => send(false), SEND_AFTER_MS);
}

/** Send whatever is unsent, now; `leaving` when the page is going away. */
export function send(leaving: boolean): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!sender || (!unsent.length && !slow.length && !longTasks)) return;
  const body = JSON.stringify({
    errors: unsent,
    slow,
    long_tasks: longTasks,
    long_task_max_ms: longestTask,
    page: typeof location === "undefined" ? "" : location.pathname.slice(0, 200),
    browser: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 300),
  });
  unsent = [];
  slow = [];
  longTasks = 0;
  longestTask = 0;
  try {
    sender(body, leaving);
  } catch {
    /* the log is a convenience; a page that cannot send it still works */
  }
}

function post(body: string, leaving: boolean): void {
  if (leaving && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    return;
  }
  fetch(ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

/** A copy, so nobody holding one sees the next error land in it. */
export function snapshot(): Recorded[] {
  return recorded.map((entry) => ({ ...entry }));
}

export function reset(): void {
  recorded = [];
  unsent = [];
  slow = [];
  longTasks = 0;
  longestTask = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Listen on a window for the two things a browser reports about a page,
 *  send what is recorded to the server, and return the way to stop. */
export function install(target: EventTarget = window, transport: Sender = post): () => void {
  sender = transport;
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
  const onHide = () => send(true);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener("pagehide", onHide);
  let observer: PerformanceObserver | null = null;
  if (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) noteLongTask(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: true });
  }
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("pagehide", onHide);
    observer?.disconnect();
    if (timer) clearTimeout(timer);
    timer = null;
    sender = null;
  };
}
