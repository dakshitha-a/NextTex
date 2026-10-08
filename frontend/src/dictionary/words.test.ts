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

/** Terms from each field the science vocabulary is for, none of which the
 *  everyday list holds. */
const SCIENCE = [
  "eigenvector", "eigenvectors", "isomorphism", "holomorphic", "surjective",
  "heteroscedasticity", "covariate", "hyperparameter", "backpropagation",
  "enthalpy", "aldehyde", "ketone", "nucleophile", "enantiomer", "chromatography",
  "mitochondria", "apoptosis", "phosphorylation", "eukaryote", "proteome",
  "fermion", "boson", "gluon", "lepton", "renormalizable", "lanczos",
];

/** One word in each English, which the vocabulary keeps apart as the
 *  everyday list keeps "colour" and "color" apart. */
const PAIRS: [string, string][] = [
  ["quantisation", "quantization"], ["haematoma", "hematoma"],
  ["renormalisation", "renormalization"], ["ischaemia", "ischemia"],
  ["hybridisation", "hybridization"], ["parameterised", "parameterized"],
];

/** Common misspellings, in papers and out of them. The vocabulary was
 *  chosen from abstracts, where a typo used often enough looks like a
 *  word, so none of these may have come with it. */
const TYPOS = [
  "accross", "adress", "agressive", "apparant", "basicly", "becuase",
  "beggining", "buisness", "cemetary", "collegue", "comitee", "completly",
  "concieve", "critisism", "dilemna", "disapear", "dissapoint", "exellent",
  "existant", "experiance", "facinating", "foward", "garantee", "guage",
  "happend", "hygene", "imediate", "independance", "intrest", "irrelevent",
  "knowlegeable", "lisence", "mantain", "minature", "mispell", "neice",
  "nieghbor", "occuring", "oppurtunity", "orignal", "particulary", "peice",
  "perminent", "posible", "potentialy", "practicly", "presance", "pressence",
  "propoganda", "recived", "reffered", "repitition", "rember", "sentance",
  "sieze", "strengh", "sufficent", "suprised", "tendancy", "tommorrow",
  "tounge", "transfering", "unfortunatly", "usualy", "vegtable", "visibile",
  "wheather", "whith", "wiht", "accesible", "aproximately", "aproach",
  "assymetric", "assymptotic", "asymetric", "anomolous", "comparision",
  "corelation", "emperical", "experimantal", "funtion", "heirarchy",
  "hypothosis", "imaginery", "intial", "intergral", "interpretion",
  "mesurement", "minimun", "neglible", "nonlinar", "optimun", "perameter",
  "posterier", "quantitive", "resolusion", "sinusoidial", "spectum",
  "stastistical", "statisical", "thier", "veriable", "simmilar", "differnt",
  "diffrent", "approximatly", "calulate", "calcualte", "caculate",
  "eigenvetor", "eigenvaue", "hamiltonain", "lagrangain", "langrangian",
  "fourrier", "gausian", "bayseian", "probablistic", "stochastical",
  "orthogonl", "polynomal", "matirx", "matrcies", "tensr", "vectr",
  "tempature", "presure", "moleculs", "proteinn", "enzime", "bacteriaa",
  "mitochondira", "ribosme", "phosphorilation", "chromatograpy",
  "spectroscophy",
];

describe("the science vocabulary", () => {
  const either = dictionary("either", true);

  it("is a few tens of thousands of words beside the everyday list", () => {
    const added = either.size - dictionary("either").size;
    expect(added).toBeGreaterThan(20_000);
    expect(added).toBeLessThan(40_000);
  });

  it.each(SCIENCE)("accepts %s only when asked to", (word) => {
    expect(dictionary("either").has(word)).toBe(false);
    expect(either.has(word)).toBe(true);
    expect(dictionary("american", true).has(word)).toBe(true);
    expect(dictionary("british", true).has(word)).toBe(true);
  });

  it.each(PAIRS)("holds %s to British and %s to American", (uk, us) => {
    expect(dictionary("british", true).has(uk)).toBe(true);
    expect(dictionary("british", true).has(us)).toBe(false);
    expect(dictionary("american", true).has(us)).toBe(true);
    expect(dictionary("american", true).has(uk)).toBe(false);
    expect(either.has(uk) && either.has(us)).toBe(true);
  });

  it("keeps every typo out", () => {
    expect(TYPOS.filter((word) => either.has(word))).toEqual([]);
    expect(MISSPELT.filter((word) => either.has(word))).toEqual([]);
  });

  it("leaves the everyday lists as they were", () => {
    expect(dictionary("either")).toBe(dictionary("either"));
    expect(dictionary("either", true)).not.toBe(dictionary("either"));
    expect(dictionary("either").has("enthalpy")).toBe(false);
  });
});
