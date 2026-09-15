// The English word lists, decoded on first use.
//
// Their own directory and their own module so that the bundler can keep
// them out of the interface: nothing here is reachable except through a
// dynamic import, so a writer who never turns spell checking on never
// downloads a word list.  `words.txt` is American English, 310 kB of text
// and 98 kB once the build's brotli pass has been over it; `british.txt`
// is not a second list but the difference, the words British English adds
// and the words it takes away, 19 kB of text and a few after brotli, in
// the same chunk.
//
// See COPYRIGHT beside this file: both lists are SCOWL, and its licence
// asks that the notice travel with them.

import encoded from "./words.txt?raw";
import delta from "./british.txt?raw";

/** Which English a text is checked against.  `either` accepts both
 *  spellings of every word, which is what a project with no stated
 *  variety gets: half the literature a thesis cites is American, and an
 *  underline under every `colour` teaches people to ignore underlines. */
export type Variety = "american" | "british" | "either";

const cached = new Map<Variety, Set<string>>();

/** The list, expanded from the front-coded form it is stored in.
 *
 *  Each line is the number of characters it shares with the line above,
 *  as a single printable character, followed by the rest of the word.  A
 *  sorted list shares a great deal, which halves the file before any
 *  compression and compresses better afterwards.  Seventy-odd thousand
 *  words, expanded in a few milliseconds, once per variety per page. */
function decode(text: string): string[] {
  const words: string[] = [];
  let previous = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    const shared = line.charCodeAt(0) - 48;
    const word = previous.slice(0, shared) + line.slice(1);
    words.push(word);
    previous = word;
  }
  return words;
}

/** The two halves of the delta: what British English adds, then, after a
 *  line holding `-` alone, what it takes away.  A front-coded line starts
 *  with the shared count from `0` upwards, and `-` sorts before `0`, so
 *  the separator can never be a word. */
function halves(): { adds: string[]; removes: string[] } {
  const [added = "", removed = ""] = delta.split("\n-\n");
  return { adds: decode(added), removes: decode(removed) };
}

export function dictionary(variety: Variety = "american"): Set<string> {
  const held = cached.get(variety);
  if (held) return held;
  let words: Set<string>;
  if (variety === "american") {
    words = new Set(decode(encoded));
  } else {
    const { adds, removes } = halves();
    words = new Set(dictionary("american"));
    for (const word of adds) words.add(word);
    if (variety === "british") for (const word of removes) words.delete(word);
  }
  cached.set(variety, words);
  return words;
}
