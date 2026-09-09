import { describe, expect, it } from "vitest";

import { dictionary } from "./words";

/** The list shipped American-only, and NextTex is written in British English
 *  throughout: its own source, its own interface strings and its own
 *  specification all say "colour" and "recognised". So a writer who turned
 *  spell checking on had `colour`, `analyse` and `behaviour` underlined on
 *  almost every line, which is the exact failure `spellcheck.ts` opens by
 *  saying it must avoid, because it teaches people to ignore the underlines.
 *
 *  Sixty-one of the eighty-two spellings below were flagged before this. */
const BRITISH = [
  "colour", "colours", "coloured", "colourful",
  "behaviour", "behaviours", "favour", "favours", "favourite",
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

/** Kept, because adding one spelling must not remove the other. Half the
 *  literature a thesis cites is written in American English. */
const AMERICAN = [
  "color", "analyze", "center", "organize", "defense", "traveled", "catalog",
];

/** The point of having a list at all. */
const MISSPELT = [
  "teh", "recieve", "seperate", "occured", "definately", "wierd", "colur",
  // Near-misses of the rules that generated the British forms: `size` must
  // not have produced `sise`, nor `prize` `prise`.
  "sise", "analize",
];

describe("the word list", () => {
  const words = dictionary();

  it("holds enough words to be a dictionary", () => {
    expect(words.size).toBeGreaterThan(70_000);
  });

  it.each(BRITISH)("accepts %s", (word) => {
    expect(words.has(word)).toBe(true);
  });

  it.each(AMERICAN)("still accepts %s", (word) => {
    expect(words.has(word)).toBe(true);
  });

  it.each(MISSPELT)("still catches %s", (word) => {
    expect(words.has(word)).toBe(false);
  });
});
