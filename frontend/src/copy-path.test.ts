import { describe, expect, it } from "vitest";
import { absolutePath } from "./copy-path";

describe("absolutePath", () => {
  it("joins a POSIX folder and a tree path", () => {
    expect(absolutePath("/home/ada/thesis", "chapters/one.tex")).toBe("/home/ada/thesis/chapters/one.tex");
    expect(absolutePath("/home/ada/thesis/", "main.tex")).toBe("/home/ada/thesis/main.tex");
  });

  it("gives a Windows folder's paths in its own separator", () => {
    expect(absolutePath("C:\\Users\\ada\\thesis", "chapters/one.tex")).toBe("C:\\Users\\ada\\thesis\\chapters\\one.tex");
  });

  it("is the folder itself for the top of the project, and the tree path without a root", () => {
    expect(absolutePath("/home/ada/thesis", "")).toBe("/home/ada/thesis");
    expect(absolutePath("", "main.tex")).toBe("main.tex");
  });
});
