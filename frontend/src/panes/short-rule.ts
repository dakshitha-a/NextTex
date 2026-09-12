/** What an "always allow" answer remembers, said in English.
 *
 *  The rule is a wire value with a grammar of its own: `Bash:latexmk`,
 *  `read:/home/writer/papers/shared.bib`, or a bare tool name.  It was
 *  drawn on the card verbatim, under the word "Remembers", so the writer
 *  was asked to agree to `Bash:latexmk` and to `Write:/…/main.tex`.  That
 *  is the protocol's vocabulary, not theirs: `Bash` is the name of a tool
 *  in an SDK they have never seen, and the colon is doing work that only
 *  reads as work if you already know the grammar.
 *
 *  So the rule is translated here.  The scope is unchanged; only the
 *  sentence is.  The whole rule stays in the row's tooltip, because a
 *  writer who does know the grammar should still be able to read it. */

/** A path rule carries the whole absolute path, because that is what makes
 *  it an identity: two `shared.bib` files in different folders are two
 *  different permissions.  What the writer needs to see is the end of it. */
function shortPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return `${parts.length > 2 ? "…/" : "/"}${tail}`;
}

/** The bare tool names that reach the card, in the words the card's own
 *  headline uses for them. Anything not listed keeps its name, which is
 *  better than a wrong guess at what an unknown tool does. */
const PLAIN: Record<string, string> = {
  WebFetch: "fetching pages from the web",
  WebSearch: "searching the web",
  Bash: "shell commands",
};

export function shortRule(rule: string): string {
  const [verb, ...rest] = rule.split(":");
  const value = rest.join(":");
  if (!value) return PLAIN[rule] ?? rule;
  if (verb === "Bash") return `shell commands starting with ${value}`;
  if (verb === "read" && value.startsWith("/")) {
    return `reading ${shortPath(value)}`;
  }
  if (verb === "write" && value.startsWith("/")) {
    return `changing ${shortPath(value)}`;
  }
  if (value.startsWith("/")) return `${verb} ${shortPath(value)}`;
  return rule;
}
