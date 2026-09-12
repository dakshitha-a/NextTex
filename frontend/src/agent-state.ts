/** What a browser that has just come back should conclude about the turn.
 *
 *  `reconcile` runs when the event stream connects, when the tab becomes
 *  visible again, and once a minute while a turn is in flight. It asks the
 *  server what is happening and then has to decide what the panel says,
 *  and the arithmetic of that decision is worth having on its own, because
 *  the branch that was missing was missing for a year: the report said a
 *  turn was running, the browser did not think one was, and the code did
 *  nothing at all. Every other case had been written.
 *
 *  What that looked like: reload the page in the middle of a turn. The
 *  panel is rebuilt from the transcript, which has no idea a turn is in
 *  flight, so there is no Stop button, the composer is enabled, and the
 *  next question typed queues behind an answer the writer cannot see
 *  arriving.
 */

export type Report = { pending?: unknown[]; busy?: boolean };

/** `cards` there are open cards to revive; `raise` a turn is running and
 *  this browser did not know; `lower` a turn ended and this browser never
 *  heard how; `leave` the two already agree. */
export type Settle = "cards" | "raise" | "lower" | "leave";

export function afterReconcile(report: Report, thinking: boolean): Settle {
  if ((report.pending ?? []).length) return "cards";
  if (report.busy) return thinking ? "leave" : "raise";
  return thinking ? "lower" : "leave";
}
