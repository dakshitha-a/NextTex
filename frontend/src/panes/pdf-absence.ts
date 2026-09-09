/** Why there is no preview to show. */
export type Absence = "" | "empty" | "unreachable";

/**
 * Tell "there are no pages" apart from "we could not get them".
 *
 * The pane set one state for both, so a dropped connection told the writer
 * "Nothing has been typeset yet. An empty document produces no pages." That
 * is a false statement about their work, made at the moment they are least
 * able to check it, and it invites them to go looking for a fault in a
 * document that is fine.
 *
 * A 404 from this route means exactly one thing, and its own message says
 * so: nothing has been built yet. Every other answer is a failure, and so is
 * no answer at all, which arrives here as `null`.
 */
export function absenceFrom(
  response: { ok: boolean; status: number } | null,
): Absence {
  if (response === null) return "unreachable";
  if (response.ok) return "";
  return response.status === 404 ? "empty" : "unreachable";
}
