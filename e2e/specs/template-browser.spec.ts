import AxeBuilder from "@axe-core/playwright";
import { test as base, expect as baseExpect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { ROOT, startServer } from "../server";

/** The New project sheet's Start from, and the browser Change opens.
 *
 *  The chosen template is one block with Change at its end; Change turns
 *  the sheet into a field over kind chips over a list grouped by kind,
 *  with guides for the venues NextTex cannot ship.  A choice is one
 *  press and goes back to the form; a template whose class this TeX
 *  lacks says so, and Create installs it first.
 */

async function openBrowser(page: Page) {
  await page.getByTestId("new-project").click();
  const sheet = page.getByTestId("way-form");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("template-chosen")).toContainText("An article");
  await sheet.getByTestId("template-change").click();
  await expect(sheet.getByTestId("template-browser")).toBeVisible();
  return sheet;
}

const titles = (sheet: ReturnType<Page["getByTestId"]>) =>
  sheet.getByTestId("template-list").locator(".nx-template-row .nx-template-title");

test("the browser finds a venue by name, narrows by kind, and chooses in one press", async ({
  app,
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const sheet = await openBrowser(page);
  await expect(sheet.getByRole("heading", { name: "Start from" })).toBeVisible();

  // Everything, the everyday six first.
  await expect(titles(sheet).first()).toHaveText("An article");
  await expect(sheet.getByTestId("template-basic")).toHaveAttribute("aria-pressed", "true");

  // Every word typed, in the title, the venue or the class.
  const find = sheet.getByTestId("template-find");
  await expect(find).toBeFocused();
  await find.fill("elsevier");
  await expect(titles(sheet)).toHaveText(["Elsevier article", "Elsevier CAS article"]);
  await find.fill("ieee journal");
  await expect(titles(sheet)).toHaveText(["IEEE journal article"]);
  await find.fill("nothing like this anywhere");
  await expect(sheet.getByTestId("template-list")).toContainText("Nothing matches.");

  // Escape in the field clears it first, and does not close the sheet.
  await page.keyboard.press("Escape");
  await expect(find).toHaveValue("");
  await expect(sheet.getByTestId("template-browser")).toBeVisible();

  // A kind chip narrows the list to its group.
  await sheet.getByTestId("template-kind-conference").click();
  await expect(sheet.getByTestId("template-kind-conference")).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByTestId("template-list").locator("section")).toHaveCount(1);
  await expect(titles(sheet)).toHaveText(["ACM paper", "IEEE conference paper", "Springer LNCS"]);

  // A guide opens in place with its steps and the publisher's page, and
  // has nothing to choose.
  const icml = sheet.getByTestId("guide-icml");
  await expect(icml.locator("ol")).toHaveCount(0);
  await sheet.getByTestId("guide-icml-how").click();
  await expect(icml.locator("ol li")).toHaveCount(3);
  const official = icml.getByRole("link", { name: "Open the official page" });
  await expect(official).toHaveAttribute("href", /^https:\/\/icml\.cc\//);
  await expect(official).toHaveAttribute("target", "_blank");
  await expect(icml.locator("[aria-pressed]")).toHaveCount(0);

  // Read in both themes, with the guide open, by axe's contrast rule
  // among the rest.  The theme is the writer's stored choice, not the
  // system's, so it is set the way the settings sheet keeps it, and the
  // page reads it again; the browser is opened back to the same state.
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((chosen) => localStorage.setItem("nexttex.theme", chosen), theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByText("Projects", { exact: false }).first().waitFor();
    const again = await openBrowser(page);
    await again.getByTestId("template-kind-conference").click();
    await again.getByTestId("guide-icml-how").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const found = await new AxeBuilder({ page }).include('[data-testid="way-form"]').analyze();
    expect(found.violations.map((v) => `${theme} ${v.id}: ${v.nodes.length}`)).toEqual([]);
  }

  // Enter chooses the first match and goes back to the form.
  await find.fill("lncs");
  await page.keyboard.press("Enter");
  await expect(sheet.getByTestId("template-browser")).toHaveCount(0);
  await expect(sheet.getByTestId("template-chosen")).toContainText("Springer LNCS");
  await expect(sheet.getByPlaceholder("What is it called?")).toBeVisible();

  // A press on a row does the same; Back and a second Escape go back
  // without choosing.
  await sheet.getByTestId("template-change").click();
  await sheet.getByTestId("template-thesis").click();
  await expect(sheet.getByTestId("template-chosen")).toContainText("A thesis");
  await sheet.getByTestId("template-change").click();
  await sheet.getByTestId("template-back").click();
  await expect(sheet.getByTestId("template-chosen")).toContainText("A thesis");
  await sheet.getByTestId("template-change").click();
  await page.keyboard.press("Escape");
  await expect(sheet.getByTestId("template-chosen")).toContainText("A thesis");
  await expect(sheet).toBeVisible();
});

base("a venue whose class this TeX lacks installs it, then opens on its document", async ({
  page,
}, info) => {
  const log = join(info.outputPath(), "tlmgr.jsonl");
  const app = await startServer({
    NEXTTEX_TLMGR: join(ROOT, "tests", "fake_tlmgr.py"),
    NEXTTEX_FAKE_TLMGR_LOG: log,
    NEXTTEX_KPSEWHICH: join(ROOT, "tests", "fake_kpsewhich.py"),
    NEXTTEX_FAKE_KPSEWHICH_LACKS: "acmart.cls=acmart",
  });
  try {
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    const sheet = await openBrowser(page);
    await baseExpect(sheet.getByTestId("template-acm")).toContainText("Installs acmart");
    await sheet.getByTestId("template-acm").click();

    await baseExpect(sheet.getByTestId("template-chosen")).toContainText("ACM paper");
    await baseExpect(sheet.getByTestId("template-needs")).toContainText("does not have acmart yet");
    await sheet.getByPlaceholder("What is it called?").fill("Graph sparsifiers");
    await sheet.getByPlaceholder(/Where to put it/).fill(`${app.projects}/graph-sparsifiers`);
    await sheet.getByRole("button", { name: "Install acmart and create" }).click();

    // It opens on the venue's own document, and the stand-in saw the one
    // install.
    await baseExpect(page.locator(".cm-content")).toContainText("acmart", { timeout: 30_000 });
    const calls = readFileSync(log, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
    baseExpect(calls).toEqual([["install", "acmart"]]);

    // Asked again after the install, the TeX has it.
    const listed = await (await fetch(`${app.base}/api/templates`, {
      headers: { "x-nexttex-token": app.token },
    })).json();
    const acm = listed.templates.find((t: { name: string }) => t.name === "acm");
    baseExpect(acm.missing).toEqual([]);
  } finally {
    await app.stop();
  }
});
