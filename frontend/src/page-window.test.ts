import { describe, expect, it } from "vitest";
import { pageWindowRequest, pageWindowUrl } from "./page-window";

describe("the page window's URL", () => {
  it("is read back to a project and a document", () => {
    expect(pageWindowRequest("?page=6d767e7043ea&document=chapters%2Ftwo.tex"))
      .toEqual({ projectId: "6d767e7043ea", document: "chapters/two.tex" });
    expect(pageWindowRequest("?page=abc")).toEqual({ projectId: "abc", document: "" });
  });

  it("is nothing for an ordinary visit, or a token alone, or an id that is not one", () => {
    expect(pageWindowRequest("")).toBeNull();
    expect(pageWindowRequest("?token=xyz")).toBeNull();
    expect(pageWindowRequest("?page=")).toBeNull();
    expect(pageWindowRequest("?page=../etc")).toBeNull();
    expect(pageWindowRequest(`?page=${"a".repeat(65)}`)).toBeNull();
  });

  it("drops a document that tries to leave the project", () => {
    expect(pageWindowRequest("?page=abc&document=../x.tex")).toEqual({ projectId: "abc", document: "" });
    expect(pageWindowRequest("?page=abc&document=/etc/passwd")).toEqual({ projectId: "abc", document: "" });
  });

  it("round-trips through the URL it builds", () => {
    const url = pageWindowUrl("abc", "chapters/two.tex");
    expect(url).toBe("/?page=abc&document=chapters%2Ftwo.tex");
    expect(pageWindowRequest(url.slice(1))).toEqual({ projectId: "abc", document: "chapters/two.tex" });
    expect(pageWindowUrl("abc", "")).toBe("/?page=abc");
  });
});
