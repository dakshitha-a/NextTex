/** What the panel calls a tool call, and when it may use the past tense.
 *
 *  Every verb in this table is past tense, and the tool row is drawn when
 *  the call arrives, not when it is permitted. So a command still sitting
 *  behind a card that asked "Run a shell command?" already had `Ran` above
 *  it, and if the writer said no, the transcript kept both: `Ran`, then
 *  `Denied`, the same command twice, nothing having run.
 *
 *  The transcript is the account of what was done to somebody's document.
 *  It is allowed to say a thing is being asked about; it is not allowed to
 *  say a thing happened that did not.
 */

/** Past tense, for a call that has been allowed. */
export const VERBS: Record<string, string> = {
  Read: "Read",
  Edit: "Edited",
  MultiEdit: "Edited",
  Write: "Wrote",
  Bash: "Ran",
  Glob: "Searched",
  Grep: "Searched",
  mcp__nexttex__editor_state: "Checked where you are",
  mcp__nexttex__compile_diagnostics: "Read the errors",
  mcp__nexttex__compile: "Rebuilt the document",
  mcp__nexttex__insert_at_cursor: "Inserted at your cursor",
  mcp__nexttex__insert_figure: "Inserted a figure",
  mcp__nexttex__insert_table: "Inserted a table",
  // Not "what you selected". The tool takes a line range and the model
  // chooses it; a selection is the usual way one gets chosen, and a
  // row saying otherwise had the agent rewriting a paragraph the
  // writer had never touched under the words "what you selected".
  mcp__nexttex__replace_range: "Rewrote lines",
  mcp__nexttex__goto: "Moved your editor",
  mcp__nexttex__show_page: "Turned the preview to a page",
  mcp__nexttex__list_comments: "Read the comments",
  mcp__nexttex__reply_to_comment: "Replied to a comment",
  mcp__nexttex__run_plot_script: "Drew a figure",
  mcp__nexttex__run_script: "Ran a script",
  mcp__nexttex__install_package: "Installed a package",
  mcp__nexttex__find_papers: "Searched the literature",
  mcp__nexttex__add_reference: "Added a reference",
  mcp__nexttex__check_references: "Checked the bibliography",
  mcp__nexttex__search_library: "Searched your papers",
  mcp__nexttex__remember: "Remembered",
};

/** The same actions, before anybody has said yes. Only the ones whose past
 *  tense would be a false statement need one: `Read` is already both, and
 *  the app's own tools that read rather than change are harmless either
 *  way. What must never appear over an open card is `Ran`, `Wrote`,
 *  `Edited`. */
const ASKING: Record<string, string> = {
  Read: "Reading",
  Edit: "Editing",
  MultiEdit: "Editing",
  Write: "Writing",
  Bash: "Running",
  Glob: "Searching",
  Grep: "Searching",
  mcp__nexttex__compile: "Rebuilding the document",
  mcp__nexttex__insert_at_cursor: "Inserting at your cursor",
  mcp__nexttex__insert_figure: "Inserting a figure",
  mcp__nexttex__insert_table: "Inserting a table",
  mcp__nexttex__replace_range: "Rewriting lines",
  mcp__nexttex__goto: "Moving your editor",
  mcp__nexttex__show_page: "Turning the preview to a page",
  mcp__nexttex__reply_to_comment: "Replying to a comment",
  mcp__nexttex__run_plot_script: "Drawing a figure",
  mcp__nexttex__run_script: "Running a script",
  mcp__nexttex__install_package: "Installing a package",
  mcp__nexttex__find_papers: "Searching the literature",
  mcp__nexttex__add_reference: "Adding a reference",
  mcp__nexttex__check_references: "Checking the bibliography",
  mcp__nexttex__search_library: "Searching your papers",
  mcp__nexttex__remember: "Remembering",
};

/** Where a tool call has got to, from the panel's point of view. */
export type CallState = "asking" | "done" | "refused";

function plainly(name: string): string {
  return name.replace(/^mcp__[a-z]+__/, "").replace(/_/g, " ");
}

/**
 * The word above a tool row.
 *
 * `asking` while a card for this call is open and unanswered, `refused`
 * when it was answered with no, and `done` otherwise, which is every call
 * that was allowed and every call at a position that asks nothing.
 */
export function verbFor(name: string, state: CallState = "done"): string {
  if (state === "refused") return "Did not run";
  // The OpenAI provider names the app's own tools bare, `show_page` for
  // `mcp__nexttex__show_page`, so each of its rows read as the tool's name
  // with the underscores taken out. The same word under either provider.
  const own = `mcp__nexttex__${name}`;
  const known = name in VERBS || name in ASKING ? name : own in VERBS ? own : name;
  if (state === "asking") return ASKING[known] ?? plainly(known);
  return VERBS[known] ?? plainly(known);
}
