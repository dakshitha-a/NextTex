import { describe, expect, test } from "vitest";
import { citeKey, depthOf, entryLinks, labelOf, lineBelow, linksOf } from "./pdf-links";

// A US letter page, as pdf.js gives its `view`: the box in PDF space,
// whose y runs up from the bottom.
const VIEW = [0, 0, 612, 792];

describe("linksOf", () => {
  test("a named destination becomes a box measured from the top-left", () => {
    const links = linksOf(
      [{ annotationType: 2, rect: [100, 700, 150, 712], dest: "section.1" }],
      VIEW,
    );
    expect(links).toEqual([{ box: { x: 100, y: 92, width: 50, height: 12 }, dest: "section.1" }]);
  });

  test("an explicit destination is kept as pdf.js gives it", () => {
    const dest = [{ num: 5, gen: 0 }, { name: "XYZ" }, 72, 600, null];
    expect(linksOf([{ annotationType: 2, rect: [1, 1, 2, 2], dest }], VIEW)[0].dest).toBe(dest);
  });

  test("a page whose box does not start at the origin is measured from its own corner", () => {
    const [link] = linksOf([{ annotationType: 2, rect: [110, 700, 150, 712], dest: "x" }], [10, 20, 622, 812]);
    expect(link.box).toEqual({ x: 100, y: 112, width: 40, height: 12 });
  });

  test("web and mail addresses are links, and nothing that runs or reads the disk", () => {
    const at = (url: string) => linksOf([{ annotationType: 2, rect: [0, 0, 10, 10], url }], VIEW);
    expect(at("https://example.org")[0].url).toBe("https://example.org");
    expect(at("mailto:a@example.org")[0].url).toBe("mailto:a@example.org");
    expect(at("javascript:alert(1)")).toEqual([]);
    expect(at("file:///etc/passwd")).toEqual([]);
  });

  test("other annotations, and links with nowhere to go or no area, are left out", () => {
    expect(linksOf([
      { annotationType: 1, rect: [0, 0, 10, 10], contents: "a note" },
      { annotationType: 2, rect: [0, 0, 10, 10] },
      { annotationType: 2, rect: [5, 5, 5, 10], dest: "x" },
    ], VIEW)).toEqual([]);
  });
});

describe("depthOf", () => {
  test("XYZ names a top, measured down from the page's top", () => {
    expect(depthOf([{}, { name: "XYZ" }, 72, 600, null], VIEW)).toBe(192);
  });

  test("FitH and FitBH name a top in the place XYZ names a left", () => {
    expect(depthOf([{}, { name: "FitH" }, 500], VIEW)).toBe(292);
    expect(depthOf([{}, { name: "FitBH" }, 500], VIEW)).toBe(292);
  });

  test("a whole-page fit, or a top left null, is the top of the page", () => {
    expect(depthOf([{}, { name: "Fit" }], VIEW)).toBeNull();
    expect(depthOf([{}, { name: "XYZ" }, null, null, null], VIEW)).toBeNull();
  });

  test("a top off the page is held to it", () => {
    expect(depthOf([{}, { name: "XYZ" }, 0, 900, 0], VIEW)).toBe(0);
    expect(depthOf([{}, { name: "XYZ" }, 0, -50, 0], VIEW)).toBe(792);
  });
});

describe("lineBelow", () => {
  const run = (str: string, left: number, top: number, width = 40) =>
    ({ str, left, top, bottom: top + 10, width });

  test("the whole first line under the anchor", () => {
    const runs = [run("Above", 72, 80), run("2", 72, 112, 8), run("Method", 90, 112, 50), run("Body", 72, 140)];
    expect(lineBelow(runs, 100)).toEqual({ x: 72, y: 122, width: 68, height: 10 });
  });

  test("a line that starts a hair above the anchor still counts", () => {
    expect(lineBelow([run("Entry", 72, 99)], 100)).toEqual({ x: 72, y: 109, width: 40, height: 10 });
  });

  test("nothing within reach is nothing marked", () => {
    expect(lineBelow([run("Caption", 72, 300)], 100)).toBeNull();
    expect(lineBelow([run(" ", 72, 105)], 100)).toBeNull();
  });
});

describe("labelOf", () => {
  const box = { x: 0, y: 0, width: 1, height: 1 };
  test("a link says where it goes", () => {
    expect(labelOf({ box, dest: "section.2" })).toBe("Go to section 2");
    expect(labelOf({ box, dest: "cite.knuth" })).toBe("Go to cite knuth");
    expect(labelOf({ box, dest: [{ num: 5, gen: 0 }, { name: "Fit" }] })).toBe("Go to a place in the document");
    expect(labelOf({ box, url: "https://example.org" })).toBe("https://example.org");
  });
});

// A line of type: its text, where it starts, the top of its line and its
// baseline, all in points from the page's top-left corner.
const run = (str: string, left: number, top: number, width = 200) => ({ str, left, top, bottom: top + 10, width });

describe("citeKey", () => {
  test("hyperref's and biblatex's anchors name the key", () => {
    expect(citeKey("cite.knuth1984")).toBe("knuth1984");
    expect(citeKey("cite.0@tully1990")).toBe("tully1990");
    expect(citeKey("cite.Smith:2020a")).toBe("Smith:2020a");
    expect(citeKey("section.2")).toBeNull();
  });
});

describe("entryLinks", () => {
  test("each entry runs from its anchor to the next, its hanging label inside", () => {
    const runs = [
      run("[1]", 72, 100, 14), run("D. Knuth. The TeXbook.", 90, 100), run("Addison-Wesley, 1984.", 90, 112),
      run("[2]", 72, 130, 14), run("L. Lamport. LaTeX.", 90, 130),
    ];
    const links = entryLinks([{ key: "knuth", x: 90, depth: 98 }, { key: "lamport", x: 90, depth: 128 }], runs, 612);
    expect(links.map((link) => link.paper)).toEqual(["knuth", "lamport"]);
    expect(links[0].box).toEqual({ x: 72, y: 122, width: 218, height: 22 });
    expect(links[1].box.y).toBe(140);
    expect(labelOf(links[0])).toBe("Open the paper for knuth");
  });

  test("two columns are two lists, neither reaching into the other", () => {
    const runs = [
      run("Left one", 50, 100, 200), run("Left two", 50, 130, 200),
      run("Right one", 320, 100, 200), run("Right one, more", 320, 112, 200),
    ];
    const links = entryLinks([
      { key: "a", x: 50, depth: 98 }, { key: "b", x: 50, depth: 128 }, { key: "c", x: 320, depth: 98 },
    ], runs, 612);
    const c = links.find((link) => link.paper === "c")!;
    expect(c.box).toEqual({ x: 320, y: 122, width: 200, height: 22 });
    const a = links.find((link) => link.paper === "a")!;
    expect(a.box.x + a.box.width).toBeLessThan(320);
    expect(a.box.y).toBe(110);
  });

  test("the last entry on a page stops before the page number", () => {
    const runs = [run("Last entry.", 72, 600), run("continues.", 72, 612), run("23", 300, 740, 10)];
    const [last] = entryLinks([{ key: "z", x: 72, depth: 598 }], runs, 612);
    expect(last.box.y).toBe(622);
  });

  test("an entry continued from the page before is left alone above its first anchor", () => {
    const runs = [run("...end of an entry.", 72, 80), run("[9] Next.", 72, 100)];
    const links = entryLinks([{ key: "n", x: 72, depth: 98 }], runs, 612);
    expect(links).toHaveLength(1);
    expect(links[0].box.y - links[0].box.height).toBe(100);
  });
});
