// Spelling in German, French, Spanish or Portuguese: Hunspell itself,
// compiled to WebAssembly, over the language's own .aff and .dic files.
//
// English is a word list because English barely inflects; these do. A
// flat list would miss "Lösungsmittel", which German builds from two
// words as it pleases, and an affix engine written in JavaScript took ten
// seconds and three hundred megabytes to load French. Hunspell loads each
// in well under a second and is what LibreOffice and Firefox check with.
//
// A chunk of its own, fetched only by a project whose language is one of
// the four, with the lists fetched through the server, which keeps one
// copy per machine (`nexttex/dictionaries.py`).

// The CommonJS build: the ES one calls `import * as nanoid` as a function,
// which a bundler turns into a namespace object that cannot be called.
import { loadModule } from "hunspell-asm/dist/cjs/index.js";
import { set } from "../store";

export type Speller = {
  /** Whether the word, as written, is one the language has. */
  correct(word: string): boolean;
  /** What the writer probably meant, best first. */
  suggest(word: string): string[];
};

let factory: ReturnType<typeof loadModule> | null = null;
const spellers = new Map<string, Promise<Speller>>();

async function file(code: string, name: string): Promise<Uint8Array> {
  const response = await fetch(`/api/dictionaries/${code}/${name}`, { credentials: "same-origin" });
  if (!response.ok) {
    const answer = await response.json().catch(() => ({}));
    throw new Error(answer.detail || `the word list answered ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The status strip's one line, the first time this machine fetches a
 *  list: a pause of a few seconds is fine once it has been named. */
async function sayIfFirst(code: string): Promise<void> {
  try {
    const response = await fetch("/api/dictionaries", { credentials: "same-origin" });
    const answer = (await response.json()) as {
      languages: { code: string; name: string; size: number; cached: boolean }[];
    };
    const found = answer.languages.find((language) => language.code === code);
    if (found && !found.cached) {
      const mb = (found.size / 1_000_000).toFixed(1);
      set({ spellingNote: `Fetching the ${found.name} word list, ${mb} MB, once` });
    }
  } catch {
    // The note is a courtesy; the fetch below says what went wrong.
  }
}

/** One speller per language for the life of the tab. */
export function spellerFor(code: string): Promise<Speller> {
  const known = spellers.get(code);
  if (known) return known;
  const made = (async () => {
    await sayIfFirst(code);
    factory ??= loadModule();
    const [hunspell, aff, dic] = await Promise.all([factory, file(code, "index.aff"), file(code, "index.dic")]);
    const checker = hunspell.create(
      hunspell.mountBuffer(aff, `${code}.aff`),
      hunspell.mountBuffer(dic, `${code}.dic`),
    );
    // A page asks about the same words over and over as it scrolls and
    // is typed in; Hunspell answers in microseconds, a Map in less.
    const seen = new Map<string, boolean>();
    return {
      correct(word: string) {
        let answer = seen.get(word);
        if (answer === undefined) {
          answer = checker.spell(word);
          if (seen.size > 50_000) seen.clear();
          seen.set(word, answer);
        }
        return answer;
      },
      suggest(word: string) {
        return checker.suggest(word).slice(0, 4);
      },
    };
  })();
  // A failure is not kept, so the next look tries again.
  made.catch(() => spellers.delete(code)).finally(() => set({ spellingNote: null }));
  spellers.set(code, made);
  return made;
}
