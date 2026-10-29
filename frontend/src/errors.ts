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

/** Messages a browser reports that say nothing is wrong, counted per send
 *  rather than kept.  Chromium's ResizeObserver line fills the error event
 *  whenever an observed box changes size inside its own callback, and it
 *  put 3,940 lines in four days of the diagnostics log, burying the errors
 *  a review was looking for. */
export const HARMLESS: readonly RegExp[] = [
  /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/,
];

let noise = new Map<string, number>();

export function record(kind: Kind, message: unknown, stack = ""): void {
  const text = String(message ?? "");
  const harmless = HARMLESS.find((pattern) => pattern.test(text));
  if (harmless) {
    const key = harmless.source.slice(1, 60);
    noise.set(key, (noise.get(key) ?? 0) + 1);
    schedule();
    return;
  }
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
let frames = new Map<string, Frame>();
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

/** A long frame's cause, as the Long Animation Frames API names it, and
 *  how often and how long it held the page since the last send. */
export type Frame = { cause: string; n: number; ms: number; max: number };

/** The part of a `PerformanceScriptTiming` this reads. */
export type FrameScript = {
  duration: number;
  invoker?: string;
  invokerType?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
};

/** Causes kept per send; the rest are counted under "other". */
export const FRAME_CAUSES = 10;

/** What held a long frame: its longest script, named by what invoked it,
 *  the function and the file, or the browser's style and layout when that
 *  took longer than any script. A long task says only that the page was
 *  busy; this is what the review needs to say by what. */
export function frameCause(scripts: readonly FrameScript[], layoutMs: number): string {
  const longest = scripts.reduce<FrameScript | null>(
    (best, script) => (!best || script.duration > best.duration ? script : best), null);
  if (!longest || layoutMs > longest.duration) return "style and layout";
  const file = (longest.sourceURL ?? "").split("?")[0].split("/").pop() || "inline";
  const what = longest.invoker || longest.invokerType || "script";
  return `${what} > ${longest.sourceFunctionName || "(anonymous)"} in ${file}`.slice(0, 300);
}

/** The slowest project event handled lately, by when it began.  A long
 *  frame's script is named only by its invoker and its function, and the
 *  stream's handler is one anonymous function for some sixty kinds of
 *  event, so a 3.5 s freeze on 27 October 2026 read "EventSource.onmessage
 *  > (anonymous)" and nothing more.  The store says which kind it was. */
let slowEvent: { type: string; at: number; ms: number } | null = null;

export function noteHandled(type: string, at: number, ms: number): void {
  if (ms < LONG_TASK_MS / 4) return;
  if (!slowEvent || slowEvent.at < at - 10_000 || ms > slowEvent.ms) {
    slowEvent = { type: String(type).slice(0, 60), at, ms };
  }
}

/** `cause` with the event kind added when the frame was the stream's and a
 *  slow event began inside it. */
export function withEvent(cause: string, start: number, end: number): string {
  if (!cause.startsWith("EventSource.onmessage") || !slowEvent) return cause;
  if (slowEvent.at < start || slowEvent.at > end) return cause;
  return `${cause} handling ${slowEvent.type}`.slice(0, 300);
}

export function noteFrame(ms: number, cause: string): void {
  if (ms < LONG_TASK_MS) return;
  const key = frames.has(cause) || frames.size < FRAME_CAUSES ? cause : "other";
  const frame = frames.get(key) ?? { cause: key, n: 0, ms: 0, max: 0 };
  frame.n += 1;
  frame.ms += Math.round(ms);
  frame.max = Math.max(frame.max, Math.round(ms));
  frames.set(key, frame);
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
  if (!sender || (!unsent.length && !slow.length && !longTasks && !frames.size && !noise.size)) {
    return;
  }
  const body = JSON.stringify({
    errors: unsent,
    slow,
    long_tasks: longTasks,
    long_task_max_ms: longestTask,
    frames: [...frames.values()],
    noise: Object.fromEntries(noise),
    page: typeof location === "undefined" ? "" : location.pathname.slice(0, 200),
    browser: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 300),
  });
  unsent = [];
  slow = [];
  longTasks = 0;
  longestTask = 0;
  frames = new Map();
  noise = new Map();
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
  frames = new Map();
  noise = new Map();
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
  // Chromium's Long Animation Frames say which script held a frame, which
  // a long task cannot; where they exist they name the cause.
  let frameObserver: PerformanceObserver | null = null;
  if (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")
  ) {
    frameObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const frame = entry as PerformanceEntry & {
          scripts?: FrameScript[]; styleAndLayoutStart?: number;
        };
        const end = frame.startTime + frame.duration;
        const layout = frame.styleAndLayoutStart ? end - frame.styleAndLayoutStart : 0;
        noteFrame(frame.duration,
          withEvent(frameCause(frame.scripts ?? [], layout), frame.startTime, end));
      }
    });
    frameObserver.observe({ type: "long-animation-frame", buffered: true });
  }
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("pagehide", onHide);
    observer?.disconnect();
    frameObserver?.disconnect();
    if (timer) clearTimeout(timer);
    timer = null;
    sender = null;
  };
}
