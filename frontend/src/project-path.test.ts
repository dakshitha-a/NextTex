import { describe, expect, it } from "vitest";

import { projectFolderFor, slug, startingPoints } from "./project-path";

describe("a title as a folder name", () => {
  it("lower-cases and hyphenates", () => {
    expect(slug("Sensor Fusion Paper")).toBe("sensor-fusion-paper");
    expect(slug("  Thesis, chapter 4!  ")).toBe("thesis-chapter-4");
    expect(slug("a--b__c")).toBe("a-b-c");
  });

  it("keeps letters in any script", () => {
    expect(slug("Διατριβή 2027")).toBe("διατριβή-2027");
  });

  it("is empty for a title with nothing to keep", () => {
    expect(slug("")).toBe("");
    expect(slug("!!!")).toBe("");
  });
});

describe("where a picked folder puts the project", () => {
  it("is the folder itself when pointing at one", () => {
    expect(projectFolderFor("/home/d/writing/thesis", "ignored", "add")).toBe(
      "/home/d/writing/thesis",
    );
  });

  it("is a folder under the picked one, named from the title, for a new project", () => {
    expect(projectFolderFor("/home/d/writing", "My Paper", "create")).toBe(
      "/home/d/writing/my-paper",
    );
    expect(projectFolderFor("/home/d/writing/", "My Paper", "create")).toBe(
      "/home/d/writing/my-paper",
    );
  });

  it("leaves the last part to the writer when there is no title yet", () => {
    expect(projectFolderFor("/home/d/writing", "", "create")).toBe("/home/d/writing/");
    expect(projectFolderFor("/home/d/writing", "???", "create")).toBe("/home/d/writing/");
  });

  it("leaves the last part to the writer for a join, which has no title", () => {
    expect(projectFolderFor("/home/d/writing", "", "join")).toBe("/home/d/writing/");
  });
});

describe("where the picker opens", () => {
  it("is home when nothing is typed", () => {
    expect(startingPoints("")).toEqual([""]);
    expect(startingPoints("   ")).toEqual([""]);
  });

  it("tries the typed path, then its parent, then home", () => {
    expect(startingPoints("/home/d/writing/my-paper")).toEqual([
      "/home/d/writing/my-paper",
      "/home/d/writing",
      "",
    ]);
    expect(startingPoints("~/writing/my-paper/")).toEqual([
      "~/writing/my-paper",
      "~/writing",
      "",
    ]);
  });

  it("has no parent to try for a bare name or the root", () => {
    expect(startingPoints("thesis")).toEqual(["thesis", ""]);
    expect(startingPoints("/thesis")).toEqual(["/thesis", "/", ""]);
    // The root's trailing slash is stripped and nothing is left: home.
    expect(startingPoints("/")).toEqual([""]);
  });
});
