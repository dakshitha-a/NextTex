/** Why there is no preview to show. */
export type Absence = "" | "building" | "unbuilt" | "empty" | "unreachable";

/** What the store knows about this document's builds. Only the two fields
 *  that answer the question below; `DocBuild` in the store has more. */
export type BuildState = { compiling: boolean; result: unknown | null };

/**
 * Tell four things apart that arrive as two status codes.
 *
 * The pane once set one state for everything, so a dropped connection told
 * the writer "Nothing has been typeset yet. An empty document produces no
 * pages." That is a false statement about their work, made at the moment
 * they are least able to check it, and it invites them to go looking for a
 * fault in a document that is fine. Splitting the failure off fixed half of
 * it.
 *
 * The other half is that a 404 does not mean one thing either. The route
 * raises it whenever `build/main.pdf` is not on disk, and pdflatex writes no
 * PDF for a document with nothing in it, so **no build has ever finished**,
 * **one is running right now** and **one finished and produced no pages** are
 * the same answer over the wire. Only the last of the three is an empty
 * document, and the pane said it for all three: for the whole of a project's
 * first build, which is several seconds and is the first thing a writer sees,
 * the preview asserted that their document was empty.
 *
 * The build state is what separates them, and the store has carried it all
 * along. `result` is null until a `compile_done` has landed for this
 * document, so it is the "has this ever been built" flag; `compiling` is the
 * "right now" one. When neither is known, the answer is the one that claims
 * least.
 */
export function absenceFrom(
  response: { ok: boolean; status: number } | null,
  build?: BuildState,
): Absence {
  if (response === null) return "unreachable";
  if (response.ok) return "";
  if (response.status !== 404) return "unreachable";
  if (build?.compiling) return "building";
  if (!build || build.result === null) return "unbuilt";
  return "empty";
}
