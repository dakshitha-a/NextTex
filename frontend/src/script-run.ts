import type { ScriptResult } from "./api";

/** The arithmetic of the script pane, kept away from React so the cases
 *  can be listed: how a run is summed up in four words, what of a long
 *  traceback is worth carrying to the agent, and what the question that
 *  carries it says.
 */

/** The outcome, in the words the pane's top row uses. */
export function outcomeLabel(
  result: ScriptResult | null,
  running: boolean,
): string {
  if (running) return "Running";
  if (!result) return "Not run yet";
  if (result.stopped) return "Stopped";
  if (result.timeout) return "Stopped after 120 s";
  if (result.ok) return `Ran in ${seconds(result.duration_ms ?? 0)}`;
  return `Exit ${result.code}`;
}

function seconds(ms: number): string {
  if (ms < 1000) return `${Math.max(ms, 1)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** The last `lines` lines of `text`, and no more than `bytes` of them.
 *
 *  A traceback ends with the line that matters, so the tail is the part
 *  to keep; the byte cap is for the script that printed a row per
 *  iteration before failing, where forty lines can still be a lot. */
export function tailOf(text: string, lines: number, bytes: number): string {
  const kept = text.trimEnd().split("\n").slice(-lines).join("\n");
  return kept.length > bytes ? kept.slice(kept.length - bytes) : kept;
}

/** The last line of a traceback: what went wrong, in one sentence. */
export function lastLine(text: string): string {
  const lines = text.trimEnd().split("\n").filter((line) => line.trim());
  return lines[lines.length - 1] ?? "";
}

/** The question the pane seeds into the composer after a failed run.
 *
 *  Seeded rather than sent, which is the `Fix` button's rule: the writer
 *  presses Enter on their own message.  It names the script, says the run
 *  was theirs and not the agent's, quotes the tail of what the script
 *  said, and asks for the change to be named, so the answer is something
 *  they can read rather than a silent rewrite. */
export function troubleshootPrompt(path: string, result: ScriptResult): string {
  const said = tailOf(result.err || result.out, 40, 4000);
  const how = result.timeout
    ? "it was still running after 120 seconds and was stopped"
    : `it failed with exit ${result.code}`;
  return (
    `Fix ${path}. I ran it from the editor and ${how}:\n\n` +
    "```\n" + said + "\n```\n\n" +
    "When it runs, say what you changed."
  );
}

/** Whether a `files_changed` that names the script came from the agent
 *  after a run that failed here: the moment the pane offers a rerun. */
export function agentChangedScript(
  script: { path: string; running: boolean; result: ScriptResult | null } | null,
  paths: string[],
  byAgent: boolean,
): boolean {
  if (!script || !byAgent || script.running) return false;
  if (!paths.includes(script.path)) return false;
  return script.result !== null && !script.result.ok;
}
