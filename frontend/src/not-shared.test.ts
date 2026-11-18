import { describe, expect, test } from "vitest";
import { entryFor, listedAsItself, toggledFor } from "./not-shared";

describe("a row's own entry on the not-shared list", () => {
  test("a folder is named with its slash, a file as it is", () => {
    expect(entryFor("calc/scratch", true)).toBe("calc/scratch/");
    expect(entryFor("notes.txt", false)).toBe("notes.txt");
  });

  test("stop sharing adds it, and share again takes it away", () => {
    const once = toggledFor(["*.dat"], "calc/scratch", true);
    expect(once).toEqual(["*.dat", "calc/scratch/"]);
    expect(listedAsItself(once, "calc/scratch", true)).toBe(true);
    expect(toggledFor(once, "calc/scratch", true)).toEqual(["*.dat"]);
  });

  test("a path left out by a broader entry is not on the list as itself", () => {
    expect(listedAsItself(["*.dat"], "x.dat", false)).toBe(false);
  });
});
