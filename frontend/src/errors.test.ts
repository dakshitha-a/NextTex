import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRAME_CAUSES,
  frameCause,
  noteHandled,
  withEvent,
  install,
  LONG_TASK_MS,
  noteCall,
  noteFrame,
  noteLongTask,
  record,
  type Recorded,
  reset,
  send,
  SEND_AFTER_MS,
  SLOW_CALL_MS,
  snapshot,
} from "./errors";

describe("the interface's record of its own errors", () => {
  beforeEach(reset);

  it("keeps at most twenty, dropping the oldest", () => {
    for (let index = 0; index < 25; index++) record("error", `e${index}`);
    const kept = snapshot();
    expect(kept).toHaveLength(20);
    expect(kept[0].message).toBe("e5");
    expect(kept[19].message).toBe("e24");
  });

  it("bounds each entry", () => {
    record("api", "m".repeat(5000), "s".repeat(9000));
    const [entry] = snapshot();
    expect(entry.message).toHaveLength(2000);
    expect(entry.stack).toHaveLength(4000);
    expect(entry.at).toMatch(/^\d\d:\d\d:\d\d$/);
  });

  it("hands out a copy", () => {
    record("boundary", "one");
    const first = snapshot();
    record("boundary", "two");
    expect(first).toHaveLength(1);
    first[0].message = "changed";
    expect(snapshot()[0].message).toBe("one");
  });

  it("listens for both things a window reports, and can stop", () => {
    const target = new EventTarget();
    const stop = install(target, () => undefined);
    const failure = new Error("planted");
    target.dispatchEvent(
      Object.assign(new Event("error"), { message: "planted", error: failure }),
    );
    target.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("unawaited") }),
    );
    expect(snapshot().map((e) => [e.kind, e.message])).toEqual([
      ["error", "planted"],
      ["rejection", "unawaited"],
    ]);
    expect(snapshot()[0].stack).toContain("planted");
    stop();
    target.dispatchEvent(Object.assign(new Event("error"), { message: "after" }));
    expect(snapshot()).toHaveLength(2);
  });

  it("says something about a rejection that is not an Error", () => {
    const target = new EventTarget();
    install(target, () => undefined);
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: 42 }));
    expect(snapshot()[0].message).toBe("42");
  });
});

describe("sending what was recorded to the server's log", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("batches entries and sends them once, a couple of seconds later", () => {
    const sent: [string, boolean][] = [];
    const stop = install(new EventTarget(), (body, leaving) => sent.push([body, leaving]));
    record("error", "first");
    record("api", "500 /projects/x/file: boom");
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(SEND_AFTER_MS);
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0][0]);
    expect(body.errors.map((e: Recorded) => e.message)).toEqual(["first", "500 /projects/x/file: boom"]);
    expect(sent[0][1]).toBe(false);
    vi.advanceTimersByTime(SEND_AFTER_MS * 3);
    expect(sent).toHaveLength(1);
    stop();
  });

  it("keeps slow calls and long tasks, and nothing quick", () => {
    const sent: string[] = [];
    const stop = install(new EventTarget(), (body) => sent.push(body));
    noteCall("/projects/x/file?path=secret.tex", 100, 200);
    noteLongTask(80);
    expect(vi.getTimerCount()).toBe(0);
    noteCall("/projects/x/file?path=secret.tex", SLOW_CALL_MS + 5, 200);
    noteCall("/client-log", SLOW_CALL_MS * 2, 204);
    noteLongTask(LONG_TASK_MS + 50);
    noteLongTask(LONG_TASK_MS + 10);
    vi.advanceTimersByTime(SEND_AFTER_MS);
    const body = JSON.parse(sent[0]);
    expect(body.slow).toEqual([{ path: "/projects/x/file", ms: SLOW_CALL_MS + 5, status: 200 }]);
    expect(body.long_tasks).toBe(2);
    expect(body.long_task_max_ms).toBe(LONG_TASK_MS + 50);
    expect(body.errors).toEqual([]);
    stop();
  });

  it("sends what is left as a beacon when the page is hidden", () => {
    const sent: [string, boolean][] = [];
    const target = new EventTarget();
    const stop = install(target, (body, leaving) => sent.push([body, leaving]));
    record("rejection", "late");
    target.dispatchEvent(new Event("pagehide"));
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toBe(true);
    vi.advanceTimersByTime(SEND_AFTER_MS);
    expect(sent).toHaveLength(1);
    stop();
  });

  it("sends nothing once stopped", () => {
    const sent: string[] = [];
    const stop = install(new EventTarget(), (body) => sent.push(body));
    stop();
    record("error", "after");
    vi.advanceTimersByTime(SEND_AFTER_MS);
    send(true);
    expect(sent).toHaveLength(0);
  });

  it("counts harmless browser noise instead of keeping it", () => {
    const sent: string[] = [];
    const stop = install(new EventTarget(), (body) => sent.push(body));
    for (let index = 0; index < 30; index++) {
      record("error", "ResizeObserver loop completed with undelivered notifications.");
    }
    record("error", "a real one");
    vi.advanceTimersByTime(SEND_AFTER_MS);
    const body = JSON.parse(sent[0]);
    expect(body.errors.map((e: any) => e.message)).toEqual(["a real one"]);
    expect(Object.values(body.noise)).toEqual([30]);
    expect(snapshot().map((e) => e.message)).toEqual(["a real one"]);
    stop();
  });

  it("names the event a slow stream handler was handling", () => {
    noteHandled("files_changed", 1000, 3400);
    // A quick event after it does not take its place.
    noteHandled("compile_start", 1200, 2);
    const cause = "EventSource.onmessage > (anonymous) in index-aa.js";
    expect(withEvent(cause, 900, 4500)).toBe(`${cause} handling files_changed`);
    // A frame that did not contain it, or was not the stream's, is unchanged.
    expect(withEvent(cause, 5000, 6000)).toBe(cause);
    expect(withEvent("TimerHandler:setTimeout > draw in Pdf-bb.js", 900, 4500))
      .toBe("TimerHandler:setTimeout > draw in Pdf-bb.js");
  });

  it("names what held a long frame, and sums each cause", () => {
    const sent: string[] = [];
    const stop = install(new EventTarget(), (body) => sent.push(body));
    const pdf = frameCause([
      { duration: 40, invoker: "Response.json.then", sourceURL: "https://h/assets/index-aa.js", sourceFunctionName: "load" },
      { duration: 900, invoker: "TimerHandler:setTimeout", sourceURL: "https://h/assets/Pdf-bb.js?x=1", sourceFunctionName: "draw" },
    ], 30);
    expect(pdf).toBe("TimerHandler:setTimeout > draw in Pdf-bb.js");
    // Layout longer than any script is the browser's own work.
    expect(frameCause([{ duration: 50 }], 400)).toBe("style and layout");
    expect(frameCause([], 0)).toBe("style and layout");
    noteFrame(LONG_TASK_MS - 1, pdf);
    noteFrame(950, pdf);
    noteFrame(400, pdf);
    for (let index = 0; index < FRAME_CAUSES + 3; index++) noteFrame(LONG_TASK_MS, `cause ${index}`);
    vi.advanceTimersByTime(SEND_AFTER_MS);
    const frames = JSON.parse(sent[0]).frames;
    expect(frames[0]).toEqual({ cause: pdf, n: 2, ms: 1350, max: 950 });
    // Bounded however varied the page is: past the limit, one "other".
    expect(frames).toHaveLength(FRAME_CAUSES + 1);
    expect(frames.at(-1)).toMatchObject({ cause: "other", n: 4 });
    stop();
  });
});
