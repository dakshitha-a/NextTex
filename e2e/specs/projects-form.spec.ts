import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

/** The four ways in, and the one sheet they share.
 *
 *  New project is the one filled button on the screen; the other three
 *  sit behind "Other ways in", each with a line saying what it does; and
 *  all four open the same sheet with their own field and copy. A field
 *  in the sheet is the kit's, and the folder is typed or browsed.
 */

type Way = "create" | "add" | "join" | "bring";
const WAY_ITEMS: Record<Way, string> = {
  create: "New project",
  add: "Open a folder",
  join: "Join a shared project",
  bring: "Bring one from elsewhere",
};

async function openWay(page: Page, way: Way) {
  if (way === "create") {
    await page.getByTestId("new-project").click();
  } else {
    await page.getByTestId("ways-open").click();
    await page.getByTestId("ways-menu").getByRole("menuitem", { name: new RegExp(WAY_ITEMS[way]) }).click();
  }
  const sheet = page.getByTestId("way-form");
  await expect(sheet).toBeVisible();
  return sheet;
}

test("no field in the sheet is shorter than the control it says it is", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();

  const short: string[] = [];
  for (const way of ["create", "add", "join", "bring"] as const) {
    const sheet = await openWay(page, way);
    await page.waitForTimeout(200);
    for (const fault of await sheet.evaluate((root) => {
      const out: { tag: string; place: string; height: number }[] = [];
      const drawn = (s: CSSStyleDeclaration) =>
        s.borderTopWidth !== "0px" ||
        s.boxShadow !== "none" ||
        (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent");
      for (const el of root.querySelectorAll<HTMLElement>("input, textarea, button, .nx-field")) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.display === "none") continue;
        // Only controls that draw a box: a field or a filled button has a
        // size it is supposed to be. An input inside the kit's field draws
        // nothing itself; the field around it is what is measured.
        if (el.tagName === "INPUT" && el.closest(".nx-field")) continue;
        if (!drawn(style)) continue;
        if (box.height >= 24) continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          place: (el.getAttribute("placeholder") ?? el.textContent ?? "").trim().slice(0, 40),
          height: Math.round(box.height),
        });
      }
      return out;
    })) {
      short.push(`${way}: ${fault.tag} "${fault.place}" is ${fault.height}px`);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  }
  expect(short, short.join("\n")).toEqual([]);
});

test("the sheet carries each way's own field and copy, and its title", async ({ app, page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();

  let sheet = await openWay(page, "create");
  await expect(sheet.getByRole("heading", { name: "New project" })).toBeVisible();
  await expect(sheet.getByPlaceholder("What is it called?")).toBeFocused();
  await expect(sheet.getByRole("button", { name: "Create project" })).toBeVisible();
  await page.keyboard.press("Escape");

  sheet = await openWay(page, "add");
  await expect(sheet.getByRole("heading", { name: "Open a folder" })).toBeVisible();
  await expect(sheet).toContainText("Nothing is copied or moved.");
  await expect(sheet.getByPlaceholder("/path/to/your/writing/project")).toBeFocused();
  await expect(sheet.getByRole("button", { name: "Open folder" })).toBeVisible();
  await page.keyboard.press("Escape");

  sheet = await openWay(page, "bring");
  await expect(sheet.getByTestId("bring-source")).toBeVisible();
  await expect(sheet.getByTestId("bring-choose-zip")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Bring it" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("the invite box and the folder beneath it are one pair", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const sheet = await openWay(page, "join");

  const measured = await sheet.evaluate((root) => {
    const area = root.querySelector<HTMLElement>('[data-testid="invite-input"]')!;
    const field = [...root.querySelectorAll<HTMLInputElement>("input")].find(
      (el) => (el.placeholder ?? "").includes("A folder to put it in"),
    )!.closest(".nx-field")!;
    const browse = root.querySelector<HTMLElement>('[data-testid="browse-folder"]')!;
    const a = area.getBoundingClientRect();
    const b = field.getBoundingClientRect();
    const c = browse.getBoundingClientRect();
    return {
      sameLeft: Math.round(a.x) === Math.round(b.x),
      sameRight: Math.round(a.right) === Math.round(c.right),
      field: Math.round(b.height),
      invite: Math.round(a.height),
    };
  });

  // One left edge and one right edge: they are two halves of one answer,
  // not two controls that happen to be near each other.  The folder's row
  // ends in Browse, so the right edge is the button's.
  expect(measured.sameLeft, "the two boxes do not share a left edge").toBe(true);
  expect(measured.sameRight, "the folder's row does not end where the invite does").toBe(true);
  // The path is one line and the invite is a paste target, so they are not
  // the same height, but the path is a full control, the kit's 32 px field.
  expect(measured.field).toBe(32);
  expect(measured.invite).toBeGreaterThan(measured.field);
});

test("a new project can start as something other than an article", async ({
  app,
  page,
}) => {
  // R-096. `GET /api/templates` lists the directories under
  // `nexttex/templates`, and nothing fetched it: both callers of
  // `loadTemplate` passed no name, so the parameter never carried anything
  // and every project anyone made was an article.
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const sheet = await openWay(page, "create");

  // The templates as a segmented control, in the words somebody choosing
  // one would use.
  const choice = sheet.getByTestId("template-choice");
  await expect(choice).toBeVisible();
  await expect(choice.getByRole("button")).toHaveText([
    "An article",
    "A talk",
    "A letter",
    "A report, in chapters",
  ]);

  const where = `${app.projects}/started-as-a-talk`;
  await sheet.getByTestId("template-beamer").click();
  await expect(sheet.getByTestId("template-beamer")).toHaveAttribute("aria-pressed", "true");
  await sheet.getByPlaceholder(/Where to put it/).fill(where);
  await sheet.getByRole("button", { name: "Create project" }).click();

  // It opens on what it was started from.
  await expect(page.locator(".cm-content")).toContainText("documentclass", {
    timeout: 20_000,
  });
  await expect(page.locator(".cm-content")).toContainText("beamer");
});

test("a new project's folder can be browsed for, and goes under the picked one", async ({
  app,
  page,
}) => {
  // Asked for by the writer: a Browse button for "where", so the folder is
  // chosen on the machine's disk rather than typed.  For a new project the
  // picked folder is the parent, and the project's own folder goes under
  // it, named from the title.
  const writing = join(app.projects, "writing");
  mkdirSync(join(writing, "alpha"), { recursive: true });
  mkdirSync(join(writing, "beta"), { recursive: true });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const sheet = await openWay(page, "create");

  await sheet.getByPlaceholder("What is it called?").fill("My Paper");
  // The walk opens on what the field says when that is a folder.
  await sheet.getByPlaceholder(/Where to put it/).fill(writing);
  const browse = sheet.getByTestId("browse-folder");
  await browse.click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId("picker-path")).toHaveValue(writing);
  await expect(picker.getByRole("button", { name: "alpha" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "beta" })).toBeVisible();

  // Into alpha, and picking it fills the field with the project's own
  // folder under it, named from the title.
  await picker.getByRole("button", { name: "alpha" }).click();
  await expect(picker.getByTestId("picker-path")).toHaveValue(join(writing, "alpha"));
  await picker.getByTestId("pick-folder").click();
  await expect(picker).toHaveCount(0);
  await expect(sheet.getByPlaceholder(/Where to put it/)).toHaveValue(
    join(writing, "alpha", "my-paper"),
  );
  await sheet.getByRole("button", { name: "Create project" }).click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 20_000 });
});

test("with no title yet the picked folder is left for the writer to finish", async ({
  app,
  page,
}) => {
  const writing = join(app.projects, "writing");
  mkdirSync(writing, { recursive: true });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const sheet = await openWay(page, "create");
  await sheet.getByPlaceholder(/Where to put it/).fill(writing);
  await sheet.getByTestId("browse-folder").click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker.getByTestId("picker-path")).toHaveValue(writing);
  await picker.getByTestId("pick-folder").click();
  // A trailing slash, and the caret at its end in the focused field.
  const where = sheet.getByPlaceholder(/Where to put it/);
  await expect(where).toHaveValue(`${writing}/`);
  await expect(where).toBeFocused();
  const caret = await where.evaluate((el: HTMLInputElement) => el.selectionStart);
  expect(caret).toBe(writing.length + 1);
});

test("an existing project's folder can be browsed for and opened", async ({
  app,
  page,
}) => {
  const existing = join(app.projects, "existing");
  mkdirSync(existing, { recursive: true });
  writeFileSync(
    join(existing, "main.tex"),
    "\\documentclass{article}\\begin{document}Browsed.\\end{document}\n",
  );
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const sheet = await openWay(page, "add");

  // Nothing typed: the walk opens on home, and the path box takes a paste
  // to jump, as the papers chooser's does.
  await sheet.getByTestId("browse-folder").click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker).toContainText("Which folder holds it?");
  await picker.getByTestId("picker-path").fill(app.projects);
  await page.keyboard.press("Enter");
  await picker.getByRole("button", { name: "existing" }).click();
  await expect(picker.getByTestId("picker-path")).toHaveValue(existing);
  await picker.getByRole("button", { name: "Use this folder" }).click();
  await expect(sheet.getByPlaceholder("/path/to/your/writing/project")).toHaveValue(existing);

  await sheet.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".cm-content")).toContainText("Browsed.", {
    timeout: 20_000,
  });
});

test("on a phone the picker opens over the sheet and stays on the screen", async ({
  app,
  page,
}) => {
  const writing = join(app.projects, "writing");
  for (const name of ["a", "b", "c", "d", "e", "f"]) mkdirSync(join(writing, name), { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  const sheet = await openWay(page, "create");
  await sheet.getByPlaceholder(/Where to put it/).fill(writing);
  await sheet.getByTestId("browse-folder").click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker.getByRole("button", { name: "f" })).toBeVisible();
  // Measured once the folders are in, not before: the card grew after it
  // was placed and its footer used to sit below the bottom of the phone.
  const box = (await picker.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await expect(picker.getByTestId("pick-folder")).toBeInViewport();
  // Escape closes the picker and leaves the sheet.
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(sheet).toBeVisible();
});

test("Escape closes the picker and nothing else", async ({ app, page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const sheet = await openWay(page, "create");
  const browse = sheet.getByTestId("browse-folder");
  await browse.click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(browse).toBeFocused();
  await expect(sheet.getByPlaceholder(/Where to put it/)).toHaveValue("");
});
