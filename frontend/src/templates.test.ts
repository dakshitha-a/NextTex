import { describe, expect, it } from "vitest";
import { START_FROM, templateOrder } from "./templates";

describe("the templates a project starts from", () => {
  it("are shown in the page's order, not the directory's", () => {
    expect(templateOrder(["application", "basic", "beamer", "letter", "report"])).toEqual([
      "basic", "report", "beamer", "letter", "application",
    ]);
  });

  it("put a template this list does not name after the named ones, by name", () => {
    expect(templateOrder(["thesis", "basic", "abstract"])).toEqual(["basic", "abstract", "thesis"]);
  });

  it("name the job application by what it is", () => {
    expect(START_FROM.application).toBe("A job application");
  });
});
