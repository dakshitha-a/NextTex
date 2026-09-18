import { test, expect } from "../fixtures";

/** Which engine builds a document.
 *
 *  pdflatex was the only one for a long time.  The settings card now has an
 *  Engine row that writes an `engine` key into the project's toml, and a
 *  `% !TeX program` line at the top of a document wins over it.  The build
 *  is asked for through the compile route, which answers with the engine
 *  it ran, because the status strip does not say which engine built the
 *  page and the event stream helper keeps only event types.
 */

async function compile(
  app: { base: string; token: string },
  projectId: string,
): Promise<{ engine: string; outcome: string }> {
  const response = await fetch(`${app.base}/api/projects/${projectId}/compile`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ full: false }),
  });
  return response.json();
}

test("the engine is chosen on the settings card and the document's first line wins", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

  // The default, drawn as pdflatex rather than as nothing pressed.
  await tab.getByTestId("appearance").first().click();
  const sheet = tab.getByRole("dialog", { name: "Settings" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("engine-pdflatex")).toHaveAttribute("aria-pressed", "true");

  await sheet.getByTestId("engine-xelatex").click();
  await expect(sheet.getByTestId("engine-xelatex")).toHaveAttribute("aria-pressed", "true");
  await tab.getByTestId("settings-close").click();

  // A build now runs xelatex, and the choice went into the project's own
  // file rather than this browser.
  await expect.poll(async () => (await compile(app, project.id)).engine, {
    timeout: 60_000,
  }).toBe("xelatex");
  const opened = await fetch(`${app.base}/api/projects/${project.id}/open`, {
    method: "POST", headers: { "x-nexttex-token": app.token },
  }).then((r) => r.json());
  expect(opened.engine).toBe("xelatex");

  // The magic comment beats the card: it travels with the file into every
  // editor the co-authors use.
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+Home");
  await tab.keyboard.type("% !TeX program = lualatex\n");
  await expect(tab.locator(".cm-line").first()).toContainText("!TeX program = lualatex");
  await expect.poll(async () => (await compile(app, project.id)).engine, {
    timeout: 60_000,
  }).toBe("lualatex");

  // And the card still says what the project asked for, not what the
  // document overrode it with.
  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("appearance").first().click();
  await expect(tab.getByRole("dialog", { name: "Settings" }).getByTestId("engine-xelatex"))
    .toHaveAttribute("aria-pressed", "true");
});
