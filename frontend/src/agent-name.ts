/** What to call the agent on screen.
 *
 *  NextTex talks to two services and works with neither, so every label in
 *  the chat column is a variable rather than a word.  A writer who signed
 *  in with an OpenAI key being asked to "Ask Claude" is a small thing that
 *  makes the whole app look like it was built for somebody else.
 */
export type Provider = "claude" | "openai" | "none";

export function agentName(provider: Provider | undefined | null): string {
  if (provider === "openai") return "ChatGPT";
  if (provider === "none") return "the agent";
  return "Claude";
}

/** How the running total should be described.  A Claude subscription bills
 *  a flat fee, so the figure is a comparison; an OpenAI key bills per
 *  token, so the same figure is an estimate of an actual charge. */
export function usageNote(provider: Provider | undefined | null): string {
  return provider === "openai"
    ? "Estimated from the tokens this project has used, at OpenAI's published prices. Your invoice is the one that counts."
    : "On a Claude subscription this is what the same work would have cost through the API, not a bill.";
}
