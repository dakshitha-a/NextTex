// The English word list, decoded on first use.
//
// Its own directory and its own module so that the bundler can keep it out
// of the interface: nothing here is reachable except through a dynamic
// import, so a writer who never turns spell checking on never downloads a
// word list.  310 kB of text, 98 kB once the build's brotli pass has been
// over it.
//
// See COPYRIGHT beside this file: the list is SCOWL, and its licence asks
// that the notice travel with it.

import encoded from "./words.txt?raw";

let cached: Set<string> | null = null;

/** The list, expanded from the front-coded form it is stored in.
 *
 *  Each line is the number of characters it shares with the line above --
 *  as a single printable character -- followed by the rest of the word.  A
 *  sorted list shares a great deal, which halves the file before any
 *  compression and compresses better afterwards.  Seventy-odd thousand
 *  words, expanded in a few milliseconds, once per page. */
export function dictionary(): Set<string> {
  if (cached) return cached;
  const words = new Set<string>();
  let previous = "";
  for (const line of encoded.split("\n")) {
    if (!line) continue;
    const shared = line.charCodeAt(0) - 48;
    const word = previous.slice(0, shared) + line.slice(1);
    words.add(word);
    previous = word;
  }
  cached = words;
  return words;
}
