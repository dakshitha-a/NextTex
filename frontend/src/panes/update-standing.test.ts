/** R-041: the code on disk and the code that is running. */
import { describe, expect, test } from "vitest";
import { standingOf } from "./update-standing";

describe("whether this install has been updated and not restarted", () => {
  test("two different commits means the running one is stale", () => {
    // The laptop: working tree at b16bf6d, process serving 664f237, and
    // every place on screen reporting the first.
    expect(standingOf({ head: "664f237", diskHead: "b16bf6d" })).toBe("restart");
  });

  test("the same commit twice says nothing", () => {
    expect(standingOf({ head: "664f237", diskHead: "664f237" })).toBe("");
  });

  test("an install that is not a checkout says nothing", () => {
    expect(standingOf({ head: "", diskHead: "" })).toBe("");
  });

  test("one commit known and the other not is not evidence", () => {
    // A `git rev-parse` that failed answers empty, and an empty answer is
    // "I could not tell", which is not "they differ".
    expect(standingOf({ head: "664f237", diskHead: "" })).toBe("");
    expect(standingOf({ head: "", diskHead: "b16bf6d" })).toBe("");
  });

  test("no answer at all says nothing", () => {
    expect(standingOf(null)).toBe("");
  });
});
