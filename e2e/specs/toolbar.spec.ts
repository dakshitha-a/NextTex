import { test, expect } from "../fixtures";

/** The project bar: sharing, settings, and getting a copy out.
 *
 *  It is a 32px strip that also has to hold the project's name, and "Zip"
 *  and "PDF" spelled out were two words competing with that name for the
 *  room -- two controls that mean the same thing, "give me a copy", sitting
 *  side by side as though they were unrelated.
 */

test("both downloads live behind one button", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

  // Nothing is spelled out on the bar itself any more.
  const bar = tab.getByTestId("open-download").locator("xpath=..");
  await expect(bar.getByText("Zip", { exact: true })).toHaveCount(0);

  await expect(tab.getByTestId("download-menu")).toHaveCount(0);
  await tab.getByTestId("open-download").click();

  const menu = tab.getByTestId("download-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("download-zip")).toBeVisible();
  await expect(menu.getByTestId("download-pdf")).toBeVisible();

  // The formats are named, because "Whole project" and "Typeset page" say
  // what you get and the extension says what lands in the folder.
  await expect(menu).toContainText(".zip");
  await expect(menu).toContainText(".pdf");
});

test("the menu closes without choosing", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("open-download").click();
  await expect(tab.getByTestId("download-menu")).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("download-menu")).toHaveCount(0);
});

test("choosing one puts the menu away", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("open-download").click();
  await tab.getByTestId("download-zip").click();
  // Left open, the menu would sit over the file list while the download
  // happens somewhere the page cannot see.
  await expect(tab.getByTestId("download-menu")).toHaveCount(0);
});

test("the icon buttons still say what they are", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // A glyph with no accessible name is a button nobody navigating by name
  // can find, and these lost their text when they became icons.
  await expect(tab.getByRole("button", { name: "Share this project" }))
    .toBeVisible();
  await expect(tab.getByRole("button", { name: "Download a copy" }))
    .toBeVisible();
});

test("the word count says what it counted, and remembers", async ({ tab }) => {
  // R-100. The scope was plain `useState`, so a writer who counts their
  // chapter chose it again every session, and there were two scopes where
  // the two a writer asks about most are a selection and the section they
  // are in.
  // The status strip drops the count below a 640px pane, deliberately, and
  // the editor half of a default window is narrower than that. The rail
  // and the agent panel go away rather than the window growing, because a
  // remembered pane width survives a resize and would not give the room
  // back.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.keyboard.press("Control+b");
  await tab.keyboard.press("Control+Alt+a");
  const count = tab.getByTestId("word-count");
  await expect(count).toBeVisible({ timeout: 60_000 });

  // Round the cycle to "in file" and leave it there.
  for (let press = 0; press < 4; press += 1) {
    if ((await count.innerText()).includes("in file")) break;
    await count.click();
    await tab.waitForTimeout(400);
  }
  await expect(count).toContainText("in file");

  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.keyboard.press("Control+b");
  await tab.keyboard.press("Control+Alt+a");
  await expect(tab.getByTestId("word-count")).toContainText("in file", {
    timeout: 60_000,
  });
});

test("moving the caret does not re-count the document", async ({ tab }) => {
  // The scoped word count arrived with the cursor line, the outline, the
  // line count and the selection in its effect's dependencies, because
  // those are what the section and selection spans are computed from. The
  // span is what the count actually depends on, and in the two scopes a
  // writer leaves it on, document and file, there is no span at all: every
  // arrow key was a round trip that ran texcount over the whole project.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.keyboard.press("Control+b");
  await tab.keyboard.press("Control+Alt+a");
  await expect(tab.getByTestId("word-count")).toBeVisible({ timeout: 60_000 });
  // The first count, and any the reload behind it asked for, are not the
  // subject: the count is started here and the arrows come after it.
  await tab.waitForTimeout(1_500);

  let counted = 0;
  const watch = (request: { url(): string }) => {
    if (request.url().includes("/words")) counted += 1;
  };
  tab.on("request", watch);
  try {
    await tab.locator(".cm-content").click();
    for (let press = 0; press < 8; press += 1) {
      await tab.keyboard.press("ArrowDown");
    }
    await tab.waitForTimeout(1_500);
    // Clicking into the editor moves the caret, which is one legitimate
    // change of state; eight arrow keys after it must add nothing.
    expect(counted, "the caret moved and the document was counted again").toBeLessThan(2);
  } finally {
    tab.off("request", watch);
  }
});
