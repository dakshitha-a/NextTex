/** What was typed into the fourth way in, and what to call the folder.
 *
 *  The one field takes an arXiv id or a git URL, and a chosen zip fills
 *  it with the file's name; which of the three it is decides the request,
 *  and anything else is refused here, before a request is made, with a
 *  sentence that says what the field takes.  The patterns mirror
 *  `arxiv_id` and `is_git_url` in `nexttex/arrive.py`, which decide again
 *  on the server; this copy exists so the form can answer without a round
 *  trip and so the folder picker can propose a name.  Pure, so the cases
 *  are a vitest rather than a browser.
 */

export type Source = "zip" | "arxiv" | "git";

/** An arXiv id in its two spellings, bare or inside an abs, pdf or
 *  e-print URL; the same pattern as the server's. */
const ARXIV = /^(?:https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|e-print)\/)?((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(v\d+)?(?:\.pdf)?\/?$/;
/** A git URL on a transport that reaches a host: https, http, ssh, git,
 *  or `user@host:path`. */
const GIT = /^(?:(?:https?|ssh|git):\/\/[A-Za-z0-9._~%:@/?#[\]!$&'()*+,;=-]+|[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[A-Za-z0-9._~%/+-]+)$/;

export function arxivId(text: string): string | null {
  const found = ARXIV.exec(text.trim());
  return found ? found[1] + (found[2] ?? "") : null;
}

export function isGitUrl(text: string): boolean {
  const trimmed = text.trim();
  return GIT.test(trimmed) && !trimmed.startsWith("-");
}

/** Which way the request goes, or null with nothing to send. */
export function classify(text: string, file: File | null): Source | null {
  if (file) return "zip";
  if (arxivId(text)) return "arxiv";
  if (isGitUrl(text)) return "git";
  return null;
}

/** A folder name for what is arriving: the zip's stem, the arXiv id with
 *  its slash turned into a hyphen, or the repository's name off the end
 *  of the URL. */
export function nameFor(text: string, file: File | null): string {
  if (file) return file.name.replace(/\.zip$/i, "");
  const id = arxivId(text);
  if (id) return id.replace(/\//g, "-");
  if (isGitUrl(text)) {
    const tail = text.trim().replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
    return tail.replace(/\.git$/i, "");
  }
  return "";
}
