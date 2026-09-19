/** Which reusable prompts a draft that starts with `/` could mean.
 *
 *  The menu is drawn while the draft is one line beginning with a slash,
 *  and lists the prompts whose spoken name starts with what has been
 *  typed, hyphens and spaces the same character, case folded; the
 *  server matches the same way when the message is sent.  Choosing one
 *  completes the name into the draft and the writer sends on their own,
 *  which is the selection toolbar's rule.  Pure, so a vitest holds it.
 */

export type PromptEntry = {
  name: string;
  /** The name as typed: hyphens as spaces. */
  said: string;
  source: "builtin" | "project";
  hint: string;
  text: string;
};

const fold = (text: string) => text.trim().toLowerCase().replace(/[\s-]+/g, " ");

/** The typed head after the slash, or null when the draft is not a
 *  slash command being typed: no slash, or a second line already. */
export function slashHead(draft: string): string | null {
  if (!draft.startsWith("/") || draft.includes("\n")) return null;
  return draft.slice(1);
}

/** The prompts the draft could still mean, in the list's order. */
export function matching(draft: string, prompts: PromptEntry[]): PromptEntry[] {
  const head = slashHead(draft);
  if (head === null) return [];
  const typed = fold(head);
  return prompts.filter((prompt) => fold(prompt.said).startsWith(typed));
}

/** The draft once a prompt is chosen: the name and a space, ready for a
 *  note. */
export function completed(prompt: PromptEntry): string {
  return `/${prompt.said} `;
}
