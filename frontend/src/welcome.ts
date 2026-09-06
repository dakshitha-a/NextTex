/** What the agent says first, in a project with no conversation yet.
 *
 *  Written into the app rather than asked for: it is the same every time,
 *  it has to be right, and spending a model call on text the app already
 *  knows would be silly.  Kept to three paragraphs -- a first-time reader
 *  will not act on five -- with the two things worth doing turned into
 *  buttons beneath it rather than instructions to go and find something.
 */
/** The one sentence that differs by provider: the Claude agent has a shell
 *  and the OpenAI one deliberately does not, so promising to ask before
 *  running a command would be promising something that cannot happen. */
export const welcome = (name: string, shell = true) => {
  const beyond = shell
    ? "A shell command or a file outside the project I ask about first."
    : "A file outside the project I ask about first.";
  return `I'm ${name}, working inside this project. You write LaTeX on the left; the middle is the real typeset page, rebuilt about a second after you stop typing. Double-click anything on it to jump to the source that made it.

Ask me for prose, tables, figures, citations, or a fix for whatever the compiler is complaining about. Edits to files in this project I make directly, and each one appears here with its diff and an undo. ${beyond}

Two things make me much better at this, and both take a minute:`;
};

export const WELCOME_ACTIONS = [
  {
    kind: "template" as const,
    label: "Start from a basic document",
    detail: "A page with maths, a figure, a table and a citation already working. For when you want to write now and decide on a template later.",
  },
  {
    kind: "style" as const,
    label: "Add your template",
    detail: "Thesis guidelines, a journal's author instructions, a class file. I'll follow its rules instead of guessing.",
  },
  {
    kind: "voice" as const,
    label: "Add a sample of your writing",
    detail: "A paper or a chapter you wrote. I'll match how you build a paragraph rather than sounding like a model.",
  },
];
