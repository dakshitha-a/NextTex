import { describe, expect, it } from "vitest";
import { suggest } from "./spell-suggest";

/** A stand-in for the shipped list. The real one is ninety-eight kilobytes
 *  and lives in a lazy chunk; what this needs to test is the search, not
 *  the vocabulary. */
const WORDS = new Set([
  "receive",
  "received",
  "recess",
  "the",
  "their",
  "there",
  "separate",
  "definitely",
  "occurrence",
  "beam",
  "team",
]);
const has = (word: string) => WORDS.has(word);

describe("suggest", () => {
  it("finds the word behind a transposition", () => {
    expect(suggest("recieve", has)).toContain("receive");
  });

  it("finds the word behind a dropped letter", () => {
    expect(suggest("recive", has)).toContain("receive");
  });

  it("finds the word behind a doubled letter", () => {
    expect(suggest("beamm", has)).toContain("beam");
  });

  it("keeps the shape of the word it is replacing", () => {
    // A sentence-initial mistake is still a sentence-initial word, and a
    // suggestion that arrives in lower case is one the writer then has to
    // fix by hand.
    expect(suggest("Recieve", has)).toContain("Receive");
  });

  it("offers nothing for a word that is nothing like anything", () => {
    // A surname, an acronym, a variable. The menu's other item, adding it
    // to the dictionary, is the right answer here and a list of wrong
    // guesses above it would only get in the way.
    expect(suggest("zqxjvkw", has)).toEqual([]);
  });

  it("stops at the limit it is given", () => {
    expect(suggest("ther", has, 2).length).toBeLessThanOrEqual(2);
  });

  it("says nothing about a single letter", () => {
    expect(suggest("a", has)).toEqual([]);
  });
});
