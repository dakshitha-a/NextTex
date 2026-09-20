/** The templates a new project can start from, named on screen by what
 *  they are rather than by what the directory is called, because `beamer`
 *  is a word only a LaTeX writer knows and the people the chooser is for
 *  are the ones who may not.  A template the server lists and this map
 *  does not name falls back to its own name, so an install carrying a
 *  template of its own is offered it rather than hidden.
 *
 *  The order is this map's order, the one the direction page draws: the
 *  article first, then the report, the talk, the letter and the job
 *  application; anything unnamed after them, by name. */
export const START_FROM: Record<string, string> = {
  basic: "An article",
  report: "A report, in chapters",
  beamer: "A talk",
  letter: "A letter",
  application: "A job application",
};

const KNOWN = Object.keys(START_FROM);

/** The server's alphabetical list in the order the chooser shows it. */
export function templateOrder(names: string[]): string[] {
  const rank = (name: string) => {
    const at = KNOWN.indexOf(name);
    return at < 0 ? KNOWN.length : at;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
