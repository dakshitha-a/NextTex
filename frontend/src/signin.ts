/** Whether the server refused to start a sign-in, and what it said.
 *
 * `POST /api/claude/login/start` answers 200 with `{ok: false, error}` when
 * it will not start one, so nothing throws and a caller that only catches
 * exceptions reads a refusal as a success. On Windows that is the normal
 * answer rather than an edge case: there is no pseudo-terminal to drive
 * `claude auth login` under, the server says so in the body, and the sign-in
 * screen showed "Starting..." for ever while streaming a login that had
 * never begun.
 *
 * Returns the sentence to show, or null when the sign-in really did start.
 */
export function loginRefusal(started: unknown): string | null {
  if (!started || typeof started !== "object") return null;
  const answer = started as { ok?: unknown; error?: unknown };
  if (answer.ok !== false) return null;
  return typeof answer.error === "string" && answer.error
    ? answer.error
    : "The sign-in could not be started.";
}
