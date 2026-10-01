import { afterEach, describe, expect, test } from "vitest";
import { inline } from "./prose";
import { mount } from "../ui/mount";

/** Links in a reply and in the Markdown preview: `inline`'s newest span.
 *
 *  A reply that pointed somewhere used to show its brackets and its
 *  address.  These hold what it draws now, and above all what it refuses:
 *  text from a model, written partly from files other people wrote, must
 *  never become a link that runs something. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function render(text: string): HTMLElement {
  const m = (mounted = mount(<p>{inline(text, "t")}</p>));
  return m.container.querySelector("p")!;
}

function links(text: string): { href: string; text: string; target: string; rel: string }[] {
  return [...render(text).querySelectorAll("a")].map((a) => ({
    href: a.getAttribute("href") ?? "",
    text: a.textContent ?? "",
    target: a.getAttribute("target") ?? "",
    rel: a.getAttribute("rel") ?? "",
  }));
}

describe("a Markdown link", () => {
  test("is its words, linked to its address, opening in a new tab with no opener", () => {
    const p = render("Tully's method is in [the Tully paper](https://doi.org/10.1063/1.459170).");
    expect(p.textContent).toBe("Tully's method is in the Tully paper.");
    expect(links("[the Tully paper](https://doi.org/10.1063/1.459170)")).toEqual([
      { href: "https://doi.org/10.1063/1.459170", text: "the Tully paper", target: "_blank", rel: "noopener noreferrer" },
    ]);
    expect(p.querySelector("a")!.className).toBe("nx-link");
  });

  test("keeps one level of brackets in its address", () => {
    expect(links("[the article](https://en.wikipedia.org/wiki/Conical_intersection_(chemistry))")[0].href)
      .toBe("https://en.wikipedia.org/wiki/Conical_intersection_(chemistry)");
  });

  test("may be a mailto address", () => {
    expect(links("Ask [Ada](mailto:ada@example.org).")[0].href).toBe("mailto:ada@example.org");
  });

  test("with any other scheme stays the literal text, and is no link", () => {
    for (const text of [
      "[click to fix the build](javascript:fetch('/api'))",
      "[a picture](data:text/html;base64,PHNjcmlwdD4=)",
      "[the chapter](chapters/one.tex)",
      "[a file](file:///etc/passwd)",
      "[shouting](JAVASCRIPT:alert(1))",
    ]) {
      const p = render(text);
      expect(p.querySelector("a"), text).toBeNull();
      expect(p.textContent).toBe(text);
    }
  });
});

describe("a bare address", () => {
  test("is a link to itself", () => {
    expect(links("see https://doi.org/10.1063/1.1376633 for it")).toEqual([
      { href: "https://doi.org/10.1063/1.1376633", text: "https://doi.org/10.1063/1.1376633", target: "_blank", rel: "noopener noreferrer" },
    ]);
  });

  test("gives back the stop, the comma and a bracket it did not open", () => {
    expect(render("It is at https://example.org/a.").textContent).toBe("It is at https://example.org/a.");
    expect(links("It is at https://example.org/a.")[0].href).toBe("https://example.org/a");
    expect(links("(see https://example.org/b), then")[0].href).toBe("https://example.org/b");
    expect(links("https://en.wikipedia.org/wiki/Tully_(surname).")[0].href)
      .toBe("https://en.wikipedia.org/wiki/Tully_(surname)");
  });

  test("with underscores is not read as italic", () => {
    expect(links("https://example.org/a_b_c")[0].href).toBe("https://example.org/a_b_c");
    expect(render("https://example.org/a_b_c").querySelector("em")).toBeNull();
  });

  test("only http and https: a bare javascript: is text", () => {
    const p = render("javascript:alert(1) and www.example.org");
    expect(p.querySelector("a")).toBeNull();
  });
});

describe("the spans around a link", () => {
  test("code wins: an address in backticks stays code", () => {
    const p = render("Run `curl https://example.org/x` first.");
    expect(p.querySelector("a")).toBeNull();
    expect(p.querySelector("code")!.textContent).toBe("curl https://example.org/x");
  });

  test("bold and italic still work beside a link", () => {
    const p = render("**Read** [this](https://example.org) *now*.");
    expect(p.querySelector("strong")!.textContent).toBe("Read");
    expect(p.querySelector("em")!.textContent).toBe("now");
    expect(p.querySelector("a")!.textContent).toBe("this");
  });

  test("two links in one sentence are two links", () => {
    expect(links("[one](https://a.example) and https://b.example.").map((l) => l.href))
      .toEqual(["https://a.example", "https://b.example"]);
  });
});
