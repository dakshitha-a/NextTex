import { useLayoutEffect, useRef, useState } from "react";

/** The motion language's durations, read from the tokens in styles.css so
 *  the stylesheet is the one place they are set.  docs/style-guide.md,
 *  "Motion", says which is for what. */
export type Duration = "quick" | "arrive" | "swap" | "move" | "leave";

const FALLBACK: Record<Duration, number> = { quick: 90, arrive: 120, swap: 140, move: 180, leave: 140 };
const read: Partial<Record<Duration, number>> = {};

export function duration(name: Duration): number {
  if (read[name] === undefined) {
    const raw = typeof window === "undefined"
      ? ""
      : window.getComputedStyle(window.document.documentElement).getPropertyValue(`--dur-${name}`);
    read[name] = milliseconds(raw) ?? FALLBACK[name];
  }
  return read[name]!;
}

/** A CSS time as milliseconds.  The unit matters: the build's minifier
 *  writes 140ms as .14s, and a timer read as 0.14 ms fires at once. */
export function milliseconds(raw: string): number | null {
  const match = raw.trim().match(/^(-?\d*\.?\d+)(ms|s)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return match[2] === "s" ? value * 1000 : value;
}

/** Whether the writer's system asks for less motion.  Asked each time, since
 *  the setting can change while the app is open. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Where a pane is in opening or closing.
 *
 *  - `open` and `closed` are at rest.
 *  - `entering` is the one render in which a pane that is about to open is
 *    laid out where it starts, off its edge, so the move has a first frame
 *    to leave from.
 *  - `opening` and `closing` are the moves themselves, `--dur-move` and
 *    `--dur-leave` long.
 *
 *  Under reduced motion a pane goes straight from one rest to the other,
 *  and so does one whose layout is being put back while `still` is set.
 *  Several panes that change in one render, as reading and writing modes
 *  fold three at once, start their moves in the same frame, so they move
 *  as one. */
export type Fold = "open" | "entering" | "opening" | "closing" | "closed";

export function useFold(open: boolean, still?: { current: boolean }): Fold {
  const [phase, setPhase] = useState<Fold>(open ? "open" : "closed");
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // A layout put back rather than changed by the writer, as a project
    // opening with the panes it was left with, is placed, not moved:
    // nothing on screen moves that the writer did not ask to.
    if (reducedMotion() || still?.current) {
      setPhase(open ? "open" : "closed");
      return;
    }
    if (!open) {
      setPhase("closing");
      const timer = window.setTimeout(() => setPhase("closed"), duration("leave"));
      return () => window.clearTimeout(timer);
    }
    setPhase("entering");
    let timer = 0;
    let frame = 0;
    // Two frames: the first paints the pane at its start, the second starts
    // the move from there.  One is not always enough for the browser to
    // have a start to transition from.
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        setPhase("opening");
        timer = window.setTimeout(() => setPhase("open"), duration("move"));
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open]);
  return phase;
}

/** Whether a pane in this phase is on screen at all. */
export const shown = (phase: Fold) => phase !== "closed";

/** Whether a pane in this phase is moving, or about to. */
export const moving = (phase: Fold) => phase === "entering" || phase === "opening" || phase === "closing";

/** Whether a pane in this phase sits off its edge: where a closing pane is
 *  going and where an opening one starts. */
export const away = (phase: Fold) => phase === "entering" || phase === "closing" || phase === "closed";

/** The transition for a pane in this phase: the move's on the way in, the
 *  leave's on the way out, and none while it is placed at its start. */
export function foldTransition(phase: Fold, property: string): string | undefined {
  if (phase === "opening") return `${property} var(--dur-move) var(--ease)`;
  if (phase === "closing") return `${property} var(--dur-leave) var(--ease)`;
  return undefined;
}
