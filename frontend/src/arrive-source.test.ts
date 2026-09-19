import { describe, expect, test } from "vitest";
import { arxivId, classify, isGitUrl, nameFor } from "./arrive-source";

describe("what was typed", () => {
  test("an arXiv id in its spellings", () => {
    expect(arxivId("2301.01234")).toBe("2301.01234");
    expect(arxivId("2301.01234v2")).toBe("2301.01234v2");
    expect(arxivId("math/0601001")).toBe("math/0601001");
    expect(arxivId("https://arxiv.org/abs/2301.01234")).toBe("2301.01234");
    expect(arxivId("https://arxiv.org/pdf/2301.01234v3.pdf")).toBe("2301.01234v3");
    expect(arxivId("2301.012")).toBeNull();
    expect(arxivId("")).toBeNull();
  });

  test("a git URL on a transport that reaches a host, and not a path", () => {
    for (const url of [
      "https://github.com/dakshitha-a/NextTex.git", "ssh://git@github.com/x/y",
      "git://example.org/r.git", "git@github.com:x/y.git",
    ]) expect(isGitUrl(url), url).toBe(true);
    for (const url of ["file:///home/me/repo", "/home/me/repo", "ext::sh -c id", "-oProxyCommand=id", "github.com/x/y", ""])
      expect(isGitUrl(url), url).toBe(false);
  });

  test("a chosen zip wins, then the id, then the URL, else nothing", () => {
    const zip = new File([""], "paper.zip");
    expect(classify("anything", zip)).toBe("zip");
    expect(classify("2301.01234", null)).toBe("arxiv");
    expect(classify("https://github.com/x/y", null)).toBe("git");
    expect(classify("my thesis", null)).toBeNull();
  });
});

describe("the folder's name", () => {
  test("from the zip's stem, the id, or the repository", () => {
    expect(nameFor("", new File([""], "Thesis Draft.zip"))).toBe("Thesis Draft");
    expect(nameFor("math/0601001v2", null)).toBe("math-0601001v2");
    expect(nameFor("https://github.com/dakshitha-a/NextTex.git", null)).toBe("NextTex");
    expect(nameFor("git@github.com:x/paper.git", null)).toBe("paper");
    expect(nameFor("https://example.org/repo/", null)).toBe("repo");
    expect(nameFor("nonsense", null)).toBe("");
  });
});
