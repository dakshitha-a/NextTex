/** KaTeX, fetched the first time something has maths to set.
 *
 *  Shared by the editor's maths hover and the chat's maths, so the library
 *  and its stylesheet arrive once, and only in a session that shows an
 *  equation.  Its own module, without the editor's imports, so the chat
 *  can reach it without pulling CodeMirror into its chunk.
 */

type Katex = typeof import("katex");
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

export function loaded(): Katex | null {
  return katex;
}

export async function loadKatex(): Promise<Katex> {
  if (katex) return katex;
  if (!loading) {
    loading = Promise.all([
      import("katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([module]) => {
      katex = (module as any).default ?? module;
      return katex as Katex;
    }).catch((failure) => {
      // The rejected promise was kept, so one failed fetch, on a flaky
      // connection or during a deploy, meant every equation for the rest
      // of the session hovered as nothing with no way to try again short
      // of reloading. `spellcheck.ts` clears its own the same way.
      loading = null;
      throw failure;
    });
  }
  return loading;
}

/** The open project's `\newcommand`s, in the form KaTeX wants, written by
 *  the editor whenever it reads the symbol table, so an answer that says
 *  `$\npistar$` sets it the way the page does. */
let macros: Record<string, string> = {};

export function setProjectMacros(next: Record<string, string>): void {
  macros = next;
}

export function projectMacros(): Record<string, string> {
  // KaTeX writes `\gdef`s into the object it is given; a copy keeps one
  // message's definitions out of the next.
  return { ...macros };
}
