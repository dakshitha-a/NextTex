import type { UploadResult } from "./api";

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
