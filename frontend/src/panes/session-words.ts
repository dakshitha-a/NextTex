import type { AgentLimit, AgentSession } from "../api";

/** The words the column's foot and the Session view say about a session.
 *  A module of its own so the foot, which is always on screen, does not
 *  pull the Session view's chunk in with it. */

/** The points a conversation may be summarized at, in per cent. */
export const COMPACT_STEPS = [30, 40, 50, 60, 70, 80, 90] as const;

/** A token count a person reads: 140k rather than 140000. */
export function tokens(value: number | null | undefined): string {
  if (value == null) return "";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  const millions = value / 1_000_000;
  return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
}

/** What a limit's window is called. */
export function limitName(type: string): string {
  const names: Record<string, string> = {
    five_hour: "5-hour limit",
    seven_day: "Weekly limit",
    seven_day_opus: "Weekly Opus limit",
    seven_day_sonnet: "Weekly Sonnet limit",
  };
  return names[type] ?? `${type.replace(/_/g, " ")} limit`;
}

/** When a window resets, in the writer's own clock: the time today, the
 *  weekday this week, the date after that. */
export function resetWords(resetsAt: number | null, now = Date.now()): string {
  if (!resetsAt) return "";
  const when = new Date(resetsAt * 1000);
  const hours = (when.getTime() - now) / 3_600_000;
  if (hours < 20) return `resets at ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (hours < 24 * 6) return `resets ${when.toLocaleDateString([], { weekday: "long" })}`;
  return `resets ${when.toLocaleDateString([], { day: "numeric", month: "long" })}`;
}

/** The busiest of the plan's limits: the one the foot names. */
export function busiest(limits: AgentLimit[] | undefined): AgentLimit | null {
  const known = (limits ?? []).filter((entry) => entry.utilization !== null);
  if (!known.length) return null;
  return known.reduce((a, b) => ((b.utilization ?? 0) > (a.utilization ?? 0) ? b : a));
}

/** Whether the account is a subscription, where a dollar figure is what
 *  the work would have cost elsewhere rather than a bill. */
export function onSubscription(session: AgentSession | null): boolean {
  return Boolean(session?.account?.plan);
}

/** Model time as a person reads it: 2h 28m, 2m 10s, 40s. */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
