import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";
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
  await tab.getByTestId("settings-group-write").click();
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
    "\\usepackage{amsmath} \\cite{Vellacourt2011} \\label{sec:intro} spellling",
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

test("spell checking comes back after a reload without being asked again", async ({ tab }) => {
  // The setting survived a reload and the checker did not.  Every fresh
  // editor state starts with an empty spelling compartment, and after a
  // reload the setting and the word list had both settled before the file
  // finished opening, so nothing re-ran the effect that fills it: the
  // sheet said on, the page marked nothing, and only switching it off and
  // on again brought the underlines back.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "The results are wiht the calculation.");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });

  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(marked(tab)).toHaveText(["wiht"], { timeout: 20_000 });
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


test("the menu can be opened, walked and closed without a mouse", async ({ tab }) => {
  // R-070. It claimed `role="menu"` and a keyboard user met nothing at
  // all. Focus never entered it, so an arrow key moved the caret in the
  // document behind the backdrop while the menu stayed put over a page
  // that was now scrolling underneath it. Escape did nothing, because the
  // dismissal was a pointer-only backdrop. And it could not be opened
  // from the keyboard in the first place: Shift-F10 fires `contextmenu`
  // on the content element rather than on the word, so the handler's test
  // for a misspelled ancestor failed. A screen reader was being told
  // "menu, one item" about something only a mouse could reach and only a
  // mouse could close.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "The results are wiht the calculation.");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });

  // The caret goes into the word first, which is where somebody would
  // have put it before reaching for the menu key. A left click only
  // places the caret; it is the menu that had no keyboard route, not the
  // caret.
  await marked(tab).first().click();

  await tab.keyboard.press("Shift+F10");
  const menu = tab.getByTestId("spelling-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();

  await tab.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(tab.locator(".cm-content")).toBeFocused();
});

test("a typo is offered the word it was meant to be", async ({ tab }) => {
  // R-091. The menu had one item, "Add to the dictionary", which is the
  // right answer for a surname and the wrong one for a typo. A typo is the
  // common case, and adding a typo to the dictionary is the one outcome
  // nobody wants.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "The results are recieved today.");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });

  await marked(tab).first().click({ button: "right" });
  await tab.getByTestId("spelling-menu").waitFor();
  const guess = tab.getByRole("menuitem", { name: "received", exact: true });
  await expect(guess).toBeVisible();

  await guess.click();
  await expect(tab.locator(".cm-content")).toContainText("are received today");
  await expect(marked(tab)).toHaveCount(0);
});

test("a word nothing is like is offered the dictionary and nothing else", async ({
  tab,
}) => {
  // The other half. A column of wrong guesses above the item that is the
  // right answer would be in the way of it.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "The zqxjvkw dissociates.");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });

  await marked(tab).first().click({ button: "right" });
  await tab.getByTestId("spelling-menu").waitFor();
  // No guesses: Ignore for now, for this sitting, and Add, for good.
  await expect(tab.getByRole("menuitem")).toHaveText(["Ignore for now", /Add/]);
});

test("Ignore for now takes the underline away until the page is reloaded", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "The zqxjvkw dissociates.");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  await marked(tab).first().click({ button: "right" });
  await tab.getByTestId("ignore-for-now").click();
  await expect(marked(tab)).toHaveCount(0);
  // Nothing was kept: a reload brings it back.
  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
});

test("a word added by mistake can be taken back", async ({ tab }) => {
  // `DELETE /dictionary` and `api.forgetWord` both existed and nothing
  // called either, so a slip of the hand was permanent for the life of the
  // project: the underline was gone and there was no way to ask for it
  // back.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "The nitrophenol dissociates.");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  await marked(tab).first().click({ button: "right" });
  await tab.getByTestId("spelling-menu").waitFor();
  await tab.getByRole("menuitem", { name: /Add/ }).click();
  await expect(marked(tab)).toHaveCount(0);

  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("settings-group-write").click();
  await expect(tab.getByText("Words you added")).toBeVisible();
  await tab.getByRole("button", { name: "Forget nitrophenol" }).click();
  await expect(tab.getByText("Words you added")).toHaveCount(0);
  await tab.keyboard.press("Escape");

  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
});

/** The menu's look, which is a furniture card like every other menu.
 *
 *  It used to follow the page: painted in the editor's own --surface-2,
 *  which on a white page is one step from white.  The writer's report was
 *  that on every light ground it blended into the page, its hovered and
 *  focused row could not be seen, and it did not look like the app's other
 *  menus.  So now it is the dark card those menus are, on every ground.
 */
const luminance = (colour: string) => {
  const [r, g, b] = colour.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const settled = (el: Element) =>
  Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined);
const background = (el: Element) => getComputedStyle(el).backgroundColor;

async function openMenuOn(tab: Page, sentence: string) {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, sentence);
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  await marked(tab).first().click({ button: "right" });
  const menu = tab.getByTestId("spelling-menu");
  await menu.waitFor();
  await menu.evaluate(settled);
  return menu;
}

// The menu is the shell's, not the page's.  It used to be furniture, a
// dark card whatever the theme; the overhaul's rule is that a card opened
// inside the editor takes the shell's palette explicitly, so on a light
// shell it is a light card with dark text even over a white page, and on
// a dark shell it is a dark card with light text even over a white page.
// Either way it is never the page's own palette, which is what painted a
// pale card on a pale page once.
for (const ground of [
  { theme: "light", editor: "white", dark: false },
  { theme: "light", editor: "match", dark: false },
  { theme: "dark", editor: "white", dark: true },
]) {
  test(`the menu takes the shell's palette (${ground.theme} shell, ${ground.editor} page)`, async ({
    tab,
  }) => {
    await tab.getByTestId("appearance").first().click();
    await tab.getByTestId(`theme-${ground.theme}`).click();
    await tab.getByTestId(`editor-theme-${ground.editor}`).click();
    await tab.keyboard.press("Escape");
    const menu = await openMenuOn(tab, "The results are recieved today.");

    const card = luminance(await menu.evaluate(background));
    const text = luminance(
      await menu.getByRole("menuitem").first().evaluate((el) => getComputedStyle(el).color),
    );
    if (ground.dark) {
      expect(card, "the card is not dark").toBeLessThan(0.2);
      expect(text, "the text is not light").toBeGreaterThan(0.5);
    } else {
      expect(card, "the card is not light").toBeGreaterThan(0.5);
      expect(text, "the text is not dark").toBeLessThan(0.2);
    }
    // And the page behind it is light in every case here.
    const page = luminance(await tab.locator(".cm-editor").evaluate(background));
    expect(page).toBeGreaterThan(0.5);
  });
}

test("the current row is visible from the moment the menu opens", async ({ tab }) => {
  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("theme-light").click();
  await tab.keyboard.press("Escape");
  const menu = await openMenuOn(tab, "The results are recieved today.");
  const items = menu.getByRole("menuitem");
  // A row at rest paints nothing of its own; the card shows through.
  const rest = "rgba(0, 0, 0, 0)";

  // Focus is placed programmatically after a mouse gesture, which no
  // browser paints as focus-visible, so the row has to paint itself.
  await expect(items.first()).toBeFocused();
  expect(await items.first().evaluate(background)).not.toBe(rest);
  expect(await items.nth(1).evaluate(background)).toBe(rest);

  await tab.keyboard.press("ArrowDown");
  expect(await items.first().evaluate(background)).toBe(rest);
  expect(await items.nth(1).evaluate(background)).not.toBe(rest);

  // The pointer and the keyboard move the same highlight: hovering the
  // last item is what a person does before clicking it, and two lit rows
  // would say two things are about to happen.
  await items.last().hover();
  await expect(items.last()).toBeFocused();
  expect(await items.nth(1).evaluate(background)).toBe(rest);
  expect(await items.last().evaluate(background)).not.toBe(rest);
});

test("the menu opens upwards near the foot of the pane", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  // Enough lines that the last one sits at the foot of the pane, and a
  // misspelling on it.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+a");
  await tab.keyboard.type("A line.\n".repeat(60) + "The results are recieved today.\n");
  await tab.keyboard.press("Control+End");
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  // Scroll so the misspelled line is the last visible one.
  await marked(tab).first().evaluate((el) => el.scrollIntoView({ block: "end" }));
  await marked(tab).first().click({ button: "right" });
  const menu = tab.getByTestId("spelling-menu");
  await menu.waitFor();
  await menu.evaluate(settled);
  const box = (await menu.boundingBox())!;
  const host = (await tab.locator(".cm-editor").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(host.y + host.height + 1);
  expect(box.y).toBeGreaterThanOrEqual(host.y - 1);
});

test("the menu opens beside the word at a larger interface size", async ({ tab }) => {
  // The pointer position is read in viewport pixels and the menu's `left`
  // is written inside the zoomed shell, and at 100% nobody can tell the two
  // apart.  At 150% a menu placed from the raw reading opened half again
  // as far from the word as the pointer was.
  await tab.evaluate(() => window.localStorage.setItem("nexttex.ui.scale", "150"));
  await tab.reload();
  const menu = await openMenuOn(tab, "The results are recieved today.");
  const word = (await marked(tab).first().boundingBox())!;
  const box = (await menu.boundingBox())!;
  // Within the word's own width to the right of where it starts, and just
  // below it: the pointer landed in its middle.
  expect(box.x).toBeGreaterThanOrEqual(word.x - 2);
  expect(box.x).toBeLessThanOrEqual(word.x + word.width + 2);
  expect(box.y).toBeGreaterThanOrEqual(word.y - 2);
  expect(box.y).toBeLessThanOrEqual(word.y + word.height + 2);
});


/** Which English.
 *
 *  The one list accepted both spellings of every word, so a thesis written
 *  in British English was underlined from end to end before the fix and
 *  never told `color` from `colour` after it.  The variety is a setting
 *  now, and the default follows the document's own preamble.
 */
async function pickVariety(tab: Page, id: "variety-follow" | "variety-british" | "variety-american") {
  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("settings-group-write").click();
  await tab.getByTestId(id).click();
  await tab.keyboard.press("Escape");
}

test("colour is British and color is American, and the setting says which", async ({ tab }) => {
  await turnOn(tab);
  await type(tab, "The colour of the color.");
  // With nothing chosen and a template that declares no English, both
  // spellings pass: half the literature a thesis cites is American.
  await expect(marked(tab)).toHaveCount(0, { timeout: 15_000 });
  await pickVariety(tab, "variety-british");
  await expect(marked(tab)).toHaveText(["color"], { timeout: 15_000 });
  await pickVariety(tab, "variety-american");
  await expect(marked(tab)).toHaveText(["colour"], { timeout: 15_000 });
  await pickVariety(tab, "variety-follow");
  await expect(marked(tab)).toHaveCount(0, { timeout: 15_000 });
});

test("the document's own preamble chooses the variety", async ({ app, project, page }) => {
  // A thesis that says \usepackage[british]{babel} is checked as British
  // for everyone who opens it, with nobody setting anything.  Written
  // before the project opens, since the answer travels with the symbol
  // table on open; the sentence is typed below the preamble rather than
  // over it.
  writeFileSync(
    join(project.root, "main.tex"),
    "\\documentclass{article}\n\\usepackage[british]{babel}\n\\begin{document}\nA start.\n\\end{document}\n",
  );
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  await page.keyboard.type("\nThe colour of the color.");
  await expect(marked(page)).toHaveText(["color"], { timeout: 15_000 });
});

/** A German list small enough to write here, planted where the server
 *  keeps the copy it fetched once, so nothing reaches the network. The
 *  REP line is how Hunspell learns that "sz" is a way of typing "ß". */
function plantGerman(sandbox: string) {
  const folder = join(sandbox, "data", "nexttex", "dictionaries", "dictionary-de@3.0.0");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "index.aff"), "SET UTF-8\nTRY esnrtaoduiölcüähgmbfkzwpvjyxqß\nREP 1\nREP sz ß\n");
  writeFileSync(join(folder, "index.dic"), "6\nDie\nHäuser\nsind\ngroß\nund\nalt\n");
}

test("a German project is checked in German, with the preamble's suggestion", async ({
  app, project, page,
}) => {
  // Written before the project opens, since the preamble's language
  // travels with the symbol table on open and after each build.
  plantGerman(app.sandbox);
  writeFileSync(
    join(project.root, "main.tex"),
    "\\documentclass{article}\n\\usepackage[ngerman]{babel}\n\\begin{document}\nDie Häuser sind grosz und alt.\n\\end{document}\n",
  );
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  const tab = page;
  await expect(tab.locator(".cm-line", { hasText: "Häuser" })).toBeVisible({ timeout: 30_000 });

  // The row says what the preamble suggests before anybody chooses.
  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("settings-group-project").click();
  await expect(tab.getByText("Suggested by")).toContainText("\\usepackage[ngerman]{babel}", { timeout: 15_000 });
  await expect(tab.getByTestId("language-de")).toHaveAttribute("aria-pressed", "true");
  await tab.keyboard.press("Escape");

  await turnOn(tab);
  // "Häuser" is one word, in the list; "grosz" is not.
  await expect(marked(tab).first()).toBeVisible({ timeout: 20_000 });
  await expect(marked(tab)).toHaveText(["grosz"]);

  await marked(tab).first().click({ button: "right" });
  const menu = tab.getByTestId("spelling-menu");
  await menu.waitFor();
  await expect(menu).toContainText("groß");
});

test("choosing English over the preamble's German is kept in the project", async ({
  app, project, tab,
}) => {
  plantGerman(app.sandbox);
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({
      path: "main.tex",
      text: "\\documentclass{article}\n\\usepackage[ngerman]{babel}\n\\begin{document}\nThe results are wiht the calculation.\n\\end{document}\n",
      compile: false,
    }),
  });
  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("settings-group-project").click();
  await tab.getByTestId("language-en").click();
  await expect(tab.getByText("Suggested by")).toHaveCount(0);
  await tab.keyboard.press("Escape");
  await expect.poll(() => readFileSync(join(project.root, "nexttex.toml"), "utf8")).toContain('language = "en"');

  await turnOn(tab);
  await expect(marked(tab)).toHaveText(["wiht"], { timeout: 20_000 });
});
