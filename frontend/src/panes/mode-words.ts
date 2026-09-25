/** The three positions of the permission control, in words.
 *
 *  Apart from `ComposerMenus` because the always-visible bolt reads the
 *  current position's title for its aria-label, and the menu that lists
 *  all three is fetched only when somebody opens it: the words are the
 *  one thing both sides of that split need.
 *
 *  Named for what happens, not for how much is switched off: "Run the work
 *  without asking" says what the middle position does, where "everything
 *  inside the project" would be a claim the code cannot keep. A piped
 *  command or a script can leave the project without the fence seeing it,
 *  because what the fence inspects is the tool call and not what the
 *  command then does, and section 28 says so where a reader will find it.
 */
export type Mode = "ask" | "project" | "all";

export const MODE_TITLES: Record<Mode, string> = {
  ask: "Ask before acting",
  project: "Run the work without asking",
  all: "Never ask about anything",
};

export const MODE_NOTES: Record<Mode, string> = {
  ask: "A card for every command, every fetch and every write that leaves this project.",
  project:
    "Commands and edits run silently. Still asked about: writing outside this project, and anything reaching the internet.",
  // The providers differ here, and the words say so (Q-004): Claude asks
  // about nothing at all, while the OpenAI provider's own tools refuse a
  // path outside the project in every position.
  all:
    "Nothing is asked about at all. Everything is still recorded here. With ChatGPT or a local model, a write outside this project is still refused.",
};
