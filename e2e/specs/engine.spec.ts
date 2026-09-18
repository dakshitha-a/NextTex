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

/** Shell escape: the project asks in its own toml, this machine answers
 *  once, and the flag never reaches a build silently.  The document runs
 *  `touch` through `\write18`, which restricted shell escape refuses and
 *  the flag allows, so the marker file is the proof of which build ran. */
test("a project's request for shell escape is answered here, in two presses", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const put = (path: string, text: string) =>
    fetch(`${app.base}/api/projects/${project.id}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ path, text, compile: false, create: true }),
    });
  await put(
    "main.tex",
    "\\documentclass{article}\n\\begin{document}\n"
    + "\\immediate\\write18{touch escaped.txt}\nHello.\n\\end{document}\n",
  );
  // Before the project asks: no question anywhere, and no flag.
  expect((await compile(app, project.id)).shellEscape).toBe("off");
  await expect(tab.getByTestId("status-shell-escape")).toHaveCount(0);

  // The toml saved in the editor is read without a restart, and the strip
  // says the question is standing even though the build has no errors.
  await put("nexttex.toml", '[project]\nname = "T"\nshell_escape = true\n');
  await expect(tab.getByTestId("status-shell-escape")).toBeVisible({ timeout: 15_000 });
  expect((await compile(app, project.id)).shellEscape).toBe("asked");
  const marker = `${app.base}/api/projects/${project.id}/file?path=escaped.txt`;
  const exists = async () =>
    (await fetch(marker, { headers: { "x-nexttex-token": app.token } })).status === 200;
  expect(await exists()).toBe(false);

  // The strip opens the drawer for the question; the first press says
  // what it would do, the second does it.
  await tab.getByTestId("status").click();
  const ask = tab.getByTestId("shell-escape-ask");
  await expect(ask).toBeVisible();
  const allow = ask.getByTestId("shell-escape-allow");
  await allow.click();
  await expect(allow).toHaveText("Yes, allow it on this computer");
  await expect(ask).toContainText("until you revoke it in Settings");
  await allow.click();
  await expect(ask).toHaveCount(0, { timeout: 15_000 });

  // The build that follows carries the flag, and the document's program ran.
  await expect.poll(exists, { timeout: 60_000 }).toBe(true);
  expect((await compile(app, project.id)).shellEscape).toBe("on");

  // The sheet shows the answer and takes it back in one press.
  await tab.getByTestId("appearance").first().click();
  const row = tab.getByRole("dialog", { name: "Settings" }).getByTestId("shell-escape-row");
  await expect(row).toContainText("allowed on this computer");
  await row.getByTestId("shell-escape-revoke").click();
  await expect(row).toContainText("the project asks for it");
  expect((await compile(app, project.id)).shellEscape).toBe("asked");
});
