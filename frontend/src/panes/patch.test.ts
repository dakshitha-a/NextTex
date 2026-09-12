import { describe, expect, it } from "vitest";
import { hunksOf } from "./patch";

describe("hunksOf", () => {
  it("starts at the first hunk of what jsdiff writes", () => {
    const patch = [
      "===================================================================",
      "--- a.tex",
      "+++ a.tex",
      "@@ -1,2 +1,2 @@",
      " one",
      "-two",
      "+three",
      "",
    ].join("\n");
    expect(hunksOf(patch)).toEqual(["@@ -1,2 +1,2 @@", " one", "-two", "+three"]);
  });

  it("starts at the first hunk of what git writes, however long its header", () => {
    const patch = [
      "diff --git a/n.tex b/n.tex",
      "new file mode 100644",
      "index 0000000..e69de29",
      "--- /dev/null",
      "+++ b/n.tex",
      "@@ -0,0 +1 @@",
      "+alpha",
    ].join("\n");
    expect(hunksOf(patch)[0]).toBe("@@ -0,0 +1 @@");
    expect(hunksOf(patch)).toHaveLength(2);
  });

  it("keeps a patch with no hunk, which is what a binary change looks like", () => {
    expect(hunksOf("Binary files a/x and b/x differ\n")).toEqual([
      "Binary files a/x and b/x differ",
    ]);
  });
});
