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
// `science.txt` is the vocabulary of papers, "eigenvector" to
// "mitochondria", which the everyday list lacks: about 25,000 words, 160 kB
// of text and 63 kB after brotli, in the same chunk again, since the
// setting that uses it is on by default and a second request for it would
// be one nearly every writer makes.  `scripts/make-wordlist.py` says how
// its words were chosen.
//
// See COPYRIGHT beside this file: every list is SCOWL's, and its licence
// asks that the notice travel with them.

import encoded from "./words.txt?raw";
import delta from "./british.txt?raw";
import science from "./science.txt?raw";

/** Which English a text is checked against.  `either` accepts both
 *  spellings of every word, which is what a project with no stated
 *  variety gets: half the literature a thesis cites is American, and an
 *  underline under every `colour` teaches people to ignore underlines. */
export type Variety = "american" | "british" | "either";

const cached = new Map<string, Set<string>>();

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

/** The science vocabulary's three parts, each front-coded: the words both
 *  Englishes share, then after a `-` line the words only British English
 *  has, then after another the words only American English has.  A word
 *  is in one English's part only where the other has its other spelling,
 *  "ionisation" beside "ionization", so the Variety setting means the same
 *  with these words as without them. */
function sciences(): { shared: string[]; british: string[]; american: string[] } {
  const [shared = "", british = "", american = ""] = science.split("\n-\n");
  return { shared: decode(shared), british: decode(british), american: decode(american) };
}

/** The words a variety accepts, and with `withScience` the science
 *  vocabulary too, in that variety's spelling. */
export function dictionary(variety: Variety = "american", withScience = false): Set<string> {
  const key = withScience ? `${variety}+science` : variety;
  const held = cached.get(key);
  if (held) return held;
  let words: Set<string>;
  if (withScience) {
    const parts = sciences();
    words = new Set(dictionary(variety));
    for (const word of parts.shared) words.add(word);
    if (variety !== "american") for (const word of parts.british) words.add(word);
    if (variety !== "british") for (const word of parts.american) words.add(word);
  } else if (variety === "american") {
    words = new Set(decode(encoded));
  } else {
    const { adds, removes } = halves();
    words = new Set(dictionary("american"));
    for (const word of adds) words.add(word);
    if (variety === "british") for (const word of removes) words.delete(word);
  }
  cached.set(key, words);
  return words;
}
