import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** The three ways in, and the fields they offer.
 *
 *  Nothing covered the join tab at all, and it carried a control collapsed
 *  to two thirds of the height its own class asked for: the field sits in a
 *  container that becomes `flex-col` in that one mode, and `flex-1` in a
 *  column is a rule about height, so a basis of 0 beat `h-[28px]` and the
 *  box shrank to the 17px of its text. The other two tabs lay the same
 *  container out as a row, where `flex-1` means width, which is why it
 *  showed nowhere else.
 *
 *  Height rather than appearance, deliberately: a screenshot of this is a
 *  judgement call about whether one box looks short beside another, and the
 *  number is not.
 */

const TABS = [
  "Start something new",
  "Point at a folder",
  "Join a shared project",
] as const;

test("no field on the projects screen is shorter than the control it says it is", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();

  const short: string[] = [];
  for (const tab of TABS) {
    await page.getByRole("button", { name: tab }).click();
    await page.waitForTimeout(200);
    for (const fault of await page.evaluate(() => {
      const out: { tag: string; place: string; height: number }[] = [];
      const drawn = (s: CSSStyleDeclaration) =>
        s.borderTopWidth !== "0px" ||
        (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent");
      for (const el of document.querySelectorAll<HTMLElement>(
        "input, textarea, button",
      )) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.display === "none") continue;
        // Only controls that draw a box.  Half this screen's buttons are
        // plain text links -- "Check again", "I'm the only one here" -- and
        // those are the height of their words on purpose.  A field or a
        // filled button is a box, and a box has a size it is supposed to be.
        if (!drawn(style)) continue;
        // 24px is under every boxed control this app draws -- rows and
        // buttons are 26 or 28 -- so anything below it has been squashed by
        // its container rather than designed that way.
        if (box.height >= 24) continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          place: (el.getAttribute("placeholder") ?? el.textContent ?? "").trim().slice(0, 40),
          height: Math.round(box.height),
        });
      }
      return out;
    })) {
      short.push(`${tab}: ${fault.tag} "${fault.place}" is ${fault.height}px`);
    }
  }
  expect(short, short.join("\n")).toEqual([]);
});

test("the three ways in are tiles, and the form is under all of them", async ({
  app, page,
}) => {
  // They were a stacked list with the chosen one unfolded in place, so
  // the two closed ones sat under the Create button and read as its
  // children, and a text label did not say "press me".  One row now,
  // the chosen tile filled, the form under the row whichever is chosen.
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();

  const tiles = TABS.map((name) => page.getByRole("button", { name }));
  const boxes = await Promise.all(tiles.map((tile) => tile.boundingBox()));
  for (const box of boxes) {
    expect(box!.y).toBe(boxes[0]!.y);
    expect(box!.width).toBeLessThanOrEqual(90);
  }
  const bottom = Math.max(...boxes.map((box) => box!.y + box!.height));
  const nameField = await page.getByPlaceholder("What is it called?").boundingBox();
  expect(nameField!.y).toBeGreaterThan(bottom);
  await expect(tiles[0]).toHaveAttribute("aria-pressed", "true");
  await expect(tiles[2]).toHaveAttribute("aria-pressed", "false");

  // Choosing Join fills its tile and puts its form under the row, not
  // between the tiles.
  await tiles[2].click();
  await expect(tiles[2]).toHaveAttribute("aria-pressed", "true");
  await expect(tiles[0]).toHaveAttribute("aria-pressed", "false");
  const invite = await page.getByTestId("invite-input").boundingBox();
  expect(invite!.y).toBeGreaterThan(bottom);
  await tiles[0].click();
  const back = await page.getByPlaceholder("What is it called?").boundingBox();
  expect(back!.y).toBeGreaterThan(bottom);

  // Pointed at, a closed tile answers in the hint colour.
  const hint = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--hint)";
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  await tiles[1].hover();
  await expect(tiles[1]).toHaveCSS("border-color", hint);
});

test("the invite box and the folder beneath it are one pair", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "Join a shared project" }).click();

  const measured = await page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('[data-testid="invite-input"]')!;
    const field = [...document.querySelectorAll<HTMLInputElement>("input")].find(
      (el) => (el.placeholder ?? "").includes("A folder to put it in"),
    )!;
    const browse = document.querySelector<HTMLElement>('[data-testid="browse-folder"]')!;
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
  // ends in Browse now, so the right edge is the button's.
  expect(measured.sameLeft, "the two boxes do not share a left edge").toBe(true);
  expect(measured.sameRight, "the folder's row does not end where the invite does").toBe(true);
  // The path is one line and the invite is a paste target, so they are not
  // the same height -- but the path is a full control, not a slot.
  expect(measured.field).toBe(28);
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

  const choice = page.getByTestId("template-choice");
  await expect(choice).toBeVisible();
  await expect(choice.getByRole("option")).toHaveText([
    "An article",
    "A talk",
    "A letter",
    "A report, in chapters",
  ]);

  const where = `${app.projects}/started-as-a-talk`;
  await choice.selectOption("beamer");
  await page.getByPlaceholder(/Where to put it/).fill(where);
  await page.getByRole("button", { name: "Create project" }).click();

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

  await page.getByPlaceholder("What is it called?").fill("My Paper");
  // The walk opens on what the field says when that is a folder.
  await page.getByPlaceholder(/Where to put it/).fill(writing);
  const browse = page.getByTestId("browse-folder");
  await browse.click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("Which folder should it go in?");
  await expect(picker.getByTestId("picker-path")).toHaveValue(writing);
  await expect(picker.getByRole("button", { name: "alpha" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "beta" })).toBeVisible();

  // Descend, then commit: two gestures, since the tree is mostly unseen.
  await picker.getByRole("button", { name: "alpha" }).click();
  await expect(picker.getByTestId("picker-path")).toHaveValue(join(writing, "alpha"));
  await picker.getByTestId("pick-folder").click();
  await expect(picker).toHaveCount(0);
  const where = page.getByPlaceholder(/Where to put it/);
  await expect(where).toHaveValue(join(writing, "alpha", "my-paper"));
  await expect(browse).toBeFocused();

  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.locator(".cm-content")).toContainText("documentclass", {
    timeout: 20_000,
  });
  expect(existsSync(join(writing, "alpha", "my-paper", "main.tex"))).toBe(true);
});

test("with no title yet the picked folder is left for the writer to finish", async ({
  app,
  page,
}) => {
  const writing = join(app.projects, "writing");
  mkdirSync(writing, { recursive: true });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.getByPlaceholder(/Where to put it/).fill(writing);
  await page.getByTestId("browse-folder").click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker.getByTestId("picker-path")).toHaveValue(writing);
  await picker.getByTestId("pick-folder").click();
  // A trailing slash, and the caret at its end in the focused field.
  const where = page.getByPlaceholder(/Where to put it/);
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
  await page.getByRole("button", { name: "Point at a folder" }).click();

  // Nothing typed: the walk opens on home, and the path box takes a paste
  // to jump, as the papers chooser's does.
  await page.getByTestId("browse-folder").click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker).toContainText("Which folder holds it?");
  await picker.getByTestId("picker-path").fill(app.projects);
  await page.keyboard.press("Enter");
  await picker.getByRole("button", { name: "existing" }).click();
  await expect(picker.getByTestId("picker-path")).toHaveValue(existing);
  await picker.getByRole("button", { name: "Use this folder" }).click();
  await expect(page.getByPlaceholder("/path/to/your/writing/project")).toHaveValue(existing);

  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".cm-content")).toContainText("Browsed.", {
    timeout: 20_000,
  });
});

test("on a phone the picker opens inside the drawer and stays on the screen", async ({
  app,
  page,
}) => {
  const writing = join(app.projects, "writing");
  for (const name of ["a", "b", "c", "d", "e", "f"]) mkdirSync(join(writing, name), { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  await page.getByTestId("ways-open").click();
  await page.getByPlaceholder(/Where to put it/).fill(writing);
  await page.getByTestId("browse-folder").click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker.getByRole("button", { name: "f" })).toBeVisible();
  // Measured once the folders are in, not before: the card grew after it
  // was placed and its footer used to sit below the bottom of the phone.
  const box = (await picker.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await expect(picker.getByTestId("pick-folder")).toBeInViewport();
  // Escape closes the picker and leaves the drawer.
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Ways in" })).toBeVisible();
});

test("Escape closes the picker and nothing else", async ({ app, page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const browse = page.getByTestId("browse-folder");
  await browse.click();
  const picker = page.getByTestId("folder-picker");
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(browse).toBeFocused();
  await expect(page.getByPlaceholder(/Where to put it/)).toHaveValue("");
});
