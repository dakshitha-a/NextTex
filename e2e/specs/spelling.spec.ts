import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Spell checking the prose, and only the prose.
 *
 *  The feature stands or falls on what it does *not* underline.  A LaTeX
 *  file is mostly not English -- package names, citation keys, labels,
 *  environments -- and a checker that marks those teaches the writer to
 *  ignore every mark it makes, which is worse than having none.
 */

async function turnOn(tab: Page) {
  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("spelling-on").click();
  await tab.keyboard.press("Escape");
}

/** Replace the document, rather than adding to it.
 *
 *  The template this project is seeded from is prose too, and perfectly
 *  capable of containing a word the list has never heard of.  These tests
 *  are about which words are marked, so the document has to be only the
 *  line under test. */
async function type(tab: Page, text: string) {
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+a");
  await tab.keyboard.type(text + "\n");
}

const marked = (tab: Page) => tab.locator(".nx-misspelled");

test("a misspelled word is underlined once the checker is on", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await type(tab, "The results are wiht the calculation.");
  // Nothing is marked while it is off, and no word list has been fetched.
  await expect(marked(tab)).toHaveCount(0);

  await turnOn(tab);
  // The list is a lazy chunk, so the first marks arrive after it lands.
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  await expect(marked(tab)).toHaveText(["wiht"]);
});

test("the parts of a file that are not English are left alone", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(
    tab,
    "\\usepackage{amsmath} \\cite{Matsika2011} \\label{sec:intro} spellling",
  );
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  // The one real misspelling, and nothing else on a line that is otherwise
  // four commands and their keys.
  await expect(marked(tab)).toHaveText(["spellling"]);
});

test("a heading is prose and is checked", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "\\section{Teh motivation}");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  await expect(marked(tab)).toHaveText(["Teh"]);
});

test("a word the writer accepts stops being underlined, for good", async ({
  tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "The nitrophenol dissociates.");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  await expect(marked(tab)).toHaveText(["nitrophenol"]);

  // The right button, not the left: the left one places the caret, and a
  // word does not stop being editable because it is underlined.
  await marked(tab).first().click({ button: "right" });
  await tab.getByTestId("spelling-menu").waitFor();
  await tab.getByRole("menuitem", { name: /Add/ }).click();
  await expect(marked(tab)).toHaveCount(0);

  // And it is the project that remembers, not the tab.
  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.waitForTimeout(2500);
  await expect(marked(tab)).toHaveCount(0);
});

test("turning it off takes every mark away", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "A sentance with a mistake.");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });

  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("spelling-off").click();
  await tab.keyboard.press("Escape");
  await expect(marked(tab)).toHaveCount(0);
});

test("a displayed equation is not prose, however many lines it runs to", async ({
  tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  // `\text{}` inside an equation is a label, and `rnge` inside a listing is
  // code.  Neither is English, and neither ends on the line it started on,
  // which is what a per-line scan cannot see.
  await type(
    tab,
    "A sentance first.\n\\begin{align}\n  x &= \\text{teh thing}\n\\end{align}\n",
  );
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  await expect(marked(tab)).toHaveText(["sentance"]);
});

test("turning spelling off and on again brings the underlines back", async ({
  tab,
}) => {
  // R-068. The compartment holding the checker is per editor state, and
  // turning the setting off empties it. Turning it on again took the
  // branch that says "the module is already loaded, nothing to
  // reconfigure", because that question was asked of a module-level ref
  // rather than of the state, and dispatched the settings into a state
  // with no spelling field. The underlines never came back, on any tab,
  // for the rest of the session.
  await type(tab, "This sentance is wrong.");
  await turnOn(tab);
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });

  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("spelling-off").click();
  await tab.keyboard.press("Escape");
  await expect(marked(tab)).toHaveCount(0, { timeout: 20_000 });

  await turnOn(tab);

  await expect(
    marked(tab).first(),
    "the underlines did not come back after switching it off and on",
  ).toBeVisible({ timeout: 20_000 });
});
