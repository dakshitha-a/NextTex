import { describe, expect, it } from "vitest";

import { dictionary } from "./words";

/** The list shipped American-only, and NextTex is written in British English
 *  throughout: its own source, its own interface strings and its own
 *  specification all say "colour" and "recognised". So a writer who turned
 *  spell checking on had `colour`, `analyse` and `behaviour` underlined on
 *  almost every line, which is the exact failure `spellcheck.ts` opens by
 *  saying it must avoid, because it teaches people to ignore the underlines.
 *
 *  The first fix added derived British forms to the one list by hand.  The
 *  British forms come from the real `wbritish` list now, as a delta on the
 *  American one, and a project can say which English it is written in. */
const BRITISH = [
  "colour", "colours", "coloured", "colourful",
  "behaviour", "behavioural", "favour", "favours", "favourite",
  "honour", "honours", "labour", "labours", "neighbour", "neighbours",
  "flavour", "flavoured", "humour", "rumour",
  "analyse", "analysed", "analyses", "analysing",
  "recognise", "recognised", "recognises", "recognising",
  "organise", "organised", "organising",
  "realise", "realised", "realising",
  "emphasise", "emphasised", "normalise", "normalised",
  "summarise", "summarised", "minimise", "minimised",
  "maximise", "maximised", "characterise", "characterised",
  "generalise", "generalised", "utilise", "utilised",
  "centre", "centres", "centred", "metre", "metres", "litre", "litres",
  "theatre", "fibre", "fibres",
  "travelled", "travelling", "modelled", "modelling",
  "labelled", "labelling", "cancelled", "cancelling",
  "signalled", "fuelled", "marvellous",
  "catalogue", "dialogue", "analogue",
  "defence", "offence", "licence", "practise",
  "programme", "programmes", "grey", "aluminium", "sulphur",
];

/** The other spelling of some of the same words. */
const AMERICAN = [
  "color", "analyze", "center", "organize", "defense", "traveled", "catalog",
];

/** Words that are neither, and must stay caught whichever variety is on. */
const MISSPELT = [
  "teh", "recieve", "seperate", "occured", "definately", "wierd", "colur",
  // Near-misses of the rules that once generated British forms by hand:
  // `size` must not have produced `sise`, nor `prize` `prise`.
  "sise", "analize",
];

describe("the word lists", () => {
  const american = dictionary("american");
  const british = dictionary("british");
  const either = dictionary("either");

  it("hold enough words to be dictionaries", () => {
    expect(american.size).toBeGreaterThan(70_000);
    expect(british.size).toBeGreaterThan(70_000);
    // The delta is a few thousand words each way, not a second list.
    expect(Math.abs(british.size - american.size)).toBeLessThan(3_000);
    expect(either.size).toBeGreaterThan(american.size);
    expect(either.size).toBeGreaterThan(british.size);
  });

  it.each(BRITISH)("British and either accept %s", (word) => {
    expect(british.has(word)).toBe(true);
    expect(either.has(word)).toBe(true);
  });

  it.each(AMERICAN)("American and either accept %s", (word) => {
    expect(american.has(word)).toBe(true);
    expect(either.has(word)).toBe(true);
  });

  it.each(["color", "analyze", "center"])("British does not accept %s", (word) => {
    expect(british.has(word)).toBe(false);
  });

  it.each(["colour", "analyse", "centre"])("American does not accept %s", (word) => {
    expect(american.has(word)).toBe(false);
  });

  it.each(MISSPELT)("every variety still catches %s", (word) => {
    expect(american.has(word)).toBe(false);
    expect(british.has(word)).toBe(false);
    expect(either.has(word)).toBe(false);
  });

  it("answers the same set object twice", () => {
    expect(dictionary("british")).toBe(british);
  });
});
