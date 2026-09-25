/** Why there is no preview to show. */
export type Absence =
  | "" | "building" | "unbuilt" | "empty" | "unreachable"
  /** The last build stopped before it wrote a page, and no earlier build
   *  left one to keep.  Not "empty": the document has something in it,
   *  and the Build drawer says what went wrong. */
  | "stopped"
  /** The strip has no document on it.  A folder that never had one, or
   *  one whose only document has just gone to the trash: the route's 404
   *  is the same for both, and the second is not a project that needs a
   *  template. */
  | "nodocument";

/** What the store knows about this document's builds. Only the two fields
 *  that answer the question below; `DocBuild` in the store has more. */
export type BuildState = { compiling: boolean; result: { outcome?: string } | null };

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
  /** Whether any document is on the strip at all.  With none, a 404 is
   *  not about a build, and the build state has nothing to say. */
  onStrip = true,
): Absence {
  if (response === null) return "unreachable";
  if (response.ok) return "";
  // The route answers 503 while a build is rewriting the PDF under it,
  // which is the engine's doing and not a fault: the next `compile_done`
  // fetches again.  The pane keeps a page it already has; with none, the
  // truthful word is the one for a build in flight.
  if (response.status === 503) return "building";
  if (response.status !== 404) return "unreachable";
  if (!onStrip) return "nodocument";
  if (build?.compiling) return "building";
  if (!build || build.result === null) return "unbuilt";
  // A build that failed made no pages because it failed, not because the
  // document is empty; the probe found the pane saying it was (Q-066).
  const outcome = build.result.outcome;
  if (outcome && outcome !== "ok") return "stopped";
  return "empty";
}
