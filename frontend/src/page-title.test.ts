import { describe, expect, it } from "vitest";

import { pageTitle } from "./page-title";

describe("what the browser tab says", () => {
  it("names the project while it is open, before the app", () => {
    expect(pageTitle("editor", "Thesis", "")).toBe("Thesis · NextTex");
  });

  it("is the app alone on every other screen, even with a project remembered", () => {
    // The store keeps the last project's name while the list shows, so the
    // screen decides, not the name.
    expect(pageTitle("projects", "Thesis", "")).toBe("NextTex");
    expect(pageTitle("signin", "Thesis", "")).toBe("NextTex");
    expect(pageTitle("loading", "", "")).toBe("NextTex");
  });

  it("keeps a named install's name at the end", () => {
    expect(pageTitle("projects", "", "dev")).toBe("NextTex · dev");
    expect(pageTitle("editor", "Thesis", "dev")).toBe("Thesis · NextTex · dev");
  });

  it("does not show a blank name", () => {
    expect(pageTitle("editor", "  ", "")).toBe("NextTex");
  });
});
