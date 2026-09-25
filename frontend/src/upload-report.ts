import type { UploadResult } from "./api";

/** The outcomes of a file that is now in the project. */
const ARRIVED = new Set(["written", "replaced", "renamed"]);

/** The folder a project path is in, "" at the top. */
function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : "";
}

/** "a", "a and b", "a, b and c". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What to tell the writer about the files that did not land.
 *
 * Both callers used to read only `written` and throw the rest away, so a
 * file the server refused simply was not there afterwards, with no message
 * and nothing in the tree to notice. A drop of five that quietly becomes
 * four is worse than an error, because the writer has no reason to look.
 *
 * `skipped` is deliberately not reported: that one is the writer's own
 * answer to the question the upload card just asked them.
 *
 * Returns the empty string when everything landed, so the caller can treat
 * it as the condition it is.
 */
export function whatDidNotLand(results: UploadResult[]): string {
  const named = (outcome: string) =>
    results.filter((r) => r.outcome === outcome).map((r) => r.name);

  const refused = named("refused");
  const tooBig = named("too-big");
  const parts: string[] = [];
  // A file the server could not write, with the reason it gave: the folder
  // it was going into went to the trash during the upload, most often
  // (Q-027). Said first, with how many of the files did arrive and where,
  // since the upload went on past it.
  const failed = results.filter((r) => r.outcome === "failed");
  if (failed.length) {
    const arrived = results.filter((r) => ARRIVED.has(r.outcome));
    const offered = arrived.length + failed.length;
    const folder = arrived.length ? directoryOf(arrived[0].path) : "";
    const reasons = new Set(failed.map((r) => r.reason ?? "it could not be written"));
    // The server's reasons are about one file; several share it as "they".
    const one = [...reasons][0] ?? "";
    const reason = failed.length > 1 ? one.replace(/^it /, "they ") : one;
    const why = reasons.size === 1 ? `, because ${reason}` : "";
    parts.push(
      `${arrived.length} of ${offered} ${offered === 1 ? "file" : "files"} arrived` +
        (folder ? ` in ${folder}` : "") +
        `. ${list(failed.map((r) => r.name))} did not${why}`,
    );
  }

  if (refused.length) {
    parts.push(
      `${list(refused)} ${refused.length === 1 ? "was" : "were"} refused, ` +
        "because a file the build would run cannot be uploaded",
    );
  }
  if (tooBig.length) {
    parts.push(
      `${list(tooBig)} ${tooBig.length === 1 ? "was" : "were"} too large to accept`,
    );
  }
  return parts.length ? `${parts.join("; ")}.` : "";
}
