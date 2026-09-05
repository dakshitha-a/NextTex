/** What Claude says first, in a project that has no conversation yet.
 *
 *  Written here rather than asked for: it is the same every time, it has to
 *  be right, and spending a model call on a message the app already knows
 *  the text of would be silly.  It reads as the agent's own words because
 *  it is the agent that will do all of it.
 */
export const WELCOME = `I'm Claude, working inside this project. Here is how we fit together.

**The three panes.** You write LaTeX on the left. The middle is the real typeset PDF, rebuilt about a second after you stop typing — double-click any line of it to jump to the source that made it. This column is me.

**What I can do here.** I can write and revise prose, build tables and figure environments, insert and check citations, restructure sections, and read the compiler's errors to fix what broke. Edits to files in this project I make directly, and each one appears here as a chip with the diff and an undo. Anything else — a shell command, a file outside the project — I have to ask you about first.

**Tailoring this project to a template.** A journal class, a university handbook, a lab report — they agree on nothing, so I don't guess. Open *What Claude reads* at the bottom of the file list and add the real document: the thesis guidelines, the journal's author instructions, a class file. I'll read it once and hold the rules it sets from then on.

**Teaching me how you write.** Add a few things you have written to the same panel, under writing voice. I'll work out how you build a paragraph, how formal you are, how you handle hedging and citations — and write new prose that sounds like the rest of your document rather than like a model.

Ask me for something whenever you're ready.`;
